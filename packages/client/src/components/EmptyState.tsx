import { CategoryIconComponent } from './icons';

interface EmptyStateProps {
  icon: CategoryIconComponent;
  title: string;
  subtitle?: string;
  color?: string;
  compact?: boolean;
}

export default function EmptyState({ icon: Ico, title, subtitle, color, compact }: EmptyStateProps) {
  return (
    <div style={{
      padding: compact ? '32px 24px' : '72px 32px',
      textAlign: 'center', color: 'var(--ink-3)',
    }}>
      <div style={{
        width: compact ? 44 : 60, height: compact ? 44 : 60, borderRadius: 16,
        background: color ? `${color}14` : 'rgba(28,25,23,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 14px', color: color ?? 'var(--ink-4)',
      }}>
        <Ico size={compact ? 20 : 28} />
      </div>
      <div style={{
        fontSize: compact ? 14 : 17, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4,
        fontFamily: 'var(--font-display)', letterSpacing: 0.1,
      }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 13, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>{subtitle}</div> : null}
    </div>
  );
}
