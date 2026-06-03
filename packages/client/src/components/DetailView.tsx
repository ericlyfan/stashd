import { useState } from 'react';
import { Document } from '@stashd/shared';
import { updateDocument } from '../api/client';
import { getCategoryMeta, IconSparkle, IconCalendar, IconDollar, IconBuilding, IconClock, IconPlus, IconTag, IconNote } from './icons';
import { Tag, fmtDate, fmtMoney, relTime, isImageFile } from './InboxView';

// ── DocPreview ────────────────────────────────────────────────────────────────

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

function DocPreview({ doc }: { doc: Document }) {
  const fileUrl = `/api/documents/${doc.id}/file`;

  if (HEIC_MIMES.has(doc.fileType)) {
    return <UnsupportedPreview doc={doc} fileUrl={fileUrl} reason="HEIC images can't be previewed in-browser." />;
  }

  if (isImageFile(doc.fileType)) {
    return (
      <img
        src={fileUrl}
        alt={doc.originalName}
        style={{
          display: 'block', maxWidth: '100%', maxHeight: '100%',
          margin: '0 auto', borderRadius: 6,
          background: '#fff',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        }}
      />
    );
  }

  if (doc.fileType === 'application/pdf') {
    return (
      <iframe
        src={fileUrl}
        title={doc.originalName}
        style={{
          width: '100%', height: '100%', minHeight: 480,
          border: 'none', borderRadius: 6, background: '#fff',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        }}
      />
    );
  }

  return <UnsupportedPreview doc={doc} fileUrl={fileUrl} reason="This file type can't be previewed in-app." />;
}

function UnsupportedPreview({ doc, fileUrl, reason }: { doc: Document; fileUrl: string; reason: string }) {
  const meta = getCategoryMeta(doc.category);
  const Ico = meta.icon;
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      boxShadow: '0 8px 30px rgba(0,0,0,0.10)',
      width: 320, padding: '32px 24px',
      margin: '0 auto', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: `${meta.color}18`, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><Ico size={26} /></div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
          {doc.originalName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {reason}
        </div>
      </div>
      <a
        href={fileUrl}
        target="_blank"
        rel="noreferrer"
        download={doc.originalName}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 6,
          background: 'var(--accent)', color: '#fff',
          fontSize: 12, fontWeight: 600, textDecoration: 'none',
        }}
      >
        <IconNote size={12} />Open file
      </a>
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
        borderRight: '0.5px solid var(--line)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          flex: 1, minHeight: 0,
          padding: '24px 24px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'auto',
        }}>
          <DocPreview doc={doc} />
        </div>
        <div style={{
          textAlign: 'center', fontSize: 10.5, color: 'var(--ink-3)',
          padding: '0 24px 14px', fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
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
