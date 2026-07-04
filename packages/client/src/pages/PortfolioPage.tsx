import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Paperclip, Plus, RefreshCw, TrendingUp, X } from 'lucide-react';
import { HoldingInput, HoldingWithQuote, PortfolioSnapshot, WatchlistItemWithQuote } from '@stashd/shared';
import { addWatchlist, createHolding, deleteHolding, getPortfolio, getWatchlist, removeWatchlist, updateHolding } from '../api';
import { useStore } from '../store';
import HoldingDialog from '../components/HoldingDialog';
import EmptyState from '../components/EmptyState';
import { formatMoney, formatMoneyCell, relTime } from '../lib/format';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'];
const BASE_KEY = 'stashd.portfolioBase';

// Signed money in a given currency, e.g. "+$1,240.00" / "−C$310.50".
function signedAmount(v: number | undefined, currency: string): string {
  if (v === undefined || v === null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(v), currency)}`;
}

function signedPct(v?: number): string {
  if (v === undefined || v === null) return '';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${(Math.abs(v) * 100).toFixed(2)}%`;
}

// Green for a gain, red for a loss, neutral for flat/unknown.
function gainClass(v?: number): string {
  if (v === undefined || v === null || v === 0) return '';
  return v > 0 ? 'gain-pos' : 'gain-neg';
}

export default function PortfolioPage() {
  const { notify } = useStore();
  const navigate = useNavigate();
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItemWithQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<HoldingWithQuote | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [watchSymbol, setWatchSymbol] = useState('');
  // The currency the totals are shown in; per-holding rows stay native.
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) || 'CAD');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [s, wl] = await Promise.all([getPortfolio(base), getWatchlist().catch(() => [])]);
      setSnap(s);
      setWatchlist(wl);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load portfolio', 'err');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify, base]);

  const openStock = (symbol: string) => navigate(`/portfolio/${encodeURIComponent(symbol)}`);

  async function addWatch() {
    const s = watchSymbol.trim().toUpperCase();
    if (!s) return;
    try {
      await addWatchlist({ symbol: s });
      setWatchSymbol('');
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

  useEffect(() => {
    load();
  }, [load]);

  function changeBase(next: string) {
    setBase(next);
    localStorage.setItem(BASE_KEY, next);
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

  if (loading) {
    return (
      <div className="page">
        <div className="loading-line">Pricing the portfolio…</div>
      </div>
    );
  }

  const holdings = snap?.holdings ?? [];
  const totals = snap?.totals;

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
            <label className="base-picker" title="Currency for the totals and chart">
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
          Track what you own, what you paid, and what it’s worth now. Current prices are fetched
          live from the market; leave a holding’s current price blank to auto-fetch, or set it by
          hand when you’d rather.
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
            <div className="stats rise rise-1" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <div className="stat" style={{ ['--accent' as never]: '#3b82f6' }}>
                <div className="num">{formatMoneyCell(totals.costBasis, base)}</div>
                <div className="lbl">Book cost</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: 'var(--wax)' }}>
                <div className="num">{formatMoneyCell(totals.marketValue, base)}</div>
                <div className="lbl">Market value</div>
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

          <div className="li-table-wrap rise rise-2">
            <table className="li-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num-col">Shares</th>
                  <th className="num-col">Avg cost</th>
                  <th className="num-col">Current</th>
                  <th className="num-col">Book cost</th>
                  <th className="num-col">Market value</th>
                  <th className="num-col">Weight</th>
                  <th className="num-col">Today</th>
                  <th className="num-col">Total return</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
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
                  <td colSpan={4}>
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
            <input
              className="input"
              value={watchSymbol}
              placeholder="Add a ticker (e.g. TSLA, SHOP.TO)"
              style={{ textTransform: 'uppercase' }}
              onChange={e => setWatchSymbol(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addWatch()}
            />
            <button className="btn btn-sm btn-primary" onClick={addWatch} disabled={!watchSymbol.trim()}>
              <Plus size={13} /> Watch
            </button>
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
                  <th className="num-col">Price</th>
                  <th className="num-col">Today</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map(w => (
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
                        {w.name && <span className="h-name">{w.name}</span>}
                      </div>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
