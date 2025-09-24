// n8nApi.ts
import { CourseType, WPCourse } from './types';
import { debugFetch } from '../utils/debug';

const N8N_UPSERT_URL = 'https://n8n.myapps.mylabs.click/webhook/upsert';
const N8N_RETRIEVE_URL = 'https://n8n.myapps.mylabs.click/webhook/retrieve';

// Base URL for all WordPress-related n8n webhooks.
const WP_WEBHOOK_BASE_URL = 'https://n8n.ankapps.ankabut.ac.ae/webhook';


const log = (onLog?: (s: string) => void, msg = "") => {
  if (!onLog) return;
  onLog(`[${new Date().toISOString()}] [n8nAPI] ${msg}`);
};

interface UpsertResponse {
  sourceId: string;
}

export async function upsertDocument(
  file: File,
  metadata: { runId: string; topic: string },
  onLog?: (message: string) => void
): Promise<UpsertResponse> {
  log(onLog, `Uploading document "${file.name}" for topic "${metadata.topic}" with runId ${metadata.runId}`);
  
  const formData = new FormData();
  // Explicitly append fields with the correct keys as required by the n8n webhook.
  formData.append('file', file);
  formData.append('runId', metadata.runId);
  formData.append('topic', metadata.topic);

  // Add logging to verify the keys being sent in FormData, to help debug the discrepancy.
  if (onLog) {
      const keys = Array.from(formData.keys()).join(', ');
      log(onLog, `FormData keys being sent: [${keys}]`);
  }

  try {
    const response = await debugFetch(N8N_UPSERT_URL, {
      method: 'POST',
      body: formData,
    }, onLog, { label: 'n8n-upsert' });

    log(onLog, `Upload response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n document upsert failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    log(onLog, `Upload response JSON: ${JSON.stringify(result)}`);
    
    // The n8n /upsert endpoint must return a `sourceId` to identify the document for retrieval.
    if (!result.sourceId) {
        throw new Error('`sourceId` not found in n8n upsert response.');
    }

    return result as UpsertResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(onLog, `Upsert error: ${message}`);
    throw error;
  }
}

export interface SlideRequestInfo {
    id: number;
    contentType: string;
    autoMode: boolean;
    userContent: string;
    interactive: string;
}

interface RetrieveParams {
  runId: string;
  sourceId: string;
  topic: string;
  courseType: CourseType;
  slides: SlideRequestInfo[];
}

interface RetrieveResponseItem {
    id: number;
    SlideContent: string;
}


export async function retrieveGroundTruth(
  params: RetrieveParams,
  onLog?: (message: string) => void
): Promise<RetrieveResponseItem[]> {
  log(onLog, `Retrieving ground truth for sourceId "${params.sourceId}" with runId ${params.runId}`);

  try {
    const response = await debugFetch(N8N_RETRIEVE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }, onLog, { label: 'n8n-retrieve' });
    
    log(onLog, `Retrieve response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n ground truth retrieval failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    log(onLog, `Retrieve response JSON: ${JSON.stringify(result)}`);
    
    if (!result || !Array.isArray(result)) {
        throw new Error('n8n retrieve response is not a valid array.');
    }

    // Validate that each item has an ID to ensure correct slide mapping.
    for (const item of result) {
        if (typeof item.id !== 'number') {
            throw new Error(`n8n retrieve response item is missing a numeric 'id' field. Item: ${JSON.stringify(item)}`);
        }
    }

    return result as RetrieveResponseItem[];

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(onLog, `Retrieve error: ${message}`);
    throw error;
  }
}

// --- WordPress Export APIs ---

async function handleWpApiError(res: Response, context: string): Promise<Error> {
    const errorText = await res.text();
    let message = `Failed to ${context}: ${res.status} ${res.statusText || ''}`.trim();
    try {
        const errorJson = JSON.parse(errorText);
        const n8nError = errorJson.error?.message || errorJson.message;
        if (n8nError) {
            message = `Failed to ${context}: n8n workflow execution failed. See logs for details.`;
        }
    } catch {
        // Not a JSON error, stick with the original message.
    }
    return new Error(message);
}

// This is the type of the raw response from the webhook for a single course.
interface WPCourseFromWebhook {
    course_id: number;
    course_title: string;
}

export async function wpSearchCourses(q: string, page = 1, onLog?: (message: string) => void): Promise<{ items: WPCourse[], total: number }> {
  const baseUrl = `${WP_WEBHOOK_BASE_URL}/get-courses`;
  const params = new URLSearchParams();
  params.append('page', page.toString());

  if (q && q.trim()) {
    params.append('query', q.trim());
  }

  const url = `${baseUrl}?${params.toString()}`;

  const res = await debugFetch(url, {
    method: 'GET',
  }, onLog, { label: 'wp-search-courses' });

  if (!res.ok) throw await handleWpApiError(res, 'fetch courses');
  
  // The webhook returns an array of courses directly with different key names.
  const rawCourses: WPCourseFromWebhook[] = await res.json();

  // Map the raw response to the internal WPCourse format used by the application.
  const items: WPCourse[] = rawCourses.map(course => ({
      id: course.course_id,
      title: course.course_title,
  }));
  
  // The total count is the length of the returned array, as there's no separate total field.
  const total = items.length;

  return { items, total };
}

export async function wpCreateCourse(payload: { title: string; description?: string }, onLog?: (message: string) => void): Promise<{ courseId: number }> {
  const res = await debugFetch(`${WP_WEBHOOK_BASE_URL}/create-course`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, onLog, { label: 'wp-create-course' });
  if (!res.ok) throw await handleWpApiError(res, 'create course');
  return res.json();
}

export interface WpExportPayload {
  mode: 'new' | 'existing';
  course: { id: number } | { title: string; description?: string };
  lesson: { title: string };
  topics: { title: string; html: string }[];
  publish: 'draft' | 'publish';
  runId?: string | null;
  conversationId?: string | null;
}

export async function wpStartExport(payload: WpExportPayload, onLog?: (message: string) => void): Promise<{ status: string }> {
  const res = await debugFetch(`${WP_WEBHOOK_BASE_URL}/create-lesson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, onLog, { label: 'wp-create-lesson' });
  if (!res.ok) throw await handleWpApiError(res, 'start export');
  return res.json();
}