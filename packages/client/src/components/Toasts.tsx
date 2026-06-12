import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useStore } from '../store';

export default function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`}>
          {t.kind === 'err' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
