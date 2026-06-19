# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It is the single living document for **Stashd** — both the *operating manual* (how to build, run,
verify, and not break things) and the *architecture & feature reference* (how it all works). Keep this
file honest and current; it is the project's memory and the first thing agents load.

_Last updated: 2026-06-18_

> **How this file is organized.** Part I is the operating manual — read it first. Part II is the
> detailed architecture/feature reference; reach for the relevant section when you touch that area.
> When this doc and the code disagree, trust the code, then fix this doc.

## Keeping this file current (do this every session)

**Before you finish a session in which you changed code, update this file in the same breath.** This
doc is the only long-lived memory of the project; if it drifts, every future session starts wronger.
A session-end hook (`.claude/settings.json`) will remind you when you've touched `packages/**` but not
`CLAUDE.md` — treat that reminder as part of "done," not noise. Concretely:

- New/changed/removed **endpoint** → update the Part II §6 table.
- New **feature, page, service, or flow** → update the relevant Part II section (§1–§7).
- New **gotcha, quirk, or invariant** you hit → add it to Part I (Gotchas / Conventions) so the next
  agent doesn't relearn it the hard way.
- Bump the **`Last updated`** date below whenever you change anything substantive.
- If nothing architectural changed (a typo fix, a refactor with no behavior change), it's fine to note
  that and move on — don't manufacture edits.

---

# Part I — Operating manual

## What Stashd is

A **local-first document organizer**. You drop in files (PDF, image, Office, text, email); a
multimodal LLM on *your own* Ollama instance reads each one and proposes a filing — category, tags,
summary, key dates, amount, vendor — and you approve or correct it before it lands in "the stash."
Nothing leaves the machine except the call to your configured Ollama endpoint.

Three feature pillars beyond filing:
- **Search** — FTS5 full-text over document bodies, with match-aware snippets.
- **Ask the stash** (`/chat`) — RAG chat with citations and a native tool loop that can act on the stash.
- **Ledgers** (`/ledgers`) — project cost tracking, optionally linked to stash documents.

**Accepted file types** — single source of truth is `MIME_BY_EXT` in `shared/src/category.ts`
(exposed as `SUPPORTED_EXTENSIONS` / `isSupportedFilename`): `pdf`, `jpg/jpeg`, `png`, `heic/heif`,
`webp`, `txt`, `md`, `docx`, `xlsx`, `csv`, `eml`, `msg`. Both acceptance gates (client drop
validation + server multer) are derived from this map's keys and **validate by extension**, not the
browser-reported MIME (unreliable for Office/email); the pipeline resolves MIME via `mimeFromExtension`.

## Repository layout

npm-workspaces monorepo; three packages under `packages/`.

| Package    | Stack                                              | Entry / role                                          |
| ---------- | -------------------------------------------------- | ----------------------------------------------------- |
| `server`   | Express 4, TypeScript, tsx, better-sqlite3         | `src/index.ts` → `src/app.ts`. REST + SSE, storage, AI |
| `client`   | React 18, Vite, react-router 6, pdfjs-dist         | `src/main.tsx` → `src/App.tsx`. SPA, hand-written CSS  |
| `shared`   | TypeScript only                                    | `src/index.ts` re-exports `types.ts` + `category.ts`   |

### Where things live

**Server** (`packages/server/src/`)
- `app.ts` — wires services + routes; runs boot backfills. `index.ts` — listen loop.
- `routes/` — `documents.ts`, `categories.ts`, `chat.ts`, `projects.ts` (one router factory each).
- `services/`
  - `StoreService.ts` — **all SQLite access** (better-sqlite3, WAL). Schema, migrations, queries.
  - `FileService.ts` — file storage under `data/documents/<slug>/` and `data/temp/<jobId>/`.
  - `ClassificationService.ts` — prompt building, model call, taxonomy guards (serialized).
  - `textExtraction.ts` — extension-keyed `extractText` dispatcher + `backfillDerivedFields`.
  - `emailParse.ts` — `.eml`/`.msg` → headers + body + attachments.
  - `EmbeddingService.ts` — chunk + embed (local Ollama), vector index lifecycle.
  - `ChatService.ts` — RAG retrieval + tool loop.
  - `categoryStyle.ts` — auto icon/color for new categories.
- `providers/` — model-provider registry keyed by `PROVIDER`; `OllamaProvider` is the only impl.

**Client** (`packages/client/src/`)
- `store.tsx` — the one global context (docs + categories + projects, upload queue/SSE, review sheet, toasts).
- `api.ts` — every server call; components call these then `refresh()`.
- `pages/` — route components. `components/` — reusable UI. `lib/` — `format.ts` (`viewerKind`),
  `categoryMeta.tsx` (icon/color mirror), `pdf.ts`, `thumbs.ts`.
- `styles.css` — **the only stylesheet.** No CSS framework; paper/ledger aesthetic.

**Shared** (`packages/shared/src/`)
- `types.ts` — `Document`, `Category`, `ClassificationResult`, `SearchHit`, `SSEEvent`, etc.
- `category.ts` — **single source of truth** for runtime helpers that must not drift across
  client/server: `MIME_BY_EXT`, `SUPPORTED_EXTENSIONS`, `isSupportedFilename`, `mimeFromExtension`,
  `extensionOf`, `slugifyCategory`, `categoryNameFromSlug`, `COLOR_PALETTE`.

## Build, run, verify

```bash
npm install            # from repo root; sets up all workspaces

npm run dev:server     # Express on :3001 (tsx watch)
npm run dev:client     # Vite on :5173, proxies /api → :3001
```

**Verification — there is no test suite, by design** (removed in `cdce640`; the `vitest` references
left in `vite.config.ts` are vestigial — no test files, no vitest dependency). To verify a change:

```bash
npm run build --workspace=packages/server   # tsc — emits to dist/
npm run build --workspace=packages/client   # tsc --noEmit + vite build
npm run build --workspace=packages/shared   # tsc — emits declarations
```

A clean `tsc` across the touched workspace(s) is the baseline gate. Beyond that, **drive the running
app** — upload a file, watch the SSE stream, review/file it, search for it, ask the chat about it. Do
not claim a change works on a type-check alone if it has runtime behavior.

### Environment (`packages/server/.env`)

Classification (the configured cloud endpoint is `https://ollama.com`):
- `OLLAMA_URL` (default `http://localhost:11434`)
- `OLLAMA_MODEL` (default `gemma4`) — must be multimodal, JSON-capable, **and tool-capable** (chat uses native tool calling)
- `OLLAMA_API_KEY` (optional), `PORT` (default `3001`), `PROVIDER` (default `ollama`)

Embeddings run on a **separate, local** Ollama (the cloud endpoint serves no embedding models):
- `OLLAMA_EMBED_URL` (default `http://localhost:11434`)
- `OLLAMA_EMBED_MODEL` (default `embeddinggemma`, 768 dims — `ollama pull embeddinggemma` once)
- `OLLAMA_EMBED_API_KEY` (optional)

## Conventions & invariants

- **File-type support is data, not code.** Adding/removing a supported type means editing
  `MIME_BY_EXT` in `shared/src/category.ts` — both acceptance gates derive from its keys. Then wire an
  extractor in `textExtraction.ts` and a viewer branch via `viewerKind` in `client/src/lib/format.ts`.
  Don't hardcode extension lists anywhere else.
- **`shared` is the anti-drift layer.** Anything client and server must agree on (slugs, colors, MIME
  resolution) lives there, not duplicated. The client *mirrors* the icon/color picker in
  `lib/categoryMeta.tsx` — keep it in sync with `server/services/categoryStyle.ts`.
- **All SQLite goes through `StoreService`.** No ad-hoc DB access from routes. Money totals are
  *computed per request* (`sumTotals`), never stored.
- **Slugs are stable.** Renaming a category never changes its slug, so documents aren't rewritten and
  files don't move on disk. Re-categorizing is cosmetic w.r.t. `storagePath`.
- **Taxonomy is merge-biased.** Near-duplicate drawers are worse than a lost distinction; the
  classifier snaps look-alike proposed slugs onto existing ones (`slugsLookAlike`). Preserve this bias.
- **Background work uses `void`** (embedding, attachment fan-out, backfills) so user-facing requests
  return immediately. Keep blocking work off the file/upload path.
- **Schema migrations** are boot-time, `table_info`-guarded `ALTER TABLE ADD COLUMN` — idempotent and
  safe to re-run. Follow that pattern for new columns.

## Gotchas & known limitations

- **`tsx watch` does NOT reload on this machine.** After any server-side change, **restart**
  `npm run dev:server` manually. If the API seems stale, check for orphaned watchers:
  `lsof -ti:3001` (kill them; they've accumulated before).
- **CJS/ESM interop under `Node16` resolution.** Server dynamic imports (`await import('xlsx')`,
  `@kenjiuno/msgreader`) put the API/constructor on `.default` (sometimes `.default.default`, when
  `.default` isn't itself the class). Resolve via `(mod.default ?? mod)`. The client mirrors this
  guard for `xlsx`/`mammoth`.
- **sqlite-vec `vec0` rowids must be bound as `BigInt`** from better-sqlite3.
- **Chat SSE is a `fetch` POST stream**, not `EventSource` (which can't POST). Citation ids are
  resolved by **unique prefix** on both ends because the model drops trailing UUID chars; unresolvable
  citations render as inert chips.
- **`docs/` and `.claude/` are gitignored.** Design specs/plans under `docs/superpowers/` are
  local-only — don't assume a reader can see them. This `CLAUDE.md` *is* committed.
- **HEIC** never previews in-browser (upload preview, viewer, thumbnails all fall back); classification
  still works via server-side JPEG conversion.
- **CJK search is weak** — filenames/text are stored correctly, but FTS5's `unicode61` tokenizer
  doesn't segment CJK, so Chinese queries only match from the start of an unbroken CJK run. Switching
  the index to the `trigram` tokenizer is the known fix if Chinese docs become common.
- **Extraction quality is bounded by the source** — PDFs with broken embedded font encodings yield
  partially garbled `extractedText`; image text exists only if the model transcribed it at classify time.
- **Duplicate detection is exact-bytes (SHA-256) only** — a re-scan/re-export of the same paper won't
  be flagged. Detection is advisory, never a block.
- **Abandoned uploads leak temp dirs.** UI-discarded/skipped uploads clean up via
  `DELETE /documents/job/:jobId`, but uploads abandoned by closing the tab leave `data/temp/<jobId>/`
  (and possibly an `.extracted.txt` sidecar) indefinitely — there's no sweep job.
- **Email attachments skip the review sheet** — spun-off attachments are auto-classified and filed
  `pending`, but unlike a normal upload they aren't reviewed before landing. They carry only a note
  back-link to the parent email, not a stored relation.
- **.msg metadata is best-effort** — `@kenjiuno/msgreader`'s typings under-describe `getFileData()`,
  so the parser reads a widened shape; some fields (e.g. delivery date) may be absent. `.eml` (via
  `mailparser`) is more complete.

## Making changes — practical notes

- **New API endpoint:** add to the relevant `routes/*.ts` factory, back it with a `StoreService`
  method, add the client call in `api.ts`, and update the API table in Part II §6.
- **New page/route:** add to `App.tsx`, pull data from `store.tsx` (don't fetch ad-hoc in a page
  unless it's page-local), style in `styles.css`.
- **DB schema change:** add a guarded migration in `StoreService`, update the types in
  `shared/src/types.ts`, and rebuild the shared package.
- **Heavy client libs** (`mammoth`, `xlsx`, `dompurify`) are **dynamically imported** so they
  code-split. Keep them out of the main bundle.
- **After a substantive change, update this file** — both the relevant Part II section and the
  "Last updated" date.

## Commit conventions

History uses Conventional Commits (`feat:`, `feat(sidebar):`, `chore:`, `fix:`). Match that style.
Personal project, no CI; commit/push only when asked.

---

# Part II — Architecture & feature reference

## 1. Architecture

npm-workspaces monorepo, three packages (`server` / `client` / `shared`; see Part I for the stack
table and file map).

**Persistence:** a SQLite database at `data/stashd.db` (`StoreService`, better-sqlite3, WAL mode)
holding documents, categories, chat conversations/messages/pins, and the RAG layer: `doc_chunks`
(chunk text) plus a **sqlite-vec** `vec0` virtual table (`doc_chunks_vec`) of embeddings, alongside an
FTS5 virtual table (`documents_fts`, external-content, trigger-synced) indexing name, summary, tags,
vendor, category, notes and `extractedText`. On first boot against an empty database the legacy
`data/manifest.json` is imported and renamed to `manifest.json.migrated` (kept as a recoverable
backup). Original files live under `data/documents/<category-slug>/<docId>.<ext>`; in-flight uploads
under `data/temp/<jobId>/`. **Lightweight schema migrations** run at boot via `table_info`-guarded
`ALTER TABLE ADD COLUMN` (e.g. `migrateCategoryColumns` added the categories' `pinned`/`position`
columns — safe to re-run on an already-migrated database).

**Provider layer** (`providers/`): a registry keyed by the `PROVIDER` env var, with Ollama as the only
(and fallback) implementation. Classification and chat use the configured (possibly cloud) model;
embeddings use a separate local Ollama (see Part I env vars).

## 2. Core flow: upload → classify → review → file

1. **Upload** — drag-and-drop anywhere (a full-window "curtain" appears for OS file drags) or via the
   inbox drop tray; any number of files at once. Client validates extension (`isSupportedFilename`) and
   50 MB cap, then `POST /api/documents/upload` (multer; `fileFilter` accepts/rejects by **extension**,
   not the browser MIME) stores the file in a temp dir and returns `{ jobId, duplicate? }`. Multipart
   filenames are decoded as UTF-8 (multer 2 + `defParamCharset: 'utf8'`), so CJK names survive; names
   mangled before this fix are repaired by the boot backfill (latin1→UTF-8 re-decode when it round-trips
   cleanly). `duplicate` points at an already-filed document with the same SHA-256 (advisory only,
   never a block). At most **3 files** are in flight (upload + classify) at a time; the rest wait as
   "queued" so a big drop doesn't hammer the Ollama instance. With more than one file in the tray, a
   progress header shows classified/in-flight/waiting/failed counts, a progress bar, and bulk **Skip
   duplicates** / **Clear failed** actions; every non-busy item also has a per-file skip.
2. **Classify** — client opens an SSE stream `GET /api/documents/process/:jobId`. The server extracts
   content (`ClassificationService.buildInput`): **image types** (jpeg/png/webp, plus HEIC/HEIF
   converted to JPEG via `heic-convert`) go to the model as base64 with `isImage: true`; **everything
   else** runs through the **extraction dispatcher** (`textExtraction.ts` `extractText`, keyed by
   extension) and the resulting text is what the model classifies. The dispatcher covers: `pdf`
   (`pdf-parse`), `txt`/`md`/`csv` (raw UTF-8), `docx` (`mammoth.extractRawText`), `xlsx` (SheetJS,
   every sheet flattened to CSV), and `eml`/`msg` (`emailParse.ts` → flattened headers + body +
   attachment filenames). All extractors never throw — a failure degrades to "no text." The model
   returns strict JSON: category (existing id **or a brand-new slug** — the taxonomy grows
   organically), subcategory, ≤5 tags, summary, date, amount, vendor, parties, confidence, and — for
   images — a verbatim `transcription` of visible text. **Taxonomy guards:** model calls are
   **serialized through an internal promise chain** — each classification's prompt is built only after
   the previous one resolved, which is what lets a simultaneous batch see each other's proposals (Ollama
   processes serially anyway, so this costs no wall-clock time). Categories proposed but not yet filed
   are held as 30-minute provisional entries and included in the prompt's category list; any proposed
   slug whose stemmed tokens equal **or contain/are contained by** an existing/provisional category's
   (`slugsLookAlike`: "service-quotes" ≈ "service-quotations" ≈ "quotations") is snapped onto it —
   deliberately merge-biased. The prompt also explicitly forbids near-synonym categories.
3. **Review** — the upload tray tracks each job (`queued → uploading → processing → ready → filing`,
   with errors surfaced). When classification lands, the **ReviewSheet** opens: original document on
   the left (pdf.js render or image), the proposed filing fully editable on the right, including
   accepting/creating a new category and a "flag for later" toggle. Duplicates show a warning banner
   linking to the existing document. After filing, the sheet auto-advances to the next ready item, so a
   batch can be reviewed back-to-back. A **Discard** button (and the tray's per-file/bulk skips) drops
   the upload entirely — client item and server temp dir both — without filing anything.
4. **File** — `POST /api/documents/file/:jobId` persists the document: creates the category if new
   (auto icon/color, see §4), moves the file into permanent storage, computes its `contentHash`
   (SHA-256), and inserts the row. Text extracted at classify time (dispatcher output or image
   transcription, capped at 20,000 chars) is written to a sidecar (`data/temp/<jobId>.extracted.txt`)
   so it survives server restarts, then stored as `extractedText` and the sidecar deleted; if the
   sidecar is missing the **extraction dispatcher re-runs** for any text-bearing type as a last-resort
   fallback.

   **Email attachment fan-out:** when the filed document is an `eml`/`msg`, the server parses its
   attachments and, for each supported one, **spins it off into its own document** — classified
   independently through the same pipeline, filed with `status: "pending"` and a note recording the
   parent email. This runs in the **background** (`void`) so filing the email returns immediately; the
   response carries `attachmentsSpawned`, and the client toasts and schedules a couple of `refresh()`es
   so the new docs appear. One upload → N documents.

Documents have `status: "pending" | "filed"` — "pending" means flagged for a second look and surfaces
in the Inbox and the sidebar badge.

## 3. Search (full-text)

- `GET /api/documents?search=…` runs an **FTS5 query** across **name, summary, tags, vendor, category,
  notes, and `extractedText`**: each typed word becomes a prefix term ("incre" matches "increase"),
  terms are ANDed, results ordered by FTS rank. Mid-word substrings no longer match (FTS tokenizes on
  word boundaries) — the trade for ranked, indexed search.
- When the body text matched, the response `SearchHit` carries a `snippet` (FTS5 `snippet()`,
  match-aware) which the UI renders in italics on result cards/rows so you can see *why* it matched.
- **Startup backfill** (`textExtraction.ts`, `backfillDerivedFields`): on boot the server re-parses any
  PDF lacking `extractedText` and hashes any file lacking `contentHash`, so pre-feature documents
  become searchable and duplicate-checkable. Image text can't be backfilled (it comes from the model
  at classify time only).
- Client: sidebar search box (the `/` key focuses it from anywhere) live-navigates to `/search?q=…`
  with a 180 ms debounce.

## 3b. Intelligence — "Ask the stash" (RAG chat with tools)

A persistent chatbot (`/chat`, sidebar entry **Ask the stash**) that answers questions from the
documents' actual text, with citations, and can act on the stash.

**Indexing** (`EmbeddingService.ts`): each document's `extractedText` (fallback: summary + vendor +
tags) is split into ~1400-char chunks (200 overlap, breaking on paragraph/sentence boundaries) and
embedded via the local Ollama (`/api/embed`, embeddinggemma's documented `title:`/`task:` prefixes
applied manually). Chunks land in `doc_chunks` + `doc_chunks_vec`. Indexing happens in the background
at filing time (never blocks the file step), chunk rows are deleted with the document, and a boot
backfill indexes anything missing — all serialized through a promise chain so batches don't stampede
the local model. `rag_meta` records which model/dim built the index; changing the embed model drops and
rebuilds it on next boot. If the embedding model is unreachable, boot logs a pull hint and chat
degrades gracefully (no excerpts, but tools still work). Gotcha: sqlite-vec `vec0` rowids must be bound
as `BigInt`.

**Answering** (`ChatService.ts`): per user message, the question is embedded and the top 6 chunks (KNN)
are placed in the system prompt as excerpts tagged `[doc:<id>]`; **pinned documents** (per-conversation,
full text up to 8k chars each) ride along as primary context. The model (same cloud gemma as
classification) then runs a native **tool loop** (max 6 rounds, streamed): `search_docs` (FTS),
`read_doc` (full text, 12k cap), `update_doc` (re-categorize — creating drawers if needed —, add/remove
tags, flag/unflag; only on explicit user request), `list_categories`, plus the Ledgers tools
`list_projects` / `read_project` (see §3c). Answers cite inline as `[doc:<id>]`; the server parses
these into `citations` (id + name, surviving later doc deletion) and persists tool calls as
human-readable records. History sent to the model is capped at the last 20 messages.

**Client** (`pages/ChatPage.tsx`): the conversation renders as a single "sheet" card — an **On the
desk** pinned-docs tray along its top edge, the thread as ledger entries, and the composer as the
sheet's footer. A "Correspondence" rail lists conversations (create/delete, relative dates). The empty
state offers clickable suggestions grounded in the actual stash. Markdown-lite rendering covers
paragraphs, bullets, **bold**, `###` headings and pipe tables (deliberately not a markdown engine);
citation markers become chips linking to `/doc/:id`, with a "sources" footer per answer, and tool calls
render as a mono work-log above the answer. **Citation ids are matched loosely and resolved by unique
prefix** (client and server both) because the model sometimes drops trailing UUID characters. Text
streamed before a tool round is treated as deliberation and discarded when the `tool` event arrives; an
`update_doc` tool call triggers a store `refresh()`. SSE for the answer comes over a `fetch` POST
stream (EventSource can't POST).

## 3c. Ledgers — project cost tracking

A largely independent section (sidebar entry **Ledgers**, `/ledgers`) for tracking project costs line
by line — a purpose-built alternative to a cost-tracking spreadsheet. It connects to the document
organizer only through optional, two-way links.

**Model** (`projects` + `line_items` tables, plain SQLite — no FTS/vec): a **project** has a name,
optional description, and `status: active | archived`. Each **line item** captures category,
vendor/contractor, description/milestone, quantity, date paid, invoice number, amount requested, amount
paid (pre-tax), GST/HST, total paid, status, and notes — plus an optional `document_id`. Categories and
vendors aren't a managed list: each item carries its own text, and the project page derives the distinct
sets for `<datalist>` autocomplete and for the **by-category / by-vendor** breakdowns. Money rollups
(requested / paid / tax / total) are computed per request in `StoreService.sumTotals`, never stored.

**Document links are bidirectional.** A line item may link one stash document as supporting evidence
(picked via the same search-popover the chat uses for pins). The document page shows a **"Cited in
ledgers"** card listing every line item that references it (`GET /api/projects/by-document/:docId`).
Deleting a document nulls those links inside `removeDocument`'s transaction, so they dangle harmlessly.

**UI** (`pages/LedgersPage.tsx`, `pages/LedgerPage.tsx`): the index is a grid of project cards with a
stats strip. A project page has the money stats strip, by-category/by-vendor breakdown bars, a **spend
timeline** (`components/SpendTimeline.tsx`), and the line-item table (dense, tabular-nums, a totals
`tfoot`); clicking a row opens `LineItemDialog` (all fields, with **Total paid** auto-summing from paid
+ tax until the user overrides it, plus the document picker). `ProjectDialog` handles create/edit.
Projects ride along in the global `store` (loaded with docs + categories in `refresh()`), so the
sidebar shows an active-project count.

**Spend timeline** (`components/SpendTimeline.tsx`): a chart of line-item `totalPaid` over time with
three modes — **Monthly**, **Quarterly**, **By category**. Time buckets are gap-filled (it walks
month-by-month from the first to the last paid date so quiet periods render as empty columns — the gaps
are how you read pacing) and each column stacks into per-category segments (colored from
`CATEGORY_COLORS`). Items with a missing/invalid `datePaid` can't be placed in time, so their spend is
summed separately and noted rather than dropped. Clicking a segment opens the underlying line item.

## 4. Categories ("drawers")

Categories are dynamic: seeded with just **Other** (`isCustom: false`, undeletable), grown by the
classifier proposing new ones, or created by the user.

- **Auto-styling** (`server/services/categoryStyle.ts`): a new category's icon is picked by keyword
  regex on the slug (e.g. `medical|health → heart-pulse`, `tax|bank → landmark`; 13 icons total) and
  its color by hashing the slug into a 12-color palette. The client mirrors both lists in
  `lib/categoryMeta.tsx`.
- **Create**: a **+** button beside "The Cabinet" in the sidebar opens an inline input — Enter creates
  and navigates to the new (empty) drawer. `POST /api/categories` (409 on duplicate slug).
- **Edit**: every category page has an Edit button → dialog to rename and pick any icon/color.
  `PATCH /api/categories/:id` — the slug never changes, so documents don't need rewriting.
- **Delete**: only **custom and empty** drawers (`DELETE /api/categories/:id`; 400 with a count
  otherwise). The category page's "Remove drawer" button is disabled with a hint while documents remain.
- **Drag-and-drop filing**: any document card/row can be dragged onto a sidebar drawer (custom MIME
  `application/x-stashd-docs`; drop target highlights; toast confirms). Re-categorizing does **not**
  move the file on disk — `storagePath` keeps the original folder, which is cosmetic only.

**Sidebar drawer ordering** (`components/Sidebar.tsx`): categories carry `pinned: boolean` and
`position: number`. Drawers sort pinned-first, then by manual `position` (>0 wins), then by usage
(document count), then name (`sortDrawers`); a thin rule separates the pinned group from the rest.

- **Pin/unpin**: a pin button toggles `pinned` via `PATCH /api/categories/:id` — optimistic (the row
  jumps immediately; a failure refetches to snap back).
- **Reorder**: drawers are draggable and drop onto each other (custom MIME
  `application/x-stashd-drawer`, kept distinct from the document-filing MIME so the gestures don't
  collide). Dropping inserts before the target and persists the whole order via
  `PATCH /api/categories/reorder` (`StoreService.reorderCategories` stamps 1-based positions in a
  transaction); also optimistic.
- **Collapsible cabinet**: "The Cabinet" header has a chevron that hides/shows the drawer list,
  persisted in `localStorage` (`stashd:cabinet-collapsed`).

## 5. Browsing UI

**Pages** (react-router):

- **Inbox `/`** — drop tray, upload tray (in-flight jobs), stat tiles (docs, drawers in use, flagged
  count, total tracked amounts), flagged-for-review list, six most recent docs, and a "cabinet" of
  category cards.
- **All documents `/all`** — sort (newest/oldest/A–Z/amount) + "flagged only" filter.
- **Category `/category/:id`** — the drawer's docs, doc-count and summed amounts in the header, plus
  Edit / Move-all / Remove actions.
- **Search `/search?q=…`** — server-side results with snippets.
- **Document `/doc/:id`** — full viewer dispatched by `viewerKind(mime)` (`lib/format.ts`) into one of
  six branches: **pdf** (pdf.js multi-page render with zoom), **image** (jpeg/png/webp; HEIC shows a
  fallback + download), **text** (txt as monospace `<pre>`, md via a small self-contained markdown-lite
  renderer), **html** (docx → `mammoth.convertToHtml` client-side, **sanitized with DOMPurify** before
  injection), **table** (xlsx/csv → SheetJS, a tab per sheet, capped at 1,000 rows), and **email**
  (eml/msg → renders the stored flattened `extractedText` as a header block + body; no in-browser email
  parsing). The heavy libs (`mammoth`, `xlsx`, `dompurify`) are **dynamically imported** so they
  code-split. Plus editable category/tags/notes with dirty-state save, resolve-flag and delete actions,
  and an AI-metadata card (summary, vendor, amount, doc date, confidence meter). Every previewable
  branch has a **full-screen toggle** in its bar (shared via a `ViewerChromeContext`): the viewer's
  shell is a `display:contents` no-op until toggled, then becomes a `position:fixed` overlay
  (`.viewer-fullscreen`, z-index 500) filling the window — no remount, so zoom / scroll / selected sheet
  carry over; Esc or the minimize button exits and the page is scroll-locked while open.

**Grid/list toggle:** All-docs, Category, and Search pages default to a **preview-card grid** — PDFs
render their first page client-side (pdf.js, lazily via IntersectionObserver once a card nears the
viewport, cached in-memory with a 200-entry cap), images (incl. webp) load directly, and everything
else (HEIC, txt/md, docx/xlsx/csv, eml/msg, failures) falls back to a category-colored icon tile. A
toggle (persisted in `localStorage`, shared across pages) switches to the denser ledger-row list. Inbox
keeps rows (it's a review queue).

**Multi-select + bulk actions:** a Select-mode toggle turns cards/rows selectable; with a selection
active, a bulk bar offers **delete** and **move-to-drawer** across the chosen documents (driven by the
batch `PATCH /documents` endpoint). (Added 2026-06-18, reversing an earlier rejection of the idea.)

**Shared client state** (`store.tsx`): one context holding docs + categories + projects (refreshed
together), the upload queue with SSE wiring, the review-sheet open state, and a toast system.
Components call API functions from `api.ts` directly and then `refresh()`.

## 6. API surface (all under `/api`)

| Method & path                                    | Purpose                                                                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /documents/upload`                         | multipart upload → `{ jobId, duplicate? }` (413 over 50 MB, 400 bad type)                                                   |
| `DELETE /documents/job/:jobId`                   | discard an in-flight upload (temp dir + sidecar); idempotent 204                                                            |
| `GET /documents/process/:jobId`                  | SSE: `extracting → classifying → complete` (with classification) or `error`                                                 |
| `POST /documents/file/:jobId`                    | persist a reviewed document; response includes `attachmentsSpawned` (emails fan out attachments into their own docs)         |
| `GET /documents?search=&category=`               | list/search (SearchHits with snippets when searching)                                                                       |
| `GET /documents/:id` / `GET /documents/:id/file` | metadata / raw file                                                                                                         |
| `PATCH /documents/:id`                           | update category/tags/notes/status                                                                                           |
| `PATCH /documents`                               | batch update `{ ids, category?, status?, addTags?, removeTags? }` (drives drag-and-drop + multi-select bulk move)            |
| `DELETE /documents`                              | batch delete `{ ids }` → `{ deleted }` (multi-select bulk delete)                                                          |
| `DELETE /documents/:id`                          | delete file + entry                                                                                                         |
| `GET /categories`                                | all categories with live `documentCount`                                                                                    |
| `POST /categories`                               | create by name (auto icon/color)                                                                                            |
| `PATCH /categories/:id`                          | rename / re-icon / re-color / pin (`pinned`)                                                                                |
| `PATCH /categories/reorder`                      | persist manual drawer order `{ ids }` (declared before `:id` so "reorder" isn't read as an id)                              |
| `DELETE /categories/:id`                         | delete (custom + empty only)                                                                                                |
| `GET /chat` / `POST /chat`                       | list conversations / start one                                                                                             |
| `GET /chat/:id` / `DELETE /chat/:id`             | conversation with messages + pins / delete it                                                                               |
| `PUT /chat/:id/pins`                             | replace pinned-document list `{ docIds }`                                                                                   |
| `POST /chat/:id/messages`                        | send a user message; SSE stream of `token` / `tool` / `done` / `error` events                                               |
| `GET /projects`                                  | all projects with computed money totals                                                                                    |
| `POST /projects`                                 | create a project `{ name, description? }`                                                                                   |
| `GET /projects/:id`                              | project detail with line items + totals                                                                                     |
| `PATCH /projects/:id`                            | rename / re-describe / archive (`status`)                                                                                   |
| `DELETE /projects/:id`                           | delete project + its line items                                                                                             |
| `POST /projects/:id/items`                       | add a line item                                                                                                             |
| `PATCH /projects/:id/items/:itemId`              | partial-update a line item (`documentId: null` clears the link)                                                            |
| `DELETE /projects/:id/items/:itemId`             | delete a line item                                                                                                         |
| `GET /projects/by-document/:docId`               | line items linking a given document (the document → ledger direction)                                                       |

## 7. Where it's headed

`docs/superpowers/plans/` holds completed-work records (local-only; gitignored). **RAG "ask your docs"
+ tool-calling chat landed 2026-06-12** (§3b), as did the SQLite/FTS5 migration, duplicate detection,
and the batch upload queue. **Expanded file-type support landed 2026-06-18**: webp, txt, md, docx,
xlsx, csv, eml, msg — via an extension-keyed extraction dispatcher, a six-way viewer dispatcher, and
email-attachment fan-out (§2), plus the full-screen viewer and multi-select bulk delete/move.

Remaining roadmap: re-classify-on-demand and classification feedback loops as smaller follow-ups.
Deprioritized: server-side thumbnails, dashboards/reminders. Known intelligence gaps: image-only
documents are searchable only via their classify-time transcription; chat answers depend on the local
embedding model being pulled; conversations have no rename, and answers stream but can't be cancelled
mid-generation.
