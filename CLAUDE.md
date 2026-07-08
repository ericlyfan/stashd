# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It is the single living document for **Stashd** — both the _operating manual_ (how to build, run,
verify, and not break things) and the _architecture & feature reference_ (how it all works). Keep this
file honest and current; it is the project's memory and the first thing agents load.

_Last updated: 2026-07-07 (**job applications tracker** — new sidebar section `/applications` (§3e):
`job_applications` + `application_stages` (customizable pipeline, 5 seeded, `kind` + `is_terminal`
drive the KPI math) + `application_events` (timestamped status history — stage changes happen only
via events, never PATCH) + `application_contacts` tables; `routes/applications.ts` +
`services/applications.ts` (`buildApplicationsSnapshot`, `STALE_DAYS = 14`); **board/kanban view**
(native DnD, `application/x-stashd-application` MIME) + **sortable table** behind a persisted view
toggle, 6 KPI tiles (the Needs-follow-up tile doubles as a filter); wide two-pane
`ApplicationDialog` (form + timeline + contacts), `StageManagerDialog`; chat gains
**get_applications + gated write tools add/move/update_application** (classic + agentic, shared
helpers in `services/applications.ts`, page refresh via a `stashd:applications-changed` window event); **`DocumentBrowser` lifted out of `LineItemDialog`**
into `components/DocumentBrowser.tsx`. Same day, earlier: **portfolio intelligence suite** — `GET /holdings/health` +
`services/RiskService.ts` (risk stats vs SPY, correlation/concentration/FX/sector warnings, heuristic
rebalancing hints) rendered by a **Risk & health panel**; `buildSnapshot` extracted to
`services/portfolio.ts`; chat gains a **get_portfolio tool** (classic + agentic); **news sentiment**
lexicon dots; **insider activity** card (`/api/market/insiders/:symbol`); sector screener
**value-enrichment** (`?enrich=1` → analyst-target upside column, sortable); **watchlist folders +
thesis notes** (`folder` column migration, `PATCH /watchlist/:id`, grouped table + edit dialog).
Prior 2026-07-06: Discover expansion (pulse strip, ETFs + Canada tabs, fundamentals + news, full-width
stock page, Signal card `lib/signals.ts`). Prior 2026-07-05: **portfolio overhaul + market discovery** — `/portfolio` now reads as a
holdings dashboard: **allocation panel** (shared `components/Breakdown.tsx`, top-8 + gray "Other",
by-holding / by-currency tabs), **sortable holdings columns**, **30-day sparklines**
(`components/Sparkline.tsx` + `lib/trends.ts`, `GET /holdings/history/:symbol?days=N`), helpers
deduped into `lib/gains.ts`. **Market discovery** landed the same day: `MarketService` +
`/api/market/*` (no-key ticker search via Nasdaq autocomplete + TSX directory; US sector screener +
movers via Nasdaq), a **`TickerSearch` typeahead** (watchlist add + ticker lookup), a **Discover
section on `/portfolio`** (the `MarketExplorer` movers/sector panel — there is no standalone
Discover page or sidebar entry, by request), and a **redesigned stock detail page** (chart +
period-returns strip + position/statistics rail with 52-week range meter + transactions table))_

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
multimodal LLM on _your own_ Ollama instance reads each one and proposes a filing — category, tags,
summary, key dates, amount, vendor — and you approve or correct it before it lands in "the stash."
Nothing leaves the machine except the call to your configured Ollama endpoint.

Five feature pillars beyond filing:

- **Search** — FTS5 full-text over document bodies, with match-aware snippets.
- **Ask the stash** (`/chat`) — RAG chat with citations and a native tool loop that can act on the stash.
- **Ledgers** (`/ledgers`) — project cost tracking, optionally linked to stash documents.
- **Portfolio** (`/portfolio`) — stock-holdings tracker with live prices and gain/loss, optionally linked to stash documents.
- **Applications** (`/applications`) — job-application pipeline tracker (kanban + table, customizable stages, timestamped status history), optionally linked to stash documents.

**Accepted file types** — single source of truth is `MIME_BY_EXT` in `shared/src/category.ts`
(exposed as `SUPPORTED_EXTENSIONS` / `isSupportedFilename`): `pdf`, `jpg/jpeg`, `png`, `heic/heif`,
`webp`, `txt`, `md`, `docx`, `xlsx`, `csv`, `eml`, `msg`. Both acceptance gates (client drop
validation + server multer) are derived from this map's keys and **validate by extension**, not the
browser-reported MIME (unreliable for Office/email); the pipeline resolves MIME via `mimeFromExtension`.

## Repository layout

npm-workspaces monorepo; three packages under `packages/`.

| Package  | Stack                                      | Entry / role                                           |
| -------- | ------------------------------------------ | ------------------------------------------------------ |
| `server` | Express 4, TypeScript, tsx, better-sqlite3 | `src/index.ts` → `src/app.ts`. REST + SSE, storage, AI |
| `client` | React 18, Vite, react-router 6, pdfjs-dist | `src/main.tsx` → `src/App.tsx`. SPA, hand-written CSS  |
| `shared` | TypeScript only                            | `src/index.ts` re-exports `types.ts` + `category.ts`   |

### Where things live

**Server** (`packages/server/src/`)

- `app.ts` — wires services + routes; runs boot backfills. `index.ts` — listen loop.
- `routes/` — `documents.ts`, `categories.ts`, `chat.ts`, `projects.ts`, `holdings.ts`,
  `watchlist.ts`, `market.ts`, `applications.ts` (one router factory each).
- `services/`
  - `StoreService.ts` — **all SQLite access** (better-sqlite3, WAL). Schema, migrations, queries.
  - `FileService.ts` — file storage under `data/documents/<slug>/` and `data/temp/<jobId>/`.
  - `ClassificationService.ts` — prompt building, model call, taxonomy guards (serialized).
  - `textExtraction.ts` — extension-keyed `extractText` dispatcher + `backfillDerivedFields`.
  - `emailParse.ts` — `.eml`/`.msg` → headers + body + attachments.
  - `EmbeddingService.ts` — chunk + embed (local Ollama), vector index lifecycle.
  - `ChatService.ts` — RAG retrieval + tool loop.
  - `QuoteService.ts` — live stock quotes (`fetchQuotes`: Yahoo → Nasdaq(US) → TMX(Canadian)) and daily-close history (`fetchHistory`: Cboe CDN(US) / TMX(Canadian) → Yahoo → Nasdaq), no key, cached, failure-tolerant.
  - `FxService.ts` — foreign-exchange rates (`fetchRates`, Frankfurter → open.er-api → stale → identity) for multi-currency portfolio totals, no key, cached ~1h, failure-tolerant.
  - `MarketService.ts` — market discovery, no key, cached, failure-tolerant: `searchSymbols` (Nasdaq autocomplete for US + the TSX company directory for Canadian, ".TO"-suffixed and re-ranked exact-symbol → companies → ETF wrappers, since the directory ranks Shopify-themed ETFs above Shopify Inc.), `screenSector` (Nasdaq screener, 11 sector tokens), `marketMovers` (US most active / gainers / losers via Nasdaq, plus `canada` = TSX most-active via TMX `getMarketMovers`), `marketPulse` (index-proxy ETFs via `fetchQuotes`), `popularEtfs` (curated shelf, priced live), `stockProfile` (Nasdaq quote-summary / TMX GraphQL fundamentals), `stockNews` (Nasdaq per-symbol RSS, regex-parsed + entity-decoded / TMX news).
  - `positions.ts` — average-cost position accounting from a holding's lots (`derivePosition`).
  - `portfolio.ts` — snapshot assembly (`buildSnapshot` pure, `loadSnapshot` fetches store + quotes + FX), shared by the holdings route, RiskService, and the chat get_portfolio tool.
  - `RiskService.ts` — `buildHealthReport(snapshot)`: per-holding + portfolio risk stats from 1y closes vs SPY (vol/beta/Sharpe rf-0/max drawdown), pairwise correlations, concentration/FX/sector warnings (thresholds are consts up top), heuristic trim suggestions. Cached ~10min.
  - `applications.ts` — job-application snapshot assembly (`buildApplicationsSnapshot` pure, `loadApplicationsSnapshot` fetches the store): per-application enrichment (resolved stage, last activity, days-in-stage, staleness) + pipeline KPI stats, all derived from the event history; shared by the applications route and the chat get_applications tool. `STALE_DAYS = 14` is the follow-up threshold.
  - `categoryStyle.ts` — auto icon/color for new categories.
- `providers/` — model-provider registry keyed by `PROVIDER`; `OllamaProvider` is the only impl.
- `agentic/` — standalone experimental document agent loop (`glm-4.7:cloud` by default) with swappable
  model/tool/corpus seams; not yet wired to `/chat`.

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

Standalone agent experiment (`agentic/`):

- `AGENT_OLLAMA_URL` (falls back to `OLLAMA_URL`, then `http://localhost:11434`)
- `AGENT_OLLAMA_MODEL` (default `glm-4.7:cloud`)
- `AGENT_OLLAMA_API_KEY` (falls back to `OLLAMA_API_KEY`)

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
  resolution) lives there, not duplicated. The client _mirrors_ the icon/color picker in
  `lib/categoryMeta.tsx` — keep it in sync with `server/services/categoryStyle.ts`.
- **All SQLite goes through `StoreService`.** No ad-hoc DB access from routes. Money totals are
  _computed per request_ (`sumTotals`), never stored.
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
  local-only — don't assume a reader can see them. This `CLAUDE.md` _is_ committed.
- **HEIC** never previews in-browser (upload preview, viewer, thumbnails all fall back); classification
  still works via server-side JPEG conversion.
- **CJK search is weak** — filenames/text are stored correctly, but FTS5's `unicode61` tokenizer
  doesn't segment CJK, so Chinese queries only match from the start of an unbroken CJK run. Switching
  the index to the `trigram` tokenizer is the known fix if Chinese docs become common.
- **Extraction quality is bounded by the source** — PDFs with broken embedded font encodings yield
  partially garbled `extractedText`; image text exists only if the model transcribed it at classify time.
- **Duplicate detection is advisory, never a block** — two layers, both surfaced as banners the user
  can ignore. **Exact** (SHA-256, at upload) catches byte-identical files. **Fuzzy near-dup**
  (`services/nearDuplicate.ts`) catches re-scans/re-exports/emailed copies: a 64-bit **SimHash** over
  `extractedText` (text docs) and a 64-bit **dHash** over the image (via sharp), matched by **Hamming
  distance** (`SIMHASH_MAX_DISTANCE`/`PHASH_MAX_DISTANCE`; tune those constants). The near-dup check
  runs at the classify SSE `complete` stage (the first point the incoming doc's text/image exists) and
  only when no exact dup matched. Both signatures are stored (`sim_hash`/`perceptual_hash` columns,
  guarded migration) and backfilled at boot; a linear Hamming scan is fine at personal-stash scale.
  Signatures are 16-hex 64-bit strings; `simhash64` returns undefined below `SIMHASH_MIN_CHARS` (short
  text collides too easily), `perceptualHash` never throws (decode failure → no signature).
- **Market-data providers by market — and the CDR trap.** Quotes: US via **Nasdaq** (USD), Canadian via
  **TMX** (`app-money.tmx.com`, CAD); Yahoo is the nominal primary but 429-blocked from this sandbox.
  History: US via **Cboe's CDN** (`cdn.cboe.com/api/global/delayed_quotes/charts/historical/<S>.json`,
  daily OHLC back to ~2004, no key, doesn't throttle) → Yahoo → Nasdaq; Canadian via **TMX**. (Nasdaq's
  *historical* endpoint rate-limits bursts into uselessness — that's why Cboe is the primary US history
  source, not Nasdaq.) **Never route a US ticker to TMX** — its Canadian CDR trades at a different price
  (AAPL CDR ≈ 1/7 of AAPL). Guards: `fetchTmx` rejects `"CDR"`-named results, the quote chain only falls
  to TMX on Nasdaq's explicit `NOT_US`, and `fetchHistory` picks the provider from the resolved quote
  currency (never a guess). A throttled US quote → **unpriced**, not mispriced. `GET
  /holdings/history/:symbol` ends the series on today's live price (Cboe's last close lags a day or two).
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
   linking to the existing document — a gold **byte-identical** banner (exact SHA at upload) or a
   softer dashed **near-copy** banner with a similarity % (content-level SimHash/dHash match computed at
   the classify `complete` stage; only shown when no exact dup matched). After filing, the sheet
   auto-advances to the next ready item, so a
   batch can be reviewed back-to-back. A **Discard** button (and the tray's per-file/bulk skips) drops
   the upload entirely — client item and server temp dir both — without filing anything.
4. **File** — `POST /api/documents/file/:jobId` persists the document: creates the category if new
   (auto icon/color, see §4), moves the file into permanent storage, computes its `contentHash`
   (SHA-256) plus the near-dup signatures (`simHash` over text, `perceptualHash`/dHash over images —
   see §3 and `services/nearDuplicate.ts`), and inserts the row. Text extracted at classify time (dispatcher output or image
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
  match-aware) which the UI renders in italics on result cards/rows so you can see _why_ it matched.
- **Startup backfill** (`textExtraction.ts`, `backfillDerivedFields`): on boot the server re-parses any
  PDF lacking `extractedText`, hashes any file lacking `contentHash`, and computes the near-dup
  signatures (`simHash` from text, `perceptualHash` by decoding images off disk) for any doc missing
  them, so pre-feature documents become searchable and (exact + fuzzy) duplicate-checkable. Image text
  can't be backfilled (it comes from the model at classify time only).
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
`list_projects` / `read_project` (read) and `create_project` / `add_line_item` (**write** — record a
cost against a project, creating the ledger first if needed; gated on explicit user request in the
prompt, same as `update_doc`; `add_line_item` resolves the project by id/name and defaults
`totalPaid = amountPaid + taxAmount` when omitted, mirroring the line-item dialog) (see §3c), plus
**`get_portfolio`** (read — the live-priced portfolio snapshot via `services/portfolio.ts
loadSnapshot`: holdings with weights/returns in native currency, base-currency totals (default CAD),
and the watchlist with folders + thesis notes; `executeTool` is async for this one), plus
**`get_applications`** (read — the job-application pipeline via `services/applications.ts
loadApplicationsSnapshot`: KPI stats, the stage list, and every application with its stage,
days-in-stage and staleness flag) and the application **write** tools `add_application` /
`move_application` (stage change → appends a status event, never a direct write) /
`update_application` (fields/notes; cannot move stages) — same explicit-user-request gating as the
ledger writes; applications/stages are resolved by loose reference (`resolveApplication` /
`resolveStage` in `services/applications.ts` — id, unique id prefix, or unique company/name match;
ambiguity refuses rather than guesses). A
ledger-write tool triggers a client `refresh()` just like `update_doc`. Answers cite inline as `[doc:<id>]`; the server parses
these into `citations` (id + name, surviving later doc deletion) and persists tool calls as
human-readable records. History sent to the model is capped at the last 20 messages.

**Attach a file to just the chat** (chat-only context): dropping a file **onto the chat** (dock or full
page) attaches it as throwaway context rather than filing it. `POST /chat/:id/attachments` (multer,
extension-validated) runs the `textExtraction.ts` `extractText` dispatcher, caps the text at 20k, and
stores a row in `chat_attachments` (conversation-scoped, deleted with the conversation, **never** in the
stash / FTS / vec index). `getConversation` returns `attachments`, and both `ChatService.buildMessages`
and `AgenticChatService` inject each attachment's text into the system prompt like a pinned doc (but
with no `[doc:]` id to cite). **Text-bearing types only** — images carry no extractable text and are
rejected (400); a file that yields no text is refused (422). The chat's drop handler `stopPropagation`s
so the global classify-and-file curtain (`DropZone.tsx`, now `pointer-events:none` and hidden via a
`body.chat-drag-over` class while dragging over the chat) doesn't also fire.

**Client** — the chat UI is a reusable **`components/ChatSurface.tsx`** (all state/logic: messages,
pins, attachments, stream, mode, `send()`, SSE, citations) hosted in **two shells**: the full-page
route (`pages/ChatPage.tsx`, a thin wrapper wiring `convId`/`onConvIdChange` to the router) and a
floating **`components/ChatDock.tsx`** (draggable by its top bar; **resizable from the top and left edges
+ top-left corner** — handles live on the sides away from the toolbar buttons so a bottom-right-docked
panel grows up/left; rect persisted to `localStorage` `stashd.chatDock`; z-index 90, below modal scrims).
Its top toolbar is compacted in the dock variant (`.chat-layout--dock`: truncated history title,
icon-only New chat, tighter mode toggle) so it doesn't overflow the narrow panel; the composer's
keyboard-hint chips (`↵ send · ⇧↵ line`) are also hidden in the dock — they squeezed the narrow
input to a sliver (full page keeps them). The **history popover is dock-anchored in the dock**
(`.chat-layout--dock .chat-hist` goes `position: static` so `.chat-hist-pop` spans the dock and caps
to its height) — button-anchored, its fixed 320px/60vh size overflowed and was clipped by a
minimum-size dock (`overflow: hidden`). The popover scrolls with its scrollbar hidden (by taste). A shared
**`ChatDockContext`** (mounted in `App.tsx` above `<Routes>`) holds `{ open, activeConvId }` so the panel
and its conversation survive navigation. The **corner `ChatLauncher`** opens the dock (`openDock()`); the
**sidebar "Ask the stash"** link goes to the **full-page** `/chat` (a plain `NavLink`), and the dock's
**Expand** button also hands off to the full page (`/chat/:id`).
`ChatSurface` takes `variant: 'page' | 'dock'` and optional `onExpand`/`onClose`/`onHeaderPointerDown`.
The full-page view: a **single-column page** (no second sidebar) under the global nav.
A slim **top bar** holds a `History ▾` dropdown (past conversations — active highlight, **Agentic**
badge, relative date, delete; the `HistoryMenu` popover replaced the old "Correspondence" rail) on the
left, and the mode toggle (thread view only) + a **New chat** button on the right. The active
conversation renders as a single "sheet" card — an **On the desk** pinned-docs tray along its top edge,
the thread as ledger entries, and the composer as the sheet's footer. **Chat mode is per conversation,
not global.** Each conversation stores a `mode` (**Current** = `ChatService` / **Agentic** =
`AgenticChatService`) — fixed when the chat is started and switchable later from the top bar (a
`PATCH /chat/:id` persists it). The message route reads the *stored* conversation mode as the source of
truth, so messages no longer carry `mode`. **The page always opens on a centered New Chat start
screen** (a **dynamic greeting** counting your documents/drawers/flagged, two mode cards with blurbs,
composer, and **stash-grounded suggestions** drawn from your newest doc, a paid vendor, flagged
backlog, fullest drawer, an active ledger and a recurring tag — `stashSuggestions`): the `/chat` route
has no id, and both the sidebar "Ask the stash" link and the top-bar **New chat** button navigate
there; sending the first message creates the conversation and transitions to the sheet. The mode picker
seeds from a `stashd.chatMode` localStorage default (the last mode you chose) so new chats start where
you left off. Markdown-lite rendering covers paragraphs, bullets, **bold**, `###` headings and pipe tables
(deliberately not a markdown engine); citation markers become chips linking to `/doc/:id`, with a
"sources" footer per answer, and tool calls render as a mono work-log above the answer. **Citation ids
are matched loosely and resolved by unique prefix** (client and server both) because the model sometimes
drops trailing UUID characters. Text streamed before a tool round is treated as deliberation and
discarded when the `tool` event arrives; an `update_doc` tool call triggers a store `refresh()`. SSE for
the answer comes over a `fetch` POST stream (EventSource can't POST).

**Agentic chat prototype** (`agentic/` + `AgenticChatService`): an experimental loop available in
`/chat` via the **Agentic** mode toggle. `AgenticWorkflow` is model-agnostic and enforces the
reliability rails: strong retrieval-first system prompt, a hard tool-iteration cap (default 6), tool
errors returned as tool messages, compact JSON tool results, and per-step trace events.
`OllamaAgentClient` talks to Ollama `/api/chat` with `glm-4.7:cloud` by default. The tool set now
reaches parity with the classic chat: document tools (`search_docs`, `read_doc`, `list_categories`,
and `update_doc` — re-categorize / tag / flag, gated on explicit user request in the system prompt) and
ledger tools (`list_projects`, `read_project`, including optional line-item filtering such as project
`4190` + query `Costco`, plus the **write** tools `create_project` / `add_line_item` — same gating and
`totalPaid` defaulting as classic), the portfolio read tool (`get_portfolio`,
`agentic/PortfolioAgentTools.ts`) and the application tools (`agentic/ApplicationAgentTools.ts`:
`get_applications` read + the gated writes `add_application` / `move_application` /
`update_application` — same shared action/resolution helpers as classic). Document tools go through the `AgentDocumentCorpus` seam: `StoreDocumentCorpus`
adapts the real `StoreService` (and resolves a truncated/prefix doc id the way citations do), while
`FixtureDocumentCorpus` supports standalone smoke tests without a database or live model.
`AgenticChatService` wraps this loop with normal chat persistence, pinned-doc context, a lightweight
roster context message (today's date + drawers + ledgers, so the agent need not spend a tool round to
learn what exists), loose citation extraction and SSE-compatible tool/done events. It **streams model
tokens** like classic chat: an `onToken` handler threads from `AgenticChatService` → `AgenticWorkflow.run`
→ `OllamaAgentClient` (which switches to `stream: true` and parses the NDJSON), forwarding `token`
events as they arrive. Tokens stream every round; a round that ends in a tool call has its deliberation
text discarded client-side on the `tool` event (same as classic). An `update_doc` tool event drives the
same client `refresh()` as classic mode.

## 3c. Ledgers — project cost tracking

A largely independent section (sidebar entry **Ledgers**, `/ledgers`) for tracking project costs line
by line — a purpose-built alternative to a cost-tracking spreadsheet. It connects to the document
organizer only through optional, two-way links.

**Model** (`projects` + `line_items` tables, plain SQLite — no FTS/vec): a **project** has a name,
optional description, `status: active | archived`, and an `isDefault` "current project" flag
(`is_default` column, guarded migration). Each **line item** captures category,
vendor/contractor, description/milestone, quantity, date paid, invoice number, amount requested, amount
paid (pre-tax), GST/HST, total paid, status, and notes — plus an optional `document_id`. Categories and
vendors aren't a managed list: each item carries its own text, and the project page derives the distinct
sets for `<datalist>` autocomplete and for the **by-category / by-vendor** breakdowns. Money rollups
(requested / paid / tax / total) are computed per request in `StoreService.sumTotals`, never stored.

**Document links are bidirectional.** A line item may link one stash document as supporting evidence,
chosen from a **full-window document browser** (`components/DocumentBrowser.tsx`, shared by
`LineItemDialog` and the job-application dialog): a search box (name/vendor/folder/tag/summary), a left folder rail
that filters by drawer, and a scrollable list showing each document's full (two-line-clamped) name,
folder, vendor, date and amount. It opens from the "link a document" trigger or the "Change" button on
an existing link. (The chat's pin picker still uses the compact `.pin-pop` popover.) The document page shows a **"Cited in
ledgers"** card listing every line item that references it (`GET /api/projects/by-document/:docId`).
Deleting a document nulls those links inside `removeDocument`'s transaction, so they dangle harmlessly.

**UI** (`pages/LedgersPage.tsx`, `pages/LedgerPage.tsx`): the index is a grid of project cards with a
stats strip. A project page has the money stats strip, by-category/by-vendor breakdown bars (the
segmented-bar-plus-rows view is the shared `components/Breakdown.tsx`, also used by the portfolio's
allocation panel), a **spend
timeline** (`components/SpendTimeline.tsx`), and the line-item table (dense, tabular-nums, a totals
`tfoot`); clicking a row opens `LineItemDialog` (all fields, with **Total paid** auto-summing from paid

- tax until the user overrides it, plus the document picker). `ProjectDialog` handles create/edit.
  Projects ride along in the global `store` (loaded with docs + categories in `refresh()`), so the
  sidebar shows an active-project count.

**Current ("default") project:** a project page's **★ Set current** toggle sets `isDefault` (`PATCH
/projects/:id { isDefault }`); the index cards show a **Current** badge. When **exactly one** project is
default, the sidebar's **Ledgers** entry deep-links straight to it (`/ledger/:id`) — the "jump to what
I'm working on" shortcut; with **zero or several** defaults it falls back to the `/ledgers` index (normal
selection). Deliberately not enforced to a single default in the DB — the sidebar just treats "not
exactly one" as the index case, and the `/ledgers` index always lists everything so you can re-pick.

**Spend timeline** (`components/SpendTimeline.tsx`): a chart of line-item `totalPaid` over time with
three modes — **Monthly**, **Quarterly**, **By category**. Time buckets are gap-filled (it walks
month-by-month from the first to the last paid date so quiet periods render as empty columns — the gaps
are how you read pacing) and each column stacks into per-category segments (colored from
`CATEGORY_COLORS`). Items with a missing/invalid `datePaid` can't be placed in time, so their spend is
summed separately and noted rather than dropped. Clicking a segment opens the underlying line item.

## 3d. Portfolio — stock holdings

A standalone section (sidebar entry **Portfolio**, `/portfolio`) for tracking stock positions —
what you own, what you paid, and what it's worth now. Like Ledgers it's largely independent of the
document organizer, connecting only through an optional one-way link (a holding → a supporting stash
document, e.g. a brokerage statement).

**Model** (`holdings` + `holding_lots` tables, plain SQLite — no FTS/vec): each **holding** carries a
`symbol` (ticker), optional `name`, `shares`, `buyPrice` (per-share cost basis), an optional
`manualPrice` (per-share current-price override), an optional `currency`, an optional `documentId`, and
`notes`. **The current price is never stored** — it's fetched live per request; `manualPrice` is the
fallback. Money rollups are computed per request in the route's `buildSnapshot`, never persisted.

**Lots (dated transactions).** A holding can have **`holding_lots`** — dated buys/sells (`type`,
`trade_date`, `shares`, `price`, optional `fee`/`notes`). When a holding has lots they are the **source
of truth** for its position; with none, the stored `shares`/`buyPrice` act as a single undated opening
lot (so pre-lot holdings keep working). `services/positions.ts` `derivePosition` folds the lots by
**average cost** (a buy adds shares + cost incl. fee; a sell realizes `qty × (price − running avg cost)`
and reduces the open basis) → `{ openShares, costBasis, avgCost, realizedGain, lotCount }`. `buildSnapshot`
**overrides** the enriched holding's `shares`/`buyPrice`(=avg cost)/`costBasis` with the derived values,
so the client reads the same fields either way. Lots cascade-delete with the holding.

**Live prices** (`QuoteService.ts`): `fetchQuotes` resolves each symbol through a **provider chain**, no
API key: **(1) Yahoo** chart endpoint (`/v8/finance/chart/<SYMBOL>`, `meta.regularMarketPrice` +
`chartPreviousClose`) with a **primed session cookie** and **query1 → query2** failover; **(2) Nasdaq**
public quote API (`api.nasdaq.com/api/quote/<SYMBOL>/info?assetclass=stocks|etf`, parsing the
`$1,234.56`/`+2.85` strings, deriving previous close from `netChange`) — tries `stocks` then `etf`, so it
covers NYSE/Nasdaq equities and ETFs; **(3)** the **last cached quote** (stale up to 24h) so a refresh
outage doesn't blank the portfolio. It dedupes + upper-cases symbols, caches fresh quotes ~60s, fetches
concurrently, and **never throws**. Both providers need a browser-like `User-Agent`. **Why the chain:**
Yahoo rate-limits aggressively (HTTP 429) and is unreachable from some IPs (including this sandbox);
Nasdaq is the reliable fallback that made the feature actually work. If both are unreachable, `quotesLive`
is `false` and holdings show their `manualPrice` or render unpriced (the always-works manual fallback),
with a "live prices unavailable" note.

**Canadian listings (TMX).** Nasdaq is **US-only** and Yahoo is rate-limited from here, so Canadian
holdings are priced from the **Toronto exchange's own GraphQL API** (`app-money.tmx.com`, `fetchTmx` /
`fetchTmxHistory`), in CAD, no key. It resolves both bare symbols (`VFV`) and suffixed (`VFV.TO`), for
quotes **and** history. **CDR hazard:** a US ticker (e.g. `AAPL`) has a *Canadian Depositary Receipt*
on the TMX at a wholly different price/currency, so TMX must never be used for a US symbol. Two guards
enforce this: `fetchTmx` **rejects any result whose name contains "CDR"** (`isCdrName`), and provider
routing never *guesses* — a bare symbol only falls to TMX when Nasdaq **confirms** it isn't a US listing
(`NOT_US`, from Nasdaq's `rCode 400`), and **history** is routed by the symbol's *already-resolved quote
currency* (`fetchHistory(symbol, canadian)` — TMX only when the live quote came back CAD or the symbol is
Canadian-suffixed). A US ticker whose US quote was merely throttled stays **unpriced**, never mispriced.
Other non-US exchanges (`.L` London, etc.) still rely on Yahoo (`meta.currency`).

**Price resolution & returns** (`routes/holdings.ts`): per holding the current price resolves to the
live quote (`priceSource: 'live'`), else the manual override (`'manual'`), else nothing (`'none'`,
unpriced). When priced: `marketValue = openShares × currentPrice`; `gain`/`gainPct` are **unrealized**
(`marketValue − costBasis`); `totalGain`/`totalReturnPct` fold in `realizedGain` from sells; and — for
live quotes with a previous close — a `dayChange`. **Portfolio return % is measured against the cost
basis of the _priced_ holdings only**, so an unpriced position doesn't distort the percentage.

**Multi-currency.** Each holding has a **native currency** = the live quote's `meta.currency` → else its
manual `currency` field → else the base. All per-holding money (price, cost basis, market value, gain,
day change) stays **native**. The portfolio **totals + weights + chart** are in a **base currency**
(request `?base=CAD`, default `USD`; the client persists a base selector in `localStorage`
`stashd.portfolioBase`, default `CAD`). `buildSnapshot` sets each holding's `fxToBase` from
`FxService.fetchRates(base, currencies)` (Frankfurter → er-api → stale → identity 1.0 with `fxLive:false`)
and sums `native × fxToBase` into base-currency totals; `weight = marketValueBase ÷ total base market
value` (currency-invariant). If FX is unavailable, `fxLive` is false, amounts are summed unconverted, and
the UI shows an advisory note.

**Per-stock history** (`GET /holdings/history/:symbol?days=N` → `StockHistory`): one stock's live
quote + daily-close series (`QuoteService.fetchHistory(symbol, canadian)`; TMX for Canadian, Nasdaq/Cboe
for US, cached ~6h, native currency — no FX); `?days` trims the series server-side (sparklines request
30; `lib/trends.ts` re-trims client-side so the "30d" label holds even against a stale server). Powers
the **stock detail page** (route `/portfolio/:symbol`, `pages/StockPage.tsx`): clicking any
holding/watchlist/discover row opens it — it works for **any** symbol, owned or not. Layout is a
**full-width chart + rail grid** (`.stock-grid`, page `maxWidth: none` like the portfolio; rail 360px;
collapsing to one column under ~1020px): the left column holds the **`StockHistoryChart`** (hand-built
inline SVG price line, range selector `1W 1M 3M 6M YTD 1Y ALL`, hover tooltip, graceful empty state;
taller here — `.stock-main .perf-plot` is `min(400px, 38vh)`), a **period-returns strip**
(1W/1M/3M/6M/YTD/1Y/All computed client-side from the closes; windows older than the data show "—"),
— when the holding has lots — a read-only **Transactions** table (buy/sell chips, per-lot totals,
"Manage" opens `HoldingDialog`), and a **Recent news** card (`GET /market/news/:symbol`, headline ·
source · relative date, external links). The right rail stacks fact cards: **Your position** (shares ·
avg cost · book cost · market value · unrealized/realized/total return · weight, plus Edit/Watch
actions, supporting-document link and notes) or a **"Not in your portfolio"** CTA card (Add to holdings
/ Watch), a **Signal** card (`lib/signals.ts` `buildSignal` — a client-side heuristic verdict
Strong buy → Strong sell from ±1 votes: price vs 50-day SMA, 50 vs 200-day SMA posture, Wilder RSI-14
extremes, analyst-target upside when available; needs ≥2 computable indicators, renders each vote with
a colored dot and an explicit "not investment advice" line), **Statistics** (previous close, today,
52-week low/high with a **range meter** marking where today's price sits), and **Fundamentals**
(`GET /market/profile/:symbol` — market cap, P/E, EPS, dividend yield/amount/ex-date, 1-yr target,
volumes; sector · industry · exchange ride in the header sub-line). Profile + news fetch after the
quote resolves (its currency routes bare Canadian symbols to TMX) and never block the page. (There is **no** portfolio-wide performance graph — removed in favor of
this per-stock view.)

**Market discovery** (`services/MarketService.ts`, `routes/market.ts` at `/api/market`, no key, cached,
failure-tolerant — outages degrade to empty lists): **ticker search** (`searchSymbols`: Nasdaq
autocomplete for US stocks/ETFs + the TSX company directory for Canadian, results ".TO"-suffixed so the
quote chain routes to TMX and never collides with a same-lettered US listing; exact-symbol matches float
first; Nasdaq's share-class name boilerplate is stripped by `cleanName`), a **sector screener**
(`screenSector`, Nasdaq's public screener, 11 validated sector tokens, market-cap order) and **movers**
(`marketMovers`: most active by dollar volume / gainers / losers — beware Nasdaq overloads the `change`
column, so percent is only trusted when the string contains "%"). Client surfaces: 
**`components/TickerSearch.tsx`** — a debounced combobox (arrow keys + Enter; Enter with no selection
falls through to the raw ticker) used twice on `/portfolio`: the **watchlist add** (selects add to the
watchlist) and the Discover section's **ticker lookup** (selects open the stock page); and
**`components/MarketExplorer.tsx`** — a **market-pulse strip** (clickable index tiles: S&P 500 /
Nasdaq 100 / Dow / Russell 2000 / TSX Composite day-moves via `GET /market/pulse`), tabs for
**Most active / Gainers / Losers / Canada / ETFs** (Canada = the TSX most-active list via TMX; the
ETFs tab is the curated `GET /market/etfs` shelf — US + Canadian, native-currency prices with CAD
tags) plus the sector chips, over a full table with
per-row **quick-watch toggles** (the host passes `watchedSymbols` + `onToggleWatch` so the watchlist
section above stays in step). It all lives in the **Discover section at the bottom of `/portfolio`** —
there is deliberately **no standalone Discover page, route, or sidebar entry** (one was built
2026-07-05 and removed the next day in favor of keeping everything on the Portfolio tab). Every
discovery row navigates to `/portfolio/:symbol`.

**Watchlist** (`watchlist` table; `routes/watchlist.ts` mounted at `/api/watchlist`): stocks you follow
but don't own. `GET /watchlist` returns items enriched with live quotes (native currency, day change);
`POST /watchlist { symbol }` is idempotent (returns the existing item on a duplicate symbol);
`PATCH /watchlist/:id` (name / thesis `notes` / `folder`), `DELETE /watchlist/:id`. Surfaced as a
**section below the holdings table** on `/portfolio` — a `TickerSearch` typeahead to add (suggestions
as you type; Enter falls back to the raw ticker) and a compact table (symbol · 30d sparkline · price ·
today), **grouped by folder** once any entry has one (folder header rows; unfiled last), each row with
a pencil (opens `components/WatchlistDialog.tsx` — folder input with datalist of existing folders +
free-form **thesis note**; a sticky-note icon with a tooltip marks noted rows) and a remove ×. The
stock page shows the thesis in a "Watch thesis" card. Independent of holdings (no positions).

**Risk & health** (`GET /holdings/health?base=` → `PortfolioHealth`, `services/RiskService.ts`,
rendered by `components/RiskPanel.tsx` below the holdings table when ≥2 priced holdings — fetched
behind the fold, never blocking): five stat tiles (annualized **volatility**, **beta vs SPY**,
**Sharpe (rf 0)**, **max drawdown**, 1y return) computed from 1y of daily closes with the portfolio
series as a current-weight blend (disclosed as an approximation); **warnings** for near-lockstep pairs
(ρ ≥ 0.85, both legs ≥ 5%), single positions > 25%, top-3 > 65%, non-base FX exposure > 75%, and
sector weight > 45% (via cached profiles; funds without a sector are skipped); heuristic **trim
suggestions** with base-currency amounts; a per-holding risk table and most-correlated chips. All
thresholds are consts at the top of RiskService. **News sentiment**: `NewsItem.sentiment` is a simple
server-side lexicon read of the headline, rendered as a quiet colored dot in the stock page's news
card. **Insider activity** (`GET /market/insiders/:symbol`, US only): open-market buys/sells (3m/12m)
+ net-posture chip in a stock-page rail card. **Value screen**: the Discover sector view fetches
`?enrich=1` and shows a sortable analyst-target **Upside** column (Nasdaq's $0-target "no coverage"
placeholder is filtered; the summary API carries no P/E for US stocks, so there is deliberately no P/E
column).

**UI** (`pages/PortfolioPage.tsx`, `components/HoldingDialog.tsx`): the page fetches its
`PortfolioSnapshot` + watchlist. Top-down it shows: a four-tile KPI strip with colored accent stripes
(**Market value / Today (day $ + %) / Total return ($ incl. realized + %) / Book cost**, gain colored
green/red, market value first); advisory banners when `quotesLive`/`fxLive` is false; an **allocation
panel** (shown at ≥2 priced holdings) — a segmented share-of-total bar + per-slice rows built on the
shared **`components/Breakdown.tsx`** (extracted from the ledger's cost breakdowns), with
**by-holding / by-currency tabs** (currency tab only when >1 native currency), the **top 8** slices
hued in `ALLOC_COLORS` (a fixed CVD-validated ordering of the shared `COLOR_PALETTE` — the raw cycle
fails adjacent-pair checks) and the tail folded into a gray **"Other"**, holding rows clicking through
to the stock page; then the dense holdings table. Table columns — **Shares · Avg cost · Current · 30d ·
Book cost · Market value · Weight · Today · Total return** — have **click-to-sort headers**
(client-side; money columns open biggest-first; cross-currency columns sort on the base-converted or
percentage figure; unpriced rows sink; default sort market-value-desc). The **30d column** renders a
per-row **`components/Sparkline.tsx`** (tiny direction-colored SVG) fed by **`lib/trends.ts`** — a
`useTrends` hook that lazily fetches `GET /holdings/history/:symbol?days=30` (4-at-a-time concurrency,
session-cached per symbol, failures cache as empty) for holdings **and** watchlist rows. Per-row money
stays in the holding's **native currency** (currency tag by the ticker; `MANUAL` tags, an `N lots`
badge, a paperclip on linked rows); tiles + `tfoot` totals are in the **base currency**. A header
**base-currency selector** (persisted, default CAD) re-fetches on change. Shared signed-money/percent
and gain-color helpers live in **`lib/gains.ts`** (used by the page, `StockPage`, and
`StockHistoryChart` — don't re-inline them). **Clicking a holding row navigates to its stock page**
(not the dialog); the **Add holding** button opens `HoldingDialog` for a new position (it has a
**Currency** field auto-detected from the quote, a hint to use exchange-suffixed tickers for non-US
listings, and — when editing — a **Transactions**/`LotsEditor` section). Leave the current-price field
blank to auto-fetch or set it to override; the same search-popover the ledgers/chat use attaches a
supporting document. Deleting a document nulls any holding link inside `removeDocument`'s transaction
(alongside the ledger links), so it dangles harmlessly.

## 3e. Applications — job-application pipeline

A standalone section (sidebar entry **Applications**, `/applications`) tracking job applications
through a customizable pipeline. Like Ledgers/Portfolio it's independent of the document organizer,
connecting only through an optional one-way link (an application → a supporting stash document, e.g.
the resume sent, the JD, an offer letter — nulled in `removeDocument`'s transaction on delete).

**Model** (4 tables, plain SQLite — no FTS/vec):

- **`application_stages`** — the pipeline itself, fully user-customizable (name, `color`, 1-based
  `position` = board-column order). Two semantic fields keep the stats meaningful across renames:
  **`kind`** (`applied | screen | interview | offer | rejected | withdrawn`) is what the KPI math
  reads, and **`is_terminal`** stages don't count as "active". Seeded once into an empty table
  (Applied · Interviewing · Offer · Accepted · Rejected, fixed slug ids — trimmed from an initial
  7 on 2026-07-07, by request);
  delete is blocked while applications sit in a stage (400 with count) and for the last remaining
  stage. Reorder mirrors the categories pattern (`PATCH /applications/stages/reorder { ids }`).
- **`job_applications`** — company + role (required), url, location, `work_mode`
  (`remote|hybrid|onsite`), job `description` (freeform JD text), `source` (free text; the dialog
  offers a datalist of defaults + previously-used values, the ledger-vendor approach),
  `compensation` (deliberately freeform text), `stage_id` (the **denormalized head of the event
  history**), `applied_date`, `document_id`, notes.
- **`application_events`** — the timestamped status history. **Stage changes only happen by
  appending an event** (`POST /applications/:id/events`; the application PATCH deliberately cannot
  move stages), so "how long did each stage take" is always answerable. `stage_name` is snapshotted
  so history survives stage renames/deletes. Events are backdatable and editable/deletable; after
  any event mutation the current stage **re-aligns to whichever event is now latest** (an event
  delete = undo of a mis-drag). Creating an application writes the opening event dated to the
  applied date — **clamped to now** (noon UTC of "today" is hours in the future for anyone west of
  Greenwich, and a future-dated opening event out-sorts every later stage change, snapping the
  application back on every drag; hit and fixed 2026-07-07). For the same reason the client's
  applied-date default uses the *local* calendar day (`toLocaleDateString('en-CA')`), never an ISO
  slice. Cascade-deleted with the application.
- **`application_contacts`** — recruiters/hiring managers/referrers per application (name required;
  title, email, url, notes). Cascade-deleted with the application.

**Chat integration**: `get_applications` (read) plus `add_application` / `move_application` /
`update_application` (writes, explicit-request-gated) exist in **both** chat engines; the action +
loose-resolution logic lives in `services/applications.ts` (`createJobApplication`,
`moveJobApplication`, `realignApplicationStage`, `resolveApplication`, `resolveStage`) and the HTTP
route delegates to the same helpers. Client-side, a chat write dispatches a
`stashd:applications-changed` window event (see `APP_WRITE_TOOLS` in `ChatSurface.tsx`) that
`ApplicationsPage` listens for — the page owns its data, so the global-store `refresh()` used by
document/ledger writes can't reach it. **Add any new application write tool to that array too.**

**Snapshot & KPIs** (`services/applications.ts`, shared by the route and the chat tools): every read
goes through `buildApplicationsSnapshot` → enriched applications (resolved `stage`, `lastActivityAt`
= latest event, `daysInStage`, `eventCount`/`contactCount`, `stale`) + stats, all computed per
request from the event history, never stored. **Active** = current stage not terminal. **Response
rate** = ever entered a `screen/interview/offer/rejected`-kind stage ÷ total (a rejection is a
response; a withdrawal/ghost isn't). **Interview rate** = ever entered `interview/offer` ÷ total.
**Offers** = ever entered an `offer` kind. **Needs follow-up** = active with no event for
`STALE_DAYS` (14) — surfaced as the amber sixth KPI tile, per-row/card warning markers, and the
tile itself toggles a stale-only filter.

**UI** (`pages/ApplicationsPage.tsx`): page-local data (the PortfolioPage model — `load()` +
`notify`, nothing in the global store). Top-down: header with a persisted **Board | Table view
toggle** (`localStorage stashd.applicationsView`), a **Stages** button (`StageManagerDialog` —
inline rename, 12-swatch color picker, kind select with KPI-meaning labels, terminal checkbox, ↑/↓
reorder, add/delete) and **Add application**; a six-tile KPI strip (`.stats portfolio-stats
app-stats` — reuses the portfolio accent-stripe idiom); a **filter bar** (text search over
company/role/notes/source/location/comp, per-stage toggle chips with live counts, applied-date range
select) feeding both views.

- **Board** (`components/ApplicationBoard.tsx`): horizontally scrolling columns per stage in
  position order, cards drag between columns via native HTML5 DnD with its own MIME
  (`application/x-stashd-application`, the sidebar-drawer pattern — never collides with document
  drags or the drop curtain). A drop moves optimistically, POSTs the event, then reconciles with a
  reload. Terminal columns render muted. Cards: company · role · applied date · days-in-stage ·
  stale warning · paperclip/note/contact-count glyphs.
- **Table**: dense `.li-table` with click-to-sort headers (the holdings `SortTh` pattern; default
  last-activity desc, unknowns sink): Company · Role · Stage (colored dot) · Applied · In stage ·
  Last activity · Source · Location (+ work-mode tag) · Comp · glyphs. Row click opens the dialog.
- **`components/ApplicationDialog.tsx`** — a **wide two-pane dialog** (`.app-dialog-wide`,
  ~880px, the li-dialog head/body/foot structure): the full form up top (company/role/url/location/
  work-mode/source/comp/applied-date/stage select, a collapsible `<details>` JD textarea, notes,
  document link via the shared `DocumentBrowser`), and — when editing — **Timeline | Contacts**
  panes side by side. The dialog owns the event/contact sub-CRUD (refetching its own detail and
  pinging the page via `onMutated`); the parent owns main save/delete. **A stage change in the form
  is translated by the page into an event POST** — `updateApplication` never carries `stageId`.
  Timeline rows show stage dot/name/date, the computed days spent in each stage, and per-event
  date/note edit + delete.

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

- **Inbox `/`** — the big drop tray, three stat tiles (docs, drawers in use, flagged count),
  flagged-for-review list, six most recent docs, and a "cabinet" of category cards.
- **Sidebar footer** carries a **live clock** (`components/Clock.tsx`, day · date · time-to-the-second)
  and a **server status bar** (`components/StatusBar.tsx`) that heartbeats `GET /api/health` every 15s
  (and on tab-refocus) — a pulsing green "Local server · live" or red "offline". Both are their own
  components so their timers re-render only themselves, not the whole sidebar. (These replaced the old
  static "local-first" footer tagline.)
- **Global uploads dock** — `UploadTray` is mounted globally in `App.tsx` (not the Inbox), so it floats
  as a collapsible dock in the **bottom-left corner of every page** whenever the upload queue is
  non-empty (in-flight jobs, progress header, bulk skip, and click-to-review "ready" items). Combined
  with the always-global `ReviewSheet` auto-opening on classify-complete, a file dropped on any page can
  be reviewed there without returning to the Inbox.
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

| Method & path                                    | Purpose                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                    | liveness probe → `{ ok: true }` (sidebar status-bar heartbeat)                                                       |
| `POST /documents/upload`                         | multipart upload → `{ jobId, duplicate? }` (413 over 50 MB, 400 bad type)                                            |
| `DELETE /documents/job/:jobId`                   | discard an in-flight upload (temp dir + sidecar); idempotent 204                                                     |
| `GET /documents/process/:jobId`                  | SSE: `extracting → classifying → complete` (with classification + optional `nearDuplicate` content-match) or `error`  |
| `POST /documents/file/:jobId`                    | persist a reviewed document; response includes `attachmentsSpawned` (emails fan out attachments into their own docs) |
| `GET /documents?search=&category=`               | list/search (SearchHits with snippets when searching)                                                                |
| `GET /documents/:id` / `GET /documents/:id/file` | metadata / raw file                                                                                                  |
| `PATCH /documents/:id`                           | update category/tags/notes/status                                                                                    |
| `PATCH /documents`                               | batch update `{ ids, category?, status?, addTags?, removeTags? }` (drives drag-and-drop + multi-select bulk move)    |
| `DELETE /documents`                              | batch delete `{ ids }` → `{ deleted }` (multi-select bulk delete)                                                    |
| `DELETE /documents/:id`                          | delete file + entry                                                                                                  |
| `GET /categories`                                | all categories with live `documentCount`                                                                             |
| `POST /categories`                               | create by name (auto icon/color)                                                                                     |
| `PATCH /categories/:id`                          | rename / re-icon / re-color / pin (`pinned`)                                                                         |
| `PATCH /categories/reorder`                      | persist manual drawer order `{ ids }` (declared before `:id` so "reorder" isn't read as an id)                       |
| `DELETE /categories/:id`                         | delete (custom + empty only)                                                                                         |
| `GET /chat` / `POST /chat`                       | list conversations / start one (`{ mode? }` — `classic`/`agentic`, fixed per conversation)                          |
| `GET /chat/:id` / `DELETE /chat/:id`             | conversation with messages + pins + attachments (+ `mode`) / delete it                                              |
| `PATCH /chat/:id`                                | switch the conversation's chat mode `{ mode }`                                                                       |
| `PUT /chat/:id/pins`                             | replace pinned-document list `{ docIds }`                                                                            |
| `POST /chat/:id/attachments`                     | multipart: drop a file into the conversation as chat-only context (extracted text; not filed; images 400, no-text 422) |
| `DELETE /chat/:id/attachments/:attId`            | remove a chat attachment; 204                                                                                        |
| `POST /chat/:id/messages`                        | send a user message; SSE stream of `token` / `tool` / `done` / `error` events                                        |
| `GET /projects`                                  | all projects with computed money totals                                                                              |
| `POST /projects`                                 | create a project `{ name, description? }`                                                                            |
| `GET /projects/:id`                              | project detail with line items + totals                                                                              |
| `PATCH /projects/:id`                            | rename / re-describe / archive (`status`) / set-as-current (`isDefault`)                                             |
| `DELETE /projects/:id`                           | delete project + its line items                                                                                      |
| `POST /projects/:id/items`                       | add a line item                                                                                                      |
| `PATCH /projects/:id/items/:itemId`              | partial-update a line item (`documentId: null` clears the link)                                                      |
| `DELETE /projects/:id/items/:itemId`             | delete a line item                                                                                                   |
| `GET /projects/by-document/:docId`               | line items linking a given document (the document → ledger direction)                                                |
| `GET /holdings?base=CAD`                         | the whole portfolio: holdings (native currency) + returns from lots, plus rollups converted to `base` (`PortfolioSnapshot`; default base USD) |
| `GET /holdings/health?base=CAD`                  | risk & health report (`PortfolioHealth`): 1y risk stats vs SPY, correlations, concentration/FX/sector warnings, trim suggestions (declared before `/:id`) |
| `GET /holdings/history/:symbol?days=N`           | one stock's live quote + daily-close series (`StockHistory`, native currency; declared before `/:id`); `?days` trims to the last N calendar days (sparklines); empty `points` w/o history |
| `POST /holdings`                                 | add a holding `{ symbol, name?, shares?, buyPrice?, manualPrice?, documentId?, notes? }` (400 without a symbol)       |
| `PATCH /holdings/:id`                            | partial-update a holding (`documentId: null` clears the link)                                                        |
| `DELETE /holdings/:id`                           | delete a holding (and its lots)                                                                                      |
| `GET /holdings/:id/lots`                         | a holding's dated buy/sell transactions                                                                             |
| `POST /holdings/:id/lots`                        | add a lot `{ type, date, shares, price, fee?, notes? }` (400 on a bad date/shares/price/type)                       |
| `PATCH /holdings/:id/lots/:lotId`                | partial-update a lot                                                                                                |
| `DELETE /holdings/:id/lots/:lotId`               | delete a lot                                                                                                        |
| `GET /watchlist`                                 | watched stocks enriched with live quotes (`WatchlistItemWithQuote[]`, native currency)                              |
| `POST /watchlist`                                | add a watched symbol `{ symbol, name?, notes?, folder? }` (idempotent — returns the existing item on a duplicate)   |
| `PATCH /watchlist/:id`                           | edit a watch entry's `name` / `notes` (thesis) / `folder` ("" clears a field)                                       |
| `DELETE /watchlist/:id`                          | remove a watched stock                                                                                             |
| `GET /applications`                              | the whole tracker: enriched applications + pipeline stages + KPI stats (`ApplicationsSnapshot`)                     |
| `POST /applications`                             | create an application `{ company, role, … }` (400 without both); writes the opening status event at the applied date |
| `GET /applications/:id`                          | detail: enriched application + events (newest first) + contacts (`ApplicationDetail`)                               |
| `PATCH /applications/:id`                        | partial-update the fields (`documentId: null` clears the link; **cannot** move stages — use events)                 |
| `DELETE /applications/:id`                       | delete + cascade its events and contacts                                                                            |
| `POST /applications/:id/events`                  | move to a stage `{ stageId, note?, occurredAt? }` — appends history, re-aligns current stage (the board-drag endpoint) |
| `PATCH /applications/:id/events/:eventId`        | fix an event's date/note (stage re-aligns to the latest event)                                                      |
| `DELETE /applications/:id/events/:eventId`       | undo a mis-drag; stage re-aligns to the remaining latest event                                                      |
| `POST /applications/:id/contacts` / `PATCH …/:contactId` / `DELETE …/:contactId` | contact CRUD (name required on create)                                                            |
| `POST /applications/stages`                      | add a pipeline stage `{ name, color?, kind?, isTerminal? }` (color auto-cycles the palette)                         |
| `PATCH /applications/stages/reorder`             | persist pipeline order `{ ids }` (declared before `stages/:id`)                                                     |
| `PATCH /applications/stages/:id`                 | rename / recolor / re-kind / toggle terminal (all `/stages` routes declared before `/:id`)                          |
| `DELETE /applications/stages/:id`                | delete a stage (400 while occupied or if it's the last one)                                                         |
| `GET /market/search?q=`                          | ticker/company typeahead → `SymbolSuggestion[]` (US via Nasdaq autocomplete, Canadian via TSX directory, ".TO"-suffixed; empty on outage) |
| `GET /market/screener?sector=technology&enrich=1`| top-of-sector US stocks by market cap → `ScreenerRow[]` (11 sector tokens; `GET /market/sectors` lists them); `enrich` adds analyst-target upside per row |
| `GET /market/insiders/:symbol`                   | insider open-market activity summary (`InsiderActivity`; US only, null otherwise)                                   |
| `GET /market/movers?kind=active\|gainers\|losers\|canada`| today's movers → `ScreenerRow[]` (US via Nasdaq; `canada` = TSX most-active via TMX, ".TO"-suffixed, CAD)   |
| `GET /market/pulse`                              | index-proxy tiles (S&P/Nasdaq/Dow/Russell/TSX via SPY/QQQ/DIA/IWM/XIC.TO) → `PulseItem[]`                          |
| `GET /market/etfs`                               | curated popular-ETFs shelf, priced live (US + Canadian, native currency) → `ScreenerRow[]`                          |
| `GET /market/profile/:symbol?ccy=CAD`            | fundamentals (`StockProfile`: market cap, P/E, dividend, volumes, sector; Nasdaq summary / TMX by `ccy`)            |
| `GET /market/news/:symbol?ccy=CAD`               | recent headlines (`NewsItem[]`; Nasdaq per-symbol RSS / TMX news, entity-decoded; CA items link to the TMX quote page) |

## 7. Where it's headed

`docs/superpowers/plans/` holds completed-work records (local-only; gitignored). \*\*RAG "ask your docs"

- tool-calling chat landed 2026-06-12** (§3b), as did the SQLite/FTS5 migration, duplicate detection,
  and the batch upload queue. **Expanded file-type support landed 2026-06-18\*\*: webp, txt, md, docx,
  xlsx, csv, eml, msg — via an extension-keyed extraction dispatcher, a six-way viewer dispatcher, and
  email-attachment fan-out (§2), plus the full-screen viewer and multi-select bulk delete/move.

Remaining roadmap: re-classify-on-demand and classification feedback loops as smaller follow-ups.
Deprioritized: server-side thumbnails, dashboards/reminders. Known intelligence gaps: image-only
documents are searchable only via their classify-time transcription; chat answers depend on the local
embedding model being pulled; conversations have no rename, and answers stream but can't be cancelled
mid-generation.
