import { Category, Document, SearchHit, SSEEvent } from '@stashd/shared';

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

export function uploadDocument(file: File): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append('file', file);
  return req<{ jobId: string }>('/documents/upload', { method: 'POST', body: form });
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
