import { useState } from 'react';
import { ClassificationResult, fileDocument } from '../api/client';
import { useApp } from '../state';
import { categoryLabel, isImageFile } from '../lib/format';
import { IconCamera, IconCheck, IconClock, IconNote, IconSparkle, IconX, IconPlus } from './icons';
import { PrimaryButton, GhostButton } from './chrome';
import CategorySelect from './CategorySelect';

const AUTO_ACCEPT_THRESHOLD = 0.75;

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= AUTO_ACCEPT_THRESHOLD ? 'var(--green)' : value >= 0.5 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(28,25,23,0.07)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <div style={{
        fontSize: 11.5, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums',
        minWidth: 34, textAlign: 'right',
      }}>{pct}%</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
      }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  background: 'var(--surface)',
  border: '0.5px solid var(--line-strong)', borderRadius: 7,
  fontSize: 12.5, color: 'var(--ink)', outline: 'none',
};

interface ClassificationReviewProps {
  jobId: string;
  fileName: string;
  fileType: string;
  classification: ClassificationResult;
  onFiled: () => void;
  onDiscard: () => void;
}

export default function ClassificationReview({ jobId, fileName, fileType, classification, onFiled, onDiscard }: ClassificationReviewProps) {
  const { refresh, categoryById } = useApp();
  const highConfidence = classification.confidence >= AUTO_ACCEPT_THRESHOLD;
  // Low-confidence results require the fields to be reviewed before filing.
  const [editing, setEditing] = useState(!highConfidence);
  const [merged, setMerged] = useState<ClassificationResult>(classification);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState<'file' | 'flag' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ClassificationResult>(k: K, v: ClassificationResult[K]) =>
    setMerged(m => ({ ...m, [k]: v }));

  async function submit(flagForLater: boolean) {
    setBusy(flagForLater ? 'flag' : 'file');
    setError(null);
    try {
      await fileDocument(jobId, {
        category: merged.category,
        subcategory: merged.subcategory,
        tags: merged.tags ?? [],
        summary: merged.summary ?? '',
        dateExtracted: merged.date,
        amount: merged.amount,
        vendor: merged.vendor,
        confidenceScore: merged.confidence,
        flagForLater,
      });
      await refresh();
      onFiled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Filing failed');
    } finally {
      setBusy(null);
    }
  }

  const catName = categoryById(merged.category)?.name ?? categoryLabel(merged.category);

  return (
    <div className="rise-in" style={{
      background: 'var(--surface)', borderRadius: 12,
      boxShadow: 'var(--shadow-sm)',
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header: file + confidence */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: 'var(--accent-tint)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isImageFile(fileType) ? <IconCamera size={16} /> : <IconNote size={16} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{fileName}</div>
          <div style={{
            fontSize: 11, color: 'var(--accent)', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 4, marginTop: 1,
          }}>
            <IconSparkle size={10} />Classified by Gemma
          </div>
        </div>
        <div style={{ width: 130 }}>
          <ConfidenceBar value={merged.confidence} />
        </div>
      </div>

      {merged.summary ? (
        <div style={{
          fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
          padding: '9px 11px', background: 'var(--surface-2)',
          borderRadius: 8,
        }}>{merged.summary}</div>
      ) : null}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {!highConfidence ? (
            <div style={{
              fontSize: 11.5, color: 'var(--amber)', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <IconSparkle size={11} />
              Low confidence — please verify these fields before filing.
            </div>
          ) : null}
          <Field label="Category">
            <CategorySelect compact value={merged.category} onChange={(id) => set('category', id)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Date">
              <input style={inputStyle} value={merged.date ?? ''} placeholder="YYYY-MM-DD"
                onChange={(e) => set('date', e.target.value || undefined)} />
            </Field>
            <Field label="Amount">
              <input style={inputStyle} value={merged.amount ?? ''} placeholder="0.00"
                onChange={(e) => set('amount', e.target.value === '' ? undefined : (parseFloat(e.target.value) || undefined))} />
            </Field>
          </div>
          <Field label="Vendor">
            <input style={inputStyle} value={merged.vendor ?? ''}
              onChange={(e) => set('vendor', e.target.value || undefined)} />
          </Field>
          <Field label="Tags">
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {(merged.tags ?? []).map(t => (
                <span key={t} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 4px 2px 8px', borderRadius: 5,
                  background: 'rgba(28,25,23,0.05)',
                  fontSize: 11.5, color: 'var(--ink-2)',
                }}>
                  {t}
                  <button
                    onClick={() => set('tags', (merged.tags ?? []).filter(x => x !== t))}
                    style={{
                      width: 15, height: 15, borderRadius: 8,
                      background: 'rgba(28,25,23,0.08)', border: 'none',
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
                    if (!(merged.tags ?? []).includes(t)) set('tags', [...(merged.tags ?? []), t]);
                    setTagDraft('');
                  }
                }}
                placeholder="Add tag ↵"
                style={{ ...inputStyle, width: 90, padding: '3px 8px', fontSize: 11.5 }}
              />
            </div>
          </Field>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          Filing into <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{catName}</span>
          {merged.tags?.length ? <> · {merged.tags.slice(0, 3).join(', ')}</> : null}
        </div>
      )}

      {error ? <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div> : null}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GhostButton onClick={onDiscard} style={{ color: 'var(--red)' }}>
          <IconX size={12} />Discard
        </GhostButton>
        <div style={{ flex: 1 }} />
        {highConfidence && !editing ? (
          <GhostButton onClick={() => setEditing(true)}>
            <IconPlus size={12} />Edit details
          </GhostButton>
        ) : null}
        <GhostButton onClick={() => submit(true)}>
          <IconClock size={12} />
          {busy === 'flag' ? 'Flagging…' : 'Flag for later'}
        </GhostButton>
        <PrimaryButton onClick={() => submit(false)} disabled={busy != null}>
          <IconCheck size={13} />
          {busy === 'file' ? 'Filing…' : highConfidence && !editing ? 'Accept' : `File in ${catName}`}
        </PrimaryButton>
      </div>
    </div>
  );
}
