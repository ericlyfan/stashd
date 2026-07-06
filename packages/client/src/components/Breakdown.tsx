import { CATEGORY_COLORS } from '../lib/categoryMeta';
import { formatAmount } from '../lib/format';

// Share-of-total view: a segmented proportion bar plus one row per slice.
// Rows arrive sorted high → low; colors are assigned by rank from `colors`
// unless a row pins its own (e.g. a gray "Other" fold). Used by the ledger
// cost breakdowns and the portfolio allocation panel.

export interface BreakdownRow {
  label: string;
  total: number;
  color?: string; // explicit override; otherwise colored by rank
  sub?: string; // muted detail after the label (e.g. a company name)
  id?: string; // rows with an id are clickable (when onRowClick is given)
}

export default function Breakdown({
  rows,
  grandTotal,
  formatValue = formatAmount,
  colors = CATEGORY_COLORS,
  onRowClick,
}: {
  rows: BreakdownRow[];
  grandTotal: number;
  formatValue?: (v: number) => string;
  colors?: string[];
  onRowClick?: (row: BreakdownRow) => void;
}) {
  const pct = (v: number) => (grandTotal > 0 ? (v / grandTotal) * 100 : 0);

  // Color each slice by rank (rows arrive sorted high → low), so the biggest
  // slices get the leading palette hues and the segmented bar reads top-down.
  const colored = rows.map((r, i) => ({ ...r, color: r.color ?? colors[i % colors.length] }));

  return (
    <>
      <div className="breakdown-stack" role="presentation">
        {colored.map(r => (
          <span
            key={r.label}
            className="breakdown-seg"
            style={{ width: `${pct(r.total)}%`, background: r.color }}
            title={`${r.label} · ${formatValue(r.total)} · ${pct(r.total).toFixed(0)}%`}
          />
        ))}
      </div>

      <div className="breakdown-rows">
        {colored.map(r => {
          const clickable = !!onRowClick && r.id !== undefined;
          return (
            <div
              key={r.label}
              className={`breakdown-row${clickable ? ' breakdown-row-link' : ''}`}
              onClick={clickable ? () => onRowClick!(r) : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick!(r))
                  : undefined
              }
            >
              <span
                className="breakdown-bar"
                style={{ width: `${Math.max(3, pct(r.total))}%`, background: `color-mix(in srgb, ${r.color} 20%, transparent)` }}
              />
              <span className="breakdown-dot" style={{ background: r.color }} />
              <span className="breakdown-label">
                {r.label}
                {r.sub && <span className="breakdown-label-sub">{r.sub}</span>}
              </span>
              <span className="breakdown-amount">{formatValue(r.total)}</span>
              <span className="breakdown-pct">{pct(r.total).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
