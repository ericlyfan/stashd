import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Document, SearchHit } from '@stashd/shared';
import { useStore } from '../store';
import { fileUrl } from '../api';
import { formatAmount, isHeicMime, isImageMime, relTime } from '../lib/format';
import { categoryIcon } from '../lib/categoryMeta';
import { CategoryStamp, StatusStamp } from './Stamps';
import { useSelection } from './Selection';
import { pdfThumbnail } from '../lib/thumbs';

// Resolves a previewable image source for a document, lazily rendering PDF
// first pages only once the host element nears the viewport. Shared by the
// grid thumbnail, the row thumbnail, and the row hover preview.
export function useThumbSrc(doc: Document) {
  const { categoryById } = useStore();
  const isPdf = doc.fileType === 'application/pdf';
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Render PDF thumbnails only once the card scrolls near the viewport, so a
  // large stash doesn't kick off hundreds of pdf.js jobs on page load.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!isPdf || !inView) return;
    let cancelled = false;
    pdfThumbnail(doc.id, fileUrl(doc.id))
      .then(src => !cancelled && setPdfSrc(src))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc.id, isPdf, inView]);

  // Browsers can't decode HEIC, so those fall through to the placeholder.
  const src = isPdf
    ? pdfSrc
    : isImageMime(doc.fileType) && !isHeicMime(doc.fileType)
      ? fileUrl(doc.id)
      : null;

  const cat = categoryById(doc.category);
  const Icon = categoryIcon(cat?.icon);
  return { wrapRef, src, failed, setFailed, Icon, color: cat?.color ?? '#8d8472' };
}

export function Thumb({ doc, iconSize = 38 }: { doc: Document; iconSize?: number }) {
  const { wrapRef, src, failed, setFailed, Icon, color } = useThumbSrc(doc);
  return (
    <div className="thumb-wrap" ref={wrapRef}>
      {src && !failed ? (
        <img className="thumb-img" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="thumb-fallback" style={{ color }}>
          <Icon size={iconSize} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

export function DocCard({ doc, showCategory = true }: { doc: Document; showCategory?: boolean }) {
  const { categoryById } = useStore();
  const sel = useSelection();
  const selected = sel.isSelected(doc.id);
  const snippet = (doc as SearchHit).snippet;

  const inner = (
    <>
      <div className="doc-card-thumb">
        <Thumb doc={doc} />
        {doc.status === 'pending' && (
          <span className="doc-card-flag">
            <StatusStamp status="pending" />
          </span>
        )}
        {sel.selectMode && (
          <span className={`select-check${selected ? ' on' : ''}`}>{selected && <Check size={13} strokeWidth={3} />}</span>
        )}
      </div>
      <div className="doc-card-body">
        <div className="doc-card-title">{doc.originalName}</div>
        {snippet && <div className="doc-card-snippet">{snippet}</div>}
        <div className="doc-card-meta">
          {showCategory && <CategoryStamp category={categoryById(doc.category)} slug={doc.category} />}
          {doc.amount !== undefined && doc.amount !== null && (
            <span className="row-amount">{formatAmount(doc.amount)}</span>
          )}
          <span className="row-meta">{relTime(doc.createdAt)}</span>
        </div>
      </div>
    </>
  );

  if (sel.selectMode) {
    return (
      <div
        className={`doc-card selectable${selected ? ' selected' : ''}`}
        role="button"
        aria-pressed={selected}
        onClick={() => sel.toggle(doc.id)}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={`/doc/${doc.id}`}
      className="doc-card"
      draggable
      onDragStart={e => e.dataTransfer.setData('application/x-stashd-docs', JSON.stringify([doc.id]))}
    >
      {inner}
    </Link>
  );
}

export function DocGrid({
  docs,
  showCategory = true,
  children,
}: {
  docs: Document[];
  showCategory?: boolean;
  children?: React.ReactNode; // rendered when docs is empty
}) {
  if (docs.length === 0) return <>{children}</>;
  return (
    <div className="doc-grid">
      {docs.map(doc => (
        <DocCard key={doc.id} doc={doc} showCategory={showCategory} />
      ))}
    </div>
  );
}
