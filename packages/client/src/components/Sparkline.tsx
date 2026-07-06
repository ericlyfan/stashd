import { useMemo } from 'react';
import { HistoryDay } from '@stashd/shared';

// Tiny inline-SVG trend line for a table row (no axes, no labels — the row's
// numbers carry the values). Colored by direction over the window, muted to
// sit inside the paper palette. Renders a quiet dash when there's no history.

const W = 96;
const H = 26;
const PAD = 2;

export default function Sparkline({ points }: { points: HistoryDay[] | undefined }) {
  const geom = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vals = points.map(p => p.close);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const x = (i: number) => PAD + ((W - PAD * 2) * i) / (points.length - 1);
    const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / (max - min));
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.close).toFixed(1)}`).join(' ');
    const area = `${line} L ${x(points.length - 1).toFixed(1)} ${H - PAD} L ${PAD} ${H - PAD} Z`;
    const up = vals[vals.length - 1] >= vals[0];
    return { line, area, up };
  }, [points]);

  if (!geom) return <span className="li-empty">—</span>;

  const color = geom.up ? 'var(--moss)' : '#c0392b';
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path d={geom.area} fill={color} fillOpacity={0.1} stroke="none" />
      <path d={geom.line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
