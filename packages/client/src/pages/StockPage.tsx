import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, FileText, Newspaper, Pencil, Plus, TrendingUp } from 'lucide-react';
import {
  HistoryDay,
  HoldingInput,
  HoldingLot,
  HoldingWithQuote,
  InsiderActivity,
  NewsItem,
  StockHistory,
  StockProfile,
  WatchlistItemWithQuote,
} from '@stashd/shared';
import {
  addWatchlist,
  createHolding,
  deleteHolding,
  getInsiderActivity,
  getPortfolio,
  getStockHistory,
  getStockNews,
  getStockProfile,
  getWatchlist,
  listLots,
  removeWatchlist,
  updateHolding,
} from '../api';
import { useStore } from '../store';
import HoldingDialog from '../components/HoldingDialog';
import StockHistoryChart from '../components/StockHistoryChart';
import { formatCompact, formatDate, formatMoney, formatMoneyCell, relTime } from '../lib/format';
import { gainClass, signedAmount, signedPct } from '../lib/gains';
import { buildSignal, VERDICT_LABEL } from '../lib/signals';

// Period returns computed from the daily closes: last close vs the first close
// inside each window. Undefined when the window has no earlier data (e.g. a
// 1Y return on six months of history).
const PERIODS: { id: string; label: string; days?: number; ytd?: boolean }[] = [
  { id: '1w', label: '1W', days: 7 },
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 91 },
  { id: '6m', label: '6M', days: 182 },
  { id: 'ytd', label: 'YTD', ytd: true },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: Infinity },
];

function periodReturns(points: HistoryDay[]): { label: string; value?: number }[] {
  if (points.length < 2) return PERIODS.map(p => ({ label: p.label }));
  const last = points[points.length - 1].close;
  const firstDate = points[0].date;
  return PERIODS.map(p => {
    let cutoff: string;
    if (p.ytd) cutoff = `${new Date().getFullYear()}-01-01`;
    else if (p.days === Infinity) cutoff = firstDate;
    else {
      cutoff = new Date(Date.now() - p.days! * 86_400_000).toISOString().slice(0, 10);
    }
    // Baseline: the first close inside the window.
    const base = points.find(pt => pt.date >= cutoff);
    // A window that only contains the last point (or starts before our data
    // does, for finite windows) can't produce an honest return.
    if (!base || base === points[points.length - 1]) return { label: p.label };
    if (p.days !== Infinity && !p.ytd && firstDate > cutoff) return { label: p.label };
    return { label: p.label, value: base.close > 0 ? last / base.close - 1 : undefined };
  });
}

// 52-week high/low from the closes (plus where today sits inside that range).
function yearRange(points: HistoryDay[], current?: number) {
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const window = points.filter(p => p.date >= cutoff).map(p => p.close);
  if (current !== undefined) window.push(current);
  if (window.length < 2) return null;
  const lo = Math.min(...window);
  const hi = Math.max(...window);
  const pos = current !== undefined && hi > lo ? (current - lo) / (hi - lo) : undefined;
  return { lo, hi, pos };
}

export default function StockPage() {
  const { symbol = '' } = useParams();
  const { notify } = useStore();
  const sym = symbol.toUpperCase();

  const [history, setHistory] = useState<StockHistory | null>(null);
  const [holding, setHolding] = useState<HoldingWithQuote | null>(null);
  const [watch, setWatch] = useState<WatchlistItemWithQuote | null>(null);
  const [lots, setLots] = useState<HoldingLot[]>([]);
  const [profile, setProfile] = useState<StockProfile | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [insiders, setInsiders] = useState<InsiderActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [hist, snap, wl] = await Promise.all([
        getStockHistory(sym),
        getPortfolio().catch(() => null),
        getWatchlist().catch(() => []),
      ]);
      setHistory(hist);
      const h = snap?.holdings.find(x => x.symbol.trim().toUpperCase() === sym) ?? null;
      setHolding(h);
      setWatch(wl.find(w => w.symbol.trim().toUpperCase() === sym) ?? null);
      setLots(h && h.lotCount > 0 ? await listLots(h.id).catch(() => []) : []);
      // Fundamentals + headlines ride behind the fold; fetched after the
      // quote resolves (its currency routes bare Canadian symbols to TMX)
      // and never block the page.
      void getStockProfile(sym, hist.currency).then(setProfile).catch(() => {});
      void getStockNews(sym, hist.currency).then(setNews).catch(() => {});
      void getInsiderActivity(sym).then(setInsiders).catch(() => {});
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load stock', 'err');
    } finally {
      setLoading(false);
    }
  }, [sym, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveHolding(input: HoldingInput) {
    setBusy(true);
    try {
      if (holding) await updateHolding(holding.id, input);
      else await createHolding(input);
      await load();
      setEditing(false);
      setAdding(false);
      notify(holding ? 'Holding updated' : 'Holding added');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save holding', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function removeHolding() {
    if (!holding) return;
    setBusy(true);
    try {
      await deleteHolding(holding.id);
      await load();
      setEditing(false);
      notify('Holding removed');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove holding', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function toggleWatch() {
    try {
      if (watch) {
        await removeWatchlist(watch.id);
        notify('Removed from watchlist');
      } else {
        await addWatchlist({ symbol: sym, name: holding?.name });
        notify('Added to watchlist');
      }
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update watchlist', 'err');
    }
  }

  const points = history?.points ?? [];
  const returns = useMemo(() => periodReturns(points), [points]);
  const range52 = useMemo(() => yearRange(points, history?.currentPrice), [points, history?.currentPrice]);
  const signal = useMemo(
    () => buildSignal(points, history?.currentPrice, profile?.oneYearTarget),
    [points, history?.currentPrice, profile?.oneYearTarget],
  );

  if (loading) {
    return (
      <div className="page">
        <div className="loading-line">Pricing {sym}…</div>
      </div>
    );
  }

  const ccy = history?.currency ?? holding?.currency ?? 'USD';
  const name = holding?.name ?? watch?.name;
  const price = history?.currentPrice;
  const dayChange = history?.dayChange;

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <Link to="/portfolio" className="back-link">
        <ArrowLeft size={13} /> Portfolio
      </Link>

      <header className="page-head rise stock-head">
        <div>
          <div className="page-eyebrow">
            <TrendingUp size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
            {holding ? 'Holding' : watch ? 'Watching' : 'Stock'}
          </div>
          <h1 className="page-title">
            <span className="stock-ticker">{sym}</span>
            <span className="h-ccy" title={`Priced in ${ccy}`}>{ccy}</span>
          </h1>
          {(name || profile) && (
            <p className="page-sub" style={{ margin: 0 }}>
              {name}
              {profile && (profile.sector || profile.exchange) && (
                <span className="stock-sub-meta">
                  {[profile.sector, profile.industry, profile.exchange].filter(Boolean).join(' · ')}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="stock-price">
          {price !== undefined ? (
            <>
              <div className="stock-price-now">{formatMoney(price, ccy)}</div>
              {dayChange !== undefined && (
                <div className={`stock-price-day ${gainClass(dayChange)}`}>
                  {signedAmount(dayChange, ccy)} ({signedPct(history?.dayChangePct)}) today
                </div>
              )}
              {history?.priceSource === 'manual' && (
                <div className="stock-price-src">manually-entered price</div>
              )}
            </>
          ) : (
            <div className="stock-price-now li-empty">Unpriced</div>
          )}
        </div>
      </header>

      <div className="stock-grid rise rise-1">
        <div className="stock-main">
          {history && <StockHistoryChart points={history.points} currency={ccy} />}

          {/* Period returns strip under the chart — every window at a glance. */}
          <div className="stock-returns">
            {returns.map(r => (
              <div key={r.label} className="stock-return">
                <div className={`sr-val ${gainClass(r.value)}`}>{r.value !== undefined ? signedPct(r.value) : '—'}</div>
                <div className="sr-lbl">{r.label}</div>
              </div>
            ))}
          </div>

          {lots.length > 0 && (
            <section className="stock-card stock-lots">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Transactions</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> Manage
                </button>
              </div>
              <div className="li-table-wrap">
                <table className="li-table stock-lots-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="num-col">Shares</th>
                      <th className="num-col">Price</th>
                      <th className="num-col">Fee</th>
                      <th className="num-col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map(l => (
                      <tr key={l.id} className="stock-lot-row">
                        <td>{formatDate(l.date)}</td>
                        <td><span className={`lot-type lot-type-${l.type}`}>{l.type}</span></td>
                        <td className="num-col">{+l.shares.toFixed(4)}</td>
                        <td className="num-col">{formatMoney(l.price, ccy)}</td>
                        <td className="num-col">{l.fee ? formatMoney(l.fee, ccy) : <span className="li-empty">—</span>}</td>
                        <td className="num-col">
                          {formatMoney(l.shares * l.price + (l.type === 'buy' ? l.fee ?? 0 : -(l.fee ?? 0)), ccy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {news.length > 0 && (
            <section className="stock-card stock-news">
              <div className="stock-card-head">
                <h2 className="stock-card-title">
                  <Newspaper size={11} style={{ verticalAlign: '-1.5px', marginRight: 6 }} />
                  Recent news
                </h2>
              </div>
              <ul className="news-list">
                {news.map((n, i) => (
                  <li key={i} className="news-item">
                    <span
                      className={`news-tone news-tone-${n.sentiment ?? 'neu'}`}
                      title={n.sentiment === 'pos' ? 'Positive-leaning headline' : n.sentiment === 'neg' ? 'Negative-leaning headline' : 'Neutral headline'}
                    />
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noreferrer" className="news-title">{n.title}</a>
                    ) : (
                      <span className="news-title">{n.title}</span>
                    )}
                    <span className="news-meta">
                      {[n.source, n.publishedAt ? relTime(n.publishedAt) : undefined].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="stock-rail">
          {holding ? (
            <section className="stock-card">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Your position</h2>
                {holding.weight !== undefined && (
                  <span className="stock-weight">{(holding.weight * 100).toFixed(1)}% of portfolio</span>
                )}
              </div>
              <dl className="stock-facts">
                <div><dt>Shares</dt><dd>{+holding.shares.toFixed(4)}</dd></div>
                <div><dt>Avg cost</dt><dd>{formatMoneyCell(holding.avgCost, ccy)}</dd></div>
                <div><dt>Book cost</dt><dd>{formatMoneyCell(holding.costBasis, ccy)}</dd></div>
                <div><dt>Market value</dt><dd>{formatMoneyCell(holding.marketValue, ccy)}</dd></div>
                <div>
                  <dt>Unrealized</dt>
                  <dd className={gainClass(holding.gain)}>
                    {signedAmount(holding.gain, ccy)}
                    {holding.gainPct !== undefined && <span className="sf-sub">{signedPct(holding.gainPct)}</span>}
                  </dd>
                </div>
                {holding.realizedGain !== 0 && (
                  <div><dt>Realized</dt><dd className={gainClass(holding.realizedGain)}>{signedAmount(holding.realizedGain, ccy)}</dd></div>
                )}
                <div className="sf-total">
                  <dt>Total return</dt>
                  <dd className={gainClass(holding.totalGain)}>
                    {signedAmount(holding.totalGain, ccy)}
                    {holding.totalReturnPct !== undefined && <span className="sf-sub">{signedPct(holding.totalReturnPct)}</span>}
                  </dd>
                </div>
              </dl>
              <div className="stock-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit holding
                </button>
                <button className="btn btn-ghost btn-sm" onClick={toggleWatch}>
                  {watch ? <><EyeOff size={13} /> Unwatch</> : <><Eye size={13} /> Watch</>}
                </button>
              </div>
              {holding.documentId && (
                <Link to={`/doc/${holding.documentId}`} className="stock-doc-link">
                  <FileText size={12} /> Supporting document
                </Link>
              )}
              {holding.notes && <p className="stock-notes">{holding.notes}</p>}
            </section>
          ) : (
            <section className="stock-card stock-card-cta">
              <h2 className="stock-card-title">Not in your portfolio</h2>
              <p className="stock-cta-sub">
                Add {sym} as a holding to track shares, cost and returns — or keep an eye on it from
                your watchlist.
              </p>
              <div className="stock-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> Add to holdings
                </button>
                <button className="btn btn-ghost btn-sm" onClick={toggleWatch}>
                  {watch ? <><EyeOff size={13} /> Unwatch</> : <><Eye size={13} /> Watch</>}
                </button>
              </div>
            </section>
          )}

          {signal && (
            <section className="stock-card">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Signal</h2>
                <span className={`signal-badge signal-${signal.verdict}`}>{VERDICT_LABEL[signal.verdict]}</span>
              </div>
              <ul className="signal-rows">
                {signal.rows.map(r => (
                  <li key={r.label} className="signal-row">
                    <span className={`signal-dot ${r.stance}`} />
                    <span className="signal-label">{r.label}</span>
                    <span className="signal-detail">{r.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="signal-disclaimer">
                A heuristic read of the price history — not investment advice.
              </p>
            </section>
          )}

          <section className="stock-card">
            <div className="stock-card-head">
              <h2 className="stock-card-title">Statistics</h2>
            </div>
            <dl className="stock-facts">
              {history?.previousClose !== undefined && (
                <div><dt>Previous close</dt><dd>{formatMoney(history.previousClose, ccy)}</dd></div>
              )}
              {dayChange !== undefined && (
                <div><dt>Today</dt><dd className={gainClass(dayChange)}>{signedAmount(dayChange, ccy)} <span className="sf-sub">{signedPct(history?.dayChangePct)}</span></dd></div>
              )}
              {range52 ? (
                <>
                  <div><dt>52-week low</dt><dd>{formatMoney(range52.lo, ccy)}</dd></div>
                  <div><dt>52-week high</dt><dd>{formatMoney(range52.hi, ccy)}</dd></div>
                </>
              ) : (
                <div><dt>52-week range</dt><dd className="li-empty">—</dd></div>
              )}
            </dl>
            {range52?.pos !== undefined && (
              <div className="range-meter" title={`Today sits ${(range52.pos * 100).toFixed(0)}% of the way up its 52-week range`}>
                <div className="range-track">
                  <span className="range-mark" style={{ left: `${(range52.pos * 100).toFixed(1)}%` }} />
                </div>
                <div className="range-ends">
                  <span>{formatMoney(range52.lo, ccy)}</span>
                  <span>{formatMoney(range52.hi, ccy)}</span>
                </div>
              </div>
            )}
          </section>

          {profile && (
            <section className="stock-card">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Fundamentals</h2>
              </div>
              <dl className="stock-facts">
                {profile.marketCap !== undefined && (
                  <div><dt>Market cap</dt><dd>${formatCompact(profile.marketCap)}</dd></div>
                )}
                {profile.peRatio !== undefined && (
                  <div><dt>P/E ratio</dt><dd>{profile.peRatio.toFixed(1)}</dd></div>
                )}
                {profile.eps !== undefined && (
                  <div><dt>EPS</dt><dd>{formatMoney(profile.eps, ccy)}</dd></div>
                )}
                {profile.dividendYield !== undefined && profile.dividendYield > 0 && (
                  <div><dt>Dividend yield</dt><dd>{(profile.dividendYield * 100).toFixed(2)}%</dd></div>
                )}
                {profile.annualizedDividend !== undefined && profile.annualizedDividend > 0 && (
                  <div><dt>Annual dividend</dt><dd>{formatMoney(profile.annualizedDividend, ccy)}</dd></div>
                )}
                {profile.exDividendDate && (
                  <div><dt>Ex-dividend</dt><dd>{profile.exDividendDate}</dd></div>
                )}
                {profile.oneYearTarget !== undefined && (
                  <div><dt>1-yr target</dt><dd>{formatMoney(profile.oneYearTarget, ccy)}</dd></div>
                )}
                {profile.volume !== undefined && (
                  <div><dt>Volume</dt><dd>{formatCompact(profile.volume)}</dd></div>
                )}
                {profile.avgVolume !== undefined && (
                  <div><dt>Avg volume</dt><dd>{formatCompact(profile.avgVolume)}</dd></div>
                )}
              </dl>
            </section>
          )}

          {insiders && (
            <section className="stock-card">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Insider activity</h2>
                <span className={`insider-chip insider-${insiders.posture}`}>
                  {insiders.posture === 'buying' ? 'Net buying' : insiders.posture === 'selling' ? 'Net selling' : insiders.posture === 'mixed' ? 'Mixed' : 'Quiet'}
                </span>
              </div>
              <dl className="stock-facts">
                <div><dt>Open-market buys (3m / 12m)</dt><dd>{insiders.buys3m} / {insiders.buys12m}</dd></div>
                <div><dt>Sells (3m / 12m)</dt><dd>{insiders.sells3m} / {insiders.sells12m}</dd></div>
                {insiders.sharesSold3m !== undefined && insiders.sharesSold3m > 0 && (
                  <div><dt>Shares sold, 3m</dt><dd>{formatCompact(insiders.sharesSold3m)}</dd></div>
                )}
                {insiders.sharesBought3m !== undefined && insiders.sharesBought3m > 0 && (
                  <div><dt>Shares bought, 3m</dt><dd>{formatCompact(insiders.sharesBought3m)}</dd></div>
                )}
              </dl>
            </section>
          )}

          {watch?.notes && (
            <section className="stock-card">
              <div className="stock-card-head">
                <h2 className="stock-card-title">Watch thesis</h2>
                {watch.folder && <span className="stock-weight">{watch.folder}</span>}
              </div>
              <p className="stock-notes">{watch.notes}</p>
            </section>
          )}
        </aside>
      </div>

      {(editing || adding) && (
        <HoldingDialog
          holding={editing ? holding ?? undefined : undefined}
          initialSymbol={adding ? sym : undefined}
          busy={busy}
          onSave={saveHolding}
          onDelete={editing ? removeHolding : undefined}
          onLotsChanged={() => load()}
          onClose={() => {
            setEditing(false);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
