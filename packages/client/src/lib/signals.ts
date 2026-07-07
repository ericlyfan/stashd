import { HistoryDay } from '@stashd/shared';

// A transparent buy/sell read of a stock, deduced from the data the page
// already has: daily closes (trend + momentum) and, when available, the
// analyst 1-yr target. Each indicator votes ±1; the verdict is the net score.
// This is a heuristic for orientation — the card says so — not advice.

export type Stance = 'bull' | 'bear' | 'neutral';
export type Verdict = 'strong-buy' | 'buy' | 'hold' | 'sell' | 'strong-sell';

export interface SignalRow {
  label: string;
  detail: string;
  stance: Stance;
}

export interface StockSignal {
  verdict: Verdict;
  score: number;
  rows: SignalRow[];
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  'strong-buy': 'Strong buy',
  buy: 'Buy',
  hold: 'Hold',
  sell: 'Sell',
  'strong-sell': 'Strong sell',
};

// Simple moving average of the last `n` values; undefined when there aren't n.
function sma(values: number[], n: number): number | undefined {
  if (values.length < n) return undefined;
  const slice = values.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

// Wilder-smoothed 14-period RSI; undefined below 15 closes.
function rsi14(closes: number[]): number | undefined {
  const n = 14;
  if (closes.length < n + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

const stanceScore: Record<Stance, number> = { bull: 1, bear: -1, neutral: 0 };

export function buildSignal(
  points: HistoryDay[],
  currentPrice?: number,
  targetPrice?: number,
): StockSignal | null {
  const closes = points.map(p => p.close);
  const price = currentPrice ?? closes[closes.length - 1];
  if (price === undefined || closes.length < 15) return null;

  const rows: SignalRow[] = [];

  // Trend: where the price sits against its 50-day average.
  const sma50 = sma(closes, 50);
  if (sma50 !== undefined) {
    const diff = (price - sma50) / sma50;
    rows.push({
      label: 'Trend (50-day avg)',
      detail: `${diff >= 0 ? 'above' : 'below'} by ${(Math.abs(diff) * 100).toFixed(1)}%`,
      stance: diff > 0.005 ? 'bull' : diff < -0.005 ? 'bear' : 'neutral',
    });
  }

  // Long trend: 50-day vs 200-day average (golden/death-cross posture).
  const sma200 = sma(closes, 200);
  if (sma50 !== undefined && sma200 !== undefined) {
    const up = sma50 > sma200;
    rows.push({
      label: 'Long trend (50 vs 200)',
      detail: up ? 'golden-cross posture' : 'death-cross posture',
      stance: up ? 'bull' : 'bear',
    });
  }

  // Momentum: RSI reads overbought/oversold at the extremes.
  const rsi = rsi14(closes);
  if (rsi !== undefined) {
    rows.push({
      label: 'Momentum (RSI 14)',
      detail: `${rsi.toFixed(0)} — ${rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'in range'}`,
      stance: rsi < 30 ? 'bull' : rsi > 70 ? 'bear' : 'neutral',
    });
  }

  // Analyst 1-yr target (US symbols; Nasdaq's consensus figure).
  if (targetPrice !== undefined && targetPrice > 0) {
    const upside = (targetPrice - price) / price;
    rows.push({
      label: 'Analyst 1-yr target',
      detail: `${upside >= 0 ? '+' : '−'}${(Math.abs(upside) * 100).toFixed(1)}% to target`,
      stance: upside >= 0.1 ? 'bull' : upside <= -0.05 ? 'bear' : 'neutral',
    });
  }

  if (rows.length < 2) return null;

  const score = rows.reduce((s, r) => s + stanceScore[r.stance], 0);
  const verdict: Verdict =
    score >= 3 ? 'strong-buy' : score >= 2 ? 'buy' : score <= -3 ? 'strong-sell' : score <= -2 ? 'sell' : 'hold';
  return { verdict, score, rows };
}
