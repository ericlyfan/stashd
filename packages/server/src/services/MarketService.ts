import { InsiderActivity, MoversKind, NewsItem, PulseItem, ScreenerRow, StockProfile, SymbolSuggestion } from '@stashd/shared';
import { fetchQuotes } from './QuoteService';

// Market discovery with no API key: ticker search (Nasdaq autocomplete for US,
// the TSX company directory for Canadian) and US discovery tables (Nasdaq's
// public screener + market-movers APIs). Same posture as QuoteService: a
// browser-like User-Agent, short caches, and total failure tolerance — an
// unreachable source degrades to fewer/no rows, never a thrown error.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };

const SEARCH_TTL_MS = 10 * 60_000; // a query's suggestions barely change
const TABLE_TTL_MS = 5 * 60_000; // screener/movers tables
const FETCH_TIMEOUT_MS = 8_000;

const searchCache = new Map<string, { at: number; results: SymbolSuggestion[] }>();
const tableCache = new Map<string, { at: number; rows: ScreenerRow[] }>();

// The Nasdaq screener's accepted sector tokens (probed 2026-07); also the
// order the Discover page lists them in.
export const SCREENER_SECTORS = [
  'technology',
  'consumer_discretionary',
  'finance',
  'health_care',
  'industrials',
  'energy',
  'consumer_staples',
  'basic_materials',
  'real_estate',
  'utilities',
  'telecommunications',
] as const;
export type ScreenerSector = (typeof SCREENER_SECTORS)[number];

function isSector(v: unknown): v is ScreenerSector {
  return typeof v === 'string' && (SCREENER_SECTORS as readonly string[]).includes(v);
}

// Parse "$1,234.56" / "+2.85%" / "4,714,886,000,000" → number.
function parseNum(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// Nasdaq suffixes listing names with share-class boilerplate ("… Class A
// Common Stock", "… Depositary Shares representing a 1/20th interest …");
// strip it so discovery tables read like company names.
function cleanName(name: string): string {
  return name
    .replace(/ (each )?(American )?Depositary Shares?\b.*$/i, '')
    .replace(/ (Common|Ordinary) (Stock|Shares?)\b.*$/i, '')
    .replace(/[ ,]+$/, '')
    .trim();
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// ── Ticker search ────────────────────────────────────────────────────────────

interface NasdaqLookupResponse {
  data?: Array<{ symbol?: string; name?: string; exchange?: string; asset?: string }> | null;
}

// US suggestions via Nasdaq's autocomplete (covers NYSE/Nasdaq stocks + ETFs;
// mutual funds and the like are filtered out).
async function searchNasdaq(q: string): Promise<SymbolSuggestion[]> {
  const body = (await getJson(
    `https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(q)}`,
  )) as NasdaqLookupResponse | null;
  const rows = body?.data ?? [];
  const out: SymbolSuggestion[] = [];
  for (const r of rows) {
    if (!r.symbol || !r.name) continue;
    if (r.asset !== 'STOCKS' && r.asset !== 'ETF') continue;
    out.push({
      symbol: r.symbol.toUpperCase(),
      name: cleanName(r.name),
      exchange: r.exchange || undefined,
      country: 'US',
      asset: r.asset,
    });
  }
  return out;
}

interface TsxDirectoryResponse {
  results?: Array<{ symbol?: string; name?: string }> | null;
}

// Canadian suggestions via the TSX company directory. Results get a ".TO"
// suffix so the quote chain routes them to TMX — a bare pick like SHOP would
// otherwise resolve to the same-lettered US listing. The directory ranks
// oddly (Shopify-themed ETFs above Shopify Inc. itself), so re-rank: exact
// symbol match first, then plain companies before ETF wrappers.
async function searchTsx(q: string): Promise<SymbolSuggestion[]> {
  const body = (await getJson(
    `https://www.tsx.com/json/company-directory/search/tsx/${encodeURIComponent(q)}`,
  )) as TsxDirectoryResponse | null;
  const rows = body?.results ?? [];
  const upper = q.trim().toUpperCase();
  const rank = (r: { symbol?: string; name?: string }) =>
    r.symbol!.toUpperCase() === upper ? 0 : /\bETF\b/i.test(r.name!) ? 2 : 1;
  return rows
    .filter(r => r.symbol && r.name)
    .sort((a, b) => rank(a) - rank(b))
    .map(r => ({
      symbol: `${r.symbol!.toUpperCase()}.TO`,
      name: r.name!,
      exchange: 'TSX',
      country: 'CA' as const,
    }));
}

// Merged ticker search: US first (exact-symbol match floats to the top), then
// Canadian, capped. Cached per query; never throws.
export async function searchSymbols(query: string): Promise<SymbolSuggestion[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const key = q.toUpperCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;

  const [us, ca] = await Promise.all([searchNasdaq(q), searchTsx(q)]);
  const merged = [...us.slice(0, 5), ...ca.slice(0, 5)];
  // An exact ticker match is almost always what was typed — surface it first.
  merged.sort((a, b) => {
    const ax = a.symbol === key || a.symbol === `${key}.TO` ? 0 : 1;
    const bx = b.symbol === key || b.symbol === `${key}.TO` ? 0 : 1;
    return ax - bx;
  });
  const results = merged.slice(0, 9);
  searchCache.set(key, { at: Date.now(), results });
  return results;
}

// ── Discovery tables (US-only) ───────────────────────────────────────────────

interface NasdaqTableResponse {
  data?: {
    table?: { rows?: Array<Record<string, string>> | null } | null;
    STOCKS?: Record<string, { table?: { rows?: Array<Record<string, string>> | null } | null }> | null;
  } | null;
}

function toRow(r: Record<string, string>): ScreenerRow | null {
  if (!r.symbol || !r.name) return null;
  const price = parseNum(r.lastsale ?? r.lastSalePrice);
  // The screener has an explicit pctchange column. Movers overload `change`:
  // a percent string for gainers/losers, share/dollar volume for most-active —
  // so only trust it when it actually reads as a percent, else derive the
  // percentage from the dollar change against the implied previous close.
  let changePct: number | undefined;
  const pctText = [r.pctchange, r.change].find(v => typeof v === 'string' && v.includes('%'));
  if (pctText !== undefined) {
    const pct = parseNum(pctText);
    changePct = pct === undefined ? undefined : pct / 100;
  } else {
    const chg = parseNum(r.lastSaleChange ?? r.netchange);
    if (chg !== undefined && price !== undefined && price - chg > 0) changePct = chg / (price - chg);
  }
  return {
    symbol: r.symbol.toUpperCase(),
    name: cleanName(r.name),
    price,
    changePct,
    marketCap: parseNum(r.marketCap),
  };
}

// Top-of-sector stocks (market-cap order, Nasdaq's default). Cached ~5min.
// With `enrich`, each row also carries P/E and analyst-target upside from its
// cached profile (a small value screen; first hit fans out ~25 profile fetches
// at limited concurrency, all 30-min cached after that).
export async function screenSector(sector: string, limit = 25, enrich = false): Promise<ScreenerRow[]> {
  if (!isSector(sector)) return [];
  const key = `sector:${sector}:${limit}:${enrich ? 'e' : 'p'}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < TABLE_TTL_MS) return hit.rows;

  const body = (await getJson(
    `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&sector=${sector}`,
  )) as NasdaqTableResponse | null;
  const rows = (body?.data?.table?.rows ?? [])
    .map(toRow)
    .filter((r): r is ScreenerRow => r !== null);

  if (enrich && rows.length > 0) {
    const queue = [...rows];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        let row: ScreenerRow | undefined;
        while ((row = queue.shift()) !== undefined) {
          const profile = await stockProfile(row.symbol, false);
          if (!profile) continue;
          row.peRatio = profile.peRatio;
          if (profile.oneYearTarget !== undefined && row.price !== undefined && row.price > 0) {
            row.targetUpside = (profile.oneYearTarget - row.price) / row.price;
          }
        }
      }),
    );
  }

  if (rows.length > 0) tableCache.set(key, { at: Date.now(), rows });
  return rows;
}

// ── Insider activity (US only — Nasdaq form-4 data) ─────────────────────────

const INSIDER_TTL_MS = 6 * 60 * 60_000;
const insiderCache = new Map<string, { at: number; activity: InsiderActivity | null }>();

interface NasdaqInsiderResponse {
  data?: {
    numberOfTrades?: { rows?: Array<{ insiderTrade?: string; months3?: string; months12?: string }> | null } | null;
    numberOfSharesTraded?: { rows?: Array<{ insiderTrade?: string; months3?: string; months12?: string }> | null } | null;
  } | null;
}

export async function insiderActivity(symbol: string): Promise<InsiderActivity | null> {
  if (CA_SUFFIX.test(symbol)) return null; // Nasdaq has no Canadian filings
  const hit = insiderCache.get(symbol);
  if (hit && Date.now() - hit.at < INSIDER_TTL_MS) return hit.activity;

  const body = (await getJson(
    `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/insider-trades?limit=10&type=ALL`,
  )) as NasdaqInsiderResponse | null;
  const trades = body?.data?.numberOfTrades?.rows ?? [];
  const shares = body?.data?.numberOfSharesTraded?.rows ?? [];
  const find = (rows: typeof trades, label: RegExp) => rows.find(r => r.insiderTrade && label.test(r.insiderTrade));

  const buysRow = find(trades, /open market buys/i);
  const sellsRow = find(trades, /number of sells/i);
  if (!buysRow && !sellsRow) {
    insiderCache.set(symbol, { at: Date.now(), activity: null });
    return null;
  }
  const buys3m = parseNum(buysRow?.months3) ?? 0;
  const sells3m = parseNum(sellsRow?.months3) ?? 0;
  const activity: InsiderActivity = {
    symbol,
    buys3m,
    sells3m,
    buys12m: parseNum(buysRow?.months12) ?? 0,
    sells12m: parseNum(sellsRow?.months12) ?? 0,
    sharesBought3m: parseNum(find(shares, /shares bought/i)?.months3),
    sharesSold3m: parseNum(find(shares, /shares sold/i)?.months3),
    posture:
      buys3m === 0 && sells3m === 0 ? 'quiet'
      : buys3m > sells3m ? 'buying'
      : sells3m > buys3m ? 'selling'
      : 'mixed',
  };
  insiderCache.set(symbol, { at: Date.now(), activity });
  return activity;
}

// ── Market pulse (index proxies) ─────────────────────────────────────────────
// The Discover strip's "how are markets doing" tiles: liquid index-tracking
// ETFs priced through the regular quote chain (cached ~60s there).

const PULSE: { symbol: string; label: string }[] = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'DIA', label: 'Dow Jones' },
  { symbol: 'IWM', label: 'Russell 2000' },
  { symbol: 'XIC.TO', label: 'TSX Composite' },
];

export async function marketPulse(): Promise<PulseItem[]> {
  const quotes = await fetchQuotes(PULSE.map(p => p.symbol));
  return PULSE.map(p => {
    const q = quotes.get(p.symbol.toUpperCase());
    const changePct =
      q?.previousClose !== undefined && q.previousClose > 0 ? (q.price - q.previousClose) / q.previousClose : undefined;
    return { symbol: p.symbol, label: p.label, price: q?.price, changePct, currency: q?.currency };
  });
}

// ── Popular ETFs ─────────────────────────────────────────────────────────────
// A curated shelf, not a screener: Nasdaq's ETF directory only lists
// alphabetically (useless for discovery), so this prices well-known broad /
// sector / bond funds through the quote chain instead.

const POPULAR_ETFS: { symbol: string; name: string }[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500' },
  { symbol: 'VOO', name: 'Vanguard S&P 500' },
  { symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq 100)' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market' },
  { symbol: 'IWM', name: 'iShares Russell 2000' },
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity' },
  { symbol: 'VXUS', name: 'Vanguard Total International' },
  { symbol: 'AGG', name: 'iShares Core US Aggregate Bond' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR' },
  { symbol: 'VNQ', name: 'Vanguard Real Estate' },
  { symbol: 'VFV.TO', name: 'Vanguard S&P 500 (CAD)' },
  { symbol: 'XEQT.TO', name: 'iShares Core Equity (CAD)' },
  { symbol: 'VGRO.TO', name: 'Vanguard Growth (CAD)' },
  { symbol: 'XIC.TO', name: 'iShares S&P/TSX Capped Composite' },
];

export async function popularEtfs(): Promise<ScreenerRow[]> {
  const quotes = await fetchQuotes(POPULAR_ETFS.map(e => e.symbol));
  return POPULAR_ETFS.map(e => {
    const q = quotes.get(e.symbol.toUpperCase());
    const changePct =
      q?.previousClose !== undefined && q.previousClose > 0 ? (q.price - q.previousClose) / q.previousClose : undefined;
    return { symbol: e.symbol, name: e.name, price: q?.price, changePct, currency: q?.currency };
  });
}

// ── Stock profile (fundamentals) ─────────────────────────────────────────────

const PROFILE_TTL_MS = 30 * 60_000;
const profileCache = new Map<string, { at: number; profile: StockProfile }>();

const CA_SUFFIX = /\.(TO|V|CN|NE)$/i;

// "0.35%" → 0.0035; plain numbers pass through parseNum.
function parsePct(s: unknown): number | undefined {
  const n = parseNum(s);
  return n === undefined ? undefined : n / 100;
}

interface NasdaqSummaryResponse {
  data?: { summaryData?: Record<string, { value?: string }> | null } | null;
}

// US fundamentals from Nasdaq's quote summary (tries stocks, then etf — same
// dance as the quote chain).
async function nasdaqProfile(symbol: string): Promise<StockProfile | null> {
  for (const assetclass of ['stocks', 'etf']) {
    const body = (await getJson(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${assetclass}`,
    )) as NasdaqSummaryResponse | null;
    const d = body?.data?.summaryData;
    if (!d) continue;
    const v = (k: string) => d[k]?.value;
    return {
      symbol,
      exchange: v('Exchange'),
      sector: v('Sector'),
      industry: v('Industry'),
      marketCap: parseNum(v('MarketCap')),
      peRatio: parseNum(v('PERatio')),
      eps: parseNum(v('EarningsPerShare')),
      dividendYield: parsePct(v('Yield')),
      annualizedDividend: parseNum(v('AnnualizedDividend')),
      exDividendDate: v('ExDividendDate') === 'N/A' ? undefined : v('ExDividendDate'),
      // A $0 target is Nasdaq's "no coverage" placeholder, not a real target.
      oneYearTarget: (t => (t && t > 0 ? t : undefined))(parseNum(v('OneYrTarget'))),
      volume: parseNum(v('ShareVolume')),
      avgVolume: parseNum(v('AverageVolume')),
      currency: 'USD',
    };
  }
  return null;
}

interface TmxProfileResponse {
  data?: {
    getQuoteBySymbol?: {
      name?: string;
      exchangeName?: string;
      sector?: string;
      industry?: string;
      MarketCap?: number;
      peRatio?: number;
      eps?: number;
      dividendYield?: number;
      volume?: number;
      averageVolume30D?: number;
      currency?: string;
    } | null;
  } | null;
}

// Canadian fundamentals from the TMX GraphQL quote (field names verified
// against their schema's validation hints; introspection is disabled).
async function tmxProfile(symbol: string): Promise<StockProfile | null> {
  const sym = symbol.replace(CA_SUFFIX, '');
  try {
    const res = await fetch('https://app-money.tmx.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json', locale: 'en' },
      body: JSON.stringify({
        operationName: 'getQuoteBySymbol',
        variables: { symbol: sym, locale: 'en' },
        query:
          'query getQuoteBySymbol($symbol: String, $locale: String) { getQuoteBySymbol(symbol: $symbol, locale: $locale) { name exchangeName sector industry MarketCap peRatio eps dividendYield volume averageVolume30D currency } }',
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const q = ((await res.json()) as TmxProfileResponse).data?.getQuoteBySymbol;
    if (!q) return null;
    return {
      symbol,
      exchange: q.exchangeName,
      sector: q.sector || undefined,
      industry: q.industry || undefined,
      marketCap: q.MarketCap ?? undefined,
      peRatio: q.peRatio ?? undefined,
      eps: q.eps ?? undefined,
      dividendYield: q.dividendYield !== undefined && q.dividendYield !== null ? q.dividendYield / 100 : undefined,
      volume: q.volume ?? undefined,
      avgVolume: q.averageVolume30D ?? undefined,
      currency: q.currency ?? 'CAD',
    };
  } catch {
    return null;
  }
}

// Fundamentals for one symbol. `canadian` routes to TMX (the caller knows the
// resolved quote currency; a bare Canadian symbol like VFV would otherwise be
// asked of Nasdaq, which doesn't know it).
export async function stockProfile(symbol: string, canadian: boolean): Promise<StockProfile | null> {
  const key = `${symbol}:${canadian ? 'ca' : 'us'}`;
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.profile;

  const profile =
    canadian || CA_SUFFIX.test(symbol) ? await tmxProfile(symbol) : await nasdaqProfile(symbol);
  if (profile) profileCache.set(key, { at: Date.now(), profile });
  return profile;
}

// ── Per-symbol news ──────────────────────────────────────────────────────────

const NEWS_TTL_MS = 15 * 60_000;
const newsCache = new Map<string, { at: number; items: NewsItem[] }>();

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

// ── Headline sentiment ───────────────────────────────────────────────────────
// A deliberately simple lexicon read: count bullish vs bearish words in the
// headline. Transparent and cheap; advisory only (the UI shows a quiet dot).
const POS_WORDS =
  /\b(surge[sd]?|soar(s|ed)?|jump(s|ed)?|rall(y|ies|ied)|beat[s]?|record|upgrade[sd]?|outperform(s|ed)?|strong|growth|profit[s]?|gain[s]?|rise[sn]?|rose|climb(s|ed)?|boost(s|ed)?|bullish|buyback|dividend increase|raises? (guidance|outlook|dividend)|tops?|wins?|higher|best)\b/i;
const NEG_WORDS =
  /\b(plunge[sd]?|sink(s|ing)?|sank|slump(s|ed)?|fall[s]?|fell|drop(s|ped)?|miss(es|ed)?|downgrade[sd]?|underperform(s|ed)?|weak|loss(es)?|lawsuit|probe|investigation|recall|layoff[s]?|cuts? (guidance|outlook|jobs|dividend)|bearish|decline[sd]?|warns?|worst|lower|retreat(s|ed)?|crash(es|ed)?|selloff|tumble[sd]?)\b/i;

function scoreSentiment(title: string): 'pos' | 'neg' | 'neu' {
  const pos = POS_WORDS.test(title);
  const neg = NEG_WORDS.test(title);
  if (pos && !neg) return 'pos';
  if (neg && !pos) return 'neg';
  return 'neu';
}

// Nasdaq's feed double-encodes entities ("&amp;quot;"), so decode twice.
function decodeEntities(s: string): string {
  const once = (t: string) =>
    t
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  return once(once(s));
}

// US headlines from Nasdaq's per-symbol RSS feed (regex-parsed; the feed is
// simple enough that an XML dependency isn't warranted).
async function nasdaqNews(symbol: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(`https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(symbol)}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const url = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
      const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
      const creator = block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1];
      if (!title) continue;
      const clean = decodeEntities(stripCdata(title));
      items.push({
        title: clean,
        url: url ? stripCdata(url) : undefined,
        source: creator ? decodeEntities(stripCdata(creator)) : undefined,
        publishedAt: date ? stripCdata(date) : undefined,
        sentiment: scoreSentiment(clean),
      });
      if (items.length >= 8) break;
    }
    return items;
  } catch {
    return [];
  }
}

interface TmxNewsResponse {
  data?: { news?: Array<{ headline?: string; datetime?: string; source?: string }> | null } | null;
}

// Canadian headlines from TMX. The API carries no per-article URL, so items
// link to the symbol's TMX quote page.
async function tmxNews(symbol: string): Promise<NewsItem[]> {
  const sym = symbol.replace(CA_SUFFIX, '');
  try {
    const res = await fetch('https://app-money.tmx.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json', locale: 'en' },
      body: JSON.stringify({
        operationName: 'getNewsAndEvents',
        variables: { symbol: sym, page: 1, limit: 8, locale: 'en' },
        query:
          'query getNewsAndEvents($symbol: String!, $page: Int!, $limit: Int!, $locale: String!) { news: getNewsForSymbol(symbol: $symbol, page: $page, limit: $limit, locale: $locale) { headline datetime source } }',
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const rows = ((await res.json()) as TmxNewsResponse).data?.news ?? [];
    return rows
      .filter(r => r.headline)
      .map(r => ({
        title: r.headline!,
        url: `https://money.tmx.com/en/quote/${encodeURIComponent(sym)}`,
        source: r.source,
        publishedAt: r.datetime,
        sentiment: scoreSentiment(r.headline!),
      }));
  } catch {
    return [];
  }
}

export async function stockNews(symbol: string, canadian: boolean): Promise<NewsItem[]> {
  const key = `${symbol}:${canadian ? 'ca' : 'us'}`;
  const hit = newsCache.get(key);
  if (hit && Date.now() - hit.at < NEWS_TTL_MS) return hit.items;

  const items = canadian || CA_SUFFIX.test(symbol) ? await tmxNews(symbol) : await nasdaqNews(symbol);
  if (items.length > 0) newsCache.set(key, { at: Date.now(), items });
  return items;
}

const MOVERS_KEY: Record<Exclude<MoversKind, 'canada'>, string> = {
  active: 'MostActiveByDollarVolume',
  gainers: 'MostAdvanced',
  losers: 'MostDeclined',
};

interface TmxMoversResponse {
  data?: {
    getMarketMovers?: Array<{ symbol?: string; name?: string; price?: number; percentChange?: number }> | null;
  } | null;
}

// TSX most-active names from TMX. Symbols come back bare (CNQ) but many trade
// on a US exchange too, so they're ".TO"-suffixed to keep the quote/history
// chain on the Canadian listing.
async function tmxMovers(): Promise<ScreenerRow[]> {
  try {
    const res = await fetch('https://app-money.tmx.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json', locale: 'en' },
      body: JSON.stringify({
        operationName: 'getMarketMovers',
        variables: {},
        query: 'query getMarketMovers { getMarketMovers(sortOrder: "desc") { symbol name price percentChange } }',
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const rows = ((await res.json()) as TmxMoversResponse).data?.getMarketMovers ?? [];
    return rows
      .filter(r => r.symbol && r.name)
      .map(r => ({
        symbol: `${r.symbol!.toUpperCase()}.TO`,
        name: r.name!,
        price: r.price ?? undefined,
        changePct: r.percentChange !== undefined && r.percentChange !== null ? r.percentChange / 100 : undefined,
        currency: 'CAD',
      }));
  } catch {
    return [];
  }
}

// Today's movers: US (most traded by dollar volume / biggest gainers /
// decliners, via Nasdaq) or the TSX most-active list (via TMX).
export async function marketMovers(kind: MoversKind): Promise<ScreenerRow[]> {
  const key = `movers:${kind}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < TABLE_TTL_MS) return hit.rows;

  let rows: ScreenerRow[];
  if (kind === 'canada') {
    rows = await tmxMovers();
  } else {
    const body = (await getJson('https://api.nasdaq.com/api/marketmovers?assetclass=stocks')) as
      | NasdaqTableResponse
      | null;
    rows = (body?.data?.STOCKS?.[MOVERS_KEY[kind]]?.table?.rows ?? [])
      .map(toRow)
      .filter((r): r is ScreenerRow => r !== null);
  }
  if (rows.length > 0) tableCache.set(key, { at: Date.now(), rows });
  return rows;
}
