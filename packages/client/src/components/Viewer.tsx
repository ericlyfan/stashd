import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjsLib } from '../lib/pdf';
import { Download, ImageOff, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { Document } from '@stashd/shared';
import { fileUrl } from '../api';
import { isHeicMime, viewerKind } from '../lib/format';
import EmptyState from './EmptyState';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 10) / 10));

// Lets any viewer bar render a full-screen toggle without threading props
// through every branch. Absent (null) outside the document-page Viewer — e.g.
// the review-sheet's PdfView preview — where the button simply doesn't appear.
const ViewerChromeContext = createContext<{ fullscreen: boolean; toggle: () => void } | null>(null);

function FullscreenButton() {
  const chrome = useContext(ViewerChromeContext);
  if (!chrome) return null;
  return (
    <button
      className="btn btn-ghost btn-sm"
      aria-label={chrome.fullscreen ? 'Exit full screen' : 'Full screen'}
      title={chrome.fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
      onClick={chrome.toggle}
    >
      {chrome.fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </button>
  );
}

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
      <FullscreenButton />
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

// Fetches a document's raw bytes as text. Shared by the text viewer (and,
// later, the table/email branches that parse text-ish payloads client-side).
export function useFileText(url: string): { text: string | null; error: string | null } {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.text();
      })
      .then(t => !cancelled && setText(t))
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { text, error };
}

// Inline emphasis only — **bold**, *italic*, `code`. Deliberately not a
// markdown engine (mirrors the chat's house style).
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

// Markdown-lite for the .md viewer: headings, bullet/numbered lists, and
// paragraphs, with inline emphasis. Blank lines separate blocks.
function MarkdownLite({ src }: { src: string }) {
  const blocks = useMemo(() => src.split(/\n{2,}/).filter(b => b.trim()), [src]);
  return (
    <div className="doc-md">
      {blocks.map((block, i) => {
        const heading = /^(#{1,3})\s+(.*)$/.exec(block.trim());
        if (heading) {
          const level = heading[1].length;
          const Tag = (`h${level}` as 'h1' | 'h2' | 'h3');
          return <Tag key={i}>{renderInline(heading[2])}</Tag>;
        }
        const lines = block.split('\n');
        const isList = lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

// Like useFileText but for binary payloads (docx/xlsx parsed client-side).
function useFileBuffer(url: string): { buffer: ArrayBuffer | null; error: string | null } {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBuffer(null);
    setError(null);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.arrayBuffer();
      })
      .then(b => !cancelled && setBuffer(b))
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { buffer, error };
}

function ViewerHeader({ url, info }: { url: string; info: string }) {
  return (
    <div className="viewer-bar">
      <span className="info">{info}</span>
      <div style={{ flex: 1 }} />
      <a className="btn btn-ghost btn-sm" href={url} download>
        <Download size={13} />
      </a>
      <FullscreenButton />
    </div>
  );
}

// .docx rendered via mammoth → HTML, client-side (mammoth is dynamically
// imported so the heavy lib only loads when a Word doc is actually opened).
function DocxView({ url, info }: { url: string; info: string }) {
  const { buffer, error } = useFileBuffer(url);
  const [html, setHtml] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);

  useEffect(() => {
    if (!buffer) return;
    let cancelled = false;
    (async () => {
      try {
        const [mammothMod, { default: DOMPurify }] = await Promise.all([
          import('mammoth'),
          import('dompurify'),
        ]);
        // CJS interop can nest the API on `.default`; tolerate both shapes.
        const mammoth = ((mammothMod as { default?: typeof import('mammoth') }).default ?? mammothMod);
        const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer });
        // mammoth emits a constrained subset, but sanitize anyway: a hostile
        // .docx could carry javascript: links or stray attributes.
        if (!cancelled) setHtml(DOMPurify.sanitize(value));
      } catch (e) {
        if (!cancelled) setConvError(e instanceof Error ? e.message : 'Could not render document');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  const err = error ?? convError;
  return (
    <>
      <ViewerHeader url={url} info={info} />
      <div className="viewer-body">
        {err && <div className="loading-line" style={{ color: 'var(--wax)' }}>{err}</div>}
        {!err && html === null && <div className="loading-line">Rendering…</div>}
        {html !== null && (
          <div className="doc-text-sheet">
            <div className="doc-html" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        )}
      </div>
    </>
  );
}

interface Sheet {
  name: string;
  rows: string[][];
}

// Cap rendered rows so a huge spreadsheet doesn't lock the DOM; the full text
// is still searchable server-side.
const MAX_TABLE_ROWS = 1000;

// .xlsx / .csv parsed with SheetJS and rendered as a table, with a tab per
// sheet for multi-sheet workbooks.
function TableView({ url, info }: { url: string; info: string }) {
  const { buffer, error } = useFileBuffer(url);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!buffer) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('xlsx');
        const XLSX = ((mod as { default?: typeof import('xlsx') }).default ?? mod);
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
        const parsed: Sheet[] = wb.SheetNames.map(name => ({
          name,
          rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
            header: 1,
            blankrows: false,
            raw: false,
            defval: '',
          }),
        }));
        if (!cancelled) {
          setSheets(parsed);
          setActive(0);
        }
      } catch (e) {
        if (!cancelled) setParseError(e instanceof Error ? e.message : 'Could not read spreadsheet');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  const err = error ?? parseError;
  const sheet = sheets?.[active];
  const truncated = sheet ? sheet.rows.length > MAX_TABLE_ROWS : false;
  const rows = sheet ? sheet.rows.slice(0, MAX_TABLE_ROWS) : [];
  const [head, ...body] = rows;

  return (
    <>
      <div className="viewer-bar">
        <span className="info">{info}</span>
        <div style={{ flex: 1 }} />
        {sheets && sheets.length > 1 && (
          <div className="sheet-tabs">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                className={`sheet-tab${i === active ? ' active' : ''}`}
                onClick={() => setActive(i)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <a className="btn btn-ghost btn-sm" href={url} download>
          <Download size={13} />
        </a>
        <FullscreenButton />
      </div>
      <div className="viewer-body">
        {err && <div className="loading-line" style={{ color: 'var(--wax)' }}>{err}</div>}
        {!err && !sheet && <div className="loading-line">Loading…</div>}
        {sheet && rows.length === 0 && (
          <div className="loading-line">This sheet is empty.</div>
        )}
        {sheet && rows.length > 0 && (
          <div className="doc-table-wrap">
            <table className="doc-table">
              {head && (
                <thead>
                  <tr>
                    {head.map((c, j) => (
                      <th key={j}>{c}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {body.map((row, i) => (
                  <tr key={i}>
                    {head.map((_, j) => (
                      <td key={j}>{row[j] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated && (
              <div className="doc-table-note">
                Showing the first {MAX_TABLE_ROWS.toLocaleString()} rows. Download for the full sheet.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function TextView({ url, markdown, info }: { url: string; markdown: boolean; info: string }) {
  const { text, error } = useFileText(url);
  return (
    <>
      <div className="viewer-bar">
        <span className="info">{info}</span>
        <div style={{ flex: 1 }} />
        <a className="btn btn-ghost btn-sm" href={url} download>
          <Download size={13} />
        </a>
      </div>
      <div className="viewer-body">
        {error && <div className="loading-line" style={{ color: 'var(--wax)' }}>{error}</div>}
        {!error && text === null && <div className="loading-line">Loading…</div>}
        {text !== null && (
          <div className="doc-text-sheet">
            {markdown ? <MarkdownLite src={text} /> : <pre className="doc-plain">{text}</pre>}
          </div>
        )}
      </div>
    </>
  );
}

// Email viewer: renders the flattened email text captured at classify time
// (header lines, then body), so there's no need to parse .eml/.msg in the
// browser. Attachments were spun off into their own documents at file time.
function EmailView({ doc, url }: { doc: Document; url: string }) {
  const text = doc.extractedText;
  if (!text) {
    return (
      <EmptyState icon={ImageOff} title="No preview" subtitle="Couldn’t read this message. Download the original.">
        <a className="btn btn-primary" href={url} download={doc.originalName}>
          <Download size={14} />
          Download original
        </a>
      </EmptyState>
    );
  }

  const lines = text.split('\n');
  const headers: { label: string; value: string }[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^(From|To|Date|Subject|Attachments):\s*(.*)$/.exec(lines[i]);
    if (m) headers.push({ label: m[1], value: m[2] });
    else if (lines[i].trim() === '') {
      i++;
      break;
    } else break;
  }
  const body = lines.slice(i).join('\n').trim();

  return (
    <>
      <ViewerHeader url={url} info={doc.originalName} />
      <div className="viewer-body">
        <div className="doc-text-sheet">
          {headers.length > 0 && (
            <dl className="doc-email-head">
              {headers.map(h => (
                <div key={h.label}>
                  <dt>{h.label}</dt>
                  <dd>{h.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <pre className="doc-plain doc-email-body">{body}</pre>
        </div>
      </div>
    </>
  );
}

export default function Viewer({ doc }: { doc: Document }) {
  const url = fileUrl(doc.id);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const kind = viewerKind(doc.fileType);

  // While full screen: Esc exits and the page behind is scroll-locked. The
  // overlay is position:fixed, so it leaves the document-page layout in place
  // (no remount → zoom, scroll, and selected sheet are all preserved).
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false);
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  const chrome = useMemo(
    () => ({ fullscreen, toggle: () => setFullscreen(f => !f) }),
    [fullscreen],
  );

  function renderBranch() {
    if (kind === 'pdf') return <PdfView url={url} />;
    if (kind === 'text') {
      return <TextView url={url} markdown={doc.fileType === 'text/markdown'} info={doc.originalName} />;
    }
    if (kind === 'html') return <DocxView url={url} info={doc.originalName} />;
    if (kind === 'table') return <TableView url={url} info={doc.originalName} />;
    if (kind === 'email') return <EmailView doc={doc} url={url} />;

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

    if (kind === 'image') {
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

  return (
    <ViewerChromeContext.Provider value={chrome}>
      <div
        className={`viewer-shell${fullscreen ? ' viewer-fullscreen' : ''}`}
        {...(fullscreen && { role: 'dialog', 'aria-modal': true, 'aria-label': `${doc.originalName} — full screen` })}
      >
        {renderBranch()}
      </div>
    </ViewerChromeContext.Provider>
  );
}
