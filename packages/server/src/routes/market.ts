import { Router } from 'express';
import { MoversKind } from '@stashd/shared';
import { wrap } from '../middleware';
import {
  insiderActivity,
  marketMovers,
  marketPulse,
  popularEtfs,
  screenSector,
  searchSymbols,
  stockNews,
  stockProfile,
  SCREENER_SECTORS,
} from '../services/MarketService';

// Market discovery: ticker search and US discovery tables (sector screener,
// movers). Read-only, no store access — everything proxies the no-key public
// APIs in MarketService, which caches and never throws.
export function createMarketRoutes(): Router {
  const router = Router();

  // GET /api/market/search?q=appl — merged US + Canadian ticker suggestions.
  router.get('/search', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) return res.json([]);
    res.json(await searchSymbols(q));
  }));

  // GET /api/market/sectors — the valid sector tokens, in display order.
  router.get('/sectors', (_req, res) => {
    res.json(SCREENER_SECTORS);
  });

  // GET /api/market/screener?sector=technology&enrich=1 — top-of-sector stocks
  // (US); enrich adds P/E + analyst-target upside per row (the value screen).
  router.get('/screener', wrap(async (req, res) => {
    const sector = typeof req.query.sector === 'string' ? req.query.sector : '';
    const enrich = req.query.enrich === '1' || req.query.enrich === 'true';
    res.json(await screenSector(sector, 25, enrich));
  }));

  // GET /api/market/insiders/:symbol — insider open-market activity (US only;
  // null for Canadian listings and symbols without filings).
  router.get('/insiders/:symbol', wrap(async (req, res) => {
    const symbol = req.params.symbol.trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'A symbol is required' });
    res.json(await insiderActivity(symbol));
  }));

  // GET /api/market/movers?kind=active|gainers|losers|canada — today's movers
  // (US via Nasdaq; "canada" is the TSX most-active list via TMX).
  router.get('/movers', wrap(async (req, res) => {
    const kind = req.query.kind;
    const valid: MoversKind[] = ['active', 'gainers', 'losers', 'canada'];
    if (!valid.includes(kind as MoversKind)) {
      return res.status(400).json({ error: `kind must be one of ${valid.join(', ')}` });
    }
    res.json(await marketMovers(kind as MoversKind));
  }));

  // GET /api/market/pulse — index-proxy tiles (S&P 500 / Nasdaq / Dow / …).
  router.get('/pulse', wrap(async (_req, res) => {
    res.json(await marketPulse());
  }));

  // GET /api/market/etfs — the curated popular-ETFs shelf, priced live.
  router.get('/etfs', wrap(async (_req, res) => {
    res.json(await popularEtfs());
  }));

  // GET /api/market/profile/:symbol?ccy=CAD — fundamentals for one symbol.
  // The caller passes the resolved quote currency so bare Canadian symbols
  // (VFV) route to TMX rather than being asked of Nasdaq.
  router.get('/profile/:symbol', wrap(async (req, res) => {
    const symbol = req.params.symbol.trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'A symbol is required' });
    const canadian = typeof req.query.ccy === 'string' && req.query.ccy.toUpperCase() === 'CAD';
    res.json(await stockProfile(symbol, canadian));
  }));

  // GET /api/market/news/:symbol?ccy=CAD — recent headlines for one symbol.
  router.get('/news/:symbol', wrap(async (req, res) => {
    const symbol = req.params.symbol.trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'A symbol is required' });
    const canadian = typeof req.query.ccy === 'string' && req.query.ccy.toUpperCase() === 'CAD';
    res.json(await stockNews(symbol, canadian));
  }));

  return router;
}
