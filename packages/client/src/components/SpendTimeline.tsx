import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Pin } from 'lucide-react';
import { LineItem } from '@stashd/shared';
import { CATEGORY_COLORS } from '../lib/categoryMeta';
import { formatAmount, formatCell, formatDate } from '../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Mode = 'month' | 'quarter' | 'category';

const MODES: { id: Mode; label: string }[] = [
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'category', label: 'By category' },
];

// A category's slice of one period: its share of the column and the items behind it.
interface Segment {
  category: string;
  color: string;
  total: number;
  items: LineItem[];
}

// One time period (month or quarter), gap-filled so quiet periods still appear.
interface Bucket {
  key: string;
  label: string; // full label for headers/tooltips, e.g. "Jun ’26" or "Q2 ’26"
  tick: string; // short axis label
  total: number;
  items: LineItem[];
  segments: Segment[]; // category split, sorted high → low (for the stacked view)
}

const yy = (y: number) => `’${String(y).slice(2)}`;
const amountOf = (items: LineItem[]) => items.reduce((s, it) => s + (it.totalPaid ?? 0), 0);

function periodKey(d: Date, quarterly: boolean): { key: string; label: string } {
  const y = d.getFullYear();
  if (quarterly) {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${yy(y)}` };
  }
  return { key: `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${yy(y)}` };
}

// Bucket items by the period they were paid in, walking month-by-month from the
// first paid date to the last so empty periods render as gaps (the gaps are how
// you read pacing). Items with no/invalid datePaid can't be placed in time, so
// their spend is returned separately for the panel to note rather than drop.
function buildBuckets(
  items: LineItem[],
  quarterly: boolean,
  colorFor: (cat: string) => string,
): { buckets: Bucket[]; undated: number } {
  const map = new Map<string, LineItem[]>();
  const times: number[] = [];
  let undated = 0;
  for (const it of items) {
    const d = it.datePaid ? new Date(it.datePaid) : null;
    if (!d || isNaN(d.getTime())) {
      undated += it.totalPaid ?? 0;
      continue;
    }
    times.push(d.getTime());
    const { key } = periodKey(d, quarterly);
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  if (times.length === 0) return { buckets: [], undated };

  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  const buckets: Bucket[] = [];
  const seen = new Set<string>();
  let prevYear = -1;
  for (
    let y = min.getFullYear(), m = min.getMonth();
    y < max.getFullYear() || (y === max.getFullYear() && m <= max.getMonth());

  ) {
    const { key, label } = periodKey(new Date(y, m, 1), quarterly);
    if (!seen.has(key)) {
      seen.add(key);
      const its = map.get(key) ?? [];
      // Short axis tick: show the year only on the first column and each Jan/Q1,
      // so long projects don't repeat "’26" under every bar.
      const newYear = y !== prevYear;
      const tick = quarterly
        ? `Q${Math.floor(m / 3) + 1}${newYear ? ` ${yy(y)}` : ''}`
        : `${MONTHS[m]}${newYear || m === 0 ? ` ${yy(y)}` : ''}`;
      prevYear = y;
      buckets.push({ key, label, tick, total: amountOf(its), items: its, segments: buildSegments(its, colorFor) });
    }
    if (++m > 11) {
      m = 0;
      y++;
    }
  }
  return { buckets, undated };
}

function buildSegments(items: LineItem[], colorFor: (cat: string) => string): Segment[] {
  const map = new Map<string, LineItem[]>();
  for (const it of items) {
    const cat = it.category?.trim() || 'Uncategorized';
    const arr = map.get(cat) ?? [];
    arr.push(it);
    map.set(cat, arr);
  }
  return [...map.entries()]
    .map(([category, its]) => ({ category, color: colorFor(category), total: amountOf(its), items: its }))
    .sort((a, b) => b.total - a.total);
}

interface Selection {
  bucket: string;
  category?: string;
}

// Spend-over-time view. Columns are spend per period; clicking or hovering a
// column (or a category segment, in the stacked view) opens the line items that
// make up that number below the chart, where each can be opened in turn.
export default function SpendTimeline({
  items,
  onOpenItem,
}: {
  items: LineItem[];
  onOpenItem?: (item: LineItem) => void;
}) {
  const [mode, setMode] = useState<Mode>('month');
  const [pinned, setPinned] = useState<Selection | null>(null);
  const [hovered, setHovered] = useState<Selection | null>(null);

  // Stable category → color, ranked by overall spend so the same category keeps
  // its color across every period and matches the "By category" breakdown.
  const colorFor = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of items) {
      const cat = it.category?.trim() || 'Uncategorized';
      totals.set(cat, (totals.get(cat) ?? 0) + (it.totalPaid ?? 0));
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const map = new Map(ranked.map((c, i) => [c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
    return (cat: string) => map.get(cat) ?? CATEGORY_COLORS[0];
  }, [items]);

  const stacked = mode === 'category';
  const { buckets, undated } = useMemo(
    () => buildBuckets(items, mode === 'quarter', colorFor),
    [items, mode, colorFor],
  );

  const maxTotal = Math.max(...buckets.map(b => b.total), 1);
  const peak = buckets.reduce((best, b) => (b.total > best.total ? b : best), buckets[0]);

  // Default to the latest period with spend, so there's always something open.
  const fallback = useMemo<Selection | null>(() => {
    const last = [...buckets].reverse().find(b => b.total > 0);
    return last ? { bucket: last.key } : null;
  }, [buckets]);

  const active = pinned ?? hovered ?? fallback;
  const activeBucket = active ? buckets.find(b => b.key === active.bucket) : undefined;
  const activeSegment =
    activeBucket && active?.category ? activeBucket.segments.find(s => s.category === active.category) : undefined;
  const detailItems = (activeSegment ? activeSegment.items : activeBucket?.items ?? [])
    .slice()
    .sort((a, b) => (b.totalPaid ?? 0) - (a.totalPaid ?? 0));
  const detailTotal = amountOf(detailItems);

  function switchMode(next: Mode) {
    setMode(next);
    setPinned(null);
    setHovered(null);
  }

  function pin(sel: Selection) {
    setPinned(p => (p && p.bucket === sel.bucket && p.category === sel.category ? null : sel));
  }

  const sameSel = (a: Selection | null | undefined, b: Selection) =>
    !!a && a.bucket === b.bucket && a.category === b.category;

  return (
    <div className="spend">
      <div className="spend-modes" role="tablist">
        {MODES.map(m => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={`spend-mode${mode === m.id ? ' active' : ''}`}
            onClick={() => switchMode(m.id)}
          >
            {m.label}
          </button>
        ))}
        <span className="spend-axis-max" title="Largest period">
          {formatAmount(maxTotal)}
        </span>
      </div>

      <div className="spend-plot" onMouseLeave={() => setHovered(null)}>
        <div className="spend-gridline" />
        <div className="spend-cols">
          {buckets.map(b => {
            const isActive = active?.bucket === b.key;
            const isPinned = pinned?.bucket === b.key;
            return (
              <div
                key={b.key}
                className={`spend-col${isActive ? ' active' : ''}${pinned && !isPinned ? ' dim' : ''}`}
                title={`${b.label} · ${formatAmount(b.total)} · ${b.items.length} item${b.items.length === 1 ? '' : 's'}`}
              >
                <div
                  className="spend-track"
                  onMouseEnter={() => setHovered({ bucket: b.key })}
                  onClick={() => pin({ bucket: b.key })}
                >
                  {stacked ? (
                    b.segments.map(s => (
                      <div
                        key={s.category}
                        className={`spend-seg${sameSel(active, { bucket: b.key, category: s.category }) ? ' active' : ''}`}
                        style={{ height: `${(s.total / maxTotal) * 100}%`, background: s.color }}
                        title={`${b.label} · ${s.category} · ${formatAmount(s.total)}`}
                        onMouseEnter={e => {
                          e.stopPropagation();
                          setHovered({ bucket: b.key, category: s.category });
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          pin({ bucket: b.key, category: s.category });
                        }}
                      />
                    ))
                  ) : (
                    <div
                      className={`spend-bar${b.key === peak.key && b.total > 0 ? ' is-peak' : ''}`}
                      style={{ height: `${(b.total / maxTotal) * 100}%` }}
                    />
                  )}
                </div>
                <div className="spend-tick">{b.tick}</div>
              </div>
            );
          })}
        </div>
      </div>

      {stacked && (
        <div className="spend-legend">
          {[...new Set(buckets.flatMap(b => b.segments.map(s => s.category)))]
            .sort((a, b) => a.localeCompare(b))
            .map(cat => (
              <span key={cat} className="spend-legend-key">
                <span className="spend-legend-dot" style={{ background: colorFor(cat) }} />
                {cat}
              </span>
            ))}
        </div>
      )}

      <div className="spend-detail">
        {activeBucket ? (
          <>
            <div className="spend-detail-head">
              {activeSegment && <span className="spend-detail-dot" style={{ background: activeSegment.color }} />}
              <strong>
                {activeBucket.label}
                {activeSegment ? ` · ${activeSegment.category}` : ''}
              </strong>
              <span className="spend-detail-meta">
                {formatAmount(detailTotal)} · {detailItems.length} item{detailItems.length === 1 ? '' : 's'}
              </span>
              {pinned && (
                <button className="spend-unpin" onClick={() => setPinned(null)} title="Unpin">
                  <Pin size={11} />
                  Pinned
                </button>
              )}
            </div>
            {detailItems.length === 0 ? (
              <div className="spend-detail-empty">No spend in this period.</div>
            ) : (
              <ul className="spend-detail-list">
                {detailItems.map(it => (
                  <li
                    key={it.id}
                    className={`spend-detail-row${onOpenItem ? ' clickable' : ''}`}
                    onClick={onOpenItem ? () => onOpenItem(it) : undefined}
                    tabIndex={onOpenItem ? 0 : undefined}
                    onKeyDown={
                      onOpenItem ? e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpenItem(it)) : undefined
                    }
                  >
                    <span
                      className="spend-detail-cat"
                      style={{ background: colorFor(it.category?.trim() || 'Uncategorized') }}
                    />
                    <span className="spend-detail-desc">
                      {it.documentId && (
                        <Link
                          to={`/doc/${it.documentId}`}
                          className="spend-detail-clip"
                          title="Linked document"
                          onClick={e => e.stopPropagation()}
                        >
                          <Paperclip size={11} />
                        </Link>
                      )}
                      {it.description || <span className="spend-detail-muted">untitled</span>}
                    </span>
                    <span className="spend-detail-vendor">{it.vendor || ''}</span>
                    <span className="spend-detail-date">{it.datePaid ? formatDate(it.datePaid) : ''}</span>
                    <span className="spend-detail-amount">{formatCell(it.totalPaid)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="spend-detail-empty">Hover or select a period to see its line items.</div>
        )}
        {undated > 0 && <div className="spend-undated">{formatAmount(undated)} undated — not shown on the timeline.</div>}
      </div>
    </div>
  );
}
