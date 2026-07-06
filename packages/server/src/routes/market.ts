import { Router } from 'express';
import { MoversKind } from '@stashd/shared';
import { marketMovers, screenSector, searchSymbols, SCREENER_SECTORS } from '../services/MarketService';

// Market discovery: ticker search and US discovery tables (sector screener,
// movers). Read-only, no store access — everything proxies the no-key public
// APIs in MarketService, which caches and never throws.
export function createMarketRoutes(): Router {
  const router = Router();

  // GET /api/market/search?q=appl — merged US + Canadian ticker suggestions.
  router.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) return res.json([]);
    res.json(await searchSymbols(q));
  });

  // GET /api/market/sectors — the valid sector tokens, in display order.
  router.get('/sectors', (_req, res) => {
    res.json(SCREENER_SECTORS);
  });

  // GET /api/market/screener?sector=technology — top-of-sector stocks (US).
  router.get('/screener', async (req, res) => {
    const sector = typeof req.query.sector === 'string' ? req.query.sector : '';
    res.json(await screenSector(sector));
  });

  // GET /api/market/movers?kind=active|gainers|losers — today's movers (US).
  router.get('/movers', async (req, res) => {
    const kind = req.query.kind;
    const valid: MoversKind[] = ['active', 'gainers', 'losers'];
    if (!valid.includes(kind as MoversKind)) {
      return res.status(400).json({ error: `kind must be one of ${valid.join(', ')}` });
    }
    res.json(await marketMovers(kind as MoversKind));
  });

  return router;
}
