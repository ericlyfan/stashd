import { useNavigate } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { useApp } from '../state';
import { relTime, categoryLabel } from '../lib/format';
import { iconFor, IconClock, IconFolder, IconInbox, IconNote, IconSparkle } from '../components/icons';
import UploadZone from '../components/UploadZone';
import EmptyState from '../components/EmptyState';

function StatsBar() {
  const { docs, categories } = useApp();
  const stats = [
    { label: 'Documents', value: docs.length, icon: IconNote },
    { label: 'Categories', value: categories.length, icon: IconFolder },
    { label: 'Needs review', value: docs.filter(d => d.status === 'pending').length, icon: IconSparkle },
  ];
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          flex: 1, padding: '12px 14px',
          background: 'var(--surface)', borderRadius: 12,
          boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'var(--accent-tint)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><s.icon size={15} /></div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: 0.1 }}>{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocMiniRow({ doc }: { doc: Document }) {
  const navigate = useNavigate();
  const { categoryById } = useApp();
  const cat = categoryById(doc.category);
  const color = cat?.color ?? 'var(--accent)';
  const Ico = iconFor(cat?.icon);
  return (
    <button
      onClick={() => navigate(`/document/${doc.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 10px',
        background: 'transparent', border: 'none', borderRadius: 8,
        textAlign: 'left', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.035)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: `${color}14`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><Ico size={13} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{doc.originalName}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>
          {cat?.name ?? categoryLabel(doc.category)} · {relTime(doc.createdAt)}
        </span>
      </span>
    </button>
  );
}

function SidePanel({ title, icon: Ico, accent, children }: {
  title: string;
  icon: typeof IconClock;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 12,
      boxShadow: 'var(--shadow-sm)',
      padding: '12px 8px 8px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px 8px',
        fontSize: 10.5, fontWeight: 700,
        color: accent ? 'var(--amber)' : 'var(--ink-3)',
        textTransform: 'uppercase', letterSpacing: 0.6,
      }}>
        <Ico size={11} />{title}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { docs, loading } = useApp();

  const pending = docs
    .filter(d => d.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const recent = docs
    .filter(d => d.status === 'filed')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div style={{ padding: '26px 32px 40px', maxWidth: 1060, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
          fontSize: 28, letterSpacing: 0.2, color: 'var(--ink)',
        }}>Inbox</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3 }}>
          Drop anything in — Stash’d reads it, names it, and files it.
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StatsBar />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* Left: upload + review flow */}
        <UploadZone />

        {/* Right: pending + recent */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pending.length > 0 ? (
            <SidePanel title={`Needs review · ${pending.length}`} icon={IconSparkle} accent>
              {pending.map(d => <DocMiniRow key={d.id} doc={d} />)}
            </SidePanel>
          ) : null}

          <SidePanel title="Recent" icon={IconClock}>
            {loading ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink-4)' }}>Loading…</div>
            ) : recent.length === 0 ? (
              <EmptyState
                compact
                icon={IconInbox}
                title="Nothing stashed yet"
                subtitle="Your five most recent documents will show up here."
              />
            ) : (
              recent.map(d => <DocMiniRow key={d.id} doc={d} />)
            )}
          </SidePanel>
        </div>
      </div>
    </div>
  );
}
