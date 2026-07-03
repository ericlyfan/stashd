import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, FolderOpen, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { LineItem, LineItemInput } from '@stashd/shared';
import { useStore } from '../store';
import { categoryIcon } from '../lib/categoryMeta';
import { formatAmount, formatDate } from '../lib/format';

// Suggestions drawn from the project's existing rows, offered via <datalist>
// so categories/vendors/statuses stay consistent without a managed list.
export interface ItemSuggestions {
  categories: string[];
  vendors: string[];
  statuses: string[];
}

interface Props {
  projectId: string;
  item?: LineItem; // present when editing, absent when adding
  suggestions: ItemSuggestions;
  busy?: boolean;
  onSave: (input: LineItemInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}

// Parse a money/quantity field: blank → undefined (cleared), else a number.
function num(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function str(v?: number): string {
  return v === undefined || v === null ? '' : String(v);
}

export default function LineItemDialog({ projectId, item, suggestions, busy, onSave, onDelete, onClose }: Props) {
  const { docs } = useStore();

  const [category, setCategory] = useState(item?.category ?? '');
  const [vendor, setVendor] = useState(item?.vendor ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [quantity, setQuantity] = useState(str(item?.quantity));
  const [datePaid, setDatePaid] = useState(item?.datePaid ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(item?.invoiceNumber ?? '');
  const [amountRequested, setAmountRequested] = useState(str(item?.amountRequested));
  const [amountPaid, setAmountPaid] = useState(str(item?.amountPaid));
  const [taxAmount, setTaxAmount] = useState(str(item?.taxAmount));
  const [totalPaid, setTotalPaid] = useState(str(item?.totalPaid));
  const [status, setStatus] = useState(item?.status ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [documentId, setDocumentId] = useState<string | undefined>(item?.documentId);
  const [browserOpen, setBrowserOpen] = useState(false);

  // The total tracks paid + tax until the user types a total of their own.
  const [manualTotal, setManualTotal] = useState(
    item?.totalPaid !== undefined && item.totalPaid !== (item.amountPaid ?? 0) + (item.taxAmount ?? 0),
  );
  useEffect(() => {
    if (manualTotal) return;
    const sum = (num(amountPaid) ?? 0) + (num(taxAmount) ?? 0);
    setTotalPaid(amountPaid.trim() || taxAmount.trim() ? String(sum) : '');
  }, [amountPaid, taxAmount, manualTotal]);

  function submit() {
    onSave({
      category,
      vendor,
      description,
      quantity: num(quantity),
      datePaid: datePaid || undefined,
      invoiceNumber,
      amountRequested: num(amountRequested),
      amountPaid: num(amountPaid),
      taxAmount: num(taxAmount),
      totalPaid: num(totalPaid),
      status,
      notes,
      documentId: documentId ?? null,
    });
  }

  const linkedDoc = docs.find(d => d.id === documentId);

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-line-item" role="dialog" aria-label={item ? 'Edit line item' : 'Add line item'}>
        <div className="li-dialog-head">
          <h3>{item ? 'Edit line item' : 'New line item'}</h3>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="li-dialog-body">
          <div className="field">
            <label className="field-label" htmlFor="li-desc">Description / milestone</label>
            <input
              id="li-desc"
              className="input"
              value={description}
              autoFocus
              placeholder="e.g. Framing — second floor"
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="li-cat">Category</label>
              <input id="li-cat" className="input" list="li-cats" value={category} onChange={e => setCategory(e.target.value)} />
              <datalist id="li-cats">
                {suggestions.categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-vendor">Vendor / contractor</label>
              <input id="li-vendor" className="input" list="li-vendors" value={vendor} onChange={e => setVendor(e.target.value)} />
              <datalist id="li-vendors">
                {suggestions.vendors.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="li-qty">Quantity</label>
              <input id="li-qty" className="input" type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-date">Date paid</label>
              <input id="li-date" className="input" type="date" value={datePaid} onChange={e => setDatePaid(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="li-inv">Invoice #</label>
              <input id="li-inv" className="input" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-status">Status</label>
              <input id="li-status" className="input" list="li-statuses" value={status} placeholder="Paid, Pending…" onChange={e => setStatus(e.target.value)} />
              <datalist id="li-statuses">
                {['Paid', 'Pending', 'Partial', 'Deposit', 'Overdue', ...suggestions.statuses].map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="li-money">
            <div className="field">
              <label className="field-label" htmlFor="li-req">Amount requested</label>
              <input id="li-req" className="input" type="number" step="0.01" inputMode="decimal" value={amountRequested} onChange={e => setAmountRequested(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-paid">Amount paid (pre-tax)</label>
              <input id="li-paid" className="input" type="number" step="0.01" inputMode="decimal" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-tax">GST / HST</label>
              <input id="li-tax" className="input" type="number" step="0.01" inputMode="decimal" value={taxAmount} onChange={e => setTaxAmount(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="li-total">
                Total paid
                {!manualTotal && <span className="li-auto" title="Auto-summed from paid + tax — type to override">auto</span>}
              </label>
              <input
                id="li-total"
                className="input"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={totalPaid}
                onChange={e => {
                  setManualTotal(true);
                  setTotalPaid(e.target.value);
                }}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="li-notes">Notes</label>
            <textarea id="li-notes" className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth recording about this cost…" />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Supporting document</label>
            {linkedDoc ? (
              <div className="li-doc-row">
                <div className="li-doc-link">
                  <FileText size={13} />
                  <span className="li-doc-name">{linkedDoc.originalName}</span>
                  <button type="button" aria-label="Unlink document" onClick={() => setDocumentId(undefined)}>
                    <X size={12} />
                  </button>
                </div>
                <button type="button" className="li-doc-change" onClick={() => setBrowserOpen(true)}>
                  Change
                </button>
              </div>
            ) : documentId ? (
              <div className="li-doc-link dangling">
                <FileText size={13} />
                <span className="li-doc-name">Linked document (no longer in the stash)</span>
                <button type="button" aria-label="Clear link" onClick={() => setDocumentId(undefined)}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="pin-picker">
                <button type="button" className="pin-add" onClick={() => setBrowserOpen(true)}>
                  <Plus size={11} />
                  link a document
                </button>
                <span className="li-doc-hint">
                  <Link2 size={11} />
                  optional — attach a receipt or invoice as evidence
                </span>
              </div>
            )}
          </div>
        </div>

        {browserOpen && (
          <DocumentBrowser
            current={documentId}
            onPick={id => {
              setDocumentId(id);
              setBrowserOpen(false);
            }}
            onClose={() => setBrowserOpen(false)}
          />
        )}

        <div className="li-dialog-foot">
          {item && onDelete && (
            <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : item ? 'Save changes' : 'Add line item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// A full-window document browser for attaching a stash document as evidence:
// search across name/vendor/folder/tags, browse by folder in a left rail, and
// see each document's full name and metadata before linking.
function DocumentBrowser({
  current,
  onPick,
  onClose,
}: {
  current?: string;
  onPick: (docId: string) => void;
  onClose: () => void;
}) {
  const { docs, categories, categoryById } = useStore();
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Live per-folder counts, so the rail only lists folders that hold documents.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of docs) m[d.category] = (m[d.category] ?? 0) + 1;
    return m;
  }, [docs]);

  const folders = useMemo(
    () => categories.filter(c => (counts[c.id] ?? 0) > 0).sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)),
    [categories, counts],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter(d => !activeCat || d.category === activeCat)
      .filter(d => {
        if (!q) return true;
        const cat = categoryById(d.category)?.name ?? '';
        return (
          d.originalName.toLowerCase().includes(q) ||
          d.vendor?.toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q)) ||
          d.summary.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [docs, activeCat, query, categoryById]);

  // Portal to <body> so the fixed overlay is relative to the viewport, not
  // trapped inside the line-item dialog's backdrop-filtered scrim (which would
  // otherwise become its containing block and constrain/mis-size it).
  return createPortal(
    <div className="scrim doc-browser-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="doc-browser" role="dialog" aria-label="Link a supporting document">
        <div className="db-head">
          <div className="db-head-title">
            <Link2 size={16} />
            <h3>Link a supporting document</h3>
          </div>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="db-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search by name, vendor, folder or tag…"
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="db-body">
          <div className="db-rail">
            <button type="button" className={!activeCat ? 'active' : ''} onClick={() => setActiveCat(null)}>
              <FolderOpen size={14} />
              <span className="db-rail-name">All documents</span>
              <span className="db-rail-count">{docs.length}</span>
            </button>
            {folders.map(cat => {
              const Icon = categoryIcon(cat.icon);
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={activeCat === cat.id ? 'active' : ''}
                  onClick={() => setActiveCat(cat.id)}
                >
                  <Icon size={14} style={{ color: cat.color }} />
                  <span className="db-rail-name">{cat.name}</span>
                  <span className="db-rail-count">{counts[cat.id]}</span>
                </button>
              );
            })}
          </div>

          <div className="db-list">
            {results.map(d => {
              const cat = categoryById(d.category);
              const Icon = categoryIcon(cat?.icon);
              const meta = [cat?.name, d.vendor, formatDate(d.dateExtracted)].filter(Boolean).join('  ·  ');
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`db-item${current === d.id ? ' current' : ''}`}
                  onClick={() => onPick(d.id)}
                >
                  <span
                    className="db-icon"
                    style={cat ? { background: `${cat.color}1f`, color: cat.color } : undefined}
                  >
                    <Icon size={17} />
                  </span>
                  <span className="db-item-main">
                    <span className="db-name">{d.originalName}</span>
                    {meta && <span className="db-meta">{meta}</span>}
                  </span>
                  {d.amount !== undefined && d.amount !== null && (
                    <span className="db-amount">{formatAmount(d.amount)}</span>
                  )}
                  {current === d.id && <span className="db-current">linked</span>}
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="db-empty">
                {docs.length === 0 ? 'No documents in the stash yet.' : 'No documents match your search.'}
              </div>
            )}
          </div>
        </div>

        <div className="db-foot">
          <span className="db-foot-count">
            {results.length} document{results.length === 1 ? '' : 's'}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
