import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Link2, Plus, Trash2, X } from 'lucide-react';
import { LineItem, LineItemInput } from '@stashd/shared';
import { useStore } from '../store';

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
              <div className="li-doc-link">
                <FileText size={13} />
                <span className="li-doc-name">{linkedDoc.originalName}</span>
                <button type="button" aria-label="Unlink document" onClick={() => setDocumentId(undefined)}>
                  <X size={12} />
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
              <DocPicker onPick={setDocumentId} />
            )}
          </div>
        </div>

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

// A compact search-and-pick for attaching a document from the stash, mirroring
// the chat's pin picker.
function DocPicker({ onPick }: { onPick: (docId: string) => void }) {
  const { docs, categoryById } = useStore();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return docs
      .filter(d => !q || d.originalName.toLowerCase().includes(q) || d.vendor?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [docs, filter]);

  return (
    <div className="pin-picker" ref={popRef}>
      <button type="button" className="pin-add" onClick={() => setOpen(o => !o)}>
        <Plus size={11} />
        link a document
      </button>
      {open && (
        <div className="pin-pop">
          <input
            ref={inputRef}
            value={filter}
            placeholder="Search the stash…"
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setOpen(false)}
          />
          <div className="pin-options">
            {candidates.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onPick(d.id);
                  setOpen(false);
                  setFilter('');
                }}
              >
                <FileText size={13} />
                <span className="pin-option-name">{d.originalName}</span>
                <span className="pin-option-cat" style={{ color: categoryById(d.category)?.color }}>
                  {categoryById(d.category)?.name ?? d.category}
                </span>
              </button>
            ))}
            {candidates.length === 0 && <div className="pin-none">no matches</div>}
          </div>
        </div>
      )}
      <span className="li-doc-hint">
        <Link2 size={11} />
        optional — attach a receipt or invoice as evidence
      </span>
    </div>
  );
}
