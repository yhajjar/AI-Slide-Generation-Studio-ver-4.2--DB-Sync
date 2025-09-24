import type { GeneratedSlide } from './types';
import { createSSEParser } from './sse';
import { createExtractionState, walkEvent, finalizeSlides, OnPartialHtml } from './extractSlides';
import { debugFetch, debugEnabled } from '../utils/debug';


// --- tiny debug helpers (no new files, no UI changes)
const now = () => new Date().toISOString();
const log = (onLog?: (s: string)=>void, ch = "NET", msg = "") => {
  if (!onLog || !debugEnabled(ch.toLowerCase())) return;
  onLog(`[${now()}] [${ch}] ${msg}`);
};

interface GlmApiParams {
  prompt: string;
  apiKey: string;
  onComplete?: (conversationId: string, slides: GeneratedSlide[]) => void;
  onError?: (error: string) => void;
  onPartial?: (data: { pos: number; html: string; complete: boolean }) => void;
  conversationId?: string;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
  kbId?: string;
}

export async function callGlmAgent({
  prompt,
  apiKey,
  onComplete,
  onError,
  onPartial,
  conversationId,
  signal,
  onLog,
  kbId,
}: GlmApiParams) {
  const body: {
    agent_id: string;
    stream: boolean;
    messages: { role: string; content: { type: string; text: string }[] }[];
    conversation_id?: string;
    tools?: any[];
  } = {
    agent_id: 'slides_glm_agent',
    stream: true,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ],
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }
  
  if (kbId) {
    onLog?.(`[GLM API] Knowledge Base ID available: ${kbId}`);
  }

  try {
    onLog?.(`[GLM API] Sending request... Conversation ID: ${conversationId || 'New'}`);
    const response = await debugFetch('https://open.bigmodel.cn/api/v1/agents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal,
    }, onLog, { label: "agents", bodyPreview: false, retries: 3 });
    
    onLog?.(`[GLM API] Request sent. Status: ${response.status}`);

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const ctype = response.headers.get("content-type") || "";
    log(onLog, "SSE", `connected status=${response.status} ray=${response.headers.get("cf-ray") || "-"} content-type=${ctype}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finalConvId = conversationId || '';
    let rawSseBuffer = '';
    
    const logFn = onLog || (() => {});
    const extractionState = createExtractionState();
    const seenEventIds = new Set<string>();

    const onPartialCallback: OnPartialHtml = (pos, html, complete) => {
        onPartial?.({ pos, html, complete });
    };
    
    let shouldBreakLoop = false;
    const parse = createSSEParser(evt => {
        if (evt.id && seenEventIds.has(evt.id)) {
            if (debugEnabled("sse")) log(onLog, "SSE", `dedup skip id=${evt.id}`);
            return;
        }
        if (evt.id) {
            seenEventIds.add(evt.id);
        }

        if (debugEnabled("sse-raw")) log(onLog, "SSE-RAW", evt.data);

        try {
            if (evt.data.trim() === '[DONE]') {
                logFn('[SSE] Received [DONE] marker.');
                shouldBreakLoop = true;
                return;
            }
            const eventData = JSON.parse(evt.data);

            if (debugEnabled("sse")) {
                const choice = eventData?.choices?.[0];
                const msg = choice?.messages?.[0] ?? choice?.message;
                const phase = msg?.phase ?? eventData?.phase;
                const content = msg?.content;
                let toolInfo = "";
                if (Array.isArray(content)) {
                    for(const part of content) {
                        if (part?.type === 'object' && part.object) {
                            const tool = String(part.object.tool_name || part.object.name || "").toLowerCase();
                            const pos = part.object.position?.[0] ?? part.object.page_index;
                            const isAdd = /insert|add/.test(tool) && /page|slide/.test(tool);
                            if (isAdd) {
                                toolInfo += ` tool=${tool}${pos != null ? ` pos=${pos}` : ''}`;
                            }
                        }
                    }
                }
                log(onLog, "SSE", `phase=${phase || "-"}${toolInfo}`);
            }

            if (eventData.conversation_id && !finalConvId) {
                finalConvId = eventData.conversation_id;
            }
            walkEvent(extractionState, eventData, logFn, onPartialCallback);
        } catch (e) {
             logFn(`[SSE] Error parsing event data: ${e}. Data: ${evt.data}`);
        }
    });

    onLog?.('[GLM API] Waiting for stream...');
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        logFn?.('[GLM API] Stream closed by server.');
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      rawSseBuffer += chunk;
      parse(chunk);

      if (shouldBreakLoop) {
        logFn?.('[GLM API] Breaking read loop after receiving [DONE].');
        break;
      }
    }
    
    parse("", { flush: true }); // Flush any remaining buffer
    onLog?.('[GLM API] Stream finished.');

    if (typeof window !== 'undefined') {
        (window as any).__SSE_LAST__ = { runId: finalConvId, raw: rawSseBuffer };
    }

    if (onComplete) {
      const finalDeck = finalizeSlides(extractionState);
      const finalSlides: GeneratedSlide[] = finalDeck.map(s => ({
          pageNumber: s.position,
          html: s.html,
          draft: s.html,
          complete: true,
      }));
      onComplete(finalConvId, finalSlides);
    }

  } catch (error: any) {
    let message = error instanceof Error ? error.message : 'An unknown error occurred';
    onLog?.(`[GLM API] Error: ${message}`);

    if (error.name === 'AbortError') {
      message = 'Request aborted by client.';
      onLog?.(`[GLM API] ${message}`);
    } else if (error.name === 'TypeError') {
      message = "A network error occurred after multiple retries. This could be due to a CORS policy, a firewall, or loss of internet connectivity. Please check your network and the server's status.";
      onLog?.(`[GLM API] A persistent network error was caught. This is often a CORS or connectivity issue.`);
    }

    console.error('GLM API Error:', error);
    if (onError) {
      onError(message);
    }
  }
}

export function addPage(params: Omit<GlmApiParams, 'conversationId'>) {
    return callGlmAgent(params);
}

export function updatePage(params: GlmApiParams) {
    if (!params.conversationId) {
        const errMsg = "conversationId is required for updatePage";
        console.error(errMsg);
        if (params.onError) params.onError(errMsg);
        return;
    }
    return callGlmAgent(params);
}