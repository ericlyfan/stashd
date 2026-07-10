// Foreign-exchange rates for multi-currency portfolios, no API key. Holdings are
// valued in their native currency (per exchange); the portfolio totals convert
// everything to a chosen base currency using these rates. Mirrors
// QuoteService's provider-chain / cache / never-throw conventions.
//
// Primary: Frankfurter (ECB daily rates, no key). Fallback: open.er-api.com.
// Then a stale cache (`live:false, stale:true` — converted, but disclosed);
// then identity (1.0, `live:false, stale:false`) so totals still compute.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Rates move slowly — cache a base's full rate table for an hour, and serve a
// stale table for up to a day if every source is unreachable.
const CACHE_TTL_MS = 60 * 60_000;
const MAX_STALE_MS = 24 * 60 * 60_000;

// Keyed by base currency → { rate table (foreign→base), fetched-at }.
const cache = new Map<string, { rates: Map<string, number>; at: number }>();

export interface FxResult {
  // rates.get(ccy) converts 1 unit of `ccy` into the base currency; the base
  // itself maps to 1. Unknown currencies fall back to 1 at the call site.
  rates: Map<string, number>;
  // live: rates fetched fresh (or fresh-cached) this hour. stale: every
  // source is down and these are the last good rates (≤24h old) — conversions
  // still apply, but the UI should disclose their age. Neither: identity
  // rates, nothing is converted. live and stale are mutually exclusive.
  live: boolean;
  stale: boolean;
}

interface FrankfurterResponse {
  base?: string;
  rates?: Record<string, number>;
}

// Frankfurter gives base→foreign; we want foreign→base, so invert.
async function fetchFrankfurter(base: string, symbols: string[]): Promise<Map<string, number> | null> {
  if (symbols.length === 0) return new Map();
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(symbols.join(','))}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as FrankfurterResponse;
    if (!data.rates) return null;
    const out = new Map<string, number>();
    for (const [ccy, baseToForeign] of Object.entries(data.rates)) {
      if (typeof baseToForeign === 'number' && baseToForeign > 0) out.set(ccy, 1 / baseToForeign);
    }
    return out;
  } catch {
    return null;
  }
}

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

async function fetchErApi(base: string, symbols: string[]): Promise<Map<string, number> | null> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ErApiResponse;
    if (data.result !== 'success' || !data.rates) return null;
    const out = new Map<string, number>();
    for (const ccy of symbols) {
      const baseToForeign = data.rates[ccy];
      if (typeof baseToForeign === 'number' && baseToForeign > 0) out.set(ccy, 1 / baseToForeign);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Rates converting each of `currencies` into `base`. Deduplicates + upper-cases,
 * always maps the base currency to 1, caches per base for an hour, and degrades
 * to a stale table then to identity rates (`live:false`). Never throws.
 */
export async function fetchRates(base: string, currencies: string[]): Promise<FxResult> {
  const baseCcy = base.trim().toUpperCase();
  const wanted = [...new Set(currencies.map(c => c.trim().toUpperCase()).filter(Boolean))].filter(c => c !== baseCcy);

  const now = Date.now();
  const hit = cache.get(baseCcy);
  const fresh = hit && now - hit.at < CACHE_TTL_MS;
  const covered = (table: Map<string, number>) => wanted.every(c => table.has(c));
  if (fresh && covered(hit!.rates)) {
    return { rates: withBase(hit!.rates, baseCcy), live: true, stale: false };
  }

  const fetched = (await fetchFrankfurter(baseCcy, wanted)) ?? (await fetchErApi(baseCcy, wanted));
  if (fetched && covered(fetched)) {
    cache.set(baseCcy, { rates: fetched, at: now });
    return { rates: withBase(fetched, baseCcy), live: true, stale: false };
  }

  // Every source failed (or was incomplete). Serve the last good table if
  // recent — but flagged, never as live: conversions still apply, and the
  // UI's staleness advisory must fire during the outage.
  if (hit && now - hit.at < MAX_STALE_MS && covered(hit.rates)) {
    return { rates: withBase(hit.rates, baseCcy), live: false, stale: true };
  }

  // Nothing usable — identity rates so totals still add up (flagged not live).
  const identity = withBase(new Map<string, number>(), baseCcy);
  for (const c of wanted) identity.set(c, 1);
  return { rates: identity, live: wanted.length === 0, stale: false };
}

function withBase(rates: Map<string, number>, base: string): Map<string, number> {
  const out = new Map(rates);
  out.set(base, 1);
  return out;
}
