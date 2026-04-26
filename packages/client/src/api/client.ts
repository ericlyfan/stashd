import { Category, ClassificationResult, Document } from '@stashd/shared';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listDocuments(search?: string, category?: string): Promise<Document[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  return req<Document[]>(`/documents?${params}`);
}

export function getDocument(id: string): Promise<Document> {
  return req<Document>(`/documents/${id}`);
}

export function updateDocument(id: string, updates: { category?: string; tags?: string[]; notes?: string }): Promise<Document> {
  return req<Document>(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function deleteDocument(id: string): Promise<void> {
  return req<void>(`/documents/${id}`, { method: 'DELETE' });
}

export function fileDocument(jobId: string, data: {
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
}): Promise<Document> {
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
