// Categories are dynamic: seeded with "other" and grown as the classifier
// proposes new ones. Ids are kebab-case slugs (e.g. "medical-health").
export type CategoryId = string;

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  category: CategoryId;
  subcategory?: string;
  tags: string[];
  summary: string;
  dateExtracted?: string;
  amount?: number;
  vendor?: string;
  confidenceScore: number;
  status: "pending" | "filed";
  notes?: string;
  // Full text pulled from the document at filing time (pdf-parse for PDFs,
  // model transcription for images). Capped, and absent for older documents
  // until backfilled.
  extractedText?: string;
  // SHA-256 of the file bytes, used for duplicate detection. Backfilled at
  // boot for documents filed before the feature existed.
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

// A search result: a document plus the fragment of text that matched the
// query. Computed per-request, never persisted.
export interface SearchHit extends Document {
  snippet?: string;
}

export interface Category {
  id: CategoryId;
  name: string;
  color: string;
  icon: string;
  isCustom: boolean;
}

// Returned by POST /documents/upload. `duplicate` points at an already-filed
// document with identical bytes — a warning, never a block.
export interface UploadResponse {
  jobId: string;
  duplicate?: {
    id: string;
    originalName: string;
    category: CategoryId;
  };
}

export interface DocumentInput {
  filename: string;
  mimeType: string;
  content: string;
  isImage: boolean;
}

export interface ClassificationResult {
  category: CategoryId;
  subcategory?: string;
  tags: string[];
  summary: string;
  date?: string;
  amount?: number;
  vendor?: string;
  parties: string[];
  confidence: number;
  // For images: the document's visible text, transcribed by the model.
  transcription?: string;
}

export type ProcessingStage = "extracting" | "classifying" | "complete" | "error";

export interface SSEEvent {
  stage: ProcessingStage;
  message: string;
  classification?: ClassificationResult;
  error?: string;
}

// ── Chat / RAG ──────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// A document the assistant drew on for an answer. `id` may point at a
// document deleted since the message was written — the client must tolerate
// dangling links.
export interface Citation {
  docId: string;
  name: string;
}

// A tool invocation the assistant made while answering, kept for display
// ("looked through the stash", "moved X to receipts…").
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
  pinnedDocIds: string[];
}

// SSE stream for POST /chat/:id/messages. `token` events carry answer text as
// it generates; `tool` events fire when the assistant calls back into Stashd;
// `done` carries the final persisted assistant message.
export type ChatSSEEvent =
  | { type: "token"; text: string }
  | { type: "tool"; call: ToolCallRecord }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

// ── Ledgers (project cost tracking) ──────────────────────────────────────────
// A largely independent section: users create projects and track their costs
// line by line, like a purpose-built spreadsheet. A line item may optionally
// link to a document in the stash as supporting evidence — the link is kept in
// sync from both sides.

export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

// One tracked cost — a single row of a project's ledger. Categories and
// vendors aren't a managed list: each item carries its own, and a project's
// distinct values are derived for autocomplete and rollups.
export interface LineItem {
  id: string;
  projectId: string;
  category?: string;
  vendor?: string;
  description: string;
  quantity?: number;
  datePaid?: string;
  invoiceNumber?: string;
  amountRequested?: number;
  amountPaid?: number; // pre-tax
  taxAmount?: number; // GST/HST
  totalPaid?: number;
  status?: string;
  notes?: string;
  // Optional supporting document from the stash. Nulled if that document is
  // later deleted, so the link can dangle without breaking.
  documentId?: string;
  createdAt: string;
  updatedAt: string;
}

// Per-project money rollups, computed per request — never persisted.
export interface ProjectTotals {
  itemCount: number;
  requested: number;
  paid: number; // pre-tax sum
  tax: number;
  total: number;
}

export interface ProjectSummary extends Project {
  totals: ProjectTotals;
}

export interface ProjectDetail extends Project {
  items: LineItem[];
  totals: ProjectTotals;
}

// Fields a client may set on a line item; the server owns id / projectId /
// timestamps. `documentId: null` explicitly clears a link.
export interface LineItemInput {
  category?: string;
  vendor?: string;
  description?: string;
  quantity?: number;
  datePaid?: string;
  invoiceNumber?: string;
  amountRequested?: number;
  amountPaid?: number;
  taxAmount?: number;
  totalPaid?: number;
  status?: string;
  notes?: string;
  documentId?: string | null;
}

// Where a stash document is referenced from the ledgers (the document → ledger
// direction of the two-way link).
export interface DocumentLink {
  projectId: string;
  projectName: string;
  itemId: string;
  description: string;
}
