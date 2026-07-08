import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Link2, Search, X } from 'lucide-react';
import { useStore } from '../store';
import { categoryIcon } from '../lib/categoryMeta';
import { formatAmount, formatDate } from '../lib/format';

// A full-window document browser for attaching a stash document as evidence:
// search across name/vendor/folder/tags, browse by folder in a left rail, and
// see each document's full name and metadata before linking. Used by the
// ledger line-item dialog and the job-application dialog.
export default function DocumentBrowser({
  current,
  onPick,
  onClose,
}: {
  current?: string;
  onPick: (docId: string) => void;
  onClose: () => void;
}) {
  const { docs, categories, categoryById } = useStore();
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Live per-folder counts, so the rail only lists folders that hold documents.
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of docs) m[d.category] = (m[d.category] ?? 0) + 1;
    return m;
  }, [docs]);

  const folders = useMemo(
    () => categories.filter(c => (counts[c.id] ?? 0) > 0).sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0)),
    [categories, counts],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter(d => !activeCat || d.category === activeCat)
      .filter(d => {
        if (!q) return true;
        const cat = categoryById(d.category)?.name ?? '';
        return (
          d.originalName.toLowerCase().includes(q) ||
          d.vendor?.toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q) ||
          d.tags.some(t => t.toLowerCase().includes(q)) ||
          d.summary.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [docs, activeCat, query, categoryById]);

  // Portal to <body> so the fixed overlay is relative to the viewport, not
  // trapped inside the host dialog's backdrop-filtered scrim (which would
  // otherwise become its containing block and constrain/mis-size it).
  return createPortal(
    <div className="scrim doc-browser-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="doc-browser" role="dialog" aria-label="Link a supporting document">
        <div className="db-head">
          <div className="db-head-title">
            <Link2 size={16} />
            <h3>Link a supporting document</h3>
          </div>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="db-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search by name, vendor, folder or tag…"
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="db-body">
          <div className="db-rail">
            <button type="button" className={!activeCat ? 'active' : ''} onClick={() => setActiveCat(null)}>
              <FolderOpen size={14} />
              <span className="db-rail-name">All documents</span>
              <span className="db-rail-count">{docs.length}</span>
            </button>
            {folders.map(cat => {
              const Icon = categoryIcon(cat.icon);
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={activeCat === cat.id ? 'active' : ''}
                  onClick={() => setActiveCat(cat.id)}
                >
                  <Icon size={14} style={{ color: cat.color }} />
                  <span className="db-rail-name">{cat.name}</span>
                  <span className="db-rail-count">{counts[cat.id]}</span>
                </button>
              );
            })}
          </div>

          <div className="db-list">
            {results.map(d => {
              const cat = categoryById(d.category);
              const Icon = categoryIcon(cat?.icon);
              const meta = [cat?.name, d.vendor, formatDate(d.dateExtracted)].filter(Boolean).join('  ·  ');
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`db-item${current === d.id ? ' current' : ''}`}
                  onClick={() => onPick(d.id)}
                >
                  <span
                    className="db-icon"
                    style={cat ? { background: `${cat.color}1f`, color: cat.color } : undefined}
                  >
                    <Icon size={17} />
                  </span>
                  <span className="db-item-main">
                    <span className="db-name">{d.originalName}</span>
                    {meta && <span className="db-meta">{meta}</span>}
                  </span>
                  {d.amount !== undefined && d.amount !== null && (
                    <span className="db-amount">{formatAmount(d.amount)}</span>
                  )}
                  {current === d.id && <span className="db-current">linked</span>}
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="db-empty">
                {docs.length === 0 ? 'No documents in the stash yet.' : 'No documents match your search.'}
              </div>
            )}
          </div>
        </div>

        <div className="db-foot">
          <span className="db-foot-count">
            {results.length} document{results.length === 1 ? '' : 's'}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
