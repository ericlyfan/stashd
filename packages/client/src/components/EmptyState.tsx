import { LucideIcon } from 'lucide-react';

export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="e-icon">
        <Icon size={22} strokeWidth={1.6} />
      </div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
      {children && <div style={{ marginTop: 18 }}>{children}</div>}
    </div>
  );
}
