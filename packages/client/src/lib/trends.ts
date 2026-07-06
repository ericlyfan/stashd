import { useEffect, useState } from 'react';
import { HistoryDay } from '@stashd/shared';
import { getStockHistory } from '../api';

// 30-day close series per symbol, for the table sparklines. Fetched lazily
// after the snapshot renders, a few symbols at a time so a big portfolio
// doesn't fire twenty requests at once, and cached for the session (the server
// caches the underlying provider data ~6h anyway). A failed/empty fetch caches
// as an empty array so we don't retry every render.

const TREND_DAYS = 30;
const CONCURRENCY = 4;

const cache = new Map<string, HistoryDay[]>();

async function fetchMissing(symbols: string[], onOne: () => void): Promise<void> {
  const queue = symbols.filter(s => !cache.has(s));
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      let sym: string | undefined;
      while ((sym = queue.shift()) !== undefined) {
        const key = sym;
        try {
          const hist = await getStockHistory(key, TREND_DAYS);
          // Trim client-side too: the "30d" label must hold even if a stale
          // server ignores ?days= and returns the full series.
          const cutoff = new Date(Date.now() - TREND_DAYS * 86_400_000).toISOString().slice(0, 10);
          cache.set(key, hist.points.filter(p => p.date >= cutoff));
        } catch {
          cache.set(key, []);
        }
        onOne();
      }
    }),
  );
}

// Returns whatever series are known so far; re-renders as fetches land.
export function useTrends(symbols: string[]): Map<string, HistoryDay[]> {
  const [, setTick] = useState(0);
  const key = [...new Set(symbols.map(s => s.trim().toUpperCase()))].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchMissing(key.split(','), () => alive && setTick(t => t + 1));
    return () => {
      alive = false;
    };
  }, [key]);

  return cache;
}
