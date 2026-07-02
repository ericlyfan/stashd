import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  Holding,
  HoldingInput,
  HoldingWithQuote,
  PortfolioSnapshot,
  PortfolioTotals,
  Quote,
} from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { fetchQuotes } from '../services/QuoteService';

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

// Build a partial HoldingInput carrying only the keys the request supplied, so
// PATCH stays a true partial update. `documentId` resolves to a real document
// id, an explicit null (clear), or is omitted (untouched).
function readHoldingInput(body: Record<string, unknown>, store: StoreService): HoldingInput {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const input: HoldingInput = {};
  if (has('symbol')) input.symbol = cleanText(body.symbol)?.toUpperCase();
  if (has('name')) input.name = cleanText(body.name);
  if (has('shares')) input.shares = cleanNumber(body.shares);
  if (has('buyPrice')) input.buyPrice = cleanNumber(body.buyPrice);
  if (has('manualPrice')) input.manualPrice = cleanNumber(body.manualPrice);
  if (has('currency')) input.currency = cleanText(body.currency);
  if (has('notes')) input.notes = cleanText(body.notes);
  if (has('documentId')) {
    const id = cleanText(body.documentId);
    input.documentId = id && store.getDocument(id) ? id : null;
  }
  return input;
}

// Resolve each holding's current price (live quote first, else the manual
// override) and compute its returns; then roll the priced holdings up into
// portfolio totals. Pure — quotes are fetched by the caller.
function buildSnapshot(holdings: Holding[], quotes: Map<string, Quote>, quotesLive: boolean): PortfolioSnapshot {
  const enriched: HoldingWithQuote[] = holdings.map(h => {
    const quote = quotes.get(h.symbol.trim().toUpperCase());
    const costBasis = h.shares * h.buyPrice;

    let currentPrice: number | undefined;
    let priceSource: HoldingWithQuote['priceSource'] = 'none';
    if (quote) {
      currentPrice = quote.price;
      priceSource = 'live';
    } else if (h.manualPrice !== undefined) {
      currentPrice = h.manualPrice;
      priceSource = 'manual';
    }

    const base: HoldingWithQuote = {
      ...h,
      costBasis,
      priceSource,
      currentPrice,
      quoteCurrency: quote?.currency,
    };
    if (currentPrice === undefined) return base;

    const marketValue = h.shares * currentPrice;
    const gain = marketValue - costBasis;
    base.marketValue = marketValue;
    base.gain = gain;
    base.gainPct = costBasis > 0 ? gain / costBasis : 0;

    // Day change only when a live quote carried a previous close.
    if (priceSource === 'live' && quote?.previousClose !== undefined) {
      const dayChange = h.shares * (currentPrice - quote.previousClose);
      base.dayChange = dayChange;
      base.dayChangePct = quote.previousClose > 0 ? (currentPrice - quote.previousClose) / quote.previousClose : 0;
    }
    return base;
  });

  const totals = enriched.reduce<PortfolioTotals>(
    (acc, h) => {
      acc.costBasis += h.costBasis;
      if (h.marketValue !== undefined) {
        acc.pricedCount += 1;
        acc.marketValue += h.marketValue;
        acc.gain += h.gain ?? 0;
        acc.dayChange += h.dayChange ?? 0;
      }
      return acc;
    },
    { holdingCount: enriched.length, pricedCount: 0, costBasis: 0, marketValue: 0, gain: 0, dayChange: 0, gainPct: 0 },
  );
  // Gain % is measured against the cost basis of the *priced* holdings only, so
  // an unpriced position doesn't drag the percentage down.
  const pricedCost = enriched.reduce((s, h) => s + (h.marketValue !== undefined ? h.costBasis : 0), 0);
  totals.gainPct = pricedCost > 0 ? totals.gain / pricedCost : 0;

  return { holdings: enriched, totals, quotedAt: new Date().toISOString(), quotesLive };
}

export function createHoldingRoutes(services: Services): Router {
  const { store } = services;
  const router = Router();

  // GET /api/holdings — the whole portfolio with live prices and rollups
  router.get('/', async (_req, res) => {
    const holdings = store.listHoldings();
    const symbols = holdings.map(h => h.symbol);
    const quotes = await fetchQuotes(symbols);
    res.json(buildSnapshot(holdings, quotes, quotes.size > 0));
  });

  // POST /api/holdings — add a holding
  router.post('/', (req, res) => {
    const input = readHoldingInput((req.body ?? {}) as Record<string, unknown>, store);
    if (!input.symbol) {
      return res.status(400).json({ error: 'A ticker symbol is required' });
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
