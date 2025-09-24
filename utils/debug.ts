// utils/debug.ts

export const debugEnabled = (ch: string) => {
  if (typeof window === 'undefined') return false;
  const qs = new URLSearchParams(location.search).get("debug")?.split(",") ?? [];
  const ls = (localStorage.getItem("slides_debug") || "").split(",");
  const set = new Set([...qs, ...ls].map(s => s.trim()).filter(Boolean));
  return set.has("all") || set.has(ch);
};

const maskSecrets = (s: string) =>
  s.replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9\.\-\_]+/gi, "$1•••")
   .replace(/("?(token|api[_-]?key|download_token|access[_-]?token)"?\s*:\s*")([^"]+)(")/gi, '$1•••$4');

const hdrsToString = (h: Headers) => {
  const arr: string[] = [];
  h.forEach((v, k) => arr.push(`${k}: ${k.toLowerCase().includes("authorization") ? "•••" : v}`));
  return arr.join("\n");
};

const dumpFormData = async (fd: FormData) => {
  const parts: string[] = [];
  for (const [k, v] of fd.entries()) {
    if (v instanceof File) parts.push(`${k}: [file ${v.name} ${v.type || "application/octet-stream"} ${v.size}B]`);
    else parts.push(`${k}: ${String(v).slice(0, 1000)}`);
  }
  return parts.join("\n");
};

const now = () => new Date().toISOString();
const log = (onLog?: (s: string)=>void, ch = "NET", msg = "") => {
  if (!onLog || !debugEnabled(ch.toLowerCase())) return;
  onLog(`[${now()}] [${ch}] ${msg}`);
};

// Wrap fetch with request/response tracing and retry logic
export async function debugFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  onLog?: (s: string)=>void,
  opts: { label?: string; bodyPreview?: boolean; retries?: number } = {}
) {
  const { label = "HTTP", bodyPreview = true, retries = 1 } = opts;
  let attempt = 0;
  let lastError: any;

  while(attempt < retries) {
    attempt++;
    const start = performance.now();
    try {
      if (attempt > 1) {
        const delay = 1000 * (attempt - 1);
        log(onLog, "NET", `Retrying request for "${label}" (${attempt}/${retries}) in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      
      const method = (init?.method || "GET").toUpperCase();
      const url = typeof input === "string" ? input : (input as URL).toString();
      const headers = new Headers(init?.headers || {});
      if (debugEnabled("net")) {
        let bodyStr = "";
        if (init?.body instanceof FormData) {
          bodyStr = await dumpFormData(init.body);
        } else if (typeof init?.body === "string") {
          bodyStr = maskSecrets(init.body as string);
        }
        log(onLog, "NET", `▶ ${method} ${url}\nHeaders:\n${hdrsToString(headers)}${bodyStr ? `\nBody:\n${bodyStr}` : ""}`);
      }

      const res = await fetch(input, init);
      const ms = Math.round(performance.now() - start);
      const ray = res.headers.get("cf-ray") || res.headers.get("x-amz-cf-id") || "-";
      const respHdrs = hdrsToString(res.headers);
      log(onLog, "NET", `◀ ${method} ${url} → ${res.status} ${res.statusText} (${ms} ms) ray=${ray}`);
      if (debugEnabled("headers")) log(onLog, "NET", `Response Headers:\n${respHdrs}`);

      if (!res.ok && res.status >= 500 && attempt < retries) {
          log(onLog, "NET", `Server error ${res.status} for "${label}". Retrying...`);
          lastError = new Error(`Server error: ${res.status} ${res.statusText}`);
          continue;
      }
      
      const ctype = res.headers.get("content-type") || "";
      if (bodyPreview !== false && (ctype.includes("application/json") || (ctype.includes("text/") && !ctype.includes("event-stream")))) {
        try {
          const preview = await res.clone().text();
          if (preview) {
            const short = maskSecrets(preview).slice(0, 4000);
            log(onLog, "NET", `Response Preview:\n${short}${preview.length > 4000 ? "\n…(truncated)" : ""}`);
          }
        } catch { /* ignore */ }
      }
      return res;
    } catch (err: any) {
      lastError = err;
      const ms = Math.round(performance.now() - start);
      log(onLog, "NET", `✖ ${label} (attempt ${attempt}) failed after ${ms} ms: ${err?.message || err}`);
      
      const isNetworkError = err.name === 'TypeError';
      if (isNetworkError && attempt < retries) {
          continue;
      }
      
      throw err;
    }
  }
  
  throw lastError || new Error(`${label} request failed after ${retries} attempts.`);
}