import { Quote } from '@stashd/shared';

// Live stock quotes from Yahoo Finance's public chart endpoint. No API key
// required. This is an *unofficial* endpoint, so it can occasionally change or
// rate-limit; every failure degrades to "no quote" and the caller falls back to
// the holding's manual price. Note: some egress policies block this host — in
// that case fetchQuotes simply returns nothing and the portfolio shows manual /
// unpriced holdings only.
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Yahoo rejects requests without a browser-like User-Agent.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Quotes are cached briefly so a burst of portfolio reads (or several holdings
// of the same symbol) doesn't hammer the endpoint.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { quote: Quote; at: number }>();

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
      };
    }>;
    error?: unknown;
  };
}

async function fetchOne(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooChartResponse;
    const meta = data.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    const prev = meta?.chartPreviousClose ?? meta?.previousClose;
    return {
      symbol,
      price,
      previousClose: typeof prev === 'number' ? prev : undefined,
      currency: meta?.currency,
    };
  } catch {
    // Network error, blocked egress, malformed JSON — all degrade to no quote.
    return null;
  }
}

/**
 * Fetch current quotes for a set of symbols. Deduplicates and upper-cases
 * symbols, serves fresh cache hits, and fetches the rest concurrently. Never
 * throws: unresolved symbols are simply absent from the returned map.
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
      result.set(symbol, hit.quote);
    } else if (!toFetch.includes(symbol)) {
      toFetch.push(symbol);
    }
  }

  const fetched = await Promise.all(toFetch.map(fetchOne));
  fetched.forEach((quote, i) => {
    if (quote) {
      cache.set(toFetch[i], { quote, at: now });
      result.set(toFetch[i], quote);
    }
  });

  return result;
}
