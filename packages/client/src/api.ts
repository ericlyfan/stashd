import {
  Category,
  ChatSSEEvent,
  Conversation,
  ConversationDetail,
  Document,
  DocumentLink,
  LineItem,
  LineItemInput,
  ProjectDetail,
  ProjectSummary,
  SearchHit,
  SSEEvent,
  UploadResponse,
} from '@stashd/shared';

export type { ProjectSummary, ProjectDetail, LineItem, LineItemInput, DocumentLink } from '@stashd/shared';

export type { UploadResponse } from '@stashd/shared';

export type { SearchHit } from '@stashd/shared';

export type { ClassificationResult } from '@stashd/shared';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listDocuments(search?: string, category?: string): Promise<SearchHit[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  return req<SearchHit[]>(`/documents?${params}`);
}

export interface BatchDocumentUpdates {
  category?: string;
  status?: 'pending' | 'filed';
  addTags?: string[];
  removeTags?: string[];
}

export function batchUpdateDocuments(ids: string[], updates: BatchDocumentUpdates): Promise<{ updated: number }> {
  return req<{ updated: number }>('/documents', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, ...updates }),
  });
}

export function getDocument(id: string): Promise<Document> {
  return req<Document>(`/documents/${id}`);
}

export function updateDocument(
  id: string,
  updates: { category?: string; tags?: string[]; notes?: string; status?: 'pending' | 'filed' },
): Promise<Document> {
  return req<Document>(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function deleteDocument(id: string): Promise<void> {
  return req<void>(`/documents/${id}`, { method: 'DELETE' });
}

export interface FilePayload {
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  dateExtracted?: string;
  amount?: number;
  vendor?: string;
  notes?: string;
  confidenceScore: number;
  flagForLater?: boolean;
}

export function fileDocument(jobId: string, data: FilePayload): Promise<Document> {
  return req<Document>(`/documents/file/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function discardJob(jobId: string): Promise<void> {
  return req<void>(`/documents/job/${jobId}`, { method: 'DELETE' });
}

export function uploadDocument(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  return req<UploadResponse>('/documents/upload', { method: 'POST', body: form });
}

export interface CategoryWithCount extends Category {
  documentCount: number;
}

export function listCategories(): Promise<CategoryWithCount[]> {
  return req<CategoryWithCount[]>('/categories');
}

export function createCategory(name: string): Promise<CategoryWithCount> {
  return req<CategoryWithCount>('/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function deleteCategory(id: string): Promise<void> {
  return req<void>(`/categories/${id}`, { method: 'DELETE' });
}

export function updateCategory(
  id: string,
  updates: { name?: string; icon?: string; color?: string },
): Promise<CategoryWithCount> {
  return req<CategoryWithCount>(`/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function fileUrl(docId: string): string {
  return `${BASE}/documents/${docId}/file`;
}

// ── Chat ────────────────────────────────────────────────────────────────────

export function listConversations(): Promise<Conversation[]> {
  return req<Conversation[]>('/chat');
}

export function createConversation(): Promise<Conversation> {
  return req<Conversation>('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return req<ConversationDetail>(`/chat/${id}`);
}

export function deleteConversation(id: string): Promise<void> {
  return req<void>(`/chat/${id}`, { method: 'DELETE' });
}

export function setConversationPins(id: string, docIds: string[]): Promise<{ pinnedDocIds: string[] }> {
  return req<{ pinnedDocIds: string[] }>(`/chat/${id}/pins`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docIds }),
  });
}

/**
 * Send a message and stream the assistant's answer. EventSource can't POST,
 * so this reads the SSE body off a fetch stream. Resolves once the stream
 * ends (after a `done` or `error` event).
 */
export async function sendChatMessage(
  conversationId: string,
  content: string,
  onEvent: (event: ChatSSEEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/chat/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ChatSSEEvent);
      } catch {
        // ignore malformed events
      }
    }
  }
}

// ── Ledgers (projects + line items) ──────────────────────────────────────────

export function listProjects(): Promise<ProjectSummary[]> {
  return req<ProjectSummary[]>('/projects');
}

export function createProject(name: string, description?: string): Promise<ProjectSummary> {
  return req<ProjectSummary>('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

export function getProject(id: string): Promise<ProjectDetail> {
  return req<ProjectDetail>(`/projects/${id}`);
}

export function updateProject(
  id: string,
  updates: { name?: string; description?: string; status?: 'active' | 'archived' },
): Promise<ProjectSummary> {
  return req<ProjectSummary>(`/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function deleteProject(id: string): Promise<void> {
  return req<void>(`/projects/${id}`, { method: 'DELETE' });
}

export function addLineItem(projectId: string, input: LineItemInput): Promise<LineItem> {
  return req<LineItem>(`/projects/${projectId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateLineItem(projectId: string, itemId: string, input: LineItemInput): Promise<LineItem> {
  return req<LineItem>(`/projects/${projectId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteLineItem(projectId: string, itemId: string): Promise<void> {
  return req<void>(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' });
}

export function getDocumentLinks(docId: string): Promise<DocumentLink[]> {
  return req<DocumentLink[]>(`/projects/by-document/${docId}`);
}

export function subscribeClassify(jobId: string, onEvent: (event: SSEEvent) => void): EventSource {
  const es = new EventSource(`${BASE}/documents/process/${jobId}`);
  es.onmessage = e => {
    try {
      const event = JSON.parse(e.data) as SSEEvent;
      onEvent(event);
      if (event.stage === 'complete' || event.stage === 'error') es.close();
    } catch {
      // ignore malformed events
    }
  };
  es.onerror = () => {
    // readyState CLOSED after a clean server end also fires onerror; only
    // report if we never closed it ourselves.
    if (es.readyState !== EventSource.CLOSED) {
      onEvent({ stage: 'error', message: 'Connection lost', error: 'SSE connection failed' });
    }
    es.close();
  };
  return es;
}
