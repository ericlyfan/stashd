import { Holding, HoldingLot, HoldingWithQuote, PortfolioSnapshot, PortfolioTotals, Quote } from '@stashd/shared';
import { StoreService } from './StoreService';
import { fetchQuotes } from './QuoteService';
import { fetchRates } from './FxService';
import { derivePosition } from './positions';

// Portfolio snapshot assembly, shared by the holdings route, the health/risk
// report, and the chat's get_portfolio tool. Pure computation lives in
// buildSnapshot; loadSnapshot does the store + quote + FX fetching around it.

// A holding's native (per-exchange) currency: the live quote's currency, else
// the manual override, else the portfolio base. Per-share prices and buyPrice
// are assumed to be in this currency.
export function nativeCurrency(h: Holding, quote: Quote | undefined, base: string): string {
  return (quote?.currency ?? h.currency ?? base).toUpperCase();
}

// Distinct native currencies across the holdings (quote currency wins), for the
// FX fetch. Upper-cased; excludes falsy.
export function portfolioCurrencies(holdings: Holding[], quotes: Map<string, Quote>, base: string): string[] {
  const set = new Set<string>([base.toUpperCase()]);
  for (const h of holdings) set.add(nativeCurrency(h, quotes.get(h.symbol.trim().toUpperCase()), base));
  return [...set];
}

// Resolve each holding's position (from lots when present, else legacy shares/
// buyPrice) and current price (live quote first, else manual override), compute
// its returns in the holding's native currency, then roll the priced holdings up
// into base-currency totals via the FX rate table. Pure — quotes/lots/rates are
// fetched by the caller. `fxRates.get(ccy)` converts 1 unit of ccy into `base`.
export function buildSnapshot(
  holdings: Holding[],
  lotsByHolding: Map<string, HoldingLot[]>,
  quotes: Map<string, Quote>,
  quotesLive: boolean,
  base: string,
  fxRates: Map<string, number>,
  fxLive: boolean,
  fxStale = false,
): PortfolioSnapshot {
  const enriched: HoldingWithQuote[] = holdings.map(h => {
    const quote = quotes.get(h.symbol.trim().toUpperCase());
    const pos = derivePosition(h, lotsByHolding.get(h.id) ?? []);
    const currency = nativeCurrency(h, quote, base);
    const fxToBase = fxRates.get(currency) ?? 1;

    let currentPrice: number | undefined;
    let priceSource: HoldingWithQuote['priceSource'] = 'none';
    if (quote) {
      currentPrice = quote.price;
      priceSource = 'live';
    } else if (h.manualPrice !== undefined) {
      currentPrice = h.manualPrice;
      priceSource = 'manual';
    }

    // Derived position overrides the stored legacy shares/buyPrice so the client
    // reads the same fields whether or not the holding has lots. Money fields are
    // in the native currency; `marketValueBase` is converted, for the totals.
    const enrichedHolding: HoldingWithQuote = {
      ...h,
      shares: pos.openShares,
      buyPrice: pos.avgCost,
      avgCost: pos.avgCost,
      costBasis: pos.costBasis,
      lotCount: pos.lotCount,
      realizedGain: pos.realizedGain,
      priceSource,
      currentPrice,
      currency,
      fxToBase,
      quoteCurrency: quote?.currency,
      ...(pos.invalid && { positionInvalid: true }),
    };
    if (currentPrice === undefined) return enrichedHolding;

    const marketValue = pos.openShares * currentPrice;
    const gain = marketValue - pos.costBasis; // unrealized
    enrichedHolding.marketValue = marketValue;
    enrichedHolding.marketValueBase = marketValue * fxToBase;
    enrichedHolding.gain = gain;
    enrichedHolding.gainPct = pos.costBasis > 0 ? gain / pos.costBasis : 0;
    enrichedHolding.totalGain = gain + pos.realizedGain;
    enrichedHolding.totalReturnPct = pos.costBasis > 0 ? enrichedHolding.totalGain / pos.costBasis : 0;

    // Day change only when a live quote carried a previous close.
    if (priceSource === 'live' && quote?.previousClose !== undefined) {
      enrichedHolding.dayChange = pos.openShares * (currentPrice - quote.previousClose);
      enrichedHolding.dayChangePct = quote.previousClose > 0 ? (currentPrice - quote.previousClose) / quote.previousClose : 0;
    }
    return enrichedHolding;
  });

  // Totals are in the base currency: convert each holding's native figures with
  // its fxToBase rate before summing.
  const totals = enriched.reduce<PortfolioTotals>(
    (acc, h) => {
      acc.costBasis += h.costBasis * h.fxToBase;
      acc.realizedGain += h.realizedGain * h.fxToBase;
      if (h.marketValue !== undefined) {
        acc.pricedCount += 1;
        acc.marketValue += h.marketValue * h.fxToBase;
        acc.gain += (h.gain ?? 0) * h.fxToBase;
        acc.dayChange += (h.dayChange ?? 0) * h.fxToBase;
      }
      return acc;
    },
    {
      holdingCount: enriched.length,
      pricedCount: 0,
      costBasis: 0,
      marketValue: 0,
      gain: 0,
      gainPct: 0,
      realizedGain: 0,
      totalGain: 0,
      totalReturnPct: 0,
      dayChange: 0,
      dayChangePct: 0,
    },
  );
  // Gain % is measured against the (base) cost basis of the *priced* holdings
  // only, so an unpriced position doesn't drag the percentage down.
  const pricedCost = enriched.reduce((s, h) => s + (h.marketValue !== undefined ? h.costBasis * h.fxToBase : 0), 0);
  totals.gainPct = pricedCost > 0 ? totals.gain / pricedCost : 0;
  totals.totalGain = totals.gain + totals.realizedGain;
  totals.totalReturnPct = pricedCost > 0 ? totals.totalGain / pricedCost : 0;
  // Day % against yesterday's value (market value minus today's change).
  const prevValue = totals.marketValue - totals.dayChange;
  totals.dayChangePct = prevValue > 0 ? totals.dayChange / prevValue : 0;

  // Portfolio weights: each priced holding's share of total (base) market value.
  if (totals.marketValue > 0) {
    for (const h of enriched) {
      if (h.marketValueBase !== undefined) h.weight = h.marketValueBase / totals.marketValue;
    }
  }

  return {
    holdings: enriched,
    totals,
    quotedAt: new Date().toISOString(),
    quotesLive,
    baseCurrency: base,
    fxLive,
    fxStale,
  };
}

// Fetch everything a snapshot needs (holdings, lots, quotes, FX) and build it.
export async function loadSnapshot(store: StoreService, base: string): Promise<PortfolioSnapshot> {
  const holdings = store.listHoldings();
  const quotes = await fetchQuotes(holdings.map(h => h.symbol));
  const fx = await fetchRates(base, portfolioCurrencies(holdings, quotes, base));
  return buildSnapshot(holdings, store.listAllLots(), quotes, quotes.size > 0, base, fx.rates, fx.live, fx.stale);
}
