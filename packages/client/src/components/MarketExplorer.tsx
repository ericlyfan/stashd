import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, Eye, EyeOff, Layers, Leaf, TrendingDown, TrendingUp } from 'lucide-react';
import { MoversKind, PulseItem, ScreenerRow } from '@stashd/shared';
import { getMarketMovers, getMarketPulse, getPopularEtfs, getSectorScreener } from '../api';
import { formatCompact, formatMoney } from '../lib/format';
import { gainClass, signedPct } from '../lib/gains';

// The market-discovery panel: today's US movers and the biggest names per
// sector, with one-click watchlisting. Lives in the portfolio page's Discover
// section — the host owns the watchlist state (and passes the toggles in) so
// its own watchlist UI updates in step.

const MOVER_TABS: { kind: MoversKind; label: string; icon: typeof Activity }[] = [
  { kind: 'active', label: 'Most active', icon: Activity },
  { kind: 'gainers', label: 'Gainers', icon: TrendingUp },
  { kind: 'losers', label: 'Losers', icon: TrendingDown },
  { kind: 'canada', label: 'Canada', icon: Leaf },
];

// Display order + labels for the Nasdaq screener's sector tokens.
const SECTORS: { id: string; label: string }[] = [
  { id: 'technology', label: 'Technology' },
  { id: 'consumer_discretionary', label: 'Consumer' },
  { id: 'finance', label: 'Finance' },
  { id: 'health_care', label: 'Health care' },
  { id: 'industrials', label: 'Industrials' },
  { id: 'energy', label: 'Energy' },
  { id: 'consumer_staples', label: 'Staples' },
  { id: 'basic_materials', label: 'Materials' },
  { id: 'real_estate', label: 'Real estate' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'telecommunications', label: 'Telecom' },
];

type View = { type: 'movers'; kind: MoversKind } | { type: 'etfs' } | { type: 'sector'; id: string };

function viewKey(v: View): string {
  if (v.type === 'movers') return `m:${v.kind}`;
  if (v.type === 'etfs') return 'etfs';
  return `s:${v.id}`;
}

// $4.71T / $532.1B — compact market caps for the table.
function formatCap(v?: number): string {
  const c = formatCompact(v);
  return c === '—' ? c : `$${c}`;
}

export default function MarketExplorer({
  watchedSymbols,
  onToggleWatch,
  onOpenStock,
}: {
  watchedSymbols: Set<string>; // upper-cased tickers currently on the watchlist
  onToggleWatch: (row: ScreenerRow, watched: boolean) => void;
  onOpenStock: (symbol: string) => void;
}) {
  const [view, setView] = useState<View>({ type: 'movers', kind: 'active' });
  const [tables, setTables] = useState<Record<string, ScreenerRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [pulse, setPulse] = useState<PulseItem[]>([]);
  // Sector-view sort: null keeps the server's market-cap order; everything
  // sorts biggest-first. Resets when the view changes.
  const [sortKey, setSortKey] = useState<'upside' | 'today' | 'cap' | null>(null);

  const key = viewKey(view);
  const rows = tables[key];

  const load = useCallback(async (v: View) => {
    const k = viewKey(v);
    setLoading(true);
    try {
      const data =
        v.type === 'movers' ? await getMarketMovers(v.kind)
        : v.type === 'etfs' ? await getPopularEtfs()
        : await getSectorScreener(v.id, true); // enriched: P/E + target upside
      setTables(t => ({ ...t, [k]: data }));
    } catch {
      setTables(t => ({ ...t, [k]: [] }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSortKey(null);
  }, [key]);

  useEffect(() => {
    if (tables[key] === undefined) void load(view);
  }, [view, key, tables, load]);

  useEffect(() => {
    getMarketPulse().then(setPulse).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    if (!rows || sortKey === null) return rows;
    const val = (r: ScreenerRow): number | undefined =>
      sortKey === 'upside' ? r.targetUpside : sortKey === 'today' ? r.changePct : r.marketCap;
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return vb - va;
    });
  }, [rows, sortKey]);

  const sectorTh = (label: string, k: 'upside' | 'today' | 'cap') => (
    <th className="num-col" aria-sort={sortKey === k ? 'descending' : undefined}>
      <button className={`th-sort${sortKey === k ? ' active' : ''}`} onClick={() => setSortKey(cur => (cur === k ? null : k))}>
        {label}
        {sortKey === k && <ArrowDown size={10} />}
      </button>
    </th>
  );

  return (
    <div className="breakdown breakdown-panel discover-panel">
      {pulse.length > 0 && (
        <div className="pulse-strip">
          {pulse.map(p => (
            <button
              key={p.symbol}
              className="pulse-tile"
              title={`${p.label} (via ${p.symbol})`}
              onClick={() => onOpenStock(p.symbol)}
            >
              <span className="pulse-label">{p.label}</span>
              <span className={`pulse-pct ${gainClass(p.changePct)}`}>
                {p.changePct !== undefined ? signedPct(p.changePct) : '—'}
              </span>
              {p.price !== undefined && (
                <span className="pulse-price">{formatMoney(p.price, p.currency ?? 'USD')}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="breakdown-tabs discover-tabs">
        <div className="breakdown-tablist" role="tablist">
          {MOVER_TABS.map(t => {
            const Icon = t.icon;
            const active = view.type === 'movers' && view.kind === t.kind;
            return (
              <button
                key={t.kind}
                role="tab"
                aria-selected={active}
                className={`breakdown-tab${active ? ' active' : ''}`}
                onClick={() => setView({ type: 'movers', kind: t.kind })}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
          <button
            role="tab"
            aria-selected={view.type === 'etfs'}
            className={`breakdown-tab${view.type === 'etfs' ? ' active' : ''}`}
            onClick={() => setView({ type: 'etfs' })}
          >
            <Layers size={12} />
            ETFs
          </button>
        </div>
        <span className="discover-note">
          {view.type === 'etfs' ? 'US + Canadian · live'
            : view.type === 'movers' && view.kind === 'canada' ? 'TSX · live'
            : 'US markets · live'}
        </span>
      </div>
      <div className="discover-sectors" role="tablist" aria-label="Sectors">
        {SECTORS.map(s => {
          const active = view.type === 'sector' && view.id === s.id;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              className={`sector-chip${active ? ' active' : ''}`}
              onClick={() => setView({ type: 'sector', id: s.id })}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {shown === undefined ? (
        <div className="loading-line" style={{ padding: '22px 4px' }}>Scanning the market…</div>
      ) : shown.length === 0 ? (
        <div className="perf-empty">
          Market data is unreachable right now — this table fills in when the source is back.
        </div>
      ) : (
        <div className="li-table-wrap discover-table" style={{ opacity: loading ? 0.55 : 1 }}>
          <table className="li-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num-col">Price</th>
                {view.type === 'sector' ? sectorTh('Today', 'today') : <th className="num-col">Today</th>}
                {view.type === 'sector' && sectorTh('Upside', 'upside')}
                {view.type === 'sector' && sectorTh('Market cap', 'cap')}
                <th style={{ width: 64 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const watched = watchedSymbols.has(r.symbol.trim().toUpperCase());
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onOpenStock(r.symbol)}
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpenStock(r.symbol))}
                  >
                    <td>
                      <div className="h-sym">
                        <span className="h-ticker">{r.symbol}</span>
                        {r.currency && r.currency !== 'USD' && (
                          <span className="h-ccy" title={`Priced in ${r.currency}`}>{r.currency}</span>
                        )}
                        <span className="h-name">{r.name}</span>
                      </div>
                    </td>
                    <td className="num-col">{r.price !== undefined ? formatMoney(r.price, r.currency ?? 'USD') : <span className="li-empty">—</span>}</td>
                    <td className={`num-col ${gainClass(r.changePct)}`}>
                      {r.changePct !== undefined ? signedPct(r.changePct) : <span className="li-empty">—</span>}
                    </td>
                    {view.type === 'sector' && (
                      <td className={`num-col ${gainClass(r.targetUpside)}`}>
                        {r.targetUpside !== undefined ? signedPct(r.targetUpside) : <span className="li-empty">—</span>}
                      </td>
                    )}
                    {view.type === 'sector' && <td className="num-col">{formatCap(r.marketCap)}</td>}
                    <td className="num-col">
                      <button
                        className={`watch-quick${watched ? ' on' : ''}`}
                        title={watched ? 'Stop watching' : 'Add to watchlist'}
                        aria-label={watched ? 'Stop watching' : 'Add to watchlist'}
                        onClick={e => {
                          e.stopPropagation();
                          onToggleWatch(r, watched);
                        }}
                      >
                        {watched ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
