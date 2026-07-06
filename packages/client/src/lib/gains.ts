import { formatMoney } from './format';

// Shared money-movement formatting for the portfolio surfaces (page, stock
// detail, charts). Kept together so signs, dashes and colors never drift.

// Signed money in a given currency, e.g. "+$1,240.00" / "−C$310.50".
export function signedAmount(v: number | undefined | null, currency: string): string {
  if (v === undefined || v === null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(v), currency)}`;
}

// Signed percentage from a 0..1 fraction, e.g. "+3.42%". Empty when unknown.
export function signedPct(v?: number | null): string {
  if (v === undefined || v === null) return '';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${(Math.abs(v) * 100).toFixed(2)}%`;
}

// Green for a gain, red for a loss, neutral for flat/unknown.
export function gainClass(v?: number | null): string {
  if (v === undefined || v === null || v === 0) return '';
  return v > 0 ? 'gain-pos' : 'gain-neg';
}
