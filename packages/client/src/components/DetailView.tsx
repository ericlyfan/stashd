import { useState } from 'react';
import { Document } from '@stashd/shared';
import { updateDocument } from '../api/client';
import { getCategoryMeta, IconSparkle, IconCalendar, IconDollar, IconBuilding, IconClock, IconPlus, IconTag } from './icons';
import { Tag, fmtDate, fmtMoney, relTime, isImageFile } from './InboxView';

// ── DocPreview ────────────────────────────────────────────────────────────────

function DocPreview({ doc }: { doc: Document }) {
  const meta = getCategoryMeta(doc.category);

  if (isImageFile(doc.fileType)) {
    return (
      <div style={{
        background: '#fff', borderRadius: 6,
        boxShadow: '0 8px 30px rgba(0,0,0,0.10)',
        width: 280, padding: '24px 22px',
        margin: '0 auto',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 11, color: '#222', lineHeight: 1.6,
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, letterSpacing: 0.4 }}>
          {(doc.vendor || 'RECEIPT').toUpperCase()}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: '#666', marginBottom: 14 }}>
          {fmtDate(doc.dateExtracted)}
        </div>
        <div style={{ borderTop: '1px dashed #aaa', borderBottom: '1px dashed #aaa', padding: '8px 0', marginBottom: 8 }}>
          {(['Receipt for', 'Item 1', 'Item 2', 'Item 3', 'Subtotal'] as const).map((k, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{k}</span>
              <span>{i > 0 ? '—' : ''}</span>
            </div>
          ))}
        </div>
        {doc.amount != null ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>TOTAL</span><span>{fmtMoney(doc.amount)}</span>
          </div>
        ) : null}
        <div style={{ marginTop: 14, fontSize: 9, color: '#888', textAlign: 'center' }}>
          THANK YOU FOR YOUR PURCHASE<br />★ ★ ★ ★ ★
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 4,
      boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
      width: 320, aspectRatio: '8.5 / 11',
      margin: '0 auto', padding: '32px 30px',
      position: 'relative', fontSize: 9, color: '#222',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 16, fontWeight: 600, color: meta.color, marginBottom: 4,
      }}>{doc.subcategory || 'Document'}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 14 }}>
        {doc.originalName}
      </div>
      <div style={{ height: 0.5, background: '#ddd', marginBottom: 12 }} />
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} style={{
          height: 3, background: 'rgba(0,0,0,0.08)', borderRadius: 1,
          marginBottom: 5, width: `${65 + ((i * 13) % 30)}%`,
        }} />
      ))}
      <div style={{ height: 12 }} />
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} style={{
          height: 3, background: 'rgba(0,0,0,0.08)', borderRadius: 1,
          marginBottom: 5, width: `${55 + ((i * 17) % 35)}%`,
        }} />
      ))}
      <div style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 8, color: '#999' }}>
        1 / 1
      </div>
    </div>
  );
}

// ── MetaField ─────────────────────────────────────────────────────────────────

function MetaField({ icon: Ico, label, value, mono }: {
  icon?: typeof IconCalendar;
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '0.5px solid var(--line)' }}>
      <div style={{ width: 76, fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
        {Ico ? <Ico size={11} /> : null}
        {label}
      </div>
      <div style={{
        flex: 1, fontSize: 12, color: 'var(--ink)', fontWeight: 500,
        fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
        letterSpacing: -0.05,
      }}>{value}</div>
    </div>
  );
}

// ── DetailView ────────────────────────────────────────────────────────────────

interface DetailViewProps {
  doc: Document;
  onCategoryClick: (categoryId: string) => void;
  onDocUpdated: (doc: Document) => void;
}

export default function DetailView({ doc, onCategoryClick, onDocUpdated }: DetailViewProps) {
  const meta = getCategoryMeta(doc.category);
  const Ico = meta.icon;
  const [notes, setNotes] = useState(doc.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSaveNotes() {
    if (notes === (doc.notes ?? '')) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { notes });
      onDocUpdated(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Preview pane */}
      <div style={{
        flex: 1.3, minWidth: 0,
        background: '#ebe8e1',
        padding: '32px 24px',
        overflow: 'auto',
        borderRight: '0.5px solid var(--line)',
      }}>
        <DocPreview doc={doc} />
        <div style={{
          textAlign: 'center', fontSize: 10.5, color: 'var(--ink-3)',
          marginTop: 12, fontVariantNumeric: 'tabular-nums',
        }}>
          {doc.filename}
        </div>
      </div>

      {/* Meta pane */}
      <div style={{
        width: 320, flexShrink: 0,
        background: 'var(--surface)',
        overflow: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 20px 12px' }}>
          <button
            onClick={() => onCategoryClick(doc.category)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 7px 2px 6px', borderRadius: 4,
              background: `${meta.color}10`, color: meta.color,
              fontSize: 10.5, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              marginBottom: 10, letterSpacing: 0.05,
            }}
          >
            <Ico size={10} />
            {doc.category.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' & ')}
            {doc.subcategory ? <span style={{ opacity: 0.6 }}>· {doc.subcategory}</span> : null}
          </button>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)',
            fontSize: 17, fontWeight: 600, letterSpacing: -0.2,
            color: 'var(--ink)', lineHeight: 1.25,
          }}>{doc.originalName}</h2>
        </div>

        {/* AI Summary */}
        {doc.summary ? (
          <div style={{ padding: '0 20px 16px' }}>
            <div style={{
              padding: 11,
              background: 'rgba(0,0,0,0.025)',
              border: '0.5px solid var(--line)',
              borderRadius: 7,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5,
                fontSize: 9.5, fontWeight: 700, color: 'var(--accent)',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                <IconSparkle size={10} /> AI Summary
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, letterSpacing: -0.05 }}>
                {doc.summary}
              </div>
            </div>
          </div>
        ) : null}

        {/* Fields */}
        <div style={{ padding: '0 20px' }}>
          <MetaField icon={IconCalendar} label="Date" value={fmtDate(doc.dateExtracted)} mono />
          <MetaField icon={IconDollar} label="Amount" value={doc.amount != null ? fmtMoney(doc.amount) : null} mono />
          <MetaField icon={IconBuilding} label="Vendor" value={doc.vendor} />
          <MetaField icon={IconClock} label="Added" value={`${relTime(doc.createdAt)} · ${fmtDate(doc.createdAt)}`} />
          <MetaField icon={IconSparkle} label="Confidence" value={`${Math.round(doc.confidenceScore * 100)}%`} mono />
        </div>

        {/* Tags */}
        {doc.tags.length > 0 ? (
          <div style={{ padding: '16px 20px' }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
            }}><IconTag size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />Tags</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {doc.tags.map(t => <Tag key={t} color={meta.color}>{t}</Tag>)}
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 6px 1px 4px', borderRadius: 3,
                background: 'transparent',
                border: '0.5px dashed var(--line-strong)',
                color: 'var(--ink-3)', fontSize: 10.5, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}><IconPlus size={10} />Add tag</button>
            </div>
          </div>
        ) : null}

        {/* Notes */}
        <div style={{ padding: '2px 20px 20px' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--ink-3)',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
          }}>Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleSaveNotes}
            placeholder="Add a personal note…"
            style={{
              width: '100%', minHeight: 60, padding: 8,
              background: 'var(--surface-2)', border: '0.5px solid var(--line)',
              borderRadius: 6, resize: 'vertical',
              fontSize: 12, color: 'var(--ink)', outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, letterSpacing: -0.05,
            }}
          />
          {saving ? <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Saving…</div> : null}
        </div>
      </div>
    </div>
  );
}
