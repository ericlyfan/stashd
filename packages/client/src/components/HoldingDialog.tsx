import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Link2, Plus, Trash2, X } from 'lucide-react';
import { HoldingInput, HoldingLot, HoldingWithQuote } from '@stashd/shared';
import { addLot, deleteLot, listLots, updateLot } from '../api';
import { useStore } from '../store';
import { formatAmount } from '../lib/format';

interface Props {
  holding?: HoldingWithQuote; // present when editing, absent when adding
  initialSymbol?: string; // prefill the ticker when adding (e.g. from a stock page)
  busy?: boolean;
  onSave: (input: HoldingInput) => void;
  onDelete?: () => void;
  onClose: () => void;
  onLotsChanged?: () => void; // re-price the portfolio after a lot edit
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

function positive(v: string): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

export default function HoldingDialog({ holding, initialSymbol, busy, onSave, onDelete, onClose, onLotsChanged }: Props) {
  const { docs, notify } = useStore();

  const [symbol, setSymbol] = useState(holding?.symbol ?? initialSymbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [shares, setShares] = useState(str(holding?.shares));
  const [buyPrice, setBuyPrice] = useState(str(holding?.buyPrice));
  const [manualPrice, setManualPrice] = useState(str(holding?.manualPrice));
  const [currency, setCurrency] = useState(holding?.currency ?? '');
  const [notes, setNotes] = useState(holding?.notes ?? '');
  const [documentId, setDocumentId] = useState<string | undefined>(holding?.documentId);

  function submit() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const shareCount = positive(shares);
    const cost = positive(buyPrice);
    const manual = manualPrice.trim() ? positive(manualPrice) : undefined;
    if (shareCount === undefined || cost === undefined || (manualPrice.trim() && manual === undefined)) {
      notify('Shares, buy price and current price must be greater than zero', 'err');
      return;
    }
    const ccy = currency.trim().toUpperCase();
    if (ccy && !/^[A-Z]{3}$/.test(ccy)) {
      notify('Currency must be a 3-letter code', 'err');
      return;
    }
    onSave({
      symbol: sym,
      name: name.trim() || undefined,
      shares: shareCount,
      buyPrice: cost,
      manualPrice: manual,
      currency: ccy || undefined,
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
          <p className="li-doc-hint" style={{ marginTop: -6, marginBottom: 12 }}>
            <Link2 size={11} />
            For a non-US listing, use the exchange-suffixed ticker (e.g. <b>VFV.TO</b> for the TSX) — its
            price and currency are detected automatically.
          </p>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="h-shares">Shares</label>
              <input id="h-shares" className="input" type="number" min="0.00000001" step="any" inputMode="decimal" value={shares} onChange={e => setShares(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="h-buy">Buy price (per share)</label>
              <input id="h-buy" className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="h-manual">
                Current price
                <span className="li-auto" title="Left blank, the live market price is fetched automatically. Set a value to override (e.g. when offline).">
                  auto
                </span>
              </label>
              <input id="h-manual" className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={manualPrice} placeholder="live" onChange={e => setManualPrice(e.target.value)} />
            </div>
            <div className="field" style={{ maxWidth: 110 }}>
              <label className="field-label" htmlFor="h-ccy">
                Currency
                <span className="li-auto" title="Left blank, the currency is taken from the live quote. Set it for manually-priced or offline holdings.">
                  auto
                </span>
              </label>
              <input
                id="h-ccy"
                className="input"
                value={currency}
                placeholder="USD"
                maxLength={3}
                style={{ textTransform: 'uppercase' }}
                onChange={e => setCurrency(e.target.value)}
              />
            </div>
          </div>

          {holding ? (
            <LotsEditor holdingId={holding.id} onChange={onLotsChanged} />
          ) : (
            <p className="li-doc-hint" style={{ marginTop: -4 }}>
              <Link2 size={11} />
              Save the holding, then add dated buys/sells for accurate history and realized gains.
            </p>
          )}

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

const today = () => new Date().toISOString().slice(0, 10);

// Net open shares, average cost and realized gain from a lot list — a client
// mirror of the server's average-cost accounting, for the section header so it
// stays live as lots are added/removed.
function summarize(lots: HoldingLot[]): { shares: number; avgCost: number; realized: number } {
  const ordered = [...lots].sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  let shares = 0;
  let cost = 0;
  let realized = 0;
  for (const lot of ordered) {
    const fee = lot.fee ?? 0;
    if (lot.type === 'buy') {
      shares += lot.shares;
      cost += lot.shares * lot.price + fee;
    } else {
      const avg = shares > 0 ? cost / shares : 0;
      realized += lot.shares * (lot.price - avg) - fee;
      shares -= lot.shares;
      cost -= lot.shares * avg;
      if (Math.abs(shares) <= 1e-9) { shares = 0; cost = 0; }
    }
  }
  return { shares, avgCost: shares > 0 ? cost / shares : 0, realized };
}

function oversellMessage(lots: HoldingLot[]): string | undefined {
  const ordered = [...lots].sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  let shares = 0;
  for (const lot of ordered) {
    if (lot.type === 'buy') {
      shares += lot.shares;
    } else if (lot.shares > shares + 1e-9) {
      return `Only ${+shares.toFixed(8)} shares are available to sell on ${lot.date}`;
    } else {
      shares -= lot.shares;
      if (shares <= 1e-9) shares = 0;
    }
  }
  return undefined;
}

// Dated buy/sell transactions for a holding. When present they are the source
// of truth for the position (see the server's positions.ts).
function LotsEditor({ holdingId, onChange }: { holdingId: string; onChange?: () => void }) {
  const { notify } = useStore();
  const [lots, setLots] = useState<HoldingLot[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(today());
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLots(await listLots(holdingId));
    } catch {
      setLots([]);
    }
  }, [holdingId]);

  useEffect(() => { void reload(); }, [reload]);

  function resetForm() {
    setEditingId(null);
    setType('buy');
    setDate(today());
    setShares('');
    setPrice('');
    setFee('');
  }

  function editRow(lot: HoldingLot) {
    setEditingId(lot.id);
    setType(lot.type);
    setDate(lot.date);
    setShares(String(lot.shares));
    setPrice(String(lot.price));
    setFee(lot.fee !== undefined ? String(lot.fee) : '');
  }

  async function submitLot() {
    const s = num(shares);
    const p = num(price);
    const f = fee.trim() ? num(fee) : undefined;
    if (!date || s === undefined || s <= 0 || p === undefined || p <= 0 || f !== undefined && f <= 0) {
      notify('A transaction needs a date, positive shares, a positive price and a positive fee when set', 'err');
      return;
    }
    if (type === 'sell' && lots) {
      const existing = editingId ? lots.find(lot => lot.id === editingId) : undefined;
      const candidate: HoldingLot = {
        id: editingId ?? '__new__',
        holdingId,
        type,
        date,
        shares: s,
        price: p,
        fee: f,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      const nextLots = editingId
        ? lots.map(lot => (lot.id === editingId ? candidate : lot))
        : [...lots, candidate];
      const message = oversellMessage(nextLots);
      if (message) {
        notify(message, 'err');
        return;
      }
    }
    const input = { type, date, shares: s, price: p, fee: f };
    setSaving(true);
    try {
      if (editingId) await updateLot(holdingId, editingId, input);
      else await addLot(holdingId, input);
      resetForm();
      await reload();
      onChange?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the transaction', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(lot: HoldingLot) {
    try {
      await deleteLot(holdingId, lot.id);
      if (editingId === lot.id) resetForm();
      await reload();
      onChange?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete the transaction', 'err');
    }
  }

  const sum = lots ? summarize(lots) : null;

  return (
    <div className="field lots">
      <label className="field-label">
        Transactions
        {sum && lots && lots.length > 0 && (
          <span className="lots-summary">
            {+sum.shares.toFixed(4)} sh · avg {formatAmount(sum.avgCost)}
            {sum.realized !== 0 && <> · {sum.realized >= 0 ? '+' : '−'}{formatAmount(Math.abs(sum.realized))} realized</>}
          </span>
        )}
      </label>

      {lots && lots.length > 0 && (
        <div className="lots-list">
          {lots.map(lot => (
            <div key={lot.id} className={`lot-row${editingId === lot.id ? ' editing' : ''}`}>
              <button type="button" className="lot-main" onClick={() => editRow(lot)} title="Edit">
                <span className="lot-date">{lot.date}</span>
                <span className={`lot-type lot-${lot.type}`}>{lot.type === 'buy' ? 'BUY' : 'SELL'}</span>
                <span className="lot-detail">{+lot.shares.toFixed(4)} @ {formatAmount(lot.price)}</span>
                {lot.fee ? <span className="lot-fee">fee {formatAmount(lot.fee)}</span> : null}
              </button>
              <button type="button" className="lot-del" onClick={() => removeRow(lot)} aria-label="Delete transaction">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="lot-form">
        <div className="lot-typetoggle">
          <button type="button" className={type === 'buy' ? 'active' : ''} onClick={() => setType('buy')}>Buy</button>
          <button type="button" className={type === 'sell' ? 'active' : ''} onClick={() => setType('sell')}>Sell</button>
        </div>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Trade date" />
        <input className="input" type="number" min="0.00000001" step="any" inputMode="decimal" placeholder="shares" value={shares} onChange={e => setShares(e.target.value)} aria-label="Shares" />
        <input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="price" value={price} onChange={e => setPrice(e.target.value)} aria-label="Price" />
        <input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="fee" value={fee} onChange={e => setFee(e.target.value)} aria-label="Fee" />
        <button type="button" className="btn btn-sm btn-primary" onClick={submitLot} disabled={saving}>
          {editingId ? 'Update' : <><Plus size={12} /> Add</>}
        </button>
        {editingId && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={resetForm} disabled={saving}>Cancel</button>
        )}
      </div>
      <span className="li-doc-hint" style={{ marginTop: 2 }}>
        With no transactions, the shares &amp; buy price above are treated as a single undated lot.
      </span>
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
