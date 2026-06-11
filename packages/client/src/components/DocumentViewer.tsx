import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Document } from '@stashd/shared';
import { isImageFile } from '../lib/format';
import { IconMinus, IconPlus, IconNote } from './icons';
import EmptyState from './EmptyState';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

// Round to whole percents so repeated 0.1 steps don't accumulate float drift.
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

// ── Zoom toolbar ──────────────────────────────────────────────────────────────

function ToolButton({ onClick, disabled, title, children }: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 24, minWidth: 24, padding: '0 6px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: 'rgba(28,25,23,0.05)', border: 'none', borderRadius: 6,
        color: 'var(--ink-2)', fontSize: 11.5, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >{children}</button>
  );
}

function ZoomToolbar({ zoom, onZoom, info }: {
  zoom: number;
  onZoom: (z: number) => void;
  info?: string;
}) {
  return (
    <div style={{
      position: 'sticky', top: 0, left: 0, zIndex: 5,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 14px',
      background: 'rgba(245,245,244,0.88)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      borderBottom: '0.5px solid var(--line)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
        {info ?? ''}
      </span>
      <div style={{ flex: 1 }} />
      <ToolButton title="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}>
        <IconMinus size={12} />
      </ToolButton>
      <span style={{
        fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)',
        minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
      }}>{Math.round(zoom * 100)}%</span>
      <ToolButton title="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}>
        <IconPlus size={12} />
      </ToolButton>
      <ToolButton title="Fit to width" disabled={zoom === 1} onClick={() => onZoom(1)}>
        Fit
      </ToolButton>
    </div>
  );
}

// ── PDF ───────────────────────────────────────────────────────────────────────

function PdfView({ url }: { url: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the document once per URL.
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setReady(false);
    setError(null);
    const task = pdfjsLib.getDocument(url);
    task.promise
      .then(p => { if (!cancelled) setPdf(p); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF'); });
    return () => {
      cancelled = true;
      task.destroy().catch(() => {});
    };
  }, [url]);

  // Track available width so fit-to-width follows window resizes.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      // Ignore sub-5px jitter to avoid pointless re-renders.
      setWidth(prev => (Math.abs(prev - w) > 5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render all pages whenever the doc, zoom, or pane width changes. Pages are
  // drawn into a detached fragment and swapped in at the end, so the previous
  // render stays visible while the new one is prepared.
  useEffect(() => {
    if (!pdf || !width) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = width * zoom;
        const frag = document.createDocumentFragment();

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 16px';
          canvas.style.borderRadius = '6px';
          canvas.style.boxShadow = '0 4px 20px rgba(28,25,23,0.14), 0 0 0 0.5px rgba(28,25,23,0.08)';
          canvas.style.background = '#fff';
          frag.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        if (!cancelled && contentRef.current) {
          contentRef.current.replaceChildren(frag);
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render PDF');
      }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pdf, zoom, width]);

  return (
    <>
      <ZoomToolbar
        zoom={zoom}
        onZoom={setZoom}
        info={pdf ? `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}` : ''}
      />
      <div style={{ padding: '20px 24px' }}>
        {error ? (
          <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--red)' }}>{error}</div>
        ) : !ready ? (
          <div style={{
            padding: '48px 0', textAlign: 'center',
            fontSize: 13, color: 'var(--ink-3)',
            animation: 'pulse 1.4s ease-in-out infinite',
          }}>Rendering PDF…</div>
        ) : null}
        <div ref={contentRef} style={{ width: '100%' }} />
      </div>
    </>
  );
}

// ── Image ─────────────────────────────────────────────────────────────────────

function ImageView({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <>
      <ZoomToolbar zoom={zoom} onZoom={setZoom} info={name} />
      <div style={{ padding: '20px 24px' }}>
        <img
          src={url}
          alt={name}
          style={{
            display: 'block',
            width: `${zoom * 100}%`,
            maxWidth: 'none',
            margin: '0 auto',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(28,25,23,0.14), 0 0 0 0.5px rgba(28,25,23,0.08)',
            background: '#fff',
          }}
        />
      </div>
    </>
  );
}

// ── DocumentViewer ────────────────────────────────────────────────────────────

export default function DocumentViewer({ doc }: { doc: Document }) {
  const fileUrl = `/api/documents/${doc.id}/file`;

  if (doc.fileType === 'application/pdf') {
    return <PdfView url={fileUrl} />;
  }
  if (HEIC_MIMES.has(doc.fileType)) {
    return (
      <div style={{ paddingTop: 40 }}>
        <EmptyState
          icon={IconNote}
          title="HEIC preview unavailable"
          subtitle="HEIC images can't be previewed in-browser. Use the download link below."
        />
        <div style={{ textAlign: 'center' }}>
          <a href={fileUrl} download={doc.originalName} style={{
            display: 'inline-block', padding: '7px 14px', borderRadius: 7,
            background: 'var(--accent)', color: '#fff',
            fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
          }}>Download original</a>
        </div>
      </div>
    );
  }
  if (isImageFile(doc.fileType)) {
    return <ImageView url={fileUrl} name={doc.originalName} />;
  }
  return (
    <EmptyState
      icon={IconNote}
      title="No preview"
      subtitle="This file type can't be previewed in-app."
    />
  );
}
