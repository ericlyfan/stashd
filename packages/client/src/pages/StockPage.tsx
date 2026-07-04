import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, TrendingUp } from 'lucide-react';
import { HoldingInput, HoldingWithQuote, StockHistory, WatchlistItemWithQuote } from '@stashd/shared';
import {
  addWatchlist,
  createHolding,
  deleteHolding,
  getPortfolio,
  getStockHistory,
  getWatchlist,
  removeWatchlist,
  updateHolding,
} from '../api';
import { useStore } from '../store';
import HoldingDialog from '../components/HoldingDialog';
import StockHistoryChart from '../components/StockHistoryChart';
import { formatMoney, formatMoneyCell } from '../lib/format';

function signedMoney(v: number | undefined, currency: string): string {
  if (v === undefined) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(v), currency)}`;
}
function signedPct(v?: number): string {
  if (v === undefined) return '';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${(Math.abs(v) * 100).toFixed(2)}%`;
}
function gainClass(v?: number): string {
  if (v === undefined || v === 0) return '';
  return v > 0 ? 'gain-pos' : 'gain-neg';
}

export default function StockPage() {
  const { symbol = '' } = useParams();
  const navigate = useNavigate();
  const { notify } = useStore();
  const sym = symbol.toUpperCase();

  const [history, setHistory] = useState<StockHistory | null>(null);
  const [holding, setHolding] = useState<HoldingWithQuote | null>(null);
  const [watch, setWatch] = useState<WatchlistItemWithQuote | null>(null);
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
      setHolding(snap?.holdings.find(h => h.symbol.trim().toUpperCase() === sym) ?? null);
      setWatch(wl.find(w => w.symbol.trim().toUpperCase() === sym) ?? null);
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
    <div className="page" style={{ maxWidth: 920 }}>
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
          {name && <p className="page-sub" style={{ margin: 0 }}>{name}</p>}
        </div>
        <div className="stock-price">
          {price !== undefined ? (
            <>
              <div className="stock-price-now">{formatMoney(price, ccy)}</div>
              {dayChange !== undefined && (
                <div className={`stock-price-day ${gainClass(dayChange)}`}>
                  {signedMoney(dayChange, ccy)} ({signedPct(history?.dayChangePct)}) today
                </div>
              )}
            </>
          ) : (
            <div className="stock-price-now li-empty">Unpriced</div>
          )}
        </div>
      </header>

      {history && (
        <div className="rise rise-1">
          <StockHistoryChart points={history.points} currency={ccy} />
        </div>
      )}

      {holding ? (
        <div className="stock-position rise rise-2">
          <div className="stat-row">
            <div className="mini-stat"><div className="num">{+holding.shares.toFixed(4)}</div><div className="lbl">Shares</div></div>
            <div className="mini-stat"><div className="num">{formatMoneyCell(holding.avgCost, ccy)}</div><div className="lbl">Avg cost</div></div>
            <div className="mini-stat"><div className="num">{formatMoneyCell(holding.marketValue, ccy)}</div><div className="lbl">Market value</div></div>
            <div className="mini-stat"><div className={`num ${gainClass(holding.totalGain)}`}>{signedMoney(holding.totalGain, ccy)}</div><div className="lbl">Total return {holding.totalReturnPct !== undefined && <span className="stat-sub">{signedPct(holding.totalReturnPct)}</span>}</div></div>
            {holding.weight !== undefined && (
              <div className="mini-stat"><div className="num">{(holding.weight * 100).toFixed(1)}%</div><div className="lbl">Of portfolio</div></div>
            )}
          </div>
          <div className="stock-actions">
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit holding
            </button>
            <button className="btn btn-ghost btn-sm" onClick={toggleWatch}>
              {watch ? <><EyeOff size={13} /> Unwatch</> : <><Eye size={13} /> Watch</>}
            </button>
          </div>
        </div>
      ) : (
        <div className="stock-actions rise rise-2">
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add to holdings
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleWatch}>
            {watch ? <><EyeOff size={13} /> Remove from watchlist</> : <><Eye size={13} /> Add to watchlist</>}
          </button>
        </div>
      )}

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
