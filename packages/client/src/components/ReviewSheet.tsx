import { useEffect, useMemo, useState } from 'react';
import { Copy, FileText, ImageOff, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { QueueItem, useStore } from '../store';
import { nameFromSlug, slugify } from '../lib/categoryMeta';
import { fileKindLabel, isHeicMime, isImageMime } from '../lib/format';
import { ConfidenceMeter } from './Stamps';
import TagEditor from './TagEditor';
import { PdfView } from './Viewer';

function Preview({ item }: { item: QueueItem }) {
  if (item.mime === 'application/pdf') {
    return <PdfView url={item.previewUrl} />;
  }
  if (isHeicMime(item.mime)) {
    return (
      <div className="empty" style={{ padding: '40px 16px' }}>
        <div className="e-icon">
          <ImageOff size={20} strokeWidth={1.6} />
        </div>
        <h3>HEIC preview unavailable</h3>
        <p>Browsers can’t render HEIC, but the AI still read it just fine.</p>
      </div>
    );
  }
  if (isImageMime(item.mime)) {
    return <img src={item.previewUrl} alt={item.name} />;
  }
  // Documents/spreadsheets/emails aren't previewed inline in the review slip —
  // the AI has already read them; the full viewer lives on the document page.
  return (
    <div className="empty" style={{ padding: '40px 16px' }}>
      <div className="e-icon">
        <FileText size={20} strokeWidth={1.6} />
      </div>
      <h3>{fileKindLabel(item.mime)} document</h3>
      <p>The AI read it in full. Open it from the stash for the complete view.</p>
    </div>
  );
}

/**
 * The “filing slip” — a split sheet with the original document on the left
 * and the AI's proposed classification, fully editable, on the right.
 */
export default function ReviewSheet() {
  const { queue, reviewItemId, openReview, fileItem, dismissItem, categories, notify } = useStore();
  const item = queue.find(q => q.id === reviewItemId);

  const cls = item?.classification;
  const [category, setCategory] = useState('');
  const [newCatDraft, setNewCatDraft] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  const [subcategory, setSubcategory] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seed the form whenever a different item is opened.
  useEffect(() => {
    if (!cls) return;
    setCategory(cls.category);
    setSubcategory(cls.subcategory ?? '');
    setSummary(cls.summary);
    setTags(cls.tags);
    setDate(cls.date ?? '');
    setAmount(cls.amount !== undefined && cls.amount !== null ? String(cls.amount) : '');
    setVendor(cls.vendor ?? '');
    setNotes('');
    setNewCatDraft('');
    setCreatingCat(false);
  }, [reviewItemId, cls]);

  // Esc closes (keeps the item in the tray for later).
  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') openReview(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, openReview]);

  // The AI may propose a category that doesn't exist yet — surface it as an
  // option so accepting it is one click. Same for a user-typed new one.
  const options = useMemo(() => {
    const known = categories.map(c => ({ id: c.id, name: c.name, color: c.color, isNew: false }));
    const extra = [category, cls?.category ?? '']
      .filter(slug => slug && !categories.some(c => c.id === slug))
      .filter((slug, i, arr) => arr.indexOf(slug) === i)
      .map(slug => ({ id: slug, name: nameFromSlug(slug), color: '#8d8472', isNew: true }));
    return [...extra, ...known];
  }, [categories, category, cls]);

  if (!item || !cls) return null;

  function addNewCategory() {
    const slug = slugify(newCatDraft);
    if (!slug) return;
    setCategory(slug);
    setNewCatDraft('');
    setCreatingCat(false);
  }

  function discard() {
    if (!item) return;
    dismissItem(item.id);
    notify(`“${item.name}” discarded — nothing was filed`);
  }

  async function submit(flagForLater: boolean) {
    if (!item) return;
    if (!category) {
      notify('Pick a category first', 'err');
      return;
    }
    setBusy(true);
    const parsedAmount = amount.trim() === '' ? undefined : Number(amount);
    const doc = await fileItem(item.id, {
      category,
      subcategory: subcategory.trim() || undefined,
      tags,
      summary: summary.trim(),
      dateExtracted: date || undefined,
      amount: parsedAmount !== undefined && !isNaN(parsedAmount) ? parsedAmount : undefined,
      vendor: vendor.trim() || undefined,
      notes: notes.trim() || undefined,
      confidenceScore: cls?.confidence ?? 0,
      flagForLater,
    });
    setBusy(false);
    if (doc) {
      notify(
        flagForLater
          ? `“${item.name}” filed and flagged for a second look`
          : `“${item.name}” filed under ${nameFromSlug(doc.category)}`,
      );
    }
  }

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && openReview(null)}>
      <div className="sheet" role="dialog" aria-label={`Review ${item.name}`}>
        <div className="sheet-preview">
          <div className="pv-head">Original — {item.name}</div>
          <div className="pv-body">
            <Preview item={item} />
          </div>
        </div>

        <div className="sheet-form">
          <div className="sf-head">
            <div className="page-eyebrow">Filing slip</div>
            <h2>Check the AI’s work</h2>
          </div>

          <div className="sf-body">
            {item.duplicateOf && (
              <div className="dup-banner">
                <Copy size={14} strokeWidth={2} />
                <span>
                  This file is byte-for-byte identical to{' '}
                  <Link to={`/doc/${item.duplicateOf.id}`} onClick={() => openReview(null)}>
                    {item.duplicateOf.originalName}
                  </Link>
                  , already in the stash. You can still file it if you mean to.
                </span>
              </div>
            )}
            <div className="ai-note">
              <Sparkles size={13} style={{ color: 'var(--gold)' }} />
              <span>AI classification</span>
              <ConfidenceMeter value={cls.confidence} />
              {cls.parties.length > 0 && <span>· parties: {cls.parties.join(', ')}</span>}
            </div>

            <div className="field">
              <label className="field-label">Category</label>
              <div className="cat-picker">
                {options.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`cat-option${category === opt.id ? ' selected' : ''}${opt.isNew ? ' new-cat' : ''}`}
                    onClick={() => setCategory(opt.id)}
                  >
                    <span className="swatch" style={{ background: opt.color }} />
                    {opt.name}
                    {opt.isNew && <span style={{ fontSize: 10, opacity: 0.7 }}>new</span>}
                  </button>
                ))}
                {creatingCat ? (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <input
                      className="input"
                      style={{ width: 170, padding: '4px 10px', fontSize: 12.5 }}
                      autoFocus
                      value={newCatDraft}
                      onChange={e => setNewCatDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addNewCategory();
                        if (e.key === 'Escape') setCreatingCat(false);
                      }}
                      placeholder="New category name"
                    />
                    <button type="button" className="btn btn-sm" onClick={addNewCategory}>
                      Add
                    </button>
                  </span>
                ) : (
                  <button type="button" className="cat-option new-cat" onClick={() => setCreatingCat(true)}>
                    <Plus size={12} />
                    New
                  </button>
                )}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="rs-summary">Summary</label>
              <textarea
                id="rs-summary"
                className="textarea"
                value={summary}
                onChange={e => setSummary(e.target.value)}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="rs-vendor">Vendor / issuer</label>
                <input id="rs-vendor" className="input" value={vendor} onChange={e => setVendor(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="rs-sub">Subcategory</label>
                <input id="rs-sub" className="input" value={subcategory} onChange={e => setSubcategory(e.target.value)} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="rs-date">Document date</label>
                <input id="rs-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="rs-amount">Amount</label>
                <input
                  id="rs-amount"
                  className="input"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Tags</label>
              <TagEditor tags={tags} onChange={setTags} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="rs-notes">Your notes</label>
              <textarea
                id="rs-notes"
                className="textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Anything future-you should know…"
              />
            </div>
          </div>

          <div className="sf-foot">
            <button className="btn btn-primary" onClick={() => submit(false)} disabled={busy}>
              {busy ? 'Filing…' : 'File it'}
            </button>
            <button className="btn" onClick={() => submit(true)} disabled={busy}>
              File &amp; flag for later
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-danger" onClick={discard} disabled={busy}>
              <Trash2 size={14} />
              Discard
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => openReview(null)} aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
