import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjsLib } from '../lib/pdf';
import { Download, ImageOff, Minus, Plus } from 'lucide-react';
import { Document } from '@stashd/shared';
import { fileUrl } from '../api';
import { isHeicMime, isImageMime } from '../lib/format';
import EmptyState from './EmptyState';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 10) / 10));

function ViewerBar({ zoom, onZoom, info }: { zoom: number; onZoom: (z: number) => void; info: string }) {
  return (
    <div className="viewer-bar">
      <span className="info">{info}</span>
      <div style={{ flex: 1 }} />
      <button className="btn btn-ghost btn-sm" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(clampZoom(zoom - 0.2))}>
        <Minus size={13} />
      </button>
      <span className="zoom-num">{Math.round(zoom * 100)}%</span>
      <button className="btn btn-ghost btn-sm" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(clampZoom(zoom + 0.2))}>
        <Plus size={13} />
      </button>
      <button className="btn btn-ghost btn-sm" disabled={zoom === 1} onClick={() => onZoom(1)}>
        Fit
      </button>
    </div>
  );
}

export function PdfView({ url }: { url: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setReady(false);
    setError(null);
    const task = pdfjsLib.getDocument(url);
    task.promise
      .then(p => !cancelled && setPdf(p))
      .catch(err => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load PDF'));
    return () => {
      cancelled = true;
      task.destroy().catch(() => {});
    };
  }, [url]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      setWidth(prev => (Math.abs(prev - w) > 5 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render into a detached fragment, then swap, so the old render stays
  // visible while the new zoom level draws.
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
          canvas.style.margin = '0 auto 14px';
          canvas.style.borderRadius = '6px';
          canvas.style.boxShadow = '0 2px 14px rgba(28,24,20,0.16)';
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
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, zoom, width]);

  return (
    <>
      <ViewerBar zoom={zoom} onZoom={setZoom} info={pdf ? `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}` : '…'} />
      <div className="viewer-body">
        {error && <div className="loading-line" style={{ color: 'var(--wax)' }}>{error}</div>}
        {!error && !ready && <div className="loading-line">Rendering…</div>}
        <div ref={contentRef} />
      </div>
    </>
  );
}

export default function Viewer({ doc }: { doc: Document }) {
  const url = fileUrl(doc.id);
  const [zoom, setZoom] = useState(1);

  if (doc.fileType === 'application/pdf') return <PdfView url={url} />;

  if (isHeicMime(doc.fileType)) {
    return (
      <EmptyState
        icon={ImageOff}
        title="HEIC preview unavailable"
        subtitle="Browsers can’t render HEIC. Download the original instead."
      >
        <a className="btn btn-primary" href={url} download={doc.originalName}>
          <Download size={14} />
          Download original
        </a>
      </EmptyState>
    );
  }

  if (isImageMime(doc.fileType)) {
    return (
      <>
        <ViewerBar zoom={zoom} onZoom={setZoom} info={doc.originalName} />
        <div className="viewer-body">
          <img
            src={url}
            alt={doc.originalName}
            style={{
              display: 'block',
              width: `${zoom * 100}%`,
              margin: '0 auto',
              borderRadius: 6,
              boxShadow: '0 2px 14px rgba(28,24,20,0.16)',
              background: '#fff',
            }}
          />
        </div>
      </>
    );
  }

  return <EmptyState icon={ImageOff} title="No preview" subtitle="This file type can’t be previewed in-app." />;
}
