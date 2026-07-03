import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import ChatSurface from './ChatSurface';
import { useChatDock } from './ChatDockContext';

const STORAGE_KEY = 'stashd.chatDock';
const MIN_W = 320;
const MIN_H = 380;
const DEFAULT_W = 396;
const DEFAULT_H = 560;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Default to the bottom-right corner (above the launcher), clamped to the
// viewport. Used the first time the dock opens or if the saved rect is stale.
function defaultRect(): Rect {
  const w = DEFAULT_W;
  const h = Math.min(DEFAULT_H, window.innerHeight - 40);
  return {
    x: Math.max(8, window.innerWidth - w - 24),
    y: Math.max(8, window.innerHeight - h - 24),
    w,
    h,
  };
}

function loadRect(): Rect {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Rect;
      if ([r.x, r.y, r.w, r.h].every(n => typeof n === 'number' && Number.isFinite(n))) {
        // Re-clamp against the current window so a resized/moved window can't
        // strand the panel off-screen.
        const w = clamp(r.w, MIN_W, window.innerWidth - 16);
        const h = clamp(r.h, MIN_H, window.innerHeight - 16);
        return {
          w,
          h,
          x: clamp(r.x, 8, Math.max(8, window.innerWidth - w - 8)),
          y: clamp(r.y, 8, Math.max(8, window.innerHeight - h - 8)),
        };
      }
    }
  } catch {
    // ignore malformed storage
  }
  return defaultRect();
}

export function ChatDock() {
  const { open, activeConvId, close, setActiveConvId } = useChatDock();
  const navigate = useNavigate();
  const [rect, setRect] = useState<Rect>(() => defaultRect());
  // Live session for a drag/resize gesture — refs so pointer handlers see the
  // latest without re-subscribing.
  const gesture = useRef<{
    mode: 'move' | 'resize';
    edges?: { left: boolean; top: boolean };
    startX: number;
    startY: number;
    start: Rect;
  } | null>(null);

  // Load the saved rect only when the panel opens (window dims are known then).
  useEffect(() => {
    if (open) setRect(loadRect());
  }, [open]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.mode === 'move') {
      setRect(r => ({
        ...r,
        x: clamp(g.start.x + dx, 8, Math.max(8, window.innerWidth - r.w - 8)),
        y: clamp(g.start.y + dy, 8, Math.max(8, window.innerHeight - r.h - 8)),
      }));
    } else {
      // Resize the top and/or left edge(s), keeping the opposite (bottom-right)
      // corner fixed — so a bottom-right-docked panel grows into the screen.
      const right = g.start.x + g.start.w;
      const bottom = g.start.y + g.start.h;
      let { x, y, w, h } = g.start;
      if (g.edges?.left) {
        x = clamp(g.start.x + dx, 8, right - MIN_W);
        w = right - x;
      }
      if (g.edges?.top) {
        y = clamp(g.start.y + dy, 8, bottom - MIN_H);
        h = bottom - y;
      }
      setRect({ x, y, w, h });
    }
  }, []);

  const endGesture = useCallback(() => {
    gesture.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endGesture);
    document.body.classList.remove('dragging-dock');
    setRect(r => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
      } catch {
        // ignore
      }
      return r;
    });
  }, [onPointerMove]);

  const startGesture = useCallback(
    (mode: 'move' | 'resize', e: React.PointerEvent, edges?: { left: boolean; top: boolean }) => {
      gesture.current = { mode, edges, startX: e.clientX, startY: e.clientY, start: rect };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endGesture);
      document.body.classList.add('dragging-dock');
    },
    [rect, onPointerMove, endGesture],
  );

  // Resize handles live on the top/left edges (away from the toolbar buttons)
  // so a bottom-right-docked panel grows up and to the left.
  const startResize = (edges: { left: boolean; top: boolean }) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startGesture('resize', e, edges);
  };

  // Drag from the top bar — but not when the pointer lands on an interactive
  // control inside it (History, mode toggle, buttons).
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, textarea, [role="menu"]')) return;
      e.preventDefault();
      startGesture('move', e);
    },
    [startGesture],
  );

  const expand = useCallback(() => {
    navigate(activeConvId ? `/chat/${activeConvId}` : '/chat');
    close();
  }, [navigate, activeConvId, close]);

  if (!open) return null;

  return (
    <div
      className="chat-dock"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      role="dialog"
      aria-label="Ask the stash"
    >
      <ChatSurface
        variant="dock"
        convId={activeConvId}
        onConvIdChange={id => setActiveConvId(id)}
        onExpand={expand}
        onClose={close}
        onHeaderPointerDown={onHeaderPointerDown}
      />
      <div className="chat-dock-rz chat-dock-rz-l" onPointerDown={startResize({ left: true, top: false })} aria-hidden />
      <div className="chat-dock-rz chat-dock-rz-t" onPointerDown={startResize({ left: false, top: true })} aria-hidden />
      <div className="chat-dock-rz chat-dock-rz-tl" onPointerDown={startResize({ left: true, top: true })} aria-hidden />
    </div>
  );
}

// The persistent corner button that opens the dock; hidden while it's open.
export function ChatLauncher() {
  const { open, openDock } = useChatDock();
  if (open) return null;
  return (
    <button className="chat-launcher" onClick={() => openDock()} aria-label="Ask the stash" title="Ask the stash">
      <MessagesSquare size={22} strokeWidth={1.9} />
    </button>
  );
}
