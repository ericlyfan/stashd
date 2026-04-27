import { useState, useMemo } from 'react';
import { Document } from '@stashd/shared';
import { ClassificationResult } from '../api/client';
import {
  IconChevron, IconSparkle, IconStar, IconClock, IconCamera,
  IconSearch, IconCheck, IconFolder, getCategoryMeta,
} from './icons';

export interface PendingJob {
  jobId: string;
  fileName: string;
  fileType: string;
  classification: ClassificationResult;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(ms / day);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'Last month';
  return `${Math.floor(days / 30)} months ago`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMoney(n?: number): string {
  if (n == null) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function isImageFile(fileType: string): boolean {
  return fileType.startsWith('image/');
}

// ── DocThumb ──────────────────────────────────────────────────────────────────

export function DocThumb({ categoryId, fileType, size = 56 }: { categoryId: string; fileType: string; size?: number }) {
  const meta = getCategoryMeta(categoryId);
  if (isImageFile(fileType)) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 8,
        background: `linear-gradient(135deg, ${meta.color}26, ${meta.color}10)`,
        border: '0.5px solid rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: meta.color, flexShrink: 0,
      }}>
        <IconCamera size={Math.round(size * 0.42)} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: '#fff',
      border: '0.5px solid rgba(0,0,0,0.08)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ padding: '8px 7px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ height: 4, background: meta.color, opacity: 0.7, borderRadius: 1, width: '60%' }} />
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 1, marginTop: 4 }} />
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 1, width: '85%' }} />
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 1, width: '75%' }} />
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 1, width: '90%' }} />
        <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 1, width: '70%' }} />
      </div>
      <div style={{
        position: 'absolute', bottom: 4, right: 4,
        fontSize: 7, fontWeight: 700, color: meta.color, letterSpacing: 0.5,
      }}>PDF</div>
    </div>
  );
}

// ── Tag / CategoryPill ────────────────────────────────────────────────────────

export function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 6px', borderRadius: 3,
      background: color ? `${color}14` : 'rgba(0,0,0,0.04)',
      color: color || 'var(--ink-3)',
      fontSize: 10.5, fontWeight: 500,
      whiteSpace: 'nowrap', letterSpacing: 0.05,
    }}>{children}</span>
  );
}

export function CategoryPill({ categoryId }: { categoryId: string }) {
  const meta = getCategoryMeta(categoryId);
  const Ico = meta.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '1px 6px 1px 5px', borderRadius: 3,
      background: `${meta.color}10`, color: meta.color,
      fontSize: 10.5, fontWeight: 600, letterSpacing: 0.05,
    }}>
      <Ico size={10} />
    </span>
  );
}

// ── DocRow ────────────────────────────────────────────────────────────────────

interface DocRowProps {
  doc: Document;
  onClick: () => void;
  selected?: boolean;
  showCategory?: boolean;
}

export function DocRow({ doc, onClick, selected, showCategory = true }: DocRowProps) {
  const [hovered, setHovered] = useState(false);
  const meta = getCategoryMeta(doc.category);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        width: '100%', padding: '10px 12px',
        background: selected ? 'var(--accent-tint)' : hovered ? 'rgba(0,0,0,0.025)' : 'transparent',
        border: 'none', borderRadius: 8,
        textAlign: 'left', cursor: 'pointer',
        transition: 'background 0.12s',
      }}
    >
      <DocThumb categoryId={doc.category} fileType={doc.fileType} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, letterSpacing: -0.05,
          }}>{doc.originalName}</div>
          <div style={{
            fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}>{relTime(doc.createdAt)}</div>
        </div>
        <div style={{
          fontSize: 12, color: 'var(--ink-3)', marginTop: 2,
          lineHeight: 1.4, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
        } as React.CSSProperties}>{doc.summary}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          {showCategory ? <CategoryPill categoryId={doc.category} /> : null}
          {doc.amount != null ? <Tag>{fmtMoney(doc.amount)}</Tag> : null}
          {doc.tags.slice(0, 2).map(t => <Tag key={t}>{t}</Tag>)}
          <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{meta.color && ''}</span>
        </div>
      </div>
    </button>
  );
}

// ── DocList ───────────────────────────────────────────────────────────────────

interface DocListProps {
  docs: Document[];
  onSelect: (doc: Document) => void;
  selectedId?: string;
  showCategory?: boolean;
  emptyTitle?: string;
  emptySubtitle?: string;
}

export function DocList({ docs, onSelect, selectedId, showCategory = true, emptyTitle, emptySubtitle }: DocListProps) {
  if (docs.length === 0) {
    return (
      <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'rgba(0,0,0,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', color: 'var(--ink-4)',
        }}>
          <IconFolder size={26} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
          {emptyTitle ?? 'Nothing here yet'}
        </div>
        <div style={{ fontSize: 13 }}>{emptySubtitle ?? 'Drop a file to get started.'}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 14px 24px' }}>
      {docs.map((d, i) => (
        <div key={d.id}>
          <DocRow doc={d} onClick={() => onSelect(d)} selected={selectedId === d.id} showCategory={showCategory} />
          {i < docs.length - 1 ? (
            <div style={{ height: 0.5, background: 'var(--line)', margin: '0 16px' }} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── CollapsibleSection ────────────────────────────────────────────────────────

interface CollapsibleSectionProps {
  icon: typeof IconSparkle;
  label: string;
  count?: number | null;
  color?: string;
  defaultOpen?: boolean;
  accent?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsibleSection({ icon: Ico, label, count, color, defaultOpen = true, accent, action, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: 'calc(100% - 36px)', margin: '0 18px',
          padding: '6px 8px',
          background: hovered ? 'rgba(0,0,0,0.025)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          borderRadius: 6,
        }}
      >
        <span style={{
          color: 'var(--ink-4)', display: 'flex',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.18s',
        }}>
          <IconChevron size={10} />
        </span>
        <span style={{
          fontSize: 10.5, fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{label}</span>
        {count != null ? (
          accent ? (
            <span style={{
              minWidth: 16, height: 16, padding: '0 5px', borderRadius: 8,
              background: 'var(--accent)', color: '#fff',
              fontSize: 10, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}>{count}</span>
          ) : (
            <span style={{
              fontSize: 11, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums',
            }}>{count}</span>
          )
        ) : null}
        <div style={{ flex: 1 }} />
        {action}
      </button>
      {open ? (
        <div style={{ opacity: 1 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ── PendingReviewRow ──────────────────────────────────────────────────────────

interface PendingReviewRowProps {
  job: PendingJob;
  onReview: () => void;
  onQuickFile: (jobId: string) => void;
}

export function PendingReviewRow({ job, onReview, onQuickFile }: PendingReviewRowProps) {
  const meta = getCategoryMeta(job.classification.category);
  const Ico = meta.icon;
  const conf = job.classification.confidence;
  const confColor = conf >= 0.85 ? 'var(--green)' : conf >= 0.7 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', margin: '0 14px 4px',
      background: 'var(--surface)',
      border: '0.5px solid rgba(0,0,0,0.08)',
      borderRadius: 8,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 7,
        background: `${meta.color}12`, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {isImageFile(job.fileType) ? <IconCamera size={16} /> : <Ico size={16} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, minWidth: 0, letterSpacing: -0.05,
          }}>{job.fileName}</div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 6px', borderRadius: 3,
            background: `${meta.color}10`, color: meta.color,
            fontSize: 10.5, fontWeight: 600, flexShrink: 0,
          }}>
            <IconSparkle size={9} />
            {job.classification.category.split('-')[0]}
          </span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: confColor,
            fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          }}>{Math.round(conf * 100)}%</span>
        </div>
        <div style={{
          fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
        } as React.CSSProperties}>{job.classification.summary}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={onReview}
          style={{
            height: 26, padding: '0 10px',
            background: 'transparent', color: 'var(--ink-2)',
            border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 5,
            fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >Review</button>
        <button
          onClick={() => onQuickFile(job.jobId)}
          style={{
            height: 26, padding: '0 10px',
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 5,
            fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            boxShadow: '0 1px 2px rgba(13,111,106,0.3)',
            fontFamily: 'inherit',
          }}
        ><IconCheck size={12} />File</button>
      </div>
    </div>
  );
}

// ── InboxView ─────────────────────────────────────────────────────────────────

interface InboxViewProps {
  docs: Document[];
  pendingJobs: PendingJob[];
  search: string;
  onSelect: (doc: Document) => void;
  onOpenReview: () => void;
  onQuickFile: (jobId: string) => void;
}

export default function InboxView({ docs, pendingJobs, search, onSelect, onOpenReview, onQuickFile }: InboxViewProps) {
  const filtered = useMemo(() => {
    if (!search) return docs;
    const q = search.toLowerCase();
    return docs.filter(d =>
      d.originalName.toLowerCase().includes(q) ||
      d.summary.toLowerCase().includes(q) ||
      d.tags.some(t => t.toLowerCase().includes(q)) ||
      (d.vendor ?? '').toLowerCase().includes(q)
    );
  }, [docs, search]);

  const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (search) {
    return (
      <div>
        <div style={{ padding: '20px 28px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{
              margin: 0, fontFamily: 'var(--font-display)',
              fontSize: 22, fontWeight: 600, letterSpacing: -0.3, color: 'var(--ink)',
            }}>Search</h1>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(0,0,0,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', color: 'var(--ink-4)',
            }}><IconSearch size={26} /></div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>No matches</div>
            <div style={{ fontSize: 13 }}>Try different keywords or clear the search.</div>
          </div>
        ) : (
          <DocList docs={sorted} onSelect={onSelect} />
        )}
      </div>
    );
  }

  const starred = docs.filter(d => (d as Document & { starred?: boolean }).starred);
  const nonStarred = sorted.filter(d => !(d as Document & { starred?: boolean }).starred);

  return (
    <div>
      <div style={{ padding: '20px 28px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)',
            fontSize: 22, fontWeight: 600, letterSpacing: -0.3, color: 'var(--ink)',
          }}>Inbox</h1>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{docs.length} documents</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          Everything you've stashed. Drop a file anywhere to add more.
        </div>
      </div>

      {/* Needs Review */}
      {pendingJobs.length > 0 ? (
        <CollapsibleSection
          icon={IconSparkle}
          label="Needs Review"
          count={pendingJobs.length}
          color="var(--accent)"
          accent
          defaultOpen
          action={
            <span
              onClick={(e) => { e.stopPropagation(); onOpenReview(); }}
              style={{
                fontSize: 12, fontWeight: 500, color: 'var(--accent)',
                padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
              }}
            >Review all →</span>
          }
        >
          <div style={{ paddingTop: 4, paddingBottom: 14 }}>
            {pendingJobs.map(job => (
              <PendingReviewRow
                key={job.jobId}
                job={job}
                onReview={onOpenReview}
                onQuickFile={onQuickFile}
              />
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Starred */}
      {starred.length > 0 ? (
        <CollapsibleSection
          icon={IconStar}
          label="Starred"
          count={starred.length}
          color="#c8862c"
          defaultOpen
        >
          <div style={{ padding: '4px 14px 14px' }}>
            {starred.map((d, i) => (
              <div key={d.id}>
                <DocRow doc={d} onClick={() => onSelect(d)} />
                {i < starred.length - 1 ? (
                  <div style={{ height: 0.5, background: 'var(--line)', margin: '0 16px' }} />
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Recent */}
      <CollapsibleSection
        icon={IconClock}
        label="Recent"
        count={nonStarred.length}
        color="#3b6db8"
        defaultOpen
      >
        <DocList
          docs={nonStarred}
          onSelect={onSelect}
          emptyTitle="Nothing else here"
          emptySubtitle="All your documents appear above."
        />
      </CollapsibleSection>
    </div>
  );
}
