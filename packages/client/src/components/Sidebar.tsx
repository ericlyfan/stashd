import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../state';
import { IconInbox, IconFolder } from './icons';

interface SidebarItemProps {
  label: string;
  count?: number | null;
  active?: boolean;
  onClick: () => void;
  dotColor?: string;
  icon?: React.ReactNode;
  badge?: number | null;
}

function SidebarItem({ label, count, active, onClick, dotColor, icon, badge }: SidebarItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '5px 9px',
        background: active ? 'rgba(13,148,136,0.10)' : hovered ? 'rgba(28,25,23,0.04)' : 'transparent',
        color: active ? 'var(--accent-deep)' : 'var(--ink-2)',
        border: 'none', borderRadius: 6,
        fontSize: 12.5, fontWeight: active ? 600 : 500,
        textAlign: 'left', cursor: 'pointer',
        height: 28,
        transition: 'background 0.12s',
      }}
    >
      {icon ? (
        <span style={{ display: 'flex', width: 14, justifyContent: 'center', color: active ? 'var(--accent)' : 'var(--ink-3)' }}>
          {icon}
        </span>
      ) : (
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: dotColor ?? 'var(--ink-4)',
          marginLeft: 3, marginRight: 3,
          boxShadow: active ? `0 0 0 3px ${dotColor}22` : 'none',
        }} />
      )}
      <span style={{
        flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        letterSpacing: -0.05,
      }}>{label}</span>
      {badge ? (
        <span style={{
          minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9,
          background: 'var(--accent)', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>{badge}</span>
      ) : count != null && count > 0 ? (
        <span style={{
          fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-4)',
          background: 'rgba(28,25,23,0.05)',
          padding: '1px 6px', borderRadius: 8,
        }}>{count}</span>
      ) : null}
    </button>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { docs, categories } = useApp();

  const pendingCount = docs.filter(d => d.status === 'pending').length;
  const isHome = location.pathname === '/';
  const activeCategory = location.pathname.startsWith('/category/')
    ? decodeURIComponent(location.pathname.split('/')[2] ?? '')
    : null;

  return (
    <div style={{
      width: 224, height: '100%',
      background: 'var(--sidebar)',
      borderRight: '0.5px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 18px',
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 19, color: 'var(--ink)',
            letterSpacing: 0.2,
          }}
        >Stash<span style={{ color: 'var(--accent)' }}>’</span>d</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '2px 8px 12px' }}>
        <SidebarItem
          label="Inbox"
          icon={<IconInbox size={14} />}
          count={docs.length}
          active={isHome}
          onClick={() => navigate('/')}
          badge={pendingCount > 0 ? pendingCount : null}
        />

        <div style={{
          padding: '16px 9px 5px',
          fontSize: 10, fontWeight: 700,
          color: 'var(--ink-4)',
          textTransform: 'uppercase', letterSpacing: 0.7,
        }}>Categories</div>

        <SidebarItem
          label="All Documents"
          icon={<IconFolder size={13} />}
          count={docs.length}
          active={activeCategory === 'all'}
          onClick={() => navigate('/category/all')}
        />
        {categories.map(cat => (
          <SidebarItem
            key={cat.id}
            label={cat.name}
            dotColor={cat.color}
            count={cat.documentCount}
            active={activeCategory === cat.id}
            onClick={() => navigate(`/category/${encodeURIComponent(cat.id)}`)}
          />
        ))}
      </div>

      <div style={{
        padding: '10px 16px',
        borderTop: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 7,
        fontSize: 10.5, color: 'var(--ink-3)',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--green)',
          boxShadow: '0 0 0 2px rgba(22,163,74,0.18)',
        }} />
        <span style={{ flex: 1, letterSpacing: -0.05 }}>Gemma · Local</span>
        <span style={{ color: 'var(--ink-4)' }}>Online</span>
      </div>
    </div>
  );
}
