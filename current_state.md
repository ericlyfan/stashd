# Stashd — Current State

_Last updated: 2026-06-12_

Stashd is a **local-first document organizer**. You drop in PDFs and photos (receipts, leases, IDs, manuals…), a multimodal LLM running on your own Ollama instance reads each one and proposes a filing — category, tags, summary, key dates, amounts, vendor — and you approve or correct it before it lands in the "stash." Nothing leaves the machine except the call to your configured Ollama endpoint.

---

## 1. Architecture

npm-workspaces monorepo, three packages:

| Package           | Stack                                                    | Role                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server` | Express 4, TypeScript, tsx                               | REST API + SSE, file storage, AI classification                                                                                                                                                                                                                         |
| `packages/client` | React 18, Vite, react-router 6, pdfjs-dist, lucide-react | Single-page UI (no CSS framework — one hand-written `styles.css` with a paper/ledger aesthetic)                                                                                                                                                                         |
| `packages/shared` | TypeScript only                                          | Types shared by both (`Document`, `Category`, `ClassificationResult`, `SearchHit`, `SSEEvent`…) plus runtime helpers that must not drift between client and server: `slugifyCategory`, `categoryNameFromSlug`, `COLOR_PALETTE`, `mimeFromExtension` (`src/category.ts`) |

**Persistence:** a SQLite database at `data/stashd.db` (`StoreService`, better-sqlite3, WAL mode) holding documents and categories, with an FTS5 virtual table (`documents_fts`, external-content, trigger-synced) indexing name, summary, tags, vendor, category, notes and `extractedText`. On first boot against an empty database the legacy `data/manifest.json` is imported and renamed to `manifest.json.migrated` (kept as a recoverable backup). Original files live under `data/documents/<category-slug>/<docId>.<ext>`; in-flight uploads under `data/temp/<jobId>/`.

**There is no test suite — by design** (removed in commit `cdce640`). Verification is `npm run build` per workspace (runs `tsc`) plus driving the running app.

### Dev workflow

```
npm run dev:server   # Express on :3001 (tsx watch — see Known Quirks)
npm run dev:client   # Vite on :5173, proxies /api → :3001
```

Server env (`packages/server/.env`): `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `gemma4`, must be multimodal + JSON-capable), `OLLAMA_API_KEY` (optional), `PORT` (default 3001). The provider layer (`providers/`) is a registry keyed by `PROVIDER` env var with Ollama as the only (and fallback) implementation.

---

## 2. The core flow: upload → classify → review → file

1. **Upload** — drag-and-drop anywhere (a full-window "curtain" appears for OS file drags) or via the inbox drop tray; any number of files at once. Client validates extension and 50 MB cap, then `POST /api/documents/upload` (multer, allowed: PDF/JPEG/PNG/HEIC/HEIF) stores the file in a temp dir and returns `{ jobId, duplicate? }`. Multipart filenames are decoded as UTF-8 (multer 2 + `defParamCharset: 'utf8'`), so CJK names survive; names mangled before this fix are repaired by the boot backfill (latin1→UTF-8 re-decode when it round-trips cleanly) — `duplicate` points at an already-filed document with the same SHA-256 (advisory only, never a block). At most **3 files** are in flight (upload + classify) at a time; the rest wait as "queued" so a big drop doesn't hammer the Ollama instance. With more than one file in the tray, a progress header shows classified/in-flight/waiting/failed counts, a progress bar, and bulk **Skip duplicates** / **Clear failed** actions; every non-busy item also has a per-file skip.
2. **Classify** — client opens an SSE stream `GET /api/documents/process/:jobId`. The server extracts content (`pdf-parse` text for PDFs; base64 image for photos, HEIC converted to JPEG via `heic-convert`) and prompts the Ollama model with the existing category list. The model returns strict JSON: category (existing id **or a brand-new slug** — the category taxonomy grows organically), subcategory, ≤5 tags, summary, date, amount, vendor, parties, confidence, and — for images — a verbatim `transcription` of visible text. **Taxonomy guards** (`ClassificationService`): model calls are **serialized through an internal promise chain** — each classification's prompt is built only after the previous one resolved, which is what lets a simultaneous batch see each other's proposals at all (Ollama processes serially anyway, so this costs no wall-clock time). Categories proposed but not yet filed are held as 30-minute provisional entries and included in the prompt's category list; any proposed slug whose stemmed tokens equal **or contain/are contained by** an existing/provisional category's (`slugsLookAlike`: "service-quotes" ≈ "service-quotations" ≈ "quotations") is snapped onto it — deliberately merge-biased, since a missed distinction is cheaper here than a duplicate drawer. The prompt also explicitly forbids near-synonym categories.
3. **Review** — the upload tray tracks each job (`queued → uploading → processing → ready → filing`, with errors surfaced). When classification lands, the **ReviewSheet** opens: original document on the left (pdf.js render or image), the proposed filing fully editable on the right, including accepting/creating a new category and a "flag for later" toggle. Duplicates show a warning banner linking to the existing document (also shown inline in the tray). After filing, the sheet auto-advances to the next ready item, so a batch can be reviewed back-to-back. A **Discard** button (and the tray's per-file/bulk skips) drops the upload entirely — client item and server temp dir both — without filing anything.
4. **File** — `POST /api/documents/file/:jobId` persists the document: creates the category if new (auto icon/color, see §4), moves the file into permanent storage, computes its `contentHash` (SHA-256), and inserts the row. Text extracted at classify time (PDF text or image transcription, capped at 20,000 chars) is written to a sidecar file (`data/temp/<jobId>.extracted.txt`) so it survives server restarts, then stored as `extractedText` on the document and the sidecar deleted; PDFs are re-parsed as a last-resort fallback.

Documents have `status: "pending" | "filed"` — "pending" means flagged for a second look and surfaces in the Inbox and the sidebar badge.

---

## 3. Search (full-text)

- `GET /api/documents?search=…` runs an **FTS5 query** across **name, summary, tags, vendor, category, notes, and `extractedText`** (the document's actual body text): each typed word becomes a prefix term ("incre" matches "increase"), terms are ANDed, results ordered by FTS rank. Mid-word substrings no longer match (FTS tokenizes on word boundaries) — the trade for ranked, indexed search.
- When the body text itself matched, the response `SearchHit` carries a `snippet` (FTS5 `snippet()`, match-aware) which the UI renders in italics on result cards/rows so you can see _why_ something matched.
- **Startup backfill** (`services/textExtraction.ts`, `backfillDerivedFields`): on boot the server re-parses any PDF lacking `extractedText` and hashes any file lacking `contentHash`, so pre-feature documents become searchable and duplicate-checkable. Image text can't be backfilled (it comes from the model at classify time only).
- Client: sidebar search box (the `/` key focuses it from anywhere) live-navigates to `/search?q=…` with a 180 ms debounce.

---

## 4. Categories ("drawers")

Categories are dynamic: seeded with just **Other** (`isCustom: false`, undeletable), grown by the classifier proposing new ones, or created by the user.

- **Auto-styling** (`server/services/categoryStyle.ts`): a new category's icon is picked by keyword regex on the slug (e.g. `medical|health → heart-pulse`, `tax|bank → landmark`; 13 icons total) and its color by hashing the slug into a 12-color palette. The client mirrors both lists in `lib/categoryMeta.tsx`.
- **Create**: a **+** button beside "The Cabinet" in the sidebar opens an inline input — Enter creates and navigates to the new (empty) drawer. `POST /api/categories` (409 on duplicate slug).
- **Edit**: every category page has an Edit button → dialog to rename and pick any icon/color. `PATCH /api/categories/:id` — the slug never changes, so documents don't need rewriting.
- **Delete**: only **custom and empty** drawers (`DELETE /api/categories/:id`; 400 with a count otherwise). The category page's "Remove drawer" button is disabled with an explanatory hint while documents remain — re-file the contents first (drag-and-drop, or the category select on each document's page).
- **Drag-and-drop filing**: any document card/row can be dragged onto a sidebar drawer (custom MIME `application/x-stashd-docs`; drop target highlights; toast confirms). Re-categorizing does **not** move the file on disk — `storagePath` keeps the original folder, which is cosmetic only.

---

## 5. Browsing UI

**Pages** (react-router):

- **Inbox `/`** — drop tray, upload tray (in-flight jobs), stat tiles (docs, drawers in use, flagged count, total tracked amounts), flagged-for-review list, six most recent docs, and a "cabinet" of category cards.
- **All documents `/all`** — sort (newest/oldest/A–Z/amount) + "flagged only" filter.
- **Category `/category/:id`** — the drawer's docs, doc-count and summed amounts in the header, plus Edit / Move-all / Remove actions.
- **Search `/search?q=…`** — server-side results with snippets.
- **Document `/doc/:id`** — full viewer (pdf.js multi-page render with zoom, images, HEIC fallback message + download), editable category/tags/notes with dirty-state save, resolve-flag and delete actions, and an AI-metadata card (summary, vendor, amount, doc date, confidence meter).

**Grid/list toggle:** All-docs, Category, and Search pages default to a **preview-card grid** — PDFs render their first page client-side (pdf.js, lazily via IntersectionObserver once a card nears the viewport, cached in-memory with a 200-entry cap), images load directly, HEIC/failures fall back to a category-colored icon tile. A toggle (persisted in `localStorage`, shared across pages) switches to the denser ledger-row list. Inbox keeps rows (it's a review queue).

**Shared client state** (`store.tsx`): one context holding docs + categories (refreshed together), the upload queue with SSE wiring, the review-sheet open state, and a toast system. Components call API functions from `api.ts` directly and then `refresh()`.

---

## 6. API surface (all under `/api`)

| Method & path                                    | Purpose                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /documents/upload`                         | multipart upload → `{ jobId, duplicate? }` (413 over 50 MB, 400 bad type)                                                  |
| `DELETE /documents/job/:jobId`                   | discard an in-flight upload (temp dir + sidecar); idempotent 204                                                            |
| `GET /documents/process/:jobId`                  | SSE: `extracting → classifying → complete` (with classification) or `error`                                                 |
| `POST /documents/file/:jobId`                    | persist a reviewed document                                                                                                 |
| `GET /documents?search=&category=`               | list/search (SearchHits with snippets when searching)                                                                       |
| `GET /documents/:id` / `GET /documents/:id/file` | metadata / raw file                                                                                                         |
| `PATCH /documents/:id`                           | update category/tags/notes/status                                                                                           |
| `PATCH /documents`                               | batch update `{ ids, category?, status?, addTags?, removeTags? }` (all inputs validated; currently driven by drag-and-drop) |
| `DELETE /documents/:id`                          | delete file + entry                                                                                                         |
| `GET /categories`                                | all categories with live `documentCount`                                                                                    |
| `POST /categories`                               | create by name (auto icon/color)                                                                                            |
| `PATCH /categories/:id`                          | rename / re-icon / re-color                                                                                                 |
| `DELETE /categories/:id`                         | delete (custom + empty only)                                                                                                |

---

## 7. Known quirks & limitations

- **`tsx watch` does not reload on this machine** — restart `npm run dev:server` manually after server-side changes, and check `lsof -ti:3001` if the API seems stale (orphaned watchers have accumulated before).
- **`docs/` is gitignored** — design specs and plan records under `docs/superpowers/` exist only on local disk.
- **HEIC** can't be previewed by browsers anywhere in the UI (upload preview, document viewer, grid thumbnails all show fallbacks); classification still works via server-side JPEG conversion.
- **CJK search is weak**: filenames and text in Chinese are stored correctly, but FTS5's `unicode61` tokenizer doesn't segment CJK, so Chinese queries only match from the start of an unbroken CJK run. Switching the index to the `trigram` tokenizer is the known fix if Chinese documents become common.
- **Extraction quality** is bounded by the source: PDFs with broken embedded font encodings yield partially garbled `extractedText` (observed in one real document), and image text exists only if the model transcribed it at classify time.
- **Duplicate detection is exact-bytes only** (SHA-256): a re-scan or re-export of the same paper document won't be flagged. The two identical `Stash'd.pdf` docs predating the feature remain filed.
- Uploads discarded or skipped through the UI now clean up their temp dir (`DELETE /documents/job/:jobId`), but uploads abandoned by closing the tab still leave their dir (and possibly an `.extracted.txt` sidecar) under `data/temp/` indefinitely — there's no sweep job; several stale job dirs from before the feature exist today.

## 8. Where it's headed

See `docs/superpowers/plans/` for completed-work records. The agreed roadmap priorities: **RAG "ask your docs"** (embed `extractedText` chunks via an Ollama embedding model, answer questions with citations) next, with re-classify-on-demand and classification feedback loops as smaller follow-ups. Deprioritized for now: server-side thumbnails, dashboards/reminders. (The SQLite/FTS5 migration, duplicate detection, and the batch upload queue landed 2026-06-12.)
