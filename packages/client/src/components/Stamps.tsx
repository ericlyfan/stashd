import { Category } from '@stashd/shared';
import { nameFromSlug } from '../lib/categoryMeta';

export function CategoryStamp({ category, slug }: { category?: Category; slug?: string }) {
  const color = category?.color ?? '#8d8472';
  const label = category?.name ?? (slug ? nameFromSlug(slug) : 'Uncategorized');
  return (
    <span className="stamp" style={{ color }}>
      <span className="swatch" />
      {label}
    </span>
  );
}

export function StatusStamp({ status }: { status: 'pending' | 'filed' }) {
  return (
    <span className={`status-stamp ${status}`}>
      {status === 'filed' ? 'Filed' : 'Flagged'}
    </span>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const ticks = Math.round(Math.max(0, Math.min(1, value)) * 5);
  return (
    <span className={`conf${value < 0.6 ? ' low' : ''}`} title={`AI confidence ${Math.round(value * 100)}%`}>
      <span className="ticks">
        {[0, 1, 2, 3, 4].map(i => (
          <span key={i} className={`tick${i < ticks ? ' on' : ''}`} />
        ))}
      </span>
      {Math.round(value * 100)}%
    </span>
  );
}
