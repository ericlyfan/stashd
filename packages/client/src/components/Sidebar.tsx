import { useState } from 'react';
import { Category } from '@stashd/shared';
import {
  IconInbox, IconFolder, getCategoryMeta, CategoryIconComponent,
} from './icons';

interface SidebarItemProps {
  icon: CategoryIconComponent | typeof IconInbox | typeof IconFolder;
  label: string;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
  color?: string;
  badge?: number | null;
}

export function SidebarItem({ icon: Ico, label, count, active, onClick, color, badge }: SidebarItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '4px 8px',
        background: active ? 'rgba(0,0,0,0.07)' : hovered ? 'rgba(0,0,0,0.035)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        border: 'none', borderRadius: 5,
        fontSize: 12, fontWeight: 500,
        textAlign: 'left', cursor: 'pointer',
        height: 24,
      }}
    >
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 14, color: color || 'var(--ink-3)',
      }}>
        <Ico size={13} />
      </span>
      <span style={{
        flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        letterSpacing: -0.05,
      }}>{label}</span>
      {badge ? (
        <span style={{
          minWidth: 16, height: 16, padding: '0 5px', borderRadius: 8,
          background: 'var(--accent)',
          color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>{badge}</span>
      ) : count != null ? (
        <span style={{
          fontSize: 11, fontWeight: 400, fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-4)',
          minWidth: 14, textAlign: 'right',
        }}>{count}</span>
      ) : null}
    </button>
  );
}

function SidebarSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      {title ? (
        <div style={{
          padding: '2px 10px 4px',
          fontSize: 10, fontWeight: 600,
          color: 'var(--ink-4)',
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{title}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '0 6px' }}>
        {children}
      </div>
    </div>
  );
}

export type NavTarget =
  | { view: 'inbox' }
  | { view: 'category'; categoryId: string };

interface SidebarProps {
  view: string;
  categoryId: string | null;
  onNavigate: (target: NavTarget) => void;
  categories: Array<Category & { documentCount: number }>;
  totalDocs: number;
  pendingCount: number;
}

export default function Sidebar({ view, categoryId, onNavigate, categories, totalDocs, pendingCount }: SidebarProps) {
  return (
    <div style={{
      width: 212, height: '100%',
      background: 'var(--sidebar)',
      borderRight: '0.5px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Title bar area - sits behind traffic lights */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center',
        padding: '0 14px', gap: 10,
      }}>
        <div style={{ width: 52 }} />
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14, fontWeight: 600,
          color: 'var(--ink)',
          letterSpacing: -0.2,
        }}>Stash<span style={{ color: 'var(--accent)' }}>'</span>d</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 10 }}>
        <div style={{ padding: '4px 6px 0' }}>
          <SidebarItem
            icon={IconInbox}
            label="Inbox"
            count={totalDocs}
            active={view === 'inbox'}
            onClick={() => onNavigate({ view: 'inbox' })}
            color="var(--accent)"
            badge={pendingCount > 0 ? pendingCount : null}
          />
        </div>

        <SidebarSection title="Categories">
          <SidebarItem
            icon={IconFolder}
            label="All Documents"
            count={totalDocs}
            color="var(--ink-3)"
            active={view === 'category' && categoryId === '__all'}
            onClick={() => onNavigate({ view: 'category', categoryId: '__all' })}
          />
          {categories.map((cat) => {
            const meta = getCategoryMeta(cat.id);
            return (
              <SidebarItem
                key={cat.id}
                icon={meta.icon}
                label={cat.name}
                count={cat.documentCount || null}
                color={meta.color}
                active={view === 'category' && categoryId === cat.id}
                onClick={() => onNavigate({ view: 'category', categoryId: cat.id })}
              />
            );
          })}
        </SidebarSection>
      </div>

      {/* Footer — model status */}
      <div style={{
        padding: '8px 12px',
        borderTop: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 7,
        fontSize: 10.5, color: 'var(--ink-3)',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--green)',
          boxShadow: '0 0 0 2px rgba(46,158,91,0.18)',
        }} />
        <span style={{ flex: 1, letterSpacing: -0.05 }}>Gemma · Local</span>
        <span style={{ color: 'var(--ink-4)' }}>Online</span>
      </div>
    </div>
  );
}
