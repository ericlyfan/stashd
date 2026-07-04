import { Quote } from '@stashd/shared';

// Live stock quotes with no API key. The primary source is Yahoo Finance's
// public chart endpoint; because that endpoint rate-limits aggressively (HTTP
// 429) and often needs a session cookie, we fall back to Nasdaq's public quote
// API, and finally to the last cached price. Every failure still degrades to
// "no quote" and the caller falls back to the holding's manual price.
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

// A browser-like User-Agent is required by both providers.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Fresh quotes are reused for a minute; a stale one is served for up to a day
// when every source is unreachable (better a slightly old price than a blank).
const CACHE_TTL_MS = 60_000;
const MAX_STALE_MS = 24 * 60 * 60_000;
const COOKIE_TTL_MS = 30 * 60_000;

const cache = new Map<string, { quote: Quote; at: number }>();
let cookie: string | null = null;
let cookieAt = 0;

// One daily close. Historical series are much heavier than a spot quote and
// move slowly, so they're cached longer (see HISTORY_TTL_MS).
export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  close: number;
}
const HISTORY_TTL_MS = 6 * 60 * 60_000; // 6h fresh
const HISTORY_MAX_STALE_MS = 7 * 24 * 60 * 60_000; // serve up to a week old on outage
const historyCache = new Map<string, { series: HistoryPoint[]; at: number }>();

// Parse a money/number string like "$1,234.56" or "+2.85" → number.
function parseNum(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
      };
    }>;
  };
}

interface NasdaqQuoteResponse {
  data?: {
    primaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      currency?: string | null;
    } | null;
  } | null;
  status?: { rCode?: number } | null;
}

// A provider result that also distinguishes "this symbol is definitively not a
// US listing" (so a Canadian fallback is safe) from "couldn't tell / throttled"
// (so we must NOT fall back — a US ticker like AAPL has a Canadian CDR at a
// totally different price, and returning that would be silently wrong).
const NOT_US = Symbol('not-us');
type Resolved<T> = T | typeof NOT_US | null;

// Best-effort: prime (and cache) a Yahoo session cookie — cookieless requests
// get rate-limited harder. Failures are non-fatal.
async function getCookie(): Promise<string> {
  if (cookie && Date.now() - cookieAt < COOKIE_TTL_MS) return cookie;
  try {
    const res = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
    const raw = res.headers.get('set-cookie');
    if (raw) {
      cookie = raw.split(';')[0];
      cookieAt = Date.now();
    }
  } catch {
    // proceed without a cookie
  }
  return cookie ?? '';
}

async function fetchYahoo(symbol: string): Promise<Quote | null> {
  const ck = await getCookie();
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(ck ? { Cookie: ck } : {}),
  };
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
        { headers },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as YahooChartResponse;
      const meta = data.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== 'number' || !Number.isFinite(price)) continue;
      const prev = meta?.chartPreviousClose ?? meta?.previousClose;
      return { symbol, price, previousClose: typeof prev === 'number' ? prev : undefined, currency: meta?.currency };
    } catch {
      // try the next host
    }
  }
  return null;
}

// Nasdaq's public quote API — covers all US equities/ETFs, no key. The right
// assetclass isn't known up front, so try stocks then etf. Returns NOT_US when
// Nasdaq explicitly reports the symbol doesn't exist (rCode 400) on every
// assetclass — a reliable "not a US listing" signal — vs null when it was merely
// unreachable/throttled.
async function fetchNasdaq(symbol: string): Promise<Resolved<Quote>> {
  const headers = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };
  let sawNotExist = false;
  for (const assetclass of ['stocks', 'etf'] as const) {
    try {
      const res = await fetch(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetclass}`,
        { headers },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as NasdaqQuoteResponse;
      const pd = data.data?.primaryData;
      const price = parseNum(pd?.lastSalePrice);
      if (price !== undefined) {
        const net = parseNum(pd?.netChange);
        return { symbol, price, previousClose: net !== undefined ? price - net : undefined, currency: pd?.currency ?? 'USD' };
      }
      if (data.status?.rCode === 400) sawNotExist = true;
    } catch {
      // try the next assetclass
    }
  }
  return sawNotExist ? NOT_US : null;
}

// Canadian exchange suffixes (Yahoo-style). A symbol carrying one is routed to
// TMX (the Toronto exchange's own API), which is authoritative and CAD-priced;
// the bare symbol is what TMX expects.
const CA_SUFFIX = /\.(TO|TSX|TSXV|V|NE|CN)$/i;
const isCanadian = (symbol: string) => CA_SUFFIX.test(symbol);
const tmxSymbol = (symbol: string) => symbol.replace(CA_SUFFIX, '').toUpperCase();

interface TmxQuoteResponse {
  data?: {
    getQuoteBySymbol?: { price?: number | string; prevClose?: number | string; currency?: string; name?: string } | null;
  } | null;
}

// A US ticker resolves on TMX to its Canadian Depositary Receipt (a different
// security at a different price), which TMX labels "… CDR …" in the name. Reject
// those so a US symbol never silently prices as its CDR.
const isCdrName = (name?: string) => !!name && /\bCDR\b/i.test(name);

// TMX money GraphQL — covers TSX/TSXV/CSE/NEO listings (in CAD), no key. Yahoo is
// the only other source for non-US listings and is rate-limited here, so this is
// what makes Canadian holdings priceable. CDRs are filtered out (see isCdrName).
async function fetchTmx(symbol: string): Promise<Quote | null> {
  const sym = tmxSymbol(symbol);
  const body = {
    operationName: 'getQuoteBySymbol',
    variables: { symbol: sym, locale: 'en' },
    query:
      'query getQuoteBySymbol($symbol: String, $locale: String) { getQuoteBySymbol(symbol: $symbol, locale: $locale) { price prevClose currency name __typename } }',
  };
  try {
    const res = await fetch('https://app-money.tmx.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json', locale: 'en' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TmxQuoteResponse;
    const q = data.data?.getQuoteBySymbol;
    if (isCdrName(q?.name)) return null; // a US ticker's Canadian CDR — not what was asked for
    const price = typeof q?.price === 'number' ? q.price : parseNum(q?.price);
    if (price === undefined || !Number.isFinite(price)) return null;
    const prev = typeof q?.prevClose === 'number' ? q.prevClose : parseNum(q?.prevClose);
    return { symbol, price, previousClose: prev, currency: q?.currency ?? 'CAD' };
  } catch {
    return null;
  }
}

// One symbol. Canadian-suffixed symbols go straight to TMX (Yahoo backup). For a
// bare symbol: Yahoo → Nasdaq, and only fall to TMX when Nasdaq *confirms* it's
// not a US listing (NOT_US) — so a bare Canadian ETF ("VFV") resolves via TMX
// while a US ticker whose Nasdaq quote was merely throttled stays unpriced rather
// than silently resolving to its (differently-priced) Canadian CDR.
async function fetchOne(symbol: string): Promise<Quote | null> {
  if (isCanadian(symbol)) return (await fetchTmx(symbol)) ?? (await fetchYahoo(symbol));
  const yahoo = await fetchYahoo(symbol);
  if (yahoo) return yahoo;
  const nasdaq = await fetchNasdaq(symbol);
  if (nasdaq === NOT_US) return await fetchTmx(symbol);
  return nasdaq; // Quote or null (throttled → unpriced, never a US→CDR mixup)
}

/**
 * Fetch current quotes for a set of symbols. Deduplicates and upper-cases
 * symbols, serves fresh cache hits, fetches the rest concurrently, and falls
 * back to a stale cached quote when every live source fails. Never throws:
 * unresolved symbols are simply absent from the returned map.
 */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const now = Date.now();
  const result = new Map<string, Quote>();
  const toFetch: string[] = [];

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || result.has(symbol)) continue;
    const hit = cache.get(symbol);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      result.set(symbol, hit.quote); // fresh
    } else if (!toFetch.includes(symbol)) {
      toFetch.push(symbol);
    }
  }

  const fetched = await Promise.all(toFetch.map(fetchOne));
  fetched.forEach((quote, i) => {
    const symbol = toFetch[i];
    if (quote) {
      cache.set(symbol, { quote, at: now });
      result.set(symbol, quote);
    } else {
      // Every source failed — serve the last known price if it isn't ancient,
      // so the portfolio keeps showing values through an outage.
      const stale = cache.get(symbol);
      if (stale && now - stale.at < MAX_STALE_MS) result.set(symbol, stale.quote);
    }
  });

  return result;
}

// ── Historical daily closes ──────────────────────────────────────────────────

interface YahooHistoryResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

// epoch seconds → YYYY-MM-DD (UTC).
function isoDay(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

async function fetchYahooHistory(symbol: string): Promise<HistoryPoint[] | null> {
  const ck = await getCookie();
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(ck ? { Cookie: ck } : {}),
  };
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`,
        { headers },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as YahooHistoryResponse;
      const result = data.chart?.result?.[0];
      const ts = result?.timestamp;
      const closes = result?.indicators?.quote?.[0]?.close;
      if (!ts || !closes || ts.length !== closes.length) continue;
      const series: HistoryPoint[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = closes[i];
        if (typeof close === 'number' && Number.isFinite(close)) series.push({ date: isoDay(ts[i]), close });
      }
      if (series.length > 0) return series;
    } catch {
      // try the next host
    }
  }
  return null;
}

interface NasdaqHistoryResponse {
  data?: { tradesTable?: { rows?: Array<{ date?: string; close?: string }> } | null } | null;
  status?: { rCode?: number } | null;
}

// "MM/DD/YYYY" → "YYYY-MM-DD".
function usDateToIso(s: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : undefined;
}

// Like fetchNasdaq, returns NOT_US when Nasdaq confirms the symbol isn't a US
// listing, so the caller can safely fall back to TMX without risking a CDR.
async function fetchNasdaqHistory(symbol: string): Promise<Resolved<HistoryPoint[]>> {
  const headers = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };
  const today = new Date();
  const from = new Date(today.getTime() - 10 * 365 * 24 * 60 * 60_000); // ~10y back
  const fromdate = from.toISOString().slice(0, 10);
  const todate = today.toISOString().slice(0, 10);
  let sawNotExist = false;
  for (const assetclass of ['stocks', 'etf'] as const) {
    try {
      const res = await fetch(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&fromdate=${fromdate}&todate=${todate}&limit=9999`,
        { headers },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as NasdaqHistoryResponse;
      if (data.status?.rCode === 400) sawNotExist = true;
      const rows = data.data?.tradesTable?.rows;
      if (!rows || rows.length === 0) continue;
      const series: HistoryPoint[] = [];
      for (const row of rows) {
        const date = row.date ? usDateToIso(row.date) : undefined;
        const close = parseNum(row.close);
        if (date && close !== undefined) series.push({ date, close });
      }
      // Nasdaq returns newest-first; the callers expect oldest → newest.
      series.sort((a, b) => a.date.localeCompare(b.date));
      if (series.length > 0) return series;
    } catch {
      // try the next assetclass
    }
  }
  return sawNotExist ? NOT_US : null;
}

interface CboeHistoryResponse {
  data?: Array<{ date?: string; close?: number | string }>;
}

// Cboe's public delayed-quotes CDN — daily OHLC for US equities/ETFs back to
// ~2004, no key. Unlike Nasdaq's historical endpoint (which rate-limits bursts
// into uselessness), this is a CDN and serves rapid successive requests fine, so
// it's the primary US history source. Returns null for non-US symbols (404/403).
async function fetchCboeHistory(symbol: string): Promise<HistoryPoint[] | null> {
  try {
    const res = await fetch(
      `https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/${encodeURIComponent(symbol)}.json`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as CboeHistoryResponse;
    const rows = data.data;
    if (!rows || rows.length === 0) return null;
    const series: HistoryPoint[] = [];
    for (const row of rows) {
      const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : undefined;
      const close = typeof row.close === 'number' ? row.close : parseNum(row.close);
      if (date && close !== undefined && close > 0) series.push({ date, close });
    }
    series.sort((a, b) => a.date.localeCompare(b.date));
    return series.length > 0 ? series : null;
  } catch {
    return null;
  }
}

interface TmxHistoryResponse {
  data?: { getTimeSeriesData?: Array<{ dateTime?: string; close?: number | string }> | null } | null;
}

// TMX daily close history (CAD) for Canadian listings, no key. Newest-first from
// the API; returned oldest → newest to match the other providers.
async function fetchTmxHistory(symbol: string): Promise<HistoryPoint[] | null> {
  const sym = tmxSymbol(symbol);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 15 * 365 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const body = {
    operationName: 'getTimeSeriesData',
    variables: { symbol: sym, freq: 'day', interval: 1, start, end },
    query:
      'query getTimeSeriesData($symbol: String!, $freq: String, $interval: Int, $start: String, $end: String) { getTimeSeriesData(symbol: $symbol, freq: $freq, interval: $interval, start: $start, end: $end) { dateTime close __typename } }',
  };
  try {
    const res = await fetch('https://app-money.tmx.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json', locale: 'en' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TmxHistoryResponse;
    const rows = data.data?.getTimeSeriesData;
    if (!rows || rows.length === 0) return null;
    const series: HistoryPoint[] = [];
    for (const row of rows) {
      const date = typeof row.dateTime === 'string' ? row.dateTime.slice(0, 10) : undefined;
      const close = typeof row.close === 'number' ? row.close : parseNum(row.close);
      if (date && close !== undefined) series.push({ date, close });
    }
    series.sort((a, b) => a.date.localeCompare(b.date));
    return series.length > 0 ? series : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a symbol's daily close history (oldest → newest), cached for 6h and
 * served stale for up to a week on an outage.
 *
 * History provider is chosen by market, never guessed: TMX for Canadian
 * (suffixed symbol or `canadian` from the resolved quote currency); a US symbol
 * uses **Cboe** (reliable CDN) → Yahoo → Nasdaq, never TMX (whose entry for a US
 * ticker is the differently-priced Canadian CDR). Never throws: returns [] when
 * no source is reachable.
 */
export async function fetchHistory(symbol: string, canadian = false): Promise<HistoryPoint[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return [];
  const now = Date.now();
  const hit = historyCache.get(sym);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.series;

  let series: HistoryPoint[] | null;
  if (isCanadian(sym) || canadian) {
    series = (await fetchTmxHistory(sym)) ?? (await fetchYahooHistory(sym));
  } else {
    series = (await fetchCboeHistory(sym)) ?? (await fetchYahooHistory(sym));
    if (!series) {
      const nasdaq = await fetchNasdaqHistory(sym);
      series = nasdaq === NOT_US ? null : nasdaq; // never TMX for a US symbol
    }
  }
  if (series && series.length > 0) {
    historyCache.set(sym, { series, at: now });
    return series;
  }
  if (hit && now - hit.at < HISTORY_MAX_STALE_MS) return hit.series;
  return [];
}
