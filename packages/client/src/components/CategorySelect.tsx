import { useState } from 'react';
import { Category } from '@stashd/shared';
import { useApp } from '../state';
import { categoryLabel } from '../lib/format';
import { iconFor, IconCheck, IconChevronDown } from './icons';

interface CategorySelectProps {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}

// Dropdown fed by GET /api/categories (via app state). If the current value
// isn't a known category yet (freshly proposed by the model), it's shown too.
export default function CategorySelect({ value, onChange, compact }: CategorySelectProps) {
  const { categories } = useApp();
  const [open, setOpen] = useState(false);

  const current: Category | undefined = categories.find(c => c.id === value);
  const options: Array<{ id: string; name: string; icon: string; color: string }> =
    categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }));
  if (value && !current) {
    options.unshift({ id: value, name: `${categoryLabel(value)} (new)`, icon: 'folder', color: 'var(--accent)' });
  }

  const color = current?.color ?? 'var(--accent)';
  const Ico = iconFor(current?.icon);
  const label = current?.name ?? (value ? `${categoryLabel(value)} (new)` : 'Choose category');

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: compact ? '7px 10px' : '10px 12px',
          background: 'var(--surface)',
          border: '0.5px solid var(--line-strong)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: compact ? 22 : 26, height: compact ? 22 : 26, borderRadius: 6,
          background: `${color}18`, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Ico size={compact ? 12 : 14} /></span>
        <span style={{ flex: 1, fontSize: compact ? 12.5 : 13, fontWeight: 500, color: 'var(--ink)' }}>
          {label}
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
            boxShadow: 'var(--shadow-lg)',
            padding: 4, zIndex: 10,
            maxHeight: 280, overflow: 'auto',
          }}>
            {options.map(opt => {
              const OptIco = iconFor(opt.icon);
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChange(opt.id); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '6px 8px',
                    background: opt.id === value ? 'var(--accent-tint)' : 'transparent',
                    border: 'none', borderRadius: 6,
                    cursor: 'pointer', textAlign: 'left',
                    fontSize: 13, color: 'var(--ink)',
                  }}
                >
                  <span style={{ color: opt.color, display: 'flex' }}><OptIco size={14} /></span>
                  <span style={{ flex: 1 }}>{opt.name}</span>
                  {opt.id === value ? <IconCheck size={13} style={{ color: 'var(--accent)' }} /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
