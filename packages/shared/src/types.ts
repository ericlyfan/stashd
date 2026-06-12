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
