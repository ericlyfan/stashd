import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, BookOpen, LucideIcon, Paperclip, Pencil, Plus, Star, Store, Tags, Trash2, TrendingUp } from 'lucide-react';
import { LineItem, LineItemInput, ProjectDetail } from '@stashd/shared';
import {
  addLineItem,
  deleteLineItem,
  deleteProject,
  getProject,
  updateLineItem,
  updateProject,
} from '../api';
import { useStore } from '../store';
import LineItemDialog, { ItemSuggestions } from '../components/LineItemDialog';
import ProjectDialog from '../components/ProjectDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import SpendTimeline from '../components/SpendTimeline';
import { CATEGORY_COLORS } from '../lib/categoryMeta';
import { formatAmount, formatCell, formatDate } from '../lib/format';

// distinct, trimmed, sorted values of one field across the line items
function distinct(items: LineItem[], pick: (it: LineItem) => string | undefined): string[] {
  return [...new Set(items.map(pick).map(v => v?.trim()).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

// Cluster line items by category for display so a divider can mark each group
// boundary. Groups keep first-appearance order, rows keep their order within a
// group. Display only; the data is untouched.
function groupByCategory(items: LineItem[]): { category: string; items: LineItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, LineItem[]>();
  for (const it of items) {
    const key = it.category?.trim() ?? '';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(it);
  }
  return order.map(category => ({ category, items: map.get(category)! }));
}

// sum totalPaid grouped by a field, for the cost breakdowns
function groupTotals(items: LineItem[], pick: (it: LineItem) => string | undefined): { label: string; total: number }[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const label = pick(it)?.trim() || 'Uncategorized';
    map.set(label, (map.get(label) ?? 0) + (it.totalPaid ?? 0));
  }
  return [...map.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
}

// Count of distinct months that carry a paid date — gates the over-time tab,
// which has nothing to show until spend spans more than one month.
function paidMonthCount(items: LineItem[]): number {
  const months = new Set<string>();
  for (const it of items) {
    if (it.datePaid && !isNaN(Date.parse(it.datePaid))) months.add(it.datePaid.slice(0, 7));
  }
  return months.size;
}

export default function LedgerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refresh, notify } = useStore();

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    try {
      setDetail(await getProject(id));
    } catch {
      setMissing(true);
    }
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = detail?.items ?? [];
  const suggestions: ItemSuggestions = useMemo(
    () => ({
      categories: distinct(items, it => it.category),
      vendors: distinct(items, it => it.vendor),
      statuses: distinct(items, it => it.status),
    }),
    [items],
  );
  const byCategory = useMemo(() => groupTotals(items, it => it.category), [items]);
  const byVendor = useMemo(() => groupTotals(items, it => it.vendor), [items]);
  const paidMonths = useMemo(() => paidMonthCount(items), [items]);
  const groups = useMemo(() => groupByCategory(items), [items]);

  if (missing) {
    return (
      <div className="page">
        <EmptyState icon={BookOpen} title="Project not found" subtitle="It may have been deleted.">
          <Link className="btn" to="/ledgers">
            <ArrowLeft size={14} />
            Back to ledgers
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page">
        <div className="loading-line">Opening the ledger…</div>
      </div>
    );
  }

  async function saveItem(input: LineItemInput) {
    if (!detail) return;
    setBusy(true);
    try {
      if (editingItem) {
        await updateLineItem(detail.id, editingItem.id, input);
      } else {
        await addLineItem(detail.id, input);
      }
      await load();
      await refresh();
      setEditingItem(null);
      setAdding(false);
      notify(editingItem ? 'Line item updated' : 'Line item added');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save line item', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function removeItem() {
    if (!detail || !editingItem) return;
    setBusy(true);
    try {
      await deleteLineItem(detail.id, editingItem.id);
      await load();
      await refresh();
      setEditingItem(null);
      notify('Line item deleted');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete line item', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function saveProject(values: { name: string; description?: string }) {
    if (!detail) return;
    setBusy(true);
    try {
      await updateProject(detail.id, { name: values.name, description: values.description ?? '' });
      await load();
      await refresh();
      setEditingProject(false);
      notify('Project updated');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update project', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!detail) return;
    const next = detail.status === 'archived' ? 'active' : 'archived';
    try {
      await updateProject(detail.id, { status: next });
      await load();
      await refresh();
      notify(next === 'archived' ? 'Project archived' : 'Project restored');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update project', 'err');
    }
  }

  // Mark/unmark this as the "current" project. When it's the only default, the
  // sidebar's Ledgers entry opens straight to it.
  async function toggleDefault() {
    if (!detail) return;
    const next = !detail.isDefault;
    try {
      await updateProject(detail.id, { isDefault: next });
      await load();
      await refresh();
      notify(next ? `“${detail.name}” is now your current project` : 'Cleared current project');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update project', 'err');
    }
  }

  async function removeProject() {
    if (!detail) return;
    setBusy(true);
    try {
      await deleteProject(detail.id);
      await refresh();
      notify(`“${detail.name}” deleted`);
      navigate('/ledgers');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete project', 'err');
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  const { totals } = detail;

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <header className="page-head rise">
        <div className="page-eyebrow">
          <button
            onClick={() => navigate('/ledgers')}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontFamily: 'var(--mono)',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--wax)',
            }}
          >
            <ArrowLeft size={11} style={{ verticalAlign: '-1px', marginRight: 6 }} />
            Ledgers
          </button>
        </div>
        <div className="page-title-row">
          <h1 className="page-title">{detail.name}</h1>
          {detail.status === 'archived' && <span className="lc-archived">Archived</span>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add line item
          </button>
          <button
            className={`btn btn-sm ${detail.isDefault ? 'btn-wax' : 'btn-ghost'}`}
            onClick={toggleDefault}
            title={detail.isDefault ? 'Your current project — click to clear' : 'Set as your current project'}
          >
            <Star size={13} fill={detail.isDefault ? 'currentColor' : 'none'} />
            {detail.isDefault ? 'Current' : 'Set current'}
          </button>
          <button className="btn btn-ghost btn-sm" title="Edit project" onClick={() => setEditingProject(true)}>
            <Pencil size={13} />
            Edit
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleArchive}>
            {detail.status === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            {detail.status === 'archived' ? 'Restore' : 'Archive'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={13} />
            Delete
          </button>
        </div>
        {detail.description && <p className="page-sub">{detail.description}</p>}
      </header>

      <div className="stats ledger-stats rise rise-1">
        <div className="stat" style={{ ['--accent' as never]: '#3b82f6' }}>
          <div className="num">{formatCell(totals.requested)}</div>
          <div className="lbl">Requested</div>
        </div>
        <div className="stat" style={{ ['--accent' as never]: 'var(--moss)' }}>
          <div className="num">{formatCell(totals.paid)}</div>
          <div className="lbl">Paid (pre-tax)</div>
        </div>
        <div className="stat" style={{ ['--accent' as never]: 'var(--gold)' }}>
          <div className="num">{formatCell(totals.tax)}</div>
          <div className="lbl">GST / HST</div>
        </div>
        <div className="stat" style={{ ['--accent' as never]: 'var(--wax)' }}>
          <div className="num" style={{ color: 'var(--wax)' }}>{formatCell(totals.total)}</div>
          <div className="lbl">Total paid</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rise rise-2">
          <EmptyState
            icon={BookOpen}
            title="No costs logged yet"
            subtitle="Add the first line item — a vendor, an invoice, an amount — and the totals fill in."
          >
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add line item
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {(() => {
            const tabs: AnalyticsTab[] = [
              ...(byCategory.length > 1 ? [{ kind: 'breakdown' as const, title: 'By category', icon: Tags, rows: byCategory }] : []),
              ...(byVendor.length > 1 ? [{ kind: 'breakdown' as const, title: 'By vendor', icon: Store, rows: byVendor }] : []),
              ...(paidMonths > 1 ? [{ kind: 'timeline' as const, title: 'Over time', icon: TrendingUp, items }] : []),
            ];
            return tabs.length > 0 ? (
              <Analytics tabs={tabs} grandTotal={totals.total} onOpenItem={setEditingItem} />
            ) : null;
          })()}

          <div className="li-table-wrap rise rise-3">
            <table className="li-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th className="num-col">Qty</th>
                  <th>Date paid</th>
                  <th>Invoice #</th>
                  <th className="num-col">Requested</th>
                  <th className="num-col">Paid</th>
                  <th className="num-col">GST/HST</th>
                  <th className="num-col">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, gi) =>
                  group.items.map((it, idx) => {
                    const isFirst = idx === 0;
                    return (
                  <tr
                    key={it.id}
                    className={isFirst && gi > 0 ? 'li-group-start' : undefined}
                    onClick={() => setEditingItem(it)}
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditingItem(it))}
                  >
                    <td>{it.category ?? <span className="li-empty">—</span>}</td>
                    <td>{it.vendor ?? <span className="li-empty">—</span>}</td>
                    <td className="li-desc-cell">
                      {it.documentId && (
                        <Link
                          to={`/doc/${it.documentId}`}
                          className="li-clip"
                          title="Linked document"
                          onClick={e => e.stopPropagation()}
                        >
                          <Paperclip size={12} />
                        </Link>
                      )}
                      {it.description || <span className="li-empty">untitled</span>}
                    </td>
                    <td className="num-col">{it.quantity ?? ''}</td>
                    <td>{it.datePaid ? formatDate(it.datePaid) : <span className="li-empty">—</span>}</td>
                    <td>{it.invoiceNumber ?? <span className="li-empty">—</span>}</td>
                    <td className="num-col">{formatCell(it.amountRequested)}</td>
                    <td className="num-col">{formatCell(it.amountPaid)}</td>
                    <td className="num-col">{formatCell(it.taxAmount)}</td>
                    <td className="num-col li-total-cell">{formatCell(it.totalPaid)}</td>
                    <td>{it.status ? <span className="li-status-chip">{it.status}</span> : ''}</td>
                  </tr>
                    );
                  }),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>{items.length} {items.length === 1 ? 'line item' : 'line items'}</td>
                  <td className="num-col">{formatAmount(totals.requested)}</td>
                  <td className="num-col">{formatAmount(totals.paid)}</td>
                  <td className="num-col">{formatAmount(totals.tax)}</td>
                  <td className="num-col li-total-cell">{formatAmount(totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {(adding || editingItem) && (
        <LineItemDialog
          projectId={detail.id}
          item={editingItem ?? undefined}
          suggestions={suggestions}
          busy={busy}
          onSave={saveItem}
          onDelete={editingItem ? removeItem : undefined}
          onClose={() => {
            setEditingItem(null);
            setAdding(false);
          }}
        />
      )}

      {editingProject && (
        <ProjectDialog
          project={{ ...detail, totals }}
          busy={busy}
          onSave={saveProject}
          onClose={() => setEditingProject(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this project?"
          body={`“${detail.name}” and its ${totals.itemCount} line item${totals.itemCount === 1 ? '' : 's'} will be permanently removed. Linked documents stay in the stash. There is no undo.`}
          confirmLabel="Delete project"
          busy={busy}
          onConfirm={removeProject}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

interface BreakdownTab {
  kind: 'breakdown';
  title: string;
  icon: LucideIcon;
  rows: { label: string; total: number }[];
}

interface TimelineTab {
  kind: 'timeline';
  title: string;
  icon: LucideIcon;
  items: LineItem[];
}

type AnalyticsTab = BreakdownTab | TimelineTab;

// One panel, switchable between the available analytics dimensions: cost
// breakdowns (by category / by vendor) and spend over time. The header total is
// the project grand total, shown once for every view.
function Analytics({
  tabs,
  grandTotal,
  onOpenItem,
}: {
  tabs: AnalyticsTab[];
  grandTotal: number;
  onOpenItem?: (item: LineItem) => void;
}) {
  const [active, setActive] = useState(0);
  const cur = tabs[active] ?? tabs[0];

  return (
    <div className="breakdown breakdown-panel rise rise-2">
      <div className="breakdown-tabs">
        <div className="breakdown-tablist" role="tablist">
          {tabs.map((t, i) => {
            const Icon = t.icon;
            return (
              <button
                key={t.title}
                role="tab"
                aria-selected={i === active}
                className={`breakdown-tab${i === active ? ' active' : ''}`}
                onClick={() => setActive(i)}
              >
                <Icon size={12} />
                {t.title}
              </button>
            );
          })}
        </div>
        <span className="breakdown-total">{formatAmount(grandTotal)}</span>
      </div>

      {cur.kind === 'timeline' ? (
        <SpendTimeline items={cur.items} onOpenItem={onOpenItem} />
      ) : (
        <Breakdown rows={cur.rows} grandTotal={grandTotal} />
      )}
    </div>
  );
}

// Cost-share view: a segmented proportion bar plus one row per slice.
function Breakdown({ rows, grandTotal }: { rows: { label: string; total: number }[]; grandTotal: number }) {
  const pct = (v: number) => (grandTotal > 0 ? (v / grandTotal) * 100 : 0);

  // Color each slice by rank (rows arrive sorted high → low), so the biggest
  // costs get the leading palette hues and the segmented bar reads top-down.
  const colored = rows.map((r, i) => ({ ...r, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));

  return (
    <>
      <div className="breakdown-stack" role="presentation">
        {colored.map(r => (
          <span
            key={r.label}
            className="breakdown-seg"
            style={{ width: `${pct(r.total)}%`, background: r.color }}
            title={`${r.label} · ${formatAmount(r.total)} · ${pct(r.total).toFixed(0)}%`}
          />
        ))}
      </div>

      <div className="breakdown-rows">
        {colored.map(r => (
          <div key={r.label} className="breakdown-row">
            <span
              className="breakdown-bar"
              style={{ width: `${Math.max(3, pct(r.total))}%`, background: `color-mix(in srgb, ${r.color} 20%, transparent)` }}
            />
            <span className="breakdown-dot" style={{ background: r.color }} />
            <span className="breakdown-label">{r.label}</span>
            <span className="breakdown-amount">{formatAmount(r.total)}</span>
            <span className="breakdown-pct">{pct(r.total).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}
