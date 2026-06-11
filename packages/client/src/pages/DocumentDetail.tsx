import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { getDocument, updateDocument, deleteDocument } from '../api/client';
import { useApp } from '../state';
import { fmtDate, fmtMoney, relTime, categoryLabel } from '../lib/format';
import {
  IconArrowLeft, IconCalendar, IconDollar, IconBuilding, IconClock,
  IconSparkle, IconTag, IconTrash, IconX, IconFolder,
} from '../components/icons';
import DocumentViewer from '../components/DocumentViewer';
import CategorySelect from '../components/CategorySelect';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

function MetaRow({ icon: Ico, label, value, mono }: {
  icon: typeof IconCalendar;
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ width: 84, fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Ico size={11} />{label}
      </div>
      <div style={{
        flex: 1, fontSize: 12.5, color: 'var(--ink)', fontWeight: 500,
        fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
      }}>{value}</div>
    </div>
  );
}

export default function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refresh, categoryById } = useApp();

  const [doc, setDoc] = useState<Document | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notes, setNotes] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getDocument(id)
      .then(d => { if (!cancelled) { setDoc(d); setNotes(d.notes ?? ''); } })
      .catch(() => { if (!cancelled) setNotFound(true); });
    return () => { cancelled = true; };
  }, [id]);

  async function patch(updates: { category?: string; tags?: string[]; notes?: string }) {
    if (!doc) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, updates);
      setDoc(updated);
      await refresh();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!doc) return;
    setDeleting(true);
    try {
      await deleteDocument(doc.id);
      await refresh();
      navigate(-1);
    } catch (err) {
      console.error('Delete failed', err);
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div style={{ paddingTop: 60 }}>
        <EmptyState icon={IconFolder} title="Document not found" subtitle="It may have been deleted." />
      </div>
    );
  }
  if (!doc) {
    return <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>Loading…</div>;
  }

  const cat = categoryById(doc.category);
  const color = cat?.color ?? 'var(--accent)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Page header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 18px',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 28, padding: '0 10px',
            background: 'rgba(28,25,23,0.05)', border: 'none', borderRadius: 7,
            color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
          }}
        ><IconArrowLeft size={13} />Back</button>
        <div style={{
          flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{doc.originalName}</div>
        <button
          onClick={() => setConfirming(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 28, padding: '0 11px',
            background: 'rgba(220,38,38,0.08)', border: 'none', borderRadius: 7,
            color: 'var(--red)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          }}
        ><IconTrash size={13} />Delete</button>
      </div>

      {/* Two-pane body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Preview — left 2/3, scrolls within the page; the viewer manages
            its own sticky toolbar and padding */}
        <div style={{
          flex: 2, minWidth: 0,
          background: 'var(--surface-2)',
          borderRight: '0.5px solid var(--line)',
          overflow: 'auto',
        }}>
          <DocumentViewer doc={doc} />
        </div>

        {/* Metadata — right 1/3 */}
        <div style={{
          flex: 1, minWidth: 300, maxWidth: 380,
          background: 'var(--surface)',
          overflow: 'auto',
          padding: '20px 20px 28px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div>
            <h2 style={{
              margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
              fontSize: 19, letterSpacing: 0.1, color: 'var(--ink)', lineHeight: 1.3,
            }}>{doc.originalName}</h2>
            {doc.status === 'pending' ? (
              <span style={{
                display: 'inline-block', marginTop: 6,
                padding: '2px 8px', borderRadius: 4,
                background: 'rgba(217,119,6,0.12)', color: 'var(--amber)',
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
              }}>FLAGGED FOR REVIEW</span>
            ) : null}
          </div>

          {/* Category (editable) */}
          <div>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
            }}>Category</div>
            <CategorySelect compact value={doc.category} onChange={(catId) => patch({ category: catId })} />
          </div>

          {/* AI Summary */}
          {doc.summary ? (
            <div style={{
              padding: 12,
              background: 'var(--accent-tint)',
              border: '0.5px solid rgba(13,148,136,0.2)',
              borderRadius: 9,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5,
                fontSize: 9.5, fontWeight: 700, color: 'var(--accent)',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}><IconSparkle size={10} />AI Summary</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{doc.summary}</div>
            </div>
          ) : null}

          {/* Fields */}
          <div>
            <MetaRow icon={IconCalendar} label="Date" value={fmtDate(doc.dateExtracted)} mono />
            <MetaRow icon={IconDollar} label="Amount" value={doc.amount != null ? fmtMoney(doc.amount) : null} mono />
            <MetaRow icon={IconBuilding} label="Vendor" value={doc.vendor} />
            <MetaRow icon={IconClock} label="Added" value={`${relTime(doc.createdAt)} · ${fmtDate(doc.createdAt)}`} />
            <MetaRow icon={IconSparkle} label="Confidence" value={`${Math.round(doc.confidenceScore * 100)}%`} mono />
            {doc.subcategory ? <MetaRow icon={IconFolder} label="Subcategory" value={categoryLabel(doc.subcategory)} /> : null}
          </div>

          {/* Tags (editable) */}
          <div>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 4,
            }}><IconTag size={10} />Tags</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {doc.tags.map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px 2px 8px', borderRadius: 5,
                  background: `${color}12`, color,
                  fontSize: 11.5, fontWeight: 500,
                }}>
                  {t}
                  <button
                    onClick={() => patch({ tags: doc.tags.filter(x => x !== t) })}
                    style={{
                      width: 15, height: 15, borderRadius: 8,
                      background: 'rgba(28,25,23,0.07)', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--ink-3)', cursor: 'pointer', padding: 0,
                    }}
                  ><IconX size={8} /></button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    const t = tagDraft.trim();
                    if (!doc.tags.includes(t)) patch({ tags: [...doc.tags, t] });
                    setTagDraft('');
                  }
                }}
                placeholder="Add tag ↵"
                style={{
                  width: 86, padding: '3px 8px',
                  background: 'var(--surface-2)',
                  border: '0.5px dashed var(--line-strong)', borderRadius: 5,
                  fontSize: 11.5, color: 'var(--ink)', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Notes (auto-save on blur) */}
          <div>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
            }}>Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (doc.notes ?? '')) patch({ notes }); }}
              placeholder="Add a personal note…"
              style={{
                width: '100%', minHeight: 76, padding: 10,
                background: 'var(--surface-2)', border: '0.5px solid var(--line)',
                borderRadius: 8, resize: 'vertical',
                fontSize: 12.5, color: 'var(--ink)', outline: 'none',
                lineHeight: 1.55,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 4, height: 14 }}>
              {saving ? 'Saving…' : 'Saved automatically'}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete document?"
        message={`"${doc.originalName}" and its stored file will be permanently removed. This can't be undone.`}
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
