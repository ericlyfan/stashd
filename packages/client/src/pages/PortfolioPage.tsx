import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Coins, Compass, Eye, Paperclip, Pencil, PieChart, Plus, RefreshCw, StickyNote, TrendingUp, X } from 'lucide-react';
import { HoldingInput, HoldingWithQuote, PortfolioHealth, PortfolioSnapshot, ScreenerRow, WatchlistItemWithQuote } from '@stashd/shared';
import {
  addWatchlist,
  createHolding,
  deleteHolding,
  getPortfolio,
  getPortfolioHealth,
  getWatchlist,
  removeWatchlist,
  updateHolding,
  updateWatchlist,
} from '../api';
import { useStore } from '../store';
import HoldingDialog from '../components/HoldingDialog';
import EmptyState from '../components/EmptyState';
import Breakdown, { BreakdownRow } from '../components/Breakdown';
import Sparkline from '../components/Sparkline';
import TickerSearch from '../components/TickerSearch';
import MarketExplorer from '../components/MarketExplorer';
import RiskPanel from '../components/RiskPanel';
import WatchlistDialog from '../components/WatchlistDialog';
import { useTrends } from '../lib/trends';
import { formatMoney, formatMoneyCell, relTime } from '../lib/format';
import { gainClass, signedAmount, signedPct } from '../lib/gains';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'];
const BASE_KEY = 'stashd.portfolioBase';

// Allocation-segment hues: a fixed, CVD-validated ordering drawn from the
// app's shared COLOR_PALETTE (the raw cycle fails adjacent-pair separation).
// The tail past 8 holdings folds into a gray "Other" — never a 9th hue.
const ALLOC_COLORS = ['#6366f1', '#f59e0b', '#0d9488', '#ef4444', '#3b82f6', '#ec4899', '#10b981', '#f97316'];
const OTHER_COLOR = '#64748b';
const ALLOC_MAX = 8;

// ── Holdings-table sorting ───────────────────────────────────────────────────
// Cross-currency columns sort on the base-converted / percentage figure so a
// mixed CAD+USD table orders sensibly; single-holding figures sort natively.
type SortKey = 'symbol' | 'shares' | 'avgCost' | 'price' | 'costBasis' | 'value' | 'weight' | 'day' | 'return';

function sortValue(h: HoldingWithQuote, k: SortKey): string | number | undefined {
  switch (k) {
    case 'symbol': return h.symbol;
    case 'shares': return h.shares;
    case 'avgCost': return h.avgCost;
    case 'price': return h.currentPrice;
    case 'costBasis': return h.costBasis * h.fxToBase;
    case 'value': return h.marketValueBase;
    case 'weight': return h.weight;
    case 'day': return h.dayChangePct;
    case 'return': return h.totalReturnPct;
  }
}

function compareHoldings(a: HoldingWithQuote, b: HoldingWithQuote, key: SortKey, dir: 1 | -1): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va === undefined && vb === undefined) return a.symbol.localeCompare(b.symbol);
  if (va === undefined) return 1; // unknowns sink to the bottom either way
  if (vb === undefined) return -1;
  const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
  return cmp * dir;
}

function SortTh({
  label, k, sort, onSort, numeric,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={numeric ? 'num-col' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className={`th-sort${active ? ' active' : ''}`} onClick={() => onSort(k)}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}

export default function PortfolioPage() {
  const { notify } = useStore();
  const navigate = useNavigate();
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItemWithQuote[]>([]);
  const [health, setHealth] = useState<PortfolioHealth | null>(null);
  const [editingWatch, setEditingWatch] = useState<WatchlistItemWithQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<HoldingWithQuote | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // The currency the totals are shown in; per-holding rows stay native.
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) || 'CAD');
  // Symbol keys, not display order: money columns open biggest-first.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [s, wl] = await Promise.all([getPortfolio(base), getWatchlist().catch(() => [])]);
      setSnap(s);
      setWatchlist(wl);
      // The risk report crunches a year of closes per holding server-side —
      // fetched behind the fold so it never delays the tables.
      if (s.holdings.length >= 2) void getPortfolioHealth(base).then(setHealth).catch(() => {});
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load portfolio', 'err');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify, base]);

  const openStock = (symbol: string) => navigate(`/portfolio/${encodeURIComponent(symbol)}`);

  async function addWatch(symbol: string, name?: string) {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    try {
      await addWatchlist({ symbol: s, name });
      notify(`Watching ${s}`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add to watchlist', 'err');
    }
  }

  async function removeWatch(id: string) {
    try {
      await removeWatchlist(id);
      setWatchlist(w => w.filter(i => i.id !== id));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove', 'err');
    }
  }

  // Watch/unwatch from the embedded Discover table; the watchlist section
  // above shares the same state, so it updates in step.
  async function toggleWatchRow(row: ScreenerRow, watched: boolean) {
    const rowSym = row.symbol.trim().toUpperCase();
    if (watched) {
      const existing = watchlist.find(w => w.symbol.trim().toUpperCase() === rowSym);
      if (!existing) return;
      await removeWatch(existing.id);
      notify(`Stopped watching ${rowSym}`);
    } else {
      await addWatch(rowSym, row.name);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  function changeBase(next: string) {
    setBase(next);
    localStorage.setItem(BASE_KEY, next);
  }

  function toggleSort(key: SortKey) {
    setSort(cur =>
      cur.key === key
        ? { key, dir: cur.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'symbol' ? 1 : -1 },
    );
  }

  async function save(input: HoldingInput) {
    setBusy(true);
    try {
      if (editing) await updateHolding(editing.id, input);
      else await createHolding(input);
      await load();
      setEditing(null);
      setAdding(false);
      notify(editing ? 'Holding updated' : 'Holding added');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save holding', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteHolding(editing.id);
      await load();
      setEditing(null);
      notify('Holding removed');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove holding', 'err');
    } finally {
      setBusy(false);
    }
  }

  const holdings = snap?.holdings ?? [];
  const totals = snap?.totals;

  const sorted = useMemo(
    () => [...holdings].sort((a, b) => compareHoldings(a, b, sort.key, sort.dir)),
    [holdings, sort],
  );

  // 30-day sparklines for every visible symbol, fetched lazily after render.
  const trendSymbols = useMemo(
    () => [...holdings.map(h => h.symbol), ...watchlist.map(w => w.symbol)],
    [holdings, watchlist],
  );
  const trends = useTrends(trendSymbols);

  const watchedSymbols = useMemo(
    () => new Set(watchlist.map(w => w.symbol.trim().toUpperCase())),
    [watchlist],
  );

  // Watchlist grouped by folder (alphabetical; unfiled last). Folder header
  // rows only render once at least one real folder exists.
  const watchGroups = useMemo(() => {
    const m = new Map<string, WatchlistItemWithQuote[]>();
    for (const w of watchlist) {
      const f = w.folder?.trim() ?? '';
      if (!m.has(f)) m.set(f, []);
      m.get(f)!.push(w);
    }
    return [...m.entries()].sort((a, b) =>
      a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0]),
    );
  }, [watchlist]);
  const watchFolders = useMemo(
    () => watchGroups.map(([f]) => f).filter(f => f !== ''),
    [watchGroups],
  );

  async function saveWatchEdit(values: { folder: string; notes: string }) {
    if (!editingWatch) return;
    setBusy(true);
    try {
      const updated = await updateWatchlist(editingWatch.id, values);
      setWatchlist(w => w.map(i => (i.id === updated.id ? { ...i, ...updated } : i)));
      setEditingWatch(null);
      notify(`Updated ${updated.symbol}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update', 'err');
    } finally {
      setBusy(false);
    }
  }

  // Allocation: priced holdings by base market value, top slices + a gray
  // "Other" fold (never more than 8 hues), plus a by-currency cut when the
  // portfolio actually spans currencies.
  const allocation = useMemo(() => {
    const priced = holdings
      .filter(h => (h.marketValueBase ?? 0) > 0)
      .sort((a, b) => b.marketValueBase! - a.marketValueBase!);
    const total = priced.reduce((s, h) => s + h.marketValueBase!, 0);

    const top = priced.slice(0, ALLOC_MAX);
    const rest = priced.slice(ALLOC_MAX);
    const byHolding: BreakdownRow[] = top.map(h => ({
      id: h.symbol,
      label: h.symbol,
      sub: h.name,
      total: h.marketValueBase!,
    }));
    if (rest.length > 0) {
      byHolding.push({
        label: `Other (${rest.length})`,
        total: rest.reduce((s, h) => s + h.marketValueBase!, 0),
        color: OTHER_COLOR,
      });
    }

    const ccyMap = new Map<string, number>();
    for (const h of priced) ccyMap.set(h.currency, (ccyMap.get(h.currency) ?? 0) + h.marketValueBase!);
    const byCurrency: BreakdownRow[] = [...ccyMap.entries()]
      .map(([label, tot]) => ({ label, total: tot }))
      .sort((a, b) => b.total - a.total);

    return { byHolding, byCurrency, total, pricedCount: priced.length };
  }, [holdings]);

  const [allocTab, setAllocTab] = useState<'holding' | 'currency'>('holding');
  const showCurrencyTab = allocation.byCurrency.length > 1;
  const activeAllocTab = allocTab === 'currency' && showCurrencyTab ? 'currency' : 'holding';

  if (loading) {
    return (
      <div className="page">
        <div className="loading-line">Pricing the portfolio…</div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <header className="page-head rise">
        <div className="page-eyebrow">
          <TrendingUp size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
          Portfolio
        </div>
        <div className="page-title-row">
          <h1 className="page-title">Stock <em>holdings</em></h1>
          <div style={{ flex: 1 }} />
          {holdings.length > 0 && (
            <label className="base-picker" title="Currency for the totals and allocation">
              <span>Base</span>
              <select value={base} onChange={e => changeBase(e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {holdings.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => load(true)} disabled={refreshing} title="Refresh prices">
              <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
              {refreshing ? 'Pricing…' : 'Refresh'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add holding
          </button>
        </div>
        <p className="page-sub">
          What you own, what you paid, and what it’s worth now — priced live from the market, with
          totals in your base currency.
        </p>
      </header>

      {holdings.length === 0 ? (
        <div className="rise rise-1">
          <EmptyState
            icon={TrendingUp}
            title="No holdings yet"
            subtitle="Add a stock — its ticker, how many shares, and what you paid — and its live value and gain fill in."
          >
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add holding
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {totals && (
            <div className="stats portfolio-stats rise rise-1" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="stat" style={{ ['--accent' as never]: 'var(--wax)' }}>
                <div className="num">{formatMoneyCell(totals.marketValue, base)}</div>
                <div className="lbl">
                  Market value · {base}
                  {totals.pricedCount < totals.holdingCount && (
                    <span className="stat-sub">{totals.pricedCount}/{totals.holdingCount} priced</span>
                  )}
                </div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: totals.dayChange >= 0 ? 'var(--moss)' : '#c0392b' }}>
                <div className={`num ${gainClass(totals.dayChange)}`}>{signedAmount(totals.dayChange, base)}</div>
                <div className="lbl">Today {totals.dayChange !== 0 && <span className="stat-sub">{signedPct(totals.dayChangePct)}</span>}</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: totals.totalGain >= 0 ? 'var(--moss)' : '#c0392b' }}>
                <div className={`num ${gainClass(totals.totalGain)}`}>{signedAmount(totals.totalGain, base)}</div>
                <div className="lbl">
                  Total return <span className="stat-sub">{signedPct(totals.totalReturnPct)}</span>
                  {totals.realizedGain !== 0 && (
                    <span className="stat-sub"> · {signedAmount(totals.realizedGain, base)} realized</span>
                  )}
                </div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: '#3b82f6' }}>
                <div className="num">{formatMoneyCell(totals.costBasis, base)}</div>
                <div className="lbl">Book cost</div>
              </div>
            </div>
          )}

          {snap && !snap.quotesLive && (
            <div className="portfolio-note rise rise-1">
              Live prices are unavailable right now — showing manually-entered prices where set, and
              leaving the rest unpriced. Prices resume automatically when the market data source is
              reachable.
            </div>
          )}

          {snap && snap.quotesLive && !snap.fxLive && (
            <div className="portfolio-note rise rise-1">
              Live exchange rates are unavailable, so amounts in other currencies aren’t converted to
              {' '}{base} right now. Totals resume converting when the FX source is reachable.
            </div>
          )}

          {allocation.pricedCount >= 2 && (
            <div className="breakdown breakdown-panel alloc rise rise-2">
              <div className="breakdown-tabs">
                <div className="breakdown-tablist" role="tablist">
                  <button
                    role="tab"
                    aria-selected={activeAllocTab === 'holding'}
                    className={`breakdown-tab${activeAllocTab === 'holding' ? ' active' : ''}`}
                    onClick={() => setAllocTab('holding')}
                  >
                    <PieChart size={12} />
                    Allocation
                  </button>
                  {showCurrencyTab && (
                    <button
                      role="tab"
                      aria-selected={activeAllocTab === 'currency'}
                      className={`breakdown-tab${activeAllocTab === 'currency' ? ' active' : ''}`}
                      onClick={() => setAllocTab('currency')}
                    >
                      <Coins size={12} />
                      By currency
                    </button>
                  )}
                </div>
                <span className="breakdown-total">{formatMoney(allocation.total, base)}</span>
              </div>
              <Breakdown
                rows={activeAllocTab === 'currency' ? allocation.byCurrency : allocation.byHolding}
                grandTotal={allocation.total}
                formatValue={v => formatMoney(v, base)}
                colors={ALLOC_COLORS}
                onRowClick={activeAllocTab === 'holding' ? row => row.id && openStock(row.id) : undefined}
              />
              {totals && totals.pricedCount < totals.holdingCount && (
                <div className="alloc-note">
                  {totals.holdingCount - totals.pricedCount} unpriced {totals.holdingCount - totals.pricedCount === 1 ? 'holding isn’t' : 'holdings aren’t'} included.
                </div>
              )}
            </div>
          )}

          <div className="li-table-wrap rise rise-2">
            <table className="li-table holdings-table">
              <thead>
                <tr>
                  <SortTh label="Symbol" k="symbol" sort={sort} onSort={toggleSort} />
                  <SortTh label="Shares" k="shares" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Avg cost" k="avgCost" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Current" k="price" sort={sort} onSort={toggleSort} numeric />
                  <th className="spark-col">30d</th>
                  <SortTh label="Book cost" k="costBasis" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Market value" k="value" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Weight" k="weight" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Today" k="day" sort={sort} onSort={toggleSort} numeric />
                  <SortTh label="Total return" k="return" sort={sort} onSort={toggleSort} numeric />
                </tr>
              </thead>
              <tbody>
                {sorted.map(h => (
                  <tr
                    key={h.id}
                    onClick={() => openStock(h.symbol)}
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openStock(h.symbol))}
                  >
                    <td>
                      <div className="h-sym">
                        {h.documentId && (
                          <Link
                            to={`/doc/${h.documentId}`}
                            className="li-clip"
                            title="Linked document"
                            onClick={e => e.stopPropagation()}
                          >
                            <Paperclip size={12} />
                          </Link>
                        )}
                        <span className="h-ticker">{h.symbol}</span>
                        <span className="h-ccy" title={`Priced in ${h.currency}`}>{h.currency}</span>
                        {h.lotCount > 0 && (
                          <span className="h-lots" title={`${h.lotCount} transaction${h.lotCount === 1 ? '' : 's'}`}>
                            {h.lotCount} {h.lotCount === 1 ? 'lot' : 'lots'}
                          </span>
                        )}
                        {h.name && <span className="h-name">{h.name}</span>}
                      </div>
                    </td>
                    <td className="num-col">{+h.shares.toFixed(4)}</td>
                    <td className="num-col">{formatMoneyCell(h.avgCost, h.currency)}</td>
                    <td className="num-col">
                      {h.currentPrice !== undefined ? (
                        <span className="h-price">
                          {formatMoney(h.currentPrice, h.currency)}
                          {h.priceSource === 'manual' && <span className="h-price-tag" title="Manually entered price">manual</span>}
                        </span>
                      ) : (
                        <span className="li-empty">—</span>
                      )}
                    </td>
                    <td className="spark-col">
                      <Sparkline points={trends.get(h.symbol.trim().toUpperCase())} />
                    </td>
                    <td className="num-col">{formatMoneyCell(h.costBasis, h.currency)}</td>
                    <td className="num-col">{h.marketValue !== undefined ? formatMoney(h.marketValue, h.currency) : <span className="li-empty">—</span>}</td>
                    <td className="num-col">{h.weight !== undefined ? `${(h.weight * 100).toFixed(1)}%` : <span className="li-empty">—</span>}</td>
                    <td className={`num-col ${gainClass(h.dayChange)}`}>
                      {h.dayChange !== undefined ? (
                        <>
                          {signedAmount(h.dayChange, h.currency)}
                          <span className="h-sub">{signedPct(h.dayChangePct)}</span>
                        </>
                      ) : (
                        <span className="li-empty">—</span>
                      )}
                    </td>
                    <td className={`num-col ${gainClass(h.totalGain)}`}>
                      {h.totalGain !== undefined ? (
                        <>
                          {signedAmount(h.totalGain, h.currency)}
                          <span className="h-sub">{signedPct(h.totalReturnPct)}</span>
                        </>
                      ) : (
                        <span className="li-empty">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    {holdings.length} {holdings.length === 1 ? 'holding' : 'holdings'}
                    <span className="tf-base" title="Totals converted to your base currency">· in {base}</span>
                  </td>
                  <td className="num-col">{totals ? formatMoney(totals.costBasis, base) : ''}</td>
                  <td className="num-col">{totals ? formatMoney(totals.marketValue, base) : ''}</td>
                  <td className="num-col">{totals && totals.marketValue > 0 ? '100%' : ''}</td>
                  <td className={`num-col ${gainClass(totals?.dayChange)}`}>{signedAmount(totals?.dayChange, base)}</td>
                  <td className={`num-col ${gainClass(totals?.totalGain)}`}>{signedAmount(totals?.totalGain, base)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {snap && (
            <div className="portfolio-asof">
              Prices as of {relTime(snap.quotedAt)}
              {totals && totals.pricedCount < totals.holdingCount && (
                <> · {totals.holdingCount - totals.pricedCount} unpriced</>
              )}
            </div>
          )}

          {health && health.holdings.length >= 2 && (
            <section className="risk-section rise rise-3">
              <RiskPanel health={health} />
            </section>
          )}
        </>
      )}

      {/* Watchlist — stocks you're following but don't (necessarily) own. */}
      <section className="watchlist rise rise-3">
        <div className="watchlist-head">
          <div className="page-eyebrow" style={{ margin: 0 }}>
            <Eye size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
            Watchlist
          </div>
          <div className="watchlist-add">
            <TickerSearch
              placeholder="Search a ticker or company to watch…"
              onSelect={s => addWatch(s.symbol, s.name)}
              onSubmitRaw={sym => addWatch(sym)}
            />
          </div>
        </div>

        {watchlist.length === 0 ? (
          <p className="watchlist-empty">
            Nothing on your watchlist yet. Add a ticker above to follow its price; click it to see its history.
          </p>
        ) : (
          <div className="li-table-wrap">
            <table className="li-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="spark-col">30d</th>
                  <th className="num-col">Price</th>
                  <th className="num-col">Today</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {watchGroups.map(([folder, items]) => (
                  <Fragment key={folder || '(unfiled)'}>
                    {watchFolders.length > 0 && (
                      <tr className="wl-folder-row">
                        <td colSpan={5}>
                          {folder || 'Unfiled'}
                          <span className="wl-folder-count">{items.length}</span>
                        </td>
                      </tr>
                    )}
                    {items.map(w => (
                      <tr
                        key={w.id}
                        onClick={() => openStock(w.symbol)}
                        tabIndex={0}
                        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openStock(w.symbol))}
                      >
                        <td>
                          <div className="h-sym">
                            <span className="h-ticker">{w.symbol}</span>
                            {w.currency && <span className="h-ccy">{w.currency}</span>}
                            {w.notes && (
                              <span className="wl-thesis" title={w.notes}>
                                <StickyNote size={11} />
                              </span>
                            )}
                            {w.name && <span className="h-name">{w.name}</span>}
                          </div>
                        </td>
                        <td className="spark-col">
                          <Sparkline points={trends.get(w.symbol.trim().toUpperCase())} />
                        </td>
                        <td className="num-col">
                          {w.currentPrice !== undefined ? formatMoney(w.currentPrice, w.currency ?? 'USD') : <span className="li-empty">—</span>}
                        </td>
                        <td className={`num-col ${gainClass(w.dayChange)}`}>
                          {w.dayChange !== undefined ? (
                            <>
                              {signedAmount(w.dayChange, w.currency ?? 'USD')}
                              <span className="h-sub">{signedPct(w.dayChangePct)}</span>
                            </>
                          ) : (
                            <span className="li-empty">—</span>
                          )}
                        </td>
                        <td className="num-col">
                          <div className="wl-actions">
                            <button
                              className="watchlist-x"
                              title="Folder & thesis note"
                              aria-label="Edit watch entry"
                              onClick={e => {
                                e.stopPropagation();
                                setEditingWatch(w);
                              }}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              className="watchlist-x"
                              title="Remove from watchlist"
                              aria-label="Remove"
                              onClick={e => {
                                e.stopPropagation();
                                removeWatch(w.id);
                              }}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Discover — research beyond what you own, right here on the portfolio:
          look up any ticker, browse today's movers or a sector's biggest names. */}
      <section className="discover-embed rise rise-3">
        <div className="watchlist-head">
          <div className="page-eyebrow" style={{ margin: 0 }}>
            <Compass size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
            Discover
          </div>
          <TickerSearch
            placeholder="Look up any ticker or company…"
            onSelect={s => openStock(s.symbol)}
            onSubmitRaw={openStock}
          />
        </div>
        <MarketExplorer
          watchedSymbols={watchedSymbols}
          onToggleWatch={toggleWatchRow}
          onOpenStock={openStock}
        />
      </section>

      {editingWatch && (
        <WatchlistDialog
          item={editingWatch}
          folders={watchFolders}
          busy={busy}
          onSave={saveWatchEdit}
          onClose={() => setEditingWatch(null)}
        />
      )}

      {(adding || editing) && (
        <HoldingDialog
          holding={editing ?? undefined}
          busy={busy}
          onSave={save}
          onDelete={editing ? remove : undefined}
          onLotsChanged={() => load()}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
