import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  Holding,
  HoldingInput,
  HoldingLot,
  HoldingLotInput,
  HoldingWithQuote,
  PortfolioSnapshot,
  PortfolioTotals,
  Quote,
  StockHistory,
} from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { fetchHistory, fetchQuotes } from '../services/QuoteService';
import { fetchRates } from '../services/FxService';
import { derivePosition } from '../services/positions';

interface Services {
  store: StoreService;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readPositiveNumber(value: unknown, field: string): number | undefined | { error: string } {
  if (value === null || value === undefined || value === '') return undefined;
  const n = cleanNumber(value);
  if (n === undefined) return { error: `${field} must be a number` };
  if (n <= 0) return { error: `${field} must be greater than zero` };
  return n;
}

// Build a partial HoldingInput carrying only the keys the request supplied, so
// PATCH stays a true partial update. `documentId` resolves to a real document
// id, an explicit null (clear), or is omitted (untouched).
function readHoldingInput(body: Record<string, unknown>, store: StoreService): HoldingInput | { error: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const input: HoldingInput = {};
  if (has('symbol')) input.symbol = cleanText(body.symbol)?.toUpperCase();
  if (has('name')) input.name = cleanText(body.name);
  if (has('shares')) {
    const shares = readPositiveNumber(body.shares, 'shares');
    if (typeof shares === 'object') return shares;
    input.shares = shares;
  }
  if (has('buyPrice')) {
    const buyPrice = readPositiveNumber(body.buyPrice, 'buyPrice');
    if (typeof buyPrice === 'object') return buyPrice;
    input.buyPrice = buyPrice;
  }
  if (has('manualPrice')) {
    const manualPrice = readPositiveNumber(body.manualPrice, 'manualPrice');
    if (typeof manualPrice === 'object') return manualPrice;
    input.manualPrice = manualPrice;
  }
  if (has('currency')) {
    const currency = cleanText(body.currency)?.toUpperCase();
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) return { error: 'currency must be a 3-letter code' };
    input.currency = currency;
  }
  if (has('notes')) input.notes = cleanText(body.notes);
  if (has('documentId')) {
    const id = cleanText(body.documentId);
    input.documentId = id && store.getDocument(id) ? id : null;
  }
  return input;
}

// A holding's native (per-exchange) currency: the live quote's currency, else
// the manual override, else the portfolio base. Per-share prices and buyPrice
// are assumed to be in this currency.
function nativeCurrency(h: Holding, quote: Quote | undefined, base: string): string {
  return (quote?.currency ?? h.currency ?? base).toUpperCase();
}

// Resolve each holding's position (from lots when present, else legacy shares/
// buyPrice) and current price (live quote first, else manual override), compute
// its returns in the holding's native currency, then roll the priced holdings up
// into base-currency totals via the FX rate table. Pure — quotes/lots/rates are
// fetched by the caller. `fxRates.get(ccy)` converts 1 unit of ccy into `base`.
function buildSnapshot(
  holdings: Holding[],
  lotsByHolding: Map<string, HoldingLot[]>,
  quotes: Map<string, Quote>,
  quotesLive: boolean,
  base: string,
  fxRates: Map<string, number>,
  fxLive: boolean,
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
    // in the native currency; `marketValueBase` is converted for the totals.
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
  };
}

// Distinct native currencies across the holdings (quote currency wins), for the
// FX fetch. Upper-cased; excludes falsy.
function portfolioCurrencies(holdings: Holding[], quotes: Map<string, Quote>, base: string): string[] {
  const set = new Set<string>([base.toUpperCase()]);
  for (const h of holdings) set.add(nativeCurrency(h, quotes.get(h.symbol.trim().toUpperCase()), base));
  return [...set];
}

// The base currency for a request: a clean 3-letter code from ?base=, else USD.
function readBase(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(s) ? s : 'USD';
}

// Validate + normalize a lot payload. Returns an error string, or the fields.
function readLotInput(body: Record<string, unknown>, partial: boolean): HoldingLotInput | { error: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const input: HoldingLotInput = {};
  if (has('type')) {
    if (body.type !== 'buy' && body.type !== 'sell') return { error: 'type must be "buy" or "sell"' };
    input.type = body.type;
  } else if (!partial) {
    input.type = 'buy';
  }
  if (has('date')) {
    const date = cleanText(body.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' };
    input.date = date;
  } else if (!partial) {
    return { error: 'A trade date is required' };
  }
  if (has('shares')) {
    const shares = cleanNumber(body.shares);
    if (shares === undefined || shares <= 0) return { error: 'shares must be a positive number' };
    input.shares = shares;
  } else if (!partial) {
    return { error: 'shares is required' };
  }
  if (has('price')) {
    const price = cleanNumber(body.price);
    if (price === undefined || price <= 0) return { error: 'price must be a positive number' };
    input.price = price;
  } else if (!partial) {
    return { error: 'price is required' };
  }
  if (has('fee')) {
    const fee = cleanNumber(body.fee);
    if (fee === undefined || fee <= 0) return { error: 'fee must be a positive number' };
    input.fee = fee;
  }
  if (has('notes')) input.notes = cleanText(body.notes);
  return input;
}

function lotWith(input: HoldingLotInput, existing?: HoldingLot, holdingId?: string): HoldingLot {
  return {
    id: existing?.id ?? '__new__',
    holdingId: existing?.holdingId ?? holdingId ?? '',
    type: input.type ?? existing?.type ?? 'buy',
    date: input.date ?? existing?.date ?? new Date().toISOString().slice(0, 10),
    shares: input.shares ?? existing?.shares ?? 0,
    price: input.price ?? existing?.price ?? 0,
    fee: Object.prototype.hasOwnProperty.call(input, 'fee') ? input.fee : existing?.fee,
    notes: Object.prototype.hasOwnProperty.call(input, 'notes') ? input.notes : existing?.notes,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

function validateLotPosition(lots: HoldingLot[], candidate: HoldingLot): string | undefined {
  const next = candidate.id === '__new__'
    ? [...lots, candidate]
    : lots.map(lot => (lot.id === candidate.id ? candidate : lot));
  const ordered = [...next].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );
  let shares = 0;
  for (const lot of ordered) {
    if (lot.type === 'buy') {
      shares += lot.shares;
    } else if (lot.shares > shares + 1e-9) {
      return `Cannot sell ${lot.shares} shares on ${lot.date}; only ${+shares.toFixed(8)} shares are available`;
    } else {
      shares -= lot.shares;
      if (shares <= 1e-9) shares = 0;
    }
  }
  return undefined;
}

export function createHoldingRoutes(services: Services): Router {
  const { store } = services;
  const router = Router();

  // GET /api/holdings?base=CAD — the whole portfolio with live prices, rollups
  // in the base currency, and per-holding native currency.
  router.get('/', async (req, res) => {
    const base = readBase(req.query.base);
    const holdings = store.listHoldings();
    const symbols = holdings.map(h => h.symbol);
    const quotes = await fetchQuotes(symbols);
    const { rates, live: fxLive } = await fetchRates(base, portfolioCurrencies(holdings, quotes, base));
    res.json(buildSnapshot(holdings, store.listAllLots(), quotes, quotes.size > 0, base, rates, fxLive));
  });

  // GET /api/holdings/history/:symbol — one stock's daily closes + live quote,
  // for the stock detail page. Declared before "/:id" routes so "history" isn't
  // parsed as a holding id. Single-currency (the stock's native currency).
  // ?days=N trims the series to the last N calendar days (sparklines don't need
  // two decades of closes per symbol).
  router.get('/history/:symbol', async (req, res) => {
    const symbol = req.params.symbol.trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'A symbol is required' });
    const days = Number(req.query.days);

    const quotes = await fetchQuotes([symbol]);
    const quote = quotes.get(symbol);
    const currency = quote?.currency ?? 'USD';
    // Route history by the resolved quote currency (never guessed → no CDR mixups).
    let points = await fetchHistory(symbol, currency === 'CAD');
    if (Number.isFinite(days) && days > 0) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      points = points.filter(p => p.date >= cutoff);
    }
    // Historical closes can lag a day or two behind the live quote; end the
    // series on today's live price so the chart agrees with the header.
    const today = new Date().toISOString().slice(0, 10);
    if (quote && points.length > 0 && points[points.length - 1].date < today) {
      points.push({ date: today, close: quote.price });
    }

    const priceSource: StockHistory['priceSource'] = quote ? 'live' : 'none';
    const dayChange =
      quote?.previousClose !== undefined ? quote.price - quote.previousClose : undefined;
    const result: StockHistory = {
      symbol,
      // name isn't carried by the quote providers; the client shows the
      // holding/watchlist name it already has.
      currency,
      currentPrice: quote?.price,
      previousClose: quote?.previousClose,
      dayChange,
      dayChangePct:
        dayChange !== undefined && quote?.previousClose ? dayChange / quote.previousClose : undefined,
      priceSource,
      points,
    };
    res.json(result);
  });

  // GET /api/holdings/:id/lots — a holding's transactions
  router.get('/:id/lots', (req, res) => {
    if (!store.getHolding(req.params.id)) return res.status(404).json({ error: 'Holding not found' });
    res.json(store.listLots(req.params.id));
  });

  // POST /api/holdings/:id/lots — add a transaction
  router.post('/:id/lots', (req, res) => {
    const holding = store.getHolding(req.params.id);
    if (!holding) return res.status(404).json({ error: 'Holding not found' });
    const parsed = readLotInput((req.body ?? {}) as Record<string, unknown>, false);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const lot: HoldingLot = {
      id: uuidv4(),
      holdingId: req.params.id,
      type: parsed.type ?? 'buy',
      date: parsed.date!,
      shares: parsed.shares!,
      price: parsed.price!,
      fee: parsed.fee,
      notes: parsed.notes,
      createdAt: new Date().toISOString(),
    };
    const positionError = validateLotPosition(store.listLots(holding.id), lot);
    if (positionError) return res.status(400).json({ error: positionError });
    store.addLot(lot);
    res.status(201).json(lot);
  });

  // PATCH /api/holdings/:id/lots/:lotId — partial update
  router.patch('/:id/lots/:lotId', (req, res) => {
    const lot = store.getLot(req.params.lotId);
    if (!lot || lot.holdingId !== req.params.id) return res.status(404).json({ error: 'Transaction not found' });
    const parsed = readLotInput((req.body ?? {}) as Record<string, unknown>, true);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const holding = store.getHolding(req.params.id);
    if (!holding) return res.status(404).json({ error: 'Holding not found' });
    const candidate = lotWith(parsed, lot);
    const positionError = validateLotPosition(store.listLots(holding.id), candidate);
    if (positionError) return res.status(400).json({ error: positionError });
    res.json(store.updateLot(lot.id, parsed));
  });

  // DELETE /api/holdings/:id/lots/:lotId
  router.delete('/:id/lots/:lotId', (req, res) => {
    const lot = store.getLot(req.params.lotId);
    if (!lot || lot.holdingId !== req.params.id) return res.status(404).json({ error: 'Transaction not found' });
    store.removeLot(lot.id);
    res.status(204).end();
  });

  // POST /api/holdings — add a holding
  router.post('/', (req, res) => {
    const input = readHoldingInput((req.body ?? {}) as Record<string, unknown>, store);
    if ('error' in input) return res.status(400).json({ error: input.error });
    if (!input.symbol) {
      return res.status(400).json({ error: 'A ticker symbol is required' });
    }
    if (input.shares === undefined) {
      return res.status(400).json({ error: 'shares must be greater than zero' });
    }
    if (input.buyPrice === undefined) {
      return res.status(400).json({ error: 'buyPrice must be greater than zero' });
    }
    const now = new Date().toISOString();
    const holding: Holding = {
      id: uuidv4(),
      symbol: input.symbol,
      name: input.name,
      shares: input.shares ?? 0,
      buyPrice: input.buyPrice ?? 0,
      manualPrice: input.manualPrice,
      currency: input.currency,
      documentId: input.documentId ?? undefined,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    store.addHolding(holding);
    res.status(201).json(holding);
  });

  // PATCH /api/holdings/:id — partial update
  router.patch('/:id', (req, res) => {
    const existing = store.getHolding(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Holding not found' });
    const input = readHoldingInput((req.body ?? {}) as Record<string, unknown>, store);
    if ('error' in input) return res.status(400).json({ error: input.error });
    if (Object.prototype.hasOwnProperty.call(input, 'symbol') && !input.symbol) {
      return res.status(400).json({ error: 'A ticker symbol can’t be blank' });
    }
    const updated = store.updateHolding(existing.id, { ...input, updatedAt: new Date().toISOString() });
    res.json(updated);
  });

  // DELETE /api/holdings/:id
  router.delete('/:id', (req, res) => {
    if (!store.removeHolding(req.params.id)) {
      return res.status(404).json({ error: 'Holding not found' });
    }
    res.status(204).end();
  });

  return router;
}
