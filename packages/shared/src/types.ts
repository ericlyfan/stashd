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
  // SHA-256 of the file bytes, used for exact duplicate detection. Backfilled
  // at boot for documents filed before the feature existed.
  contentHash?: string;
  // Content-level near-duplicate signatures (advisory): a 64-bit SimHash over
  // extractedText (text docs) and a 64-bit dHash over the image (images), each
  // a 16-hex string. Absent when not applicable (no text / not an image) or
  // until backfilled. See services/nearDuplicate.ts.
  simHash?: string;
  perceptualHash?: string;
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
  // Whether the drawer is pinned to the top of the sidebar.
  pinned: boolean;
  // Manual sort order in the sidebar; 0 means unset (falls back to usage sort).
  position: number;
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
  // A content-level near-duplicate found at classify time (SimHash/dHash within
  // threshold of an already-filed doc). Advisory, never a block; only set on the
  // `complete` event, and only when no exact byte-duplicate matched at upload.
  nearDuplicate?: {
    id: string;
    originalName: string;
    category: CategoryId;
    similarity: number;
  };
  error?: string;
}

// ── Chat / RAG ──────────────────────────────────────────────────────────────

// Which chat engine a conversation talks to: the original RAG `ChatService`
// ("classic") or the experimental agentic loop ("agentic"). Stored per
// conversation so each thread keeps the mode it was started in.
export type ChatMode = "classic" | "agentic";

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
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

// A file dropped directly into a conversation as throwaway context — its text
// is extracted and read by the model, but it is never filed into the stash.
// Conversation-scoped and deleted with the conversation.
export interface ChatAttachment {
  id: string;
  conversationId: string;
  name: string;
  mime: string;
  // Extracted text (capped). Empty when extraction yielded nothing.
  text: string;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
  pinnedDocIds: string[];
  attachments: ChatAttachment[];
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
  // Marks the project as a "current" one. When exactly one project is default,
  // the sidebar's Ledgers entry opens it directly; with zero or several, it
  // falls back to the normal project index.
  isDefault: boolean;
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

// ── Portfolio (stock holdings) ───────────────────────────────────────────────
// A tracked stock position. `buyPrice` is the per-share cost, so `shares ×
// buyPrice` is the cost basis. The current price is fetched from a market-data
// provider at read time (never stored); `manualPrice` is an optional per-share
// override used when the quote provider is unreachable (e.g. offline, or blocked
// egress) or for untraded/illiquid holdings.

export interface Holding {
  id: string;
  symbol: string; // ticker, e.g. "AAPL"
  name?: string; // company / display name
  shares: number;
  buyPrice: number; // per-share cost basis
  manualPrice?: number; // optional per-share current-price override
  currency?: string; // display currency, informational
  documentId?: string; // optional supporting stash document
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// A live quote for a symbol, fetched per request and cached briefly. Never
// persisted.
export interface Quote {
  symbol: string;
  price: number;
  previousClose?: number;
  currency?: string;
}

// A dated buy or sell against a holding. Lots are the source of truth for a
// holding's position and cost basis when present; a holding with no lots falls
// back to its stored shares/buyPrice as a single undated opening lot. Accounting
// is average-cost: a sell realizes qty × (price − running avg cost).
export type LotType = "buy" | "sell";

export interface HoldingLot {
  id: string;
  holdingId: string;
  type: LotType;
  date: string; // trade date, YYYY-MM-DD
  shares: number; // > 0
  price: number; // per-share trade price
  fee?: number; // optional commission/fee, added to buy cost / netted off a sale
  notes?: string;
  createdAt: string;
}

// Fields a client may set on a lot; the server owns id / holdingId / timestamps.
export interface HoldingLotInput {
  type?: LotType;
  date?: string;
  shares?: number;
  price?: number;
  fee?: number;
  notes?: string;
}

// Where a holding's current price came from: a live quote, the manual override,
// or nothing (unpriced).
export type PriceSource = "live" | "manual" | "none";

// A holding enriched with its resolved current price and computed returns. When
// the holding has lots, `shares`/`buyPrice`(avg cost)/`costBasis` here are the
// *derived* position (overriding the stored legacy fields), so the UI reads the
// same fields either way. `gain`/`gainPct` are unrealized; `totalGain` folds in
// realized gains from sells. All money-derived fields are undefined when no
// current price is known.
export interface HoldingWithQuote extends Holding {
  currentPrice?: number; // resolved: live quote, else manualPrice
  priceSource: PriceSource;
  costBasis: number; // open shares × avg cost
  avgCost: number; // per-share average cost of the open position
  lotCount: number; // number of transactions backing the position (0 = legacy)
  realizedGain: number; // gains locked in by past sells (average-cost)
  marketValue?: number; // shares × currentPrice (native currency)
  // Native (per-exchange) currency of this holding, and the rate that converts
  // it to the portfolio's base currency (1 for base-currency holdings). Money
  // fields above are in the native currency; `marketValueBase` is converted, for
  // totals + weight.
  currency: string;
  fxToBase: number;
  marketValueBase?: number;
  weight?: number; // marketValueBase ÷ portfolio base market value (0..1)
  gain?: number; // unrealized: marketValue − costBasis
  gainPct?: number; // unrealized gain ÷ costBasis
  totalGain?: number; // realizedGain + unrealized gain
  totalReturnPct?: number; // totalGain ÷ costBasis
  dayChange?: number; // shares × (price − previousClose)
  dayChangePct?: number;
  quoteCurrency?: string;
}

// Portfolio-wide rollups, computed per request — never persisted. Money sums use
// only holdings whose current price is known, and are in the base currency.
export interface PortfolioTotals {
  holdingCount: number;
  pricedCount: number; // holdings with a known current price
  costBasis: number; // total invested (open positions), all holdings
  marketValue: number; // total value of priced holdings
  gain: number; // unrealized
  gainPct: number;
  realizedGain: number; // total locked-in gains from sells
  totalGain: number; // realized + unrealized
  totalReturnPct: number; // totalGain ÷ priced cost basis
  dayChange: number;
  dayChangePct: number; // dayChange ÷ (marketValue − dayChange)
}

export interface PortfolioSnapshot {
  holdings: HoldingWithQuote[];
  totals: PortfolioTotals;
  quotedAt: string; // when quotes were fetched
  quotesLive: boolean; // false when the provider returned nothing (offline/blocked)
  baseCurrency: string; // currency the totals are expressed in
  fxLive: boolean; // false when FX rates were unavailable (totals then unconverted)
}

// ── Per-stock history ────────────────────────────────────────────────────────
// One symbol's daily close plus its live quote, for the stock detail page.
// Single-currency (the stock's native currency) — no base/FX conversion.
export interface HistoryDay {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface StockHistory {
  symbol: string;
  name?: string;
  currency: string;
  currentPrice?: number;
  previousClose?: number;
  dayChange?: number; // currentPrice − previousClose (per share)
  dayChangePct?: number;
  priceSource: PriceSource;
  points: HistoryDay[]; // oldest → newest; empty when history is unavailable
}

// ── Watchlist ────────────────────────────────────────────────────────────────
// A stock the user is watching but doesn't (necessarily) own. Priced live like a
// holding, in its native currency.
export interface WatchlistItem {
  id: string;
  symbol: string;
  name?: string;
  notes?: string; // free-form thesis note ("why I'm watching this")
  folder?: string; // optional grouping (e.g. "AI plays", "Dividend ideas")
  createdAt: string;
}

export interface WatchlistItemInput {
  symbol?: string;
  name?: string;
  notes?: string;
  folder?: string;
}

export interface WatchlistItemWithQuote extends WatchlistItem {
  currentPrice?: number;
  previousClose?: number;
  currency?: string;
  dayChange?: number;
  dayChangePct?: number;
  priceSource: PriceSource;
}

// ── Market discovery ─────────────────────────────────────────────────────────
// Ticker search + sector/mover screeners, no API key (Nasdaq public APIs for
// US, the TSX company directory for Canadian). All failure-tolerant: an
// unreachable source degrades to fewer/no rows, never an error.

// One ticker-search suggestion. `symbol` is directly usable by the rest of the
// app (Canadian results carry their ".TO" suffix so the quote chain routes to
// TMX instead of colliding with a same-lettered US listing).
export interface SymbolSuggestion {
  symbol: string;
  name: string;
  exchange?: string;
  country: "US" | "CA";
  asset?: string; // e.g. STOCKS | ETF
}

// One row of a discovery table (sector screener, market movers, or the
// popular-ETFs list). `changePct` is a fraction (0.0484 = +4.84%); `currency`
// defaults to USD when absent (screener/movers are US-only).
export interface ScreenerRow {
  symbol: string;
  name: string;
  price?: number;
  changePct?: number;
  marketCap?: number;
  currency?: string;
  // Value-screen enrichment (?enrich=1): from each symbol's cached profile.
  peRatio?: number;
  targetUpside?: number; // (analyst 1-yr target − price) ÷ price, fraction
}

// "canada" is the TSX most-active list (TMX); the rest are US (Nasdaq).
export type MoversKind = "active" | "gainers" | "losers" | "canada";

// One index tile of the Discover section's market-pulse strip (index proxies
// priced via the regular quote chain, so it works with no key).
export interface PulseItem {
  symbol: string; // the proxy ETF (e.g. SPY)
  label: string; // what it stands for (e.g. "S&P 500")
  price?: number;
  changePct?: number;
  currency?: string;
}

// A stock's profile/fundamentals for the detail page. US symbols come from
// Nasdaq's quote summary, Canadian from TMX — fields are best-effort and
// undefined when the source doesn't carry them.
export interface StockProfile {
  symbol: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  peRatio?: number;
  eps?: number;
  dividendYield?: number; // fraction (0.0035 = 0.35%)
  annualizedDividend?: number; // per share, native currency
  exDividendDate?: string;
  oneYearTarget?: number;
  volume?: number;
  avgVolume?: number;
  currency?: string;
}

// One headline for the stock page's news card. US headlines come from
// Nasdaq's per-symbol RSS feed, Canadian from TMX (which carries no per-item
// URL — those link to the TMX quote page instead). `sentiment` is a simple
// server-side lexicon read of the headline (advisory, not analysis).
export type NewsSentiment = "pos" | "neg" | "neu";

export interface NewsItem {
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string; // ISO-ish; display-formatted client-side
  sentiment?: NewsSentiment;
}

// Insider-trading activity summary for one US symbol (Nasdaq data; Canadian
// symbols have none). Counts are open-market transactions.
export interface InsiderActivity {
  symbol: string;
  buys3m: number;
  sells3m: number;
  buys12m: number;
  sells12m: number;
  sharesBought3m?: number;
  sharesSold3m?: number;
  // Net posture over 3 months: more buys than sells → "buying", etc.
  posture: "buying" | "selling" | "mixed" | "quiet";
}

// ── Portfolio risk & health ──────────────────────────────────────────────────
// Computed from ~1y of daily closes per holding (benchmark SPY), current-weight
// blended for the portfolio level. All annualized where applicable; Sharpe uses
// a 0% risk-free rate. Heuristic and advisory — the UI says so.

export interface RiskStats {
  volatility?: number; // annualized stdev of daily returns (fraction)
  beta?: number; // vs the benchmark
  sharpe?: number; // annualized return ÷ volatility (rf = 0)
  maxDrawdown?: number; // worst peak-to-trough over the window (negative fraction)
  return1y?: number; // simple return over the window (fraction)
}

export interface HoldingRisk extends RiskStats {
  symbol: string;
  weight?: number; // share of base market value (0..1)
}

export interface CorrelationPair {
  a: string;
  b: string;
  rho: number; // Pearson correlation of daily returns
}

export interface HealthWarning {
  kind: "concentration" | "correlation" | "currency" | "sector";
  severity: "info" | "warn";
  message: string;
}

export interface PortfolioHealth {
  benchmark: string; // e.g. "SPY"
  windowDays: number; // calendar window the stats cover
  portfolio: RiskStats;
  holdings: HoldingRisk[];
  correlations: CorrelationPair[]; // strongest pairs, high → low
  warnings: HealthWarning[];
  suggestions: string[]; // heuristic rebalancing hints, plain sentences
  baseCurrency: string;
  asOf: string;
}

// Fields a client may set on a holding; the server owns id / timestamps.
// `documentId: null` explicitly clears the link.
export interface HoldingInput {
  symbol?: string;
  name?: string;
  shares?: number;
  buyPrice?: number;
  manualPrice?: number;
  currency?: string;
  documentId?: string | null;
  notes?: string;
}
