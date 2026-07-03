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
}

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
// assetclass isn't known up front, so try stocks then etf.
async function fetchNasdaq(symbol: string): Promise<Quote | null> {
  const headers = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };
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
      if (price === undefined) continue;
      const net = parseNum(pd?.netChange);
      return { symbol, price, previousClose: net !== undefined ? price - net : undefined, currency: pd?.currency ?? 'USD' };
    } catch {
      // try the next assetclass
    }
  }
  return null;
}

// One symbol: Yahoo first, then Nasdaq.
async function fetchOne(symbol: string): Promise<Quote | null> {
  return (await fetchYahoo(symbol)) ?? (await fetchNasdaq(symbol));
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
