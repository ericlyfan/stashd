import { AlertTriangle, Copy, FileCheck2, FileText, Hourglass, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { fileKindLabel, formatBytes } from '../lib/format';

/**
 * The live processing queue. With a handful of files it's a simple list; a
 * bigger drop gets a progress header with counts and bulk skip actions.
 */
export default function UploadTray() {
  const { queue, dismissItem, dismissItems, openReview } = useStore();
  if (queue.length === 0) return null;

  const queued = queue.filter(q => q.status === 'queued');
  const working = queue.filter(q => q.status === 'uploading' || q.status === 'processing' || q.status === 'filing');
  const ready = queue.filter(q => q.status === 'ready');
  const failed = queue.filter(q => q.status === 'error');
  const duplicates = queue.filter(q => q.duplicateOf && (q.status === 'ready' || q.status === 'error'));
  const settled = ready.length + failed.length;

  return (
    <div className="tray" aria-label="Processing queue">
      {queue.length > 1 && (
        <div className="tray-head">
          <div className="tray-counts">
            <strong>{settled}/{queue.length}</strong> classified
            {working.length > 0 && <span> · {working.length} in flight</span>}
            {queued.length > 0 && <span> · {queued.length} waiting</span>}
            {failed.length > 0 && <span className="tray-count-err"> · {failed.length} failed</span>}
          </div>
          <div className="tray-bulk">
            {duplicates.length > 0 && (
              <button className="btn btn-sm" onClick={() => dismissItems(duplicates.map(d => d.id))}>
                Skip duplicates ({duplicates.length})
              </button>
            )}
            {failed.length > 0 && (
              <button className="btn btn-sm" onClick={() => dismissItems(failed.map(f => f.id))}>
                Clear failed ({failed.length})
              </button>
            )}
          </div>
          <div className="tray-bar" role="progressbar" aria-valuenow={settled} aria-valuemax={queue.length}>
            <div style={{ width: `${(settled / queue.length) * 100}%` }} />
          </div>
        </div>
      )}

      {queue.map(item => {
        const busy = item.status === 'uploading' || item.status === 'processing' || item.status === 'filing';
        return (
          <div key={item.id} className={`tray-item ${item.status}`}>
            <div className="file-ic">
              {item.status === 'error' ? (
                <AlertTriangle size={18} strokeWidth={1.8} />
              ) : item.status === 'ready' ? (
                <FileCheck2 size={18} strokeWidth={1.8} />
              ) : item.status === 'queued' ? (
                <Hourglass size={18} strokeWidth={1.8} />
              ) : (
                <FileText size={18} strokeWidth={1.8} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-name">{item.name}</div>
              <div className="t-stage">
                {fileKindLabel(item.mime)} · {formatBytes(item.size)} — {item.stageMessage}
              </div>
              {item.duplicateOf && (
                <div className="t-dup">
                  <Copy size={11} strokeWidth={2} />
                  <span>
                    Identical to{' '}
                    <Link to={`/doc/${item.duplicateOf.id}`}>{item.duplicateOf.originalName}</Link>, already in the
                    stash
                  </span>
                </div>
              )}
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
                aria-label={`Skip ${item.name}`}
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
