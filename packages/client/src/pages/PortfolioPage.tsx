import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { HoldingInput, HoldingWithQuote, PortfolioSnapshot } from '@stashd/shared';
import { createHolding, deleteHolding, getPortfolio, updateHolding } from '../api';
import { useStore } from '../store';
import HoldingDialog from '../components/HoldingDialog';
import EmptyState from '../components/EmptyState';
import { formatAmount, formatCell, relTime } from '../lib/format';

// Signed money, e.g. "+$1,240.00" / "−$310.50" — for gain/loss cells.
function signedAmount(v?: number): string {
  if (v === undefined || v === null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatAmount(Math.abs(v))}`;
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
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<HoldingWithQuote | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      setSnap(await getPortfolio());
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load portfolio', 'err');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

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
                <div className="num">{formatCell(totals.costBasis)}</div>
                <div className="lbl">Invested</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: 'var(--wax)' }}>
                <div className="num" style={{ color: 'var(--wax)' }}>{formatCell(totals.marketValue)}</div>
                <div className="lbl">Market value</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: totals.gain >= 0 ? 'var(--moss)' : '#c0392b' }}>
                <div className={`num ${gainClass(totals.gain)}`}>{signedAmount(totals.gain)}</div>
                <div className="lbl">Total gain / loss</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: totals.gain >= 0 ? 'var(--moss)' : '#c0392b' }}>
                <div className={`num ${gainClass(totals.gain)}`}>{signedPct(totals.gainPct)}</div>
                <div className="lbl">Return</div>
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

          <div className="li-table-wrap rise rise-2">
            <table className="li-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num-col">Shares</th>
                  <th className="num-col">Buy price</th>
                  <th className="num-col">Current</th>
                  <th className="num-col">Cost basis</th>
                  <th className="num-col">Market value</th>
                  <th className="num-col">Gain / loss</th>
                  <th className="num-col">Return</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr
                    key={h.id}
                    onClick={() => setEditing(h)}
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditing(h))}
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
                        {h.name && <span className="h-name">{h.name}</span>}
                      </div>
                    </td>
                    <td className="num-col">{h.shares}</td>
                    <td className="num-col">{formatCell(h.buyPrice)}</td>
                    <td className="num-col">
                      {h.currentPrice !== undefined ? (
                        <span className="h-price">
                          {formatAmount(h.currentPrice)}
                          {h.priceSource === 'manual' && <span className="h-price-tag" title="Manually entered price">manual</span>}
                        </span>
                      ) : (
                        <span className="li-empty">—</span>
                      )}
                    </td>
                    <td className="num-col">{formatCell(h.costBasis)}</td>
                    <td className="num-col">{h.marketValue !== undefined ? formatAmount(h.marketValue) : <span className="li-empty">—</span>}</td>
                    <td className={`num-col ${gainClass(h.gain)}`}>{h.gain !== undefined ? signedAmount(h.gain) : <span className="li-empty">—</span>}</td>
                    <td className={`num-col ${gainClass(h.gain)}`}>{h.gainPct !== undefined ? signedPct(h.gainPct) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>{holdings.length} {holdings.length === 1 ? 'holding' : 'holdings'}</td>
                  <td className="num-col">{totals ? formatAmount(totals.costBasis) : ''}</td>
                  <td className="num-col">{totals ? formatAmount(totals.marketValue) : ''}</td>
                  <td className={`num-col ${gainClass(totals?.gain)}`}>{signedAmount(totals?.gain)}</td>
                  <td className={`num-col ${gainClass(totals?.gain)}`}>{signedPct(totals?.gainPct)}</td>
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

      {(adding || editing) && (
        <HoldingDialog
          holding={editing ?? undefined}
          busy={busy}
          onSave={save}
          onDelete={editing ? remove : undefined}
          onClose={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
