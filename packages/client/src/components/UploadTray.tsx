import { AlertTriangle, FileCheck2, FileText, X } from 'lucide-react';
import { useStore } from '../store';
import { fileKindLabel, formatBytes } from '../lib/format';

/** The live processing queue: one card per file moving through the pipeline. */
export default function UploadTray() {
  const { queue, dismissItem, openReview } = useStore();
  if (queue.length === 0) return null;

  return (
    <div className="tray" aria-label="Processing queue">
      {queue.map(item => {
        const busy = item.status === 'uploading' || item.status === 'processing' || item.status === 'filing';
        return (
          <div key={item.id} className={`tray-item ${item.status}`}>
            <div className="file-ic">
              {item.status === 'error' ? (
                <AlertTriangle size={18} strokeWidth={1.8} />
              ) : item.status === 'ready' ? (
                <FileCheck2 size={18} strokeWidth={1.8} />
              ) : (
                <FileText size={18} strokeWidth={1.8} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-name">{item.name}</div>
              <div className="t-stage">
                {fileKindLabel(item.mime)} · {formatBytes(item.size)} — {item.stageMessage}
              </div>
              {busy && <div className="scanline" />}
            </div>
            {item.status === 'ready' && (
              <button className="btn btn-wax btn-sm" onClick={() => openReview(item.id)}>
                Review &amp; file
              </button>
            )}
            {!busy && (
              <button
                className="btn btn-ghost btn-sm"
                aria-label={`Dismiss ${item.name}`}
                onClick={() => dismissItem(item.id)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
