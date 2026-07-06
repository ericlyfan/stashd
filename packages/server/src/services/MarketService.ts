import { MoversKind, ScreenerRow, SymbolSuggestion } from '@stashd/shared';

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
// otherwise resolve to the same-lettered US listing.
async function searchTsx(q: string): Promise<SymbolSuggestion[]> {
  const body = (await getJson(
    `https://www.tsx.com/json/company-directory/search/tsx/${encodeURIComponent(q)}`,
  )) as TsxDirectoryResponse | null;
  const rows = body?.results ?? [];
  return rows
    .filter(r => r.symbol && r.name)
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
  const merged = [...us.slice(0, 6), ...ca.slice(0, 4)];
  // An exact ticker match is almost always what was typed — surface it first.
  merged.sort((a, b) => {
    const ax = a.symbol === key || a.symbol === `${key}.TO` ? 0 : 1;
    const bx = b.symbol === key || b.symbol === `${key}.TO` ? 0 : 1;
    return ax - bx;
  });
  const results = merged.slice(0, 8);
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
export async function screenSector(sector: string, limit = 25): Promise<ScreenerRow[]> {
  if (!isSector(sector)) return [];
  const key = `sector:${sector}:${limit}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < TABLE_TTL_MS) return hit.rows;

  const body = (await getJson(
    `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&sector=${sector}`,
  )) as NasdaqTableResponse | null;
  const rows = (body?.data?.table?.rows ?? [])
    .map(toRow)
    .filter((r): r is ScreenerRow => r !== null);
  if (rows.length > 0) tableCache.set(key, { at: Date.now(), rows });
  return rows;
}

const MOVERS_KEY: Record<MoversKind, string> = {
  active: 'MostActiveByDollarVolume',
  gainers: 'MostAdvanced',
  losers: 'MostDeclined',
};

// Today's movers (most traded by dollar volume / biggest gainers / decliners).
export async function marketMovers(kind: MoversKind): Promise<ScreenerRow[]> {
  const key = `movers:${kind}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < TABLE_TTL_MS) return hit.rows;

  const body = (await getJson('https://api.nasdaq.com/api/marketmovers?assetclass=stocks')) as
    | NasdaqTableResponse
    | null;
  const rows = (body?.data?.STOCKS?.[MOVERS_KEY[kind]]?.table?.rows ?? [])
    .map(toRow)
    .filter((r): r is ScreenerRow => r !== null);
  if (rows.length > 0) tableCache.set(key, { at: Date.now(), rows });
  return rows;
}
