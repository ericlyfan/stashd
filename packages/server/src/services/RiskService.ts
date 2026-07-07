import {
  CorrelationPair,
  HealthWarning,
  HoldingRisk,
  HoldingWithQuote,
  PortfolioHealth,
  PortfolioSnapshot,
  RiskStats,
} from '@stashd/shared';
import { fetchHistory, HistoryPoint } from './QuoteService';
import { stockProfile } from './MarketService';

// Portfolio risk & health: per-holding and portfolio-level stats from ~1y of
// daily closes (benchmark SPY), pairwise correlations, concentration checks,
// and heuristic rebalancing suggestions. Everything here is advisory — the
// numbers are honest but the thresholds are opinions, and the UI labels them
// as such. History/profile fetches ride the existing caches (6h / 30min); the
// assembled report is cached briefly per base+holdings set.

const BENCHMARK = 'SPY';
const WINDOW_DAYS = 365;
const TRADING_DAYS = 252;
const MIN_OBS = 40; // fewer aligned observations than this → stat omitted

// Opinionated thresholds, in one place so they're easy to tune.
const CORR_WARN = 0.85; // pairwise correlation that reads as "the same bet"
const CORR_MIN_WEIGHT = 0.05; // both legs must matter to warrant a warning
const TOP_HOLDING_CAP = 0.25; // single-position weight that draws a warning
const TOP3_CAP = 0.65;
const SECTOR_CAP = 0.45; // across holdings with a known sector (funds excluded)
const FX_CAP = 0.75; // non-base currency share that draws an FX note

const REPORT_TTL_MS = 10 * 60_000;
const reportCache = new Map<string, { at: number; report: PortfolioHealth }>();

// ── Series math ──────────────────────────────────────────────────────────────

// date → close, trimmed to the window.
function toSeries(points: HistoryPoint[], cutoff: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) if (p.date >= cutoff) m.set(p.date, p.close);
  return m;
}

// Daily simple returns on the dates both the series and the calendar provide.
function returnsOn(dates: string[], series: Map<string, number>): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let prev: number | undefined;
  for (const d of dates) {
    const v = series.get(d);
    out.push(prev !== undefined && v !== undefined && prev > 0 ? v / prev - 1 : undefined);
    if (v !== undefined) prev = v;
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// Pearson correlation over the indices where both series have a return.
function pearson(a: (number | undefined)[], b: (number | undefined)[]): { rho?: number; n: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== undefined && b[i] !== undefined) {
      xs.push(a[i]!);
      ys.push(b[i]!);
    }
  }
  if (xs.length < MIN_OBS) return { n: xs.length };
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  if (vx === 0 || vy === 0) return { n: xs.length };
  return { rho: cov / Math.sqrt(vx * vy), n: xs.length };
}

// beta = cov(asset, benchmark) / var(benchmark), over shared dates.
function betaVs(asset: (number | undefined)[], bench: (number | undefined)[]): number | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < asset.length; i++) {
    if (asset[i] !== undefined && bench[i] !== undefined) {
      xs.push(asset[i]!);
      ys.push(bench[i]!);
    }
  }
  if (xs.length < MIN_OBS) return undefined;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vy += (ys[i] - my) ** 2;
  }
  return vy > 0 ? cov / vy : undefined;
}

// vol / Sharpe / max drawdown / window return from a return series + closes.
function seriesStats(rets: (number | undefined)[], closes: number[]): RiskStats {
  const xs = rets.filter((r): r is number => r !== undefined);
  const stats: RiskStats = {};
  if (xs.length >= MIN_OBS) {
    const vol = stdev(xs) * Math.sqrt(TRADING_DAYS);
    stats.volatility = vol;
    const annReturn = mean(xs) * TRADING_DAYS;
    if (vol > 0) stats.sharpe = annReturn / vol;
  }
  if (closes.length >= 2) {
    stats.return1y = closes[0] > 0 ? closes[closes.length - 1] / closes[0] - 1 : undefined;
    let peak = closes[0];
    let maxDD = 0;
    for (const c of closes) {
      if (c > peak) peak = c;
      const dd = peak > 0 ? c / peak - 1 : 0;
      if (dd < maxDD) maxDD = dd;
    }
    stats.maxDrawdown = maxDD;
  }
  return stats;
}

// ── Report assembly ──────────────────────────────────────────────────────────

const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`;

export async function buildHealthReport(snapshot: PortfolioSnapshot): Promise<PortfolioHealth> {
  const base = snapshot.baseCurrency;
  const priced = snapshot.holdings.filter(h => (h.weight ?? 0) > 0);
  const cacheKey = `${base}:${priced.map(h => `${h.symbol}=${(h.weight ?? 0).toFixed(3)}`).sort().join(',')}`;
  const hit = reportCache.get(cacheKey);
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.report;

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Histories (cached ~6h in QuoteService) for benchmark + every priced holding.
  const bench = toSeries(await fetchHistory(BENCHMARK, false), cutoff);
  const seriesBySymbol = new Map<string, Map<string, number>>();
  await Promise.all(
    priced.map(async h => {
      const pts = await fetchHistory(h.symbol, h.currency === 'CAD');
      seriesBySymbol.set(h.symbol, toSeries(pts, cutoff));
    }),
  );

  // The shared calendar: benchmark dates (falls back to the union when the
  // benchmark itself is unavailable).
  let dates = [...bench.keys()].sort();
  if (dates.length < MIN_OBS) {
    const all = new Set<string>();
    for (const s of seriesBySymbol.values()) for (const d of s.keys()) all.add(d);
    dates = [...all].sort();
  }
  const benchRets = returnsOn(dates, bench);

  const retsBySymbol = new Map<string, (number | undefined)[]>();
  const holdingRisks: HoldingRisk[] = priced.map(h => {
    const series = seriesBySymbol.get(h.symbol) ?? new Map<string, number>();
    const rets = returnsOn(dates, series);
    retsBySymbol.set(h.symbol, rets);
    const closes = dates.map(d => series.get(d)).filter((v): v is number => v !== undefined);
    return {
      symbol: h.symbol,
      weight: h.weight,
      ...seriesStats(rets, closes),
      beta: betaVs(rets, benchRets),
    };
  });

  // Portfolio series: current-weight blend of the holdings' daily returns (an
  // approximation — it assumes today's weights held all year).
  const portRets: (number | undefined)[] = dates.map((_, i) => {
    let sum = 0;
    let wSum = 0;
    for (const h of priced) {
      const r = retsBySymbol.get(h.symbol)?.[i];
      if (r !== undefined && h.weight) {
        sum += r * h.weight;
        wSum += h.weight;
      }
    }
    return wSum > 0.5 ? sum / wSum : undefined; // need most of the book priced that day
  });
  // Synthetic portfolio "closes" (growth of 1) for the drawdown/window return.
  const portCloses: number[] = [];
  let level = 1;
  for (const r of portRets) {
    if (r !== undefined) {
      level *= 1 + r;
      portCloses.push(level);
    }
  }
  const portfolio: RiskStats = {
    ...seriesStats(portRets, portCloses),
    beta: betaVs(portRets, benchRets),
  };

  // Pairwise correlations (strongest first), warnings for same-bet pairs.
  const correlations: CorrelationPair[] = [];
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const { rho } = pearson(retsBySymbol.get(priced[i].symbol)!, retsBySymbol.get(priced[j].symbol)!);
      if (rho !== undefined) correlations.push({ a: priced[i].symbol, b: priced[j].symbol, rho });
    }
  }
  correlations.sort((x, y) => y.rho - x.rho);

  const warnings: HealthWarning[] = [];
  const suggestions: string[] = [];

  for (const c of correlations) {
    const wa = priced.find(h => h.symbol === c.a)?.weight ?? 0;
    const wb = priced.find(h => h.symbol === c.b)?.weight ?? 0;
    if (c.rho >= CORR_WARN && wa >= CORR_MIN_WEIGHT && wb >= CORR_MIN_WEIGHT) {
      warnings.push({
        kind: 'correlation',
        severity: 'warn',
        message: `${c.a} and ${c.b} move almost in lockstep (ρ ${c.rho.toFixed(2)}) — together ${pctFmt(wa + wb)} of the portfolio is effectively one bet.`,
      });
    }
  }

  // Concentration: single position, top-3, currency, sector.
  const byWeight = [...priced].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const top = byWeight[0];
  if (top?.weight !== undefined && top.weight > TOP_HOLDING_CAP) {
    warnings.push({
      kind: 'concentration',
      severity: 'warn',
      message: `${top.symbol} is ${pctFmt(top.weight)} of the portfolio (above the ${pctFmt(TOP_HOLDING_CAP)} single-position guideline).`,
    });
    const excess = (top.weight - TOP_HOLDING_CAP) * snapshot.totals.marketValue;
    suggestions.push(
      `Trimming ${top.symbol} by about ${base} ${excess.toFixed(0)} would bring it back to ${pctFmt(TOP_HOLDING_CAP)}.`,
    );
  }
  const top3 = byWeight.slice(0, 3).reduce((s, h) => s + (h.weight ?? 0), 0);
  if (byWeight.length > 3 && top3 > TOP3_CAP) {
    warnings.push({
      kind: 'concentration',
      severity: 'info',
      message: `Your top three positions are ${pctFmt(top3)} of the portfolio.`,
    });
  }

  const ccyWeights = new Map<string, number>();
  for (const h of priced) ccyWeights.set(h.currency, (ccyWeights.get(h.currency) ?? 0) + (h.weight ?? 0));
  for (const [ccy, w] of ccyWeights) {
    if (ccy !== base && w > FX_CAP) {
      warnings.push({
        kind: 'currency',
        severity: 'info',
        message: `${pctFmt(w)} of the portfolio is priced in ${ccy} — a large FX exposure against your ${base} base.`,
      });
    }
  }

  // Sector concentration over holdings with a known sector (funds/ETFs are
  // diversified wrappers and typically report none — they're skipped).
  const sectorWeights = new Map<string, { w: number; symbols: string[] }>();
  await Promise.all(
    priced.map(async h => {
      const profile = await stockProfile(h.symbol, h.currency === 'CAD');
      const sector = profile?.sector?.trim();
      if (!sector) return;
      const cur = sectorWeights.get(sector) ?? { w: 0, symbols: [] };
      cur.w += h.weight ?? 0;
      cur.symbols.push(h.symbol);
      sectorWeights.set(sector, cur);
    }),
  );
  for (const [sector, { w, symbols }] of sectorWeights) {
    if (w > SECTOR_CAP && symbols.length > 1) {
      warnings.push({
        kind: 'sector',
        severity: 'warn',
        message: `${pctFmt(w)} of the portfolio sits in ${sector} (${symbols.join(', ')}).`,
      });
      suggestions.push(`Adding positions outside ${sector} would soften the sector bet.`);
    }
  }

  const report: PortfolioHealth = {
    benchmark: BENCHMARK,
    windowDays: WINDOW_DAYS,
    portfolio,
    holdings: holdingRisks,
    correlations: correlations.slice(0, 6),
    warnings,
    suggestions,
    baseCurrency: base,
    asOf: new Date().toISOString(),
  };
  reportCache.set(cacheKey, { at: Date.now(), report });
  return report;
}
