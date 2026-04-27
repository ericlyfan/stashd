import { useState, useEffect } from 'react';
import { fileDocument, ClassificationResult } from '../api/client';
import { CATEGORY_META, getCategoryMeta, CategoryIconComponent } from './icons';
import {
  IconSparkle, IconCamera, IconNote, IconChevronDown, IconCheck, IconX, IconPlus,
} from './icons';
import { PrimaryButton, GhostButton } from './chrome';
import { PendingJob, fmtDate, fmtMoney, isImageFile } from './InboxView';
import { CategoryId } from '@stashd/shared';

// ── ConfidenceBar ─────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? 'var(--green)' : value >= 0.7 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
      <div style={{
        fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums',
        minWidth: 36, textAlign: 'right',
      }}>{pct}%</div>
    </div>
  );
}

// ── CategoryChooser ───────────────────────────────────────────────────────────

const ALL_CATEGORIES = Object.entries(CATEGORY_META).map(([id, meta]) => ({ id: id as CategoryId, ...meta }));

function CategoryChooser({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = getCategoryMeta(value);
  const Ico = meta.icon;
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '10px 12px',
          background: 'var(--surface)',
          border: '0.5px solid var(--line-strong)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: 6,
          background: `${meta.color}18`, color: meta.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Ico size={14} /></span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
          {value.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}
        </span>
        <IconChevronDown size={14} style={{ color: 'var(--ink-3)' }} />
      </button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--surface)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.1)',
            padding: 4, zIndex: 10,
            maxHeight: 300, overflow: 'auto',
          }}>
            {ALL_CATEGORIES.map(({ id, icon: CatIco, color }) => (
              <button
                key={id}
                onClick={() => { onChange(id); setOpen(false); }}
                onMouseEnter={(e) => { if (id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={(e) => { if (id !== value) (e.currentTarget as HTMLButtonElement).style.background = id === value ? 'var(--accent-tint)' : 'transparent'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '6px 8px',
                  background: id === value ? 'var(--accent-tint)' : 'transparent',
                  border: 'none', borderRadius: 6,
                  cursor: 'pointer', textAlign: 'left',
                  fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
                }}
              >
                <span style={{ color, display: 'flex' }}><CatIco size={15} /></span>
                <span style={{ flex: 1 }}>
                  {id.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}
                </span>
                {id === value ? <IconCheck size={13} style={{ color: 'var(--accent)' }} /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── EditableField ─────────────────────────────────────────────────────────────

function EditableField({ label, value, onChange, prefix, mono }: {
  label: string;
  value?: string | number | null;
  onChange: (v: string) => void;
  prefix?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'var(--surface)',
        border: '0.5px solid var(--line-strong)', borderRadius: 8,
        padding: '8px 12px',
      }}>
        {prefix ? <span style={{ color: 'var(--ink-3)', marginRight: 6 }}>{prefix}</span> : null}
        <input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
            fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
          }}
        />
      </div>
    </div>
  );
}

// ── Mini doc preview ──────────────────────────────────────────────────────────

function MiniDocPreview({ job, merged }: { job: PendingJob; merged: Partial<ClassificationResult> }) {
  const meta = getCategoryMeta(merged.category ?? job.classification.category);
  if (isImageFile(job.fileType)) {
    return (
      <div style={{
        background: '#fff', borderRadius: 6,
        boxShadow: '0 8px 30px rgba(0,0,0,0.10)',
        width: 240, padding: '24px 20px',
        margin: '0 auto',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 11, color: '#222', lineHeight: 1.6,
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, letterSpacing: 0.4 }}>
          {(merged.vendor || 'RECEIPT').toUpperCase()}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: '#666', marginBottom: 12 }}>
          {fmtDate(merged.date)}
        </div>
        <div style={{ borderTop: '1px dashed #ccc', borderBottom: '1px dashed #ccc', padding: '6px 0', marginBottom: 8 }}>
          {['Item 1', 'Item 2', 'Item 3'].map((k, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span>{k}</span><span>—</span>
            </div>
          ))}
        </div>
        {merged.amount != null ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>TOTAL</span><span>{fmtMoney(merged.amount)}</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{
      background: '#fff', borderRadius: 4,
      boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
      width: 260, aspectRatio: '8.5 / 11',
      margin: '0 auto', padding: '24px 22px',
      fontSize: 9, color: '#222',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: meta.color, marginBottom: 4 }}>
        {merged.category?.split('-')[0] ?? 'Document'}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#111', marginBottom: 10 }}>
        {job.fileName}
      </div>
      <div style={{ height: 0.5, background: '#ddd', marginBottom: 10 }} />
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} style={{
          height: 3, background: 'rgba(0,0,0,0.08)', borderRadius: 1,
          marginBottom: 4, width: `${65 + ((i * 13) % 30)}%`,
        }} />
      ))}
    </div>
  );
}

// ── ReviewView ────────────────────────────────────────────────────────────────

interface ReviewViewProps {
  pendingJobs: PendingJob[];
  onFiled: (jobId: string) => void;
  onSkip: (jobId: string) => void;
  onDiscard: (jobId: string) => void;
}

export default function ReviewView({ pendingJobs, onFiled, onSkip, onDiscard }: ReviewViewProps) {
  const [idx, setIdx] = useState(0);
  const [edits, setEdits] = useState<Record<string, Partial<ClassificationResult>>>({});
  const [filing, setFiling] = useState(false);

  useEffect(() => {
    setIdx(0);
  }, [pendingJobs.length]);

  if (pendingJobs.length === 0) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'rgba(46,158,91,0.12)', color: 'var(--green)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}><IconCheck size={28} /></div>
        <div style={{
          fontSize: 18, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4,
          fontFamily: 'var(--font-display)',
        }}>All caught up</div>
        <div style={{ fontSize: 13 }}>Nothing waiting to review.</div>
      </div>
    );
  }

  const cur = pendingJobs[Math.min(idx, pendingJobs.length - 1)];
  const overlay = edits[cur.jobId] ?? {};
  const merged: ClassificationResult = { ...cur.classification, ...overlay };
  const setField = (k: keyof ClassificationResult, v: unknown) =>
    setEdits(e => ({ ...e, [cur.jobId]: { ...e[cur.jobId], [k]: v } }));

  async function handleFile() {
    setFiling(true);
    try {
      await fileDocument(cur.jobId, {
        category: merged.category,
        subcategory: merged.subcategory,
        tags: merged.tags ?? [],
        summary: merged.summary ?? '',
        dateExtracted: merged.date,
        amount: merged.amount,
        vendor: merged.vendor,
        confidenceScore: merged.confidence,
      });
      onFiled(cur.jobId);
    } catch (err) {
      console.error('Filing failed', err);
    } finally {
      setFiling(false);
    }
  }

  return (
    <div style={{ padding: '20px 32px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)',
            fontSize: 28, fontWeight: 600, letterSpacing: -0.4,
          }}>Review & file</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
            Confirm Stash'd got it right. Override anything that's off.
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
          {idx + 1} of {pendingJobs.length}
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', borderRadius: 16,
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        display: 'grid', gridTemplateColumns: '1fr 1.2fr',
      }}>
        {/* Left: preview */}
        <div style={{
          background: '#ebe8e1', padding: '32px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRight: '0.5px solid var(--line)',
        }}>
          <MiniDocPreview job={cur} merged={overlay} />
        </div>

        {/* Right: form */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
          {/* AI badge + confidence */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px',
            background: 'var(--accent-tint)',
            border: '0.5px solid var(--accent-soft)',
            borderRadius: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}><IconSparkle size={14} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
                Stash'd classified this document
              </div>
              <ConfidenceBar value={merged.confidence} />
            </div>
          </div>

          {/* File name */}
          <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {isImageFile(cur.fileType) ? <IconCamera size={12} /> : <IconNote size={12} />}
            {cur.fileName}
          </div>

          {/* Summary */}
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
            }}>Summary</div>
            <div style={{
              padding: '10px 12px',
              background: 'var(--surface-2)',
              border: '0.5px solid var(--line)', borderRadius: 8,
              fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>{merged.summary}</div>
          </div>

          {/* Category */}
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
            }}>Category</div>
            <CategoryChooser value={merged.category} onChange={(v) => setField('category', v as CategoryId)} />
          </div>

          {/* Date / Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <EditableField label="Date" value={merged.date} onChange={(v) => setField('date', v)} mono />
            <EditableField label="Amount" prefix="$" value={merged.amount ?? ''} onChange={(v) => setField('amount', parseFloat(v) || undefined)} mono />
          </div>
          <EditableField label="Vendor" value={merged.vendor} onChange={(v) => setField('vendor', v)} />

          {/* Tags */}
          <div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
            }}>Tags</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(merged.tags ?? []).map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 4px 3px 8px', borderRadius: 5,
                  background: 'rgba(0,0,0,0.05)',
                  fontSize: 12, color: 'var(--ink-2)',
                }}>
                  {t}
                  <button
                    onClick={() => setField('tags', (merged.tags ?? []).filter(x => x !== t))}
                    style={{
                      width: 16, height: 16, borderRadius: 8,
                      background: 'rgba(0,0,0,0.08)', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  ><IconX size={9} /></button>
                </span>
              ))}
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '3px 8px 3px 5px', borderRadius: 5,
                background: 'transparent',
                border: '0.5px dashed var(--line-strong)',
                color: 'var(--ink-3)', fontSize: 12, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}><IconPlus size={11} />Add</button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <GhostButton onClick={() => onDiscard(cur.jobId)}>
          <IconX size={13} />Discard
        </GhostButton>
        <div style={{ flex: 1 }} />
        {pendingJobs.length > 1 ? (
          <GhostButton onClick={() => { onSkip(cur.jobId); setIdx((idx + 1) % pendingJobs.length); }}>
            Skip for now
          </GhostButton>
        ) : null}
        <PrimaryButton onClick={handleFile} disabled={filing}>
          <IconCheck size={14} />
          {filing ? 'Filing…' : `File in ${merged.category.split('-')[0].charAt(0).toUpperCase() + merged.category.split('-')[0].slice(1)}`}
        </PrimaryButton>
      </div>
    </div>
  );
}
