# Stashd MVP — Design Spec

**Date:** 2026-04-26
**Scope:** Phase 1 MVP only
**Status:** Approved, ready for implementation planning

---

## Overview

Stashd is a local-first AI document inbox. Users drop files in, the AI classifies them, the user reviews and confirms, and the document is filed automatically. No manual sorting, no cloud dependency for MVP.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Phase 1 MVP only | Start focused; Phases 2–4 defined in proposal |
| Language | TypeScript throughout | Type safety across client, server, and shared types |
| Project structure | Monorepo (npm workspaces) | Shared types package; clean split for future Vercel + Node host deployment |
| File types | PDF + JPG/PNG/HEIC | Covers core use cases; DOCX deferred to Phase 2 |
| Classification pipeline | SSE streaming | Live per-file feedback matches proposal's UX requirement |
| State management | Local component state | No global store needed for single-user local MVP |
| Search | Server-side manifest scan | No search index needed at local single-user scale |
| Deletion | Hard delete | Soft delete deferred; no recovery UX in MVP |

---

## Monorepo Structure

```
stashd/
├── package.json                  # root workspace config
├── packages/
│   ├── shared/                   # shared TypeScript types, no runtime deps
│   │   ├── package.json
│   │   └── src/
│   │       └── types.ts
│   ├── client/                   # React + Vite + Tailwind
│   │   ├── package.json
│   │   ├── vite.config.ts        # proxies /api to localhost:3001
│   │   └── src/
│   │       ├── components/
│   │       ├── pages/
│   │       └── main.tsx
│   └── server/                   # Express + TypeScript
│       ├── package.json
│       └── src/
│           ├── providers/        # ModelProvider interface + adapters
│           ├── services/         # ManifestService, FileService, ClassificationService
│           ├── routes/
│           └── index.ts
└── data/                         # gitignored — runtime storage
    ├── temp/                     # in-flight uploads awaiting review
    ├── documents/                # filed documents by category slug
    └── manifest.json             # all document metadata + categories
```

Running locally:
- `npm run dev:client` — Vite on port 5173
- `npm run dev:server` — Express on port 3001 (ts-node or tsx watch)
- `ollama serve` — Ollama running Gemma 4

---

## Data Model

Defined in `packages/shared/src/types.ts` and shared by both client and server.

```typescript
interface Document {
  id: string;
  filename: string;           // sanitized name on disk
  originalName: string;       // user's original filename
  storagePath: string;        // relative: documents/receipts-expenses/abc123.pdf
  fileType: string;           // mime type
  fileSize: number;           // bytes
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  dateExtracted?: string;     // ISO date parsed from document content
  amount?: number;
  vendor?: string;
  confidenceScore: number;
  status: 'pending' | 'filed'; // 'pending' = flagged for later, 'filed' = confirmed
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;                 // slug: "receipts-expenses"
  name: string;               // "Receipts & Expenses"
  color: string;              // hex color
  icon: string;               // lucide icon name
  isCustom: boolean;
}

interface DocumentInput {
  filename: string;
  mimeType: string;
  content: string;            // extracted text for PDFs, base64 data URL for images
  isImage: boolean;
}

interface ClassificationResult {
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  date?: string;
  amount?: number;
  vendor?: string;
  parties: string[];
  confidence: number;
}

// SSE event payloads
type ProcessingStage = 'extracting' | 'classifying' | 'complete' | 'error';

interface SSEEvent {
  stage: ProcessingStage;
  message: string;
  classification?: ClassificationResult; // present on 'complete'
  error?: string;                        // present on 'error'
}
```

### Storage layout

```
data/
├── temp/:jobId/
│   └── <original-filename>           # uploaded file, awaiting review
├── documents/
│   ├── receipts-expenses/
│   │   └── :id-:originalname
│   ├── contracts-agreements/
│   └── ...                           # one dir per category slug
└── manifest.json
```

`manifest.json` is loaded into memory on server start. Every mutation (file, update, delete) writes it back to disk. Safe at single-user local scale.

### Default categories (seeded on first run)

| ID | Name | Icon |
|----|------|------|
| `receipts-expenses` | Receipts & Expenses | receipt |
| `contracts-agreements` | Contracts & Agreements | file-signature |
| `identity-personal` | Identity & Personal | id-card |
| `insurance` | Insurance | shield |
| `medical-health` | Medical & Health | heart-pulse |
| `property-construction` | Property & Construction | home |
| `business` | Business | briefcase |
| `tax-finance` | Tax & Finance | landmark |
| `legal` | Legal | scale |
| `warranties-manuals` | Warranties & Manuals | wrench |
| `education` | Education | graduation-cap |
| `travel` | Travel | plane |
| `other` | Other | folder |

---

## AI Pipeline & SSE Flow

### Sequence

```
Client                          Server                         Ollama
  │                               │                              │
  │── POST /api/documents/upload >│                              │
  │                               │ save file to data/temp/:id  │
  │<── { jobId } ─────────────────│                              │
  │                               │                              │
  │── GET /api/documents/process/:jobId (SSE) ──────────────────│
  │                               │                              │
  │<── event: "extracting" ───────│ pdf-parse or base64 encode  │
  │<── event: "classifying" ──────│── POST /api/generate ───────>│
  │                               │<── response ────────────────│
  │                               │ parse JSON from response     │
  │<── event: "complete" ─────────│ { ClassificationResult }    │
  │                               │                              │
  │  [user reviews, edits fields] │                              │
  │                               │                              │
  │── POST /api/documents/file/:jobId ─────────────────────────>│
  │                               │ move temp → documents/       │
  │                               │ write manifest entry         │
  │<── { document } ──────────────│                              │
```

### Text extraction

| File type | Extraction method |
|-----------|------------------|
| PDF | `pdf-parse` → raw text string |
| JPG / PNG | Read as base64, pass to Ollama vision |
| HEIC | `heic-convert` → JPEG buffer → base64 |

### ModelProvider pattern

```typescript
// packages/server/src/providers/ModelProvider.ts
interface ModelProvider {
  classify(doc: DocumentInput): Promise<ClassificationResult>;
}

// packages/server/src/providers/index.ts
const providers: Record<string, ModelProvider> = {
  ollama: new OllamaProvider(),
  claude: new ClaudeProvider(),
  openai: new OpenAIProvider(),
};
export const getProvider = (name: string): ModelProvider =>
  providers[name] ?? providers['ollama'];
```

Active provider is set via `PROVIDER` env var, defaulting to `ollama`.

The `OllamaProvider` sends a structured system prompt instructing Gemma 4 to return a JSON object matching `ClassificationResult`. If the response cannot be parsed as valid JSON, the server emits an `error` SSE event and the client shows a manual-entry fallback form.

### Confidence threshold

If `confidence < 0.75`, the `ClassificationReview` component enters **mandatory review mode**: the Accept button is disabled until the user explicitly edits and confirms each field. Above 0.75, one-click Accept is available.

---

## API Surface

Base URL: `http://localhost:3001/api`
Vite dev server proxies all `/api` requests to port 3001.

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/documents/upload` | Multipart file upload; returns `{ jobId: string }` |
| `GET` | `/documents/process/:jobId` | SSE stream; emits `extracting`, `classifying`, `complete`, `error` |
| `POST` | `/documents/file/:jobId` | Confirm review with final field values; moves temp → documents, writes manifest; returns `Document` |
| `GET` | `/documents` | List filed documents. Query params: `search` (string), `category` (slug) |
| `GET` | `/documents/:id` | Get single document metadata |
| `PATCH` | `/documents/:id` | Update `category`, `tags`, `notes` after filing |
| `DELETE` | `/documents/:id` | Hard delete — removes file from disk and manifest entry |
| `GET` | `/documents/:id/file` | Serve raw file for in-app preview |
| `GET` | `/categories` | List all categories with `documentCount` |

Search scans the in-memory manifest across: `originalName`, `summary`, `tags`, `vendor`, `category`, `notes`.

---

## Frontend Components

Routing via React Router. No global state manager — component-local state + refetch on mutation.

```
App
├── Layout
│   ├── Sidebar
│   │   ├── CategoryList        (with doc counts, active highlight)
│   │   └── SearchBar           (navigates to /search?q=)
│   └── MainContent
│       ├── Dashboard           /
│       │   ├── StatsBar        (total docs, category count)
│       │   ├── UploadZone      (react-dropzone, multi-file)
│       │   │   └── FileProcessingCard   (one per file, SSE consumer)
│       │   │       └── ClassificationReview  (shown on SSE complete)
│       │   ├── NeedsReviewList (pending-status documents, links to DocumentDetail)
│       │   └── RecentDocuments (last 5 filed docs)
│       ├── CategoryView        /category/:id
│       │   └── DocumentGrid
│       ├── DocumentDetail      /document/:id
│       │   ├── PreviewPane     (PDF.js for PDFs, <img> for images)
│       │   ├── MetadataPanel   (category, tags, extracted fields, editable)
│       │   └── NotesEditor
│       └── SearchResults       /search?q=
│           └── DocumentGrid    (filtered)
```

### ClassificationReview

The human-in-the-loop component rendered inside `FileProcessingCard` after SSE `complete`:

- Shows AI-suggested `category`, `tags`, `summary`, `date`, `amount`, `vendor` as editable fields
- **Accept** button (single click) if `confidence >= 0.75`
- **Review Required** mode (must confirm each field) if `confidence < 0.75`
- **Flag for later** defers — document is filed with `status: 'pending'` and the AI classification is saved as-is; it appears in a "Needs Review" section on the Dashboard. (A dedicated inbox view is Phase 2.)
- On confirm: calls `POST /api/documents/file/:jobId` with final field values

### Design direction

- Accent color: deep teal (`#0d9488`)
- Base: warm off-white (`#fafaf9`) with subtle card shadows
- Typography: Inter for body, a display font (e.g. Cal Sans or DM Serif Display) for headings
- Icons: Lucide React

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Ollama not running | SSE emits `error` event; client shows "AI unavailable — fill in fields manually" |
| JSON parse failure from model | Same as above |
| Unsupported file type | Upload rejected at server with 400 before SSE opens |
| File > 50MB | Upload rejected at server with 413 |
| Manifest write failure | Server logs error; returns 500; client shows toast |

---

## Out of Scope for Phase 1

- DOCX / XLSX file support
- Custom user-defined categories
- Soft delete / trash
- Bulk upload (folder drop)
- Duplicate detection
- Expiry alerts
- Export / zip download
- Auth / multi-user
- Cloud storage (Supabase)
- Mobile PWA
- "Flag for later" dedicated inbox view / separate route (deferred to Phase 2; Phase 1 shows pending docs inline on Dashboard)
