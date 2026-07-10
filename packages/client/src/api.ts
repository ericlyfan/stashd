import {
  ApplicationContact,
  ApplicationContactInput,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationStage,
  ApplicationStageInput,
  ApplicationsSnapshot,
  Category,
  ChatActionResolution,
  ChatAttachment,
  ChatSSEEvent,
  Conversation,
  ConversationDetail,
  Document,
  DocumentLink,
  Holding,
  HoldingInput,
  HoldingLot,
  HoldingLotInput,
  LineItem,
  LineItemInput,
  InsiderActivity,
  MoversKind,
  NewsItem,
  PortfolioHealth,
  PortfolioSnapshot,
  PulseItem,
  ScreenerRow,
  StockHistory,
  StockProfile,
  SymbolSuggestion,
  WatchlistItem,
  WatchlistItemInput,
  WatchlistItemWithQuote,
  JobApplication,
  JobApplicationInput,
  ProjectDetail,
  ProjectSummary,
  SearchHit,
  SSEEvent,
  UploadResponse,
} from '@stashd/shared';

export type { ProjectSummary, ProjectDetail, LineItem, LineItemInput, DocumentLink } from '@stashd/shared';
export type {
  Holding,
  HoldingInput,
  HoldingWithQuote,
  HoldingLot,
  HoldingLotInput,
  PortfolioSnapshot,
  PortfolioTotals,
  StockHistory,
  HistoryDay,
  WatchlistItem,
  WatchlistItemInput,
  WatchlistItemWithQuote,
} from '@stashd/shared';

export type { UploadResponse } from '@stashd/shared';

export type { SearchHit } from '@stashd/shared';

export type { ClassificationResult } from '@stashd/shared';

export type {
  ApplicationContact,
  ApplicationContactInput,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationStage,
  ApplicationStageInput,
  ApplicationsSnapshot,
  ApplicationStats,
  EnrichedApplication,
  JobApplication,
  JobApplicationInput,
  StageKind,
  WorkMode,
} from '@stashd/shared';

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

// Lightweight liveness probe for the sidebar status bar. Resolves true only on
// a clean 200 from the local server; any error (server down, network) → false.
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
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

export function batchDeleteDocuments(ids: string[]): Promise<{ deleted: number }> {
  return req<{ deleted: number }>('/documents', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
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

// The server tacks on `attachmentsSpawned` when an email fans its attachments
// out into their own (backgrounded) documents.
export type FiledDocument = Document & { attachmentsSpawned?: number };

export function fileDocument(jobId: string, data: FilePayload): Promise<FiledDocument> {
  return req<FiledDocument>(`/documents/file/${jobId}`, {
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
  updates: { name?: string; icon?: string; color?: string; pinned?: boolean },
): Promise<CategoryWithCount> {
  return req<CategoryWithCount>(`/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// Persist a manual drawer order; returns the full category list re-sorted.
export function reorderCategories(ids: string[]): Promise<CategoryWithCount[]> {
  return req<CategoryWithCount[]>('/categories/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
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
    body: JSON.stringify({}),
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

// Drop a file into a conversation as throwaway context (extracted text only,
// never filed into the stash).
export function addChatAttachment(conversationId: string, file: File): Promise<ChatAttachment> {
  const form = new FormData();
  form.append('file', file);
  return req<ChatAttachment>(`/chat/${conversationId}/attachments`, { method: 'POST', body: form });
}

export function removeChatAttachment(conversationId: string, attachmentId: string): Promise<void> {
  return req<void>(`/chat/${conversationId}/attachments/${attachmentId}`, { method: 'DELETE' });
}

// Resolve a queued write proposal (approval card). The server executes its
// stored args on approve — the client sends only the verdict.
export function resolveChatAction(
  conversationId: string,
  actionId: string,
  approve: boolean,
): Promise<ChatActionResolution> {
  return req<ChatActionResolution>(`/chat/${conversationId}/actions/${actionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approve }),
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
  updates: { name?: string; description?: string; status?: 'active' | 'archived'; isDefault?: boolean },
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

// ── Portfolio (stock holdings) ───────────────────────────────────────────────

// The whole portfolio: every holding enriched with its live price + returns,
// plus rollups in `base` currency. Prices are fetched server-side per request
// (cached ~60s); holdings are valued natively and converted via live FX.
export function getPortfolio(base?: string): Promise<PortfolioSnapshot> {
  return req<PortfolioSnapshot>(`/holdings${base ? `?base=${encodeURIComponent(base)}` : ''}`);
}

export function createHolding(input: HoldingInput): Promise<Holding> {
  return req<Holding>('/holdings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateHolding(id: string, input: HoldingInput): Promise<Holding> {
  return req<Holding>(`/holdings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteHolding(id: string): Promise<void> {
  return req<void>(`/holdings/${id}`, { method: 'DELETE' });
}

// One stock's daily close history + live quote, for the stock detail page.
// `days` trims the series server-side (sparklines only need a short window).
export function getStockHistory(symbol: string, days?: number): Promise<StockHistory> {
  return req<StockHistory>(`/holdings/history/${encodeURIComponent(symbol)}${days ? `?days=${days}` : ''}`);
}

// ── Market discovery ─────────────────────────────────────────────────────────
// Ticker typeahead: merged US (Nasdaq) + Canadian (TSX, ".TO"-suffixed)
// suggestions. Empty on outage — never an error.
export function searchSymbols(q: string): Promise<SymbolSuggestion[]> {
  return req<SymbolSuggestion[]>(`/market/search?q=${encodeURIComponent(q)}`);
}

// Top-of-sector stocks (US, market-cap order). `enrich` adds P/E + analyst
// target upside per row (the value screen; first hit is slower, then cached).
export function getSectorScreener(sector: string, enrich = false): Promise<ScreenerRow[]> {
  return req<ScreenerRow[]>(`/market/screener?sector=${encodeURIComponent(sector)}${enrich ? '&enrich=1' : ''}`);
}

// Insider open-market activity (US symbols; null for Canadian/no filings).
export function getInsiderActivity(symbol: string): Promise<InsiderActivity | null> {
  return req<InsiderActivity | null>(`/market/insiders/${encodeURIComponent(symbol)}`);
}

// The portfolio risk & health report: risk stats vs SPY, correlation and
// concentration warnings, and heuristic rebalancing suggestions.
export function getPortfolioHealth(base?: string): Promise<PortfolioHealth> {
  return req<PortfolioHealth>(`/holdings/health${base ? `?base=${encodeURIComponent(base)}` : ''}`);
}

// Today's US movers.
export function getMarketMovers(kind: MoversKind): Promise<ScreenerRow[]> {
  return req<ScreenerRow[]>(`/market/movers?kind=${kind}`);
}

// Index-proxy tiles for the Discover pulse strip.
export function getMarketPulse(): Promise<PulseItem[]> {
  return req<PulseItem[]>('/market/pulse');
}

// The curated popular-ETFs shelf, priced live (US + Canadian).
export function getPopularEtfs(): Promise<ScreenerRow[]> {
  return req<ScreenerRow[]>('/market/etfs');
}

// Fundamentals for one symbol; pass the resolved quote currency so bare
// Canadian symbols route to TMX.
export function getStockProfile(symbol: string, ccy?: string): Promise<StockProfile | null> {
  return req<StockProfile | null>(`/market/profile/${encodeURIComponent(symbol)}${ccy ? `?ccy=${ccy}` : ''}`);
}

// Recent headlines for one symbol.
export function getStockNews(symbol: string, ccy?: string): Promise<NewsItem[]> {
  return req<NewsItem[]>(`/market/news/${encodeURIComponent(symbol)}${ccy ? `?ccy=${ccy}` : ''}`);
}

// ── Watchlist ────────────────────────────────────────────────────────────────
export function getWatchlist(): Promise<WatchlistItemWithQuote[]> {
  return req<WatchlistItemWithQuote[]>('/watchlist');
}

export function addWatchlist(input: WatchlistItemInput): Promise<WatchlistItem> {
  return req<WatchlistItem>('/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function removeWatchlist(id: string): Promise<void> {
  return req<void>(`/watchlist/${id}`, { method: 'DELETE' });
}

// Edit a watched stock's name / thesis notes / folder ("" clears a field).
export function updateWatchlist(id: string, input: WatchlistItemInput): Promise<WatchlistItem> {
  return req<WatchlistItem>(`/watchlist/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function listLots(holdingId: string): Promise<HoldingLot[]> {
  return req<HoldingLot[]>(`/holdings/${holdingId}/lots`);
}

export function addLot(holdingId: string, input: HoldingLotInput): Promise<HoldingLot> {
  return req<HoldingLot>(`/holdings/${holdingId}/lots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateLot(holdingId: string, lotId: string, input: HoldingLotInput): Promise<HoldingLot> {
  return req<HoldingLot>(`/holdings/${holdingId}/lots/${lotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteLot(holdingId: string, lotId: string): Promise<void> {
  return req<void>(`/holdings/${holdingId}/lots/${lotId}`, { method: 'DELETE' });
}

// ── Job applications ─────────────────────────────────────────────────────────

// The whole tracker: enriched applications + pipeline stages + KPI stats.
export function getApplications(): Promise<ApplicationsSnapshot> {
  return req<ApplicationsSnapshot>('/applications');
}

export function getApplication(id: string): Promise<ApplicationDetail> {
  return req<ApplicationDetail>(`/applications/${id}`);
}

export function createApplication(input: JobApplicationInput): Promise<JobApplication> {
  return req<JobApplication>('/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateApplication(id: string, input: JobApplicationInput): Promise<JobApplication> {
  return req<JobApplication>(`/applications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteApplication(id: string): Promise<void> {
  return req<void>(`/applications/${id}`, { method: 'DELETE' });
}

// Move an application to a stage — appends a status-history event (the board
// drag and dialog stage-select both go through this, never PATCH).
export function addApplicationEvent(
  applicationId: string,
  input: { stageId: string; note?: string; occurredAt?: string },
): Promise<ApplicationEvent> {
  return req<ApplicationEvent>(`/applications/${applicationId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateApplicationEvent(
  applicationId: string,
  eventId: string,
  input: { occurredAt?: string; note?: string },
): Promise<ApplicationEvent> {
  return req<ApplicationEvent>(`/applications/${applicationId}/events/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteApplicationEvent(applicationId: string, eventId: string): Promise<void> {
  return req<void>(`/applications/${applicationId}/events/${eventId}`, { method: 'DELETE' });
}

export function addApplicationContact(
  applicationId: string,
  input: ApplicationContactInput,
): Promise<ApplicationContact> {
  return req<ApplicationContact>(`/applications/${applicationId}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateApplicationContact(
  applicationId: string,
  contactId: string,
  input: ApplicationContactInput,
): Promise<ApplicationContact> {
  return req<ApplicationContact>(`/applications/${applicationId}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteApplicationContact(applicationId: string, contactId: string): Promise<void> {
  return req<void>(`/applications/${applicationId}/contacts/${contactId}`, { method: 'DELETE' });
}

export function createApplicationStage(input: ApplicationStageInput & { name: string }): Promise<ApplicationStage> {
  return req<ApplicationStage>('/applications/stages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateApplicationStage(id: string, input: ApplicationStageInput): Promise<ApplicationStage> {
  return req<ApplicationStage>(`/applications/stages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteApplicationStage(id: string): Promise<void> {
  return req<void>(`/applications/stages/${id}`, { method: 'DELETE' });
}

// Persist a manual pipeline order; returns the re-sorted stage list.
export function reorderApplicationStages(ids: string[]): Promise<ApplicationStage[]> {
  return req<ApplicationStage[]>('/applications/stages/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
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
