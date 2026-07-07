import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Quote, WatchlistItem, WatchlistItemWithQuote } from '@stashd/shared';
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

// Enrich each watched symbol with its live quote (native currency; no base/FX
// conversion — the watchlist shows each stock in its own currency).
function enrich(items: WatchlistItem[], quotes: Map<string, Quote>): WatchlistItemWithQuote[] {
  return items.map(item => {
    const quote = quotes.get(item.symbol.trim().toUpperCase());
    const dayChange = quote?.previousClose !== undefined ? quote.price - quote.previousClose : undefined;
    return {
      ...item,
      currentPrice: quote?.price,
      previousClose: quote?.previousClose,
      currency: quote?.currency,
      dayChange,
      dayChangePct: dayChange !== undefined && quote?.previousClose ? dayChange / quote.previousClose : undefined,
      priceSource: quote ? 'live' : 'none',
    };
  });
}

export function createWatchlistRoutes(services: Services): Router {
  const { store } = services;
  const router = Router();

  // GET /api/watchlist — watched symbols enriched with live quotes
  router.get('/', async (_req, res) => {
    const items = store.listWatchlist();
    const quotes = await fetchQuotes(items.map(i => i.symbol));
    res.json(enrich(items, quotes));
  });

  // POST /api/watchlist — add a symbol (idempotent: returns the existing item)
  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const symbol = cleanText(body.symbol)?.toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'A ticker symbol is required' });

    const existing = store.findWatchlistBySymbol(symbol);
    if (existing) return res.status(200).json(existing);

    const item: WatchlistItem = {
      id: uuidv4(),
      symbol,
      name: cleanText(body.name),
      notes: cleanText(body.notes),
      folder: cleanText(body.folder),
      createdAt: new Date().toISOString(),
    };
    store.addWatchlistItem(item);
    res.status(201).json(item);
  });

  // PATCH /api/watchlist/:id — edit name / thesis notes / folder. A supplied
  // empty string clears the field; omitted fields are untouched.
  router.patch('/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const input: { name?: string; notes?: string; folder?: string } = {};
    if (has('name')) input.name = cleanText(body.name) ?? '';
    if (has('notes')) input.notes = cleanText(body.notes) ?? '';
    if (has('folder')) input.folder = cleanText(body.folder) ?? '';
    const updated = store.updateWatchlistItem(req.params.id, input);
    if (!updated) return res.status(404).json({ error: 'Watchlist item not found' });
    res.json(updated);
  });

  // DELETE /api/watchlist/:id
  router.delete('/:id', (req, res) => {
    if (!store.removeWatchlistItem(req.params.id)) {
      return res.status(404).json({ error: 'Watchlist item not found' });
    }
    res.status(204).end();
  });

  return router;
}
