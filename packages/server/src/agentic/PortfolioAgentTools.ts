import { AgentTool } from './AgenticWorkflow';
import { StoreService } from '../services/StoreService';
import { loadSnapshot } from '../services/portfolio';

// Portfolio read tool for the agentic loop — parity with classic chat's
// get_portfolio. Live-priced per call; compact JSON so it doesn't blow the
// context budget.

export function createPortfolioAgentTools(store: StoreService): AgentTool[] {
  return [
    {
      name: 'get_portfolio',
      schema: {
        type: 'function',
        function: {
          name: 'get_portfolio',
          description:
            "Read the user's stock portfolio: every holding with its live price, market value, portfolio weight, day change and total return (in the holding's own currency), plus base-currency totals and the watchlist (with folders and thesis notes). Use for any question about the user's investments, positions, gains, allocation, or watched stocks.",
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              base: { type: 'string', description: 'Optional 3-letter base currency for the totals (default CAD)' },
            },
          },
        },
      },
      async execute(args) {
        const rawBase = typeof args.base === 'string' ? args.base.trim().toUpperCase() : '';
        const base = /^[A-Z]{3}$/.test(rawBase) ? rawBase : 'CAD';
        const snap = await loadSnapshot(store, base);
        const pct = (v?: number) => (v === undefined ? undefined : +(v * 100).toFixed(2));
        const money = (v?: number) => (v === undefined ? undefined : +v.toFixed(2));
        return {
          ok: true,
          baseCurrency: snap.baseCurrency,
          quotesLive: snap.quotesLive,
          note: "Per-holding money is in each holding's own currency; totals are in the base currency.",
          totals: {
            marketValue: money(snap.totals.marketValue),
            costBasis: money(snap.totals.costBasis),
            dayChange: money(snap.totals.dayChange),
            dayChangePct: pct(snap.totals.dayChangePct),
            totalGain: money(snap.totals.totalGain),
            totalReturnPct: pct(snap.totals.totalReturnPct),
            realizedGain: money(snap.totals.realizedGain),
            holdings: snap.totals.holdingCount,
            priced: snap.totals.pricedCount,
          },
          holdings: snap.holdings.map(h => ({
            symbol: h.symbol,
            name: h.name,
            currency: h.currency,
            shares: +h.shares.toFixed(4),
            avgCost: money(h.avgCost),
            price: money(h.currentPrice),
            marketValue: money(h.marketValue),
            weightPct: pct(h.weight),
            dayChangePct: pct(h.dayChangePct),
            totalReturnPct: pct(h.totalReturnPct),
          })),
          watchlist: store.listWatchlist().map(w => ({
            symbol: w.symbol,
            name: w.name,
            folder: w.folder,
            thesis: w.notes,
          })),
        };
      },
    },
  ];
}
