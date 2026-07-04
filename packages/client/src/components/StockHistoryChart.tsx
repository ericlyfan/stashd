import { useMemo, useRef, useState } from 'react';
import { HistoryDay } from '@stashd/shared';
import { formatMoney, formatDate } from '../lib/format';

// Hand-built inline SVG price chart for a single stock (paper aesthetic, no chart
// lib). Plots daily closes with a range selector; the selected range's change is
// computed client-side (first-in-window vs last).

type Range = '1w' | '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
  { id: 'all', label: 'ALL' },
];

const UP = 'var(--moss)';
const DOWN = '#c0392b';
const W = 820;
const H = 240;
const PAD = { l: 6, r: 6, t: 14, b: 20 };

function cutoff(range: Range): string | null {
  const now = new Date();
  const d = new Date(now);
  switch (range) {
    case '1w': d.setDate(d.getDate() - 7); break;
    case '1m': d.setMonth(d.getMonth() - 1); break;
    case '3m': d.setMonth(d.getMonth() - 3); break;
    case '6m': d.setMonth(d.getMonth() - 6); break;
    case '1y': d.setFullYear(d.getFullYear() - 1); break;
    case 'ytd': return `${now.getFullYear()}-01-01`;
    case 'all': return null;
  }
  return d.toISOString().slice(0, 10);
}

function signedPct(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${(Math.abs(v) * 100).toFixed(2)}%`;
}
function signedMoney(v: number, currency: string): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(v), currency)}`;
}

export default function StockHistoryChart({ points, currency }: { points: HistoryDay[]; currency: string }) {
  const [range, setRange] = useState<Range>('6m');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pts = useMemo<HistoryDay[]>(() => {
    const c = cutoff(range);
    let slice = c ? points.filter(p => p.date >= c) : points;
    if (slice.length < 2) slice = points.slice(-2);
    return slice;
  }, [points, range]);

  const geom = useMemo(() => {
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const vals = pts.map(p => p.close);
    let min = vals.length ? Math.min(...vals) : 0;
    let max = vals.length ? Math.max(...vals) : 1;
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const n = pts.length;
    const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = (v: number) => PAD.t + innerH * (1 - (v - min) / (max - min));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.close).toFixed(1)}`).join(' ');
    const area = `${line} L ${x(n - 1).toFixed(1)} ${(H - PAD.b).toFixed(1)} L ${x(0).toFixed(1)} ${(H - PAD.b).toFixed(1)} Z`;
    return { x, y, line, area, n };
  }, [pts]);

  if (points.length === 0) {
    return (
      <div className="perf-chart">
        <div className="perf-ranges">
          {RANGES.map(r => (
            <button key={r.id} className={`perf-range${r.id === range ? ' active' : ''}`} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="perf-empty">
          Price history isn’t available for this stock right now. Its live price is shown above; the
          chart fills in when the market-data source is reachable.
        </div>
      </div>
    );
  }

  const first = pts[0].close;
  const last = pts[pts.length - 1].close;
  const changeAbs = last - first;
  const changePct = first > 0 ? changeAbs / first : 0;
  const up = changeAbs >= 0;
  const hoverPt = hover !== null ? pts[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (geom.n - 1)));
  }

  return (
    <div className="perf-chart" style={{ ['--perf' as never]: up ? UP : DOWN }}>
      <div className="perf-head">
        <div>
          <div className="perf-value">{formatMoney(last, currency)}</div>
          <div className={`perf-change ${up ? 'gain-pos' : 'gain-neg'}`}>
            {signedMoney(changeAbs, currency)} ({signedPct(changePct)}){' '}
            <span className="perf-change-lbl">over {RANGES.find(r => r.id === range)?.label}</span>
          </div>
        </div>
        <div className="perf-ranges">
          {RANGES.map(r => (
            <button key={r.id} className={`perf-range${r.id === range ? ' active' : ''}`} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="perf-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="perf-svg"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <path d={geom.area} fill="var(--perf)" fillOpacity={0.1} stroke="none" />
          <path d={geom.line} fill="none" stroke="var(--perf)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hoverPt && (
            <g>
              <line x1={geom.x(hover!)} y1={PAD.t} x2={geom.x(hover!)} y2={H - PAD.b} stroke="var(--ink-faint)" strokeWidth={1} />
              <circle cx={geom.x(hover!)} cy={geom.y(hoverPt.close)} r={3.5} fill="var(--perf)" stroke="var(--card-raised)" strokeWidth={1.5} />
            </g>
          )}
        </svg>
        {hoverPt && (
          <div className="perf-tip" style={{ left: `${(geom.x(hover!) / W) * 100}%` }}>
            <div className="perf-tip-val">{formatMoney(hoverPt.close, currency)}</div>
            <div className="perf-tip-date">{formatDate(hoverPt.date)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
