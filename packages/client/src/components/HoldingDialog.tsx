import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Link2, Plus, Trash2, X } from 'lucide-react';
import { HoldingInput, HoldingWithQuote } from '@stashd/shared';
import { useStore } from '../store';

interface Props {
  holding?: HoldingWithQuote; // present when editing, absent when adding
  busy?: boolean;
  onSave: (input: HoldingInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}

// Parse a numeric field: blank → undefined (cleared), else a finite number.
function num(v: string): number | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function str(v?: number): string {
  return v === undefined || v === null ? '' : String(v);
}

export default function HoldingDialog({ holding, busy, onSave, onDelete, onClose }: Props) {
  const { docs } = useStore();

  const [symbol, setSymbol] = useState(holding?.symbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [shares, setShares] = useState(str(holding?.shares));
  const [buyPrice, setBuyPrice] = useState(str(holding?.buyPrice));
  const [manualPrice, setManualPrice] = useState(str(holding?.manualPrice));
  const [notes, setNotes] = useState(holding?.notes ?? '');
  const [documentId, setDocumentId] = useState<string | undefined>(holding?.documentId);

  function submit() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    onSave({
      symbol: sym,
      name: name.trim() || undefined,
      shares: num(shares) ?? 0,
      buyPrice: num(buyPrice) ?? 0,
      manualPrice: num(manualPrice),
      notes: notes.trim() || undefined,
      documentId: documentId ?? null,
    });
  }

  const linkedDoc = docs.find(d => d.id === documentId);

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-line-item" role="dialog" aria-label={holding ? 'Edit holding' : 'Add holding'}>
        <div className="li-dialog-head">
          <h3>{holding ? 'Edit holding' : 'New holding'}</h3>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="li-dialog-body">
          <div className="field-row">
            <div className="field" style={{ maxWidth: 160 }}>
              <label className="field-label" htmlFor="h-symbol">Ticker</label>
              <input
                id="h-symbol"
                className="input"
                value={symbol}
                autoFocus
                placeholder="AAPL"
                style={{ textTransform: 'uppercase' }}
                onChange={e => setSymbol(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="h-name">Company (optional)</label>
              <input id="h-name" className="input" value={name} placeholder="Apple Inc." onChange={e => setName(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="h-shares">Shares</label>
              <input id="h-shares" className="input" type="number" step="any" inputMode="decimal" value={shares} onChange={e => setShares(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="h-buy">Buy price (per share)</label>
              <input id="h-buy" className="input" type="number" step="0.01" inputMode="decimal" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="h-manual">
                Current price
                <span className="li-auto" title="Left blank, the live market price is fetched automatically. Set a value to override (e.g. when offline).">
                  auto
                </span>
              </label>
              <input id="h-manual" className="input" type="number" step="0.01" inputMode="decimal" value={manualPrice} placeholder="live" onChange={e => setManualPrice(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="h-notes">Notes</label>
            <textarea id="h-notes" className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth recording about this position…" />
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
          {holding && onDelete && (
            <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : holding ? 'Save changes' : 'Add holding'}
          </button>
        </div>
      </div>
    </div>
  );
}

// A compact search-and-pick for attaching a document from the stash, mirroring
// the ledger line-item picker.
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
        optional — attach a brokerage statement or trade confirmation
      </span>
    </div>
  );
}
