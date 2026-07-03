import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileStack } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@stashd/shared';
import { useStore } from '../store';

const ACCEPT = SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',');
const FORMAT_LABEL = 'PDF · images · Office · email';

/**
 * Inline drop tray for the inbox, plus a window-level drag curtain so files
 * can be dropped anywhere in the app from any page.
 */
export function GlobalDropCurtain() {
  const { addFiles } = useStore();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files');
    }
    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }
    function onOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault();
    }
    // Capture phase so the curtain always resets even when a deeper handler
    // (the chat drop zone) calls stopPropagation. Drops onto the chat are its
    // own concern (attach as chat-only context) — reset the visual and bow out.
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current = 0;
      setDragging(false);
      const target = e.target as HTMLElement | null;
      if (target?.closest('.chat-layout')) return;
      e.preventDefault();
      if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
    }
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [addFiles]);

  if (!dragging) return null;
  return (
    <div className="drop-curtain">
      <div className="plate">
        <h2>Release to stash</h2>
        <p>{FORMAT_LABEL} — up to 50 MB</p>
      </div>
    </div>
  );
}

export function DropTray() {
  const { addFiles } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  return (
    <div
      className={`dropzone${over ? ' dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      aria-label="Add documents"
    >
      <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
      <div className="dz-icon">
        <ArrowDownToLine size={24} strokeWidth={1.8} />
      </div>
      <div className="dz-title">Drop anything in</div>
      <div className="dz-sub">
        Receipts, leases, statements, manuals — the AI reads it, files it, you confirm.
      </div>
      <div className="dz-formats">
        <FileStack size={11} style={{ verticalAlign: '-1px', marginRight: 6 }} />
        {FORMAT_LABEL} · max 50 MB · drop several at once
      </div>
    </div>
  );
}
