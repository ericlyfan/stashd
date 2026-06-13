import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Inbox, Library, Plus, Search, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { batchUpdateDocuments, createCategory } from '../api';
import { categoryIcon } from '../lib/categoryMeta';

const DRAG_MIME = 'application/x-stashd-docs';

export default function Sidebar() {
  const { categories, docs, projects, queue, refresh, notify } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onDropDocs(e: React.DragEvent, categoryId: string) {
    e.preventDefault();
    setDropTarget(null);
    let ids: string[];
    try {
      ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as string[];
    } catch {
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      await batchUpdateDocuments(ids, { category: categoryId });
      await refresh();
      const name = categories.find(c => c.id === categoryId)?.name ?? categoryId;
      notify(`Filed ${ids.length} ${ids.length === 1 ? 'document' : 'documents'} under ${name}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not move documents', 'err');
    }
  }

  const inboxCount = queue.length + docs.filter(d => d.status === 'pending').length;
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const onLedgers = location.pathname.startsWith('/ledger');

  // Keep the box in sync when arriving at /search via URL, clear elsewhere.
  useEffect(() => {
    if (location.pathname === '/search') setQuery(params.get('q') ?? '');
    else setQuery('');
  }, [location.pathname, params]);

  // “/” focuses search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onSearchChange(v: string) {
    setQuery(v);
    if (v.trim()) navigate(`/search?q=${encodeURIComponent(v)}`, { replace: location.pathname === '/search' });
    else if (location.pathname === '/search') navigate('/');
  }

  async function submitNewCategory() {
    const name = newName.trim();
    if (!name) return;
    try {
      const cat = await createCategory(name);
      await refresh();
      setAdding(false);
      setNewName('');
      navigate(`/category/${cat.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create category', 'err');
    }
  }

  const sorted = [...categories].sort((a, b) => b.documentCount - a.documentCount || a.name.localeCompare(b.name));

  return (
    <aside className="sidebar">
      <NavLink to="/" className="wordmark">
        Stash’d<span className="tick">.</span>
      </NavLink>
      <div className="wordmark-sub">The document ledger</div>

      <div className="side-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search the stash…"
          aria-label="Search documents"
        />
        <kbd>/</kbd>
      </div>

      <nav className="side-section">
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Inbox size={15} strokeWidth={1.8} />
          Inbox
          {inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
        </NavLink>
        <NavLink to="/all" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Library size={15} strokeWidth={1.8} />
          All documents
          <span className="count">{docs.length}</span>
        </NavLink>
        <NavLink to="/ledgers" className={({ isActive }) => `nav-item${isActive || onLedgers ? ' active' : ''}`}>
          <BookOpen size={15} strokeWidth={1.8} />
          Ledgers
          {activeProjects > 0 && <span className="count">{activeProjects}</span>}
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Sparkles size={15} strokeWidth={1.8} />
          Ask the stash
        </NavLink>
      </nav>

      <div className="side-section">
        <div className="side-label side-label-row">
          The Cabinet
          <button
            className="side-add"
            aria-label="Add category"
            title="Add category"
            onClick={() => setAdding(a => !a)}
          >
            <Plus size={13} />
          </button>
        </div>
        {adding && (
          <input
            className="side-add-input"
            autoFocus
            value={newName}
            placeholder="New drawer name…"
            aria-label="New category name"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitNewCategory();
              if (e.key === 'Escape') {
                setAdding(false);
                setNewName('');
              }
            }}
          />
        )}
        {sorted.map(cat => {
          const Icon = categoryIcon(cat.icon);
          return (
            <NavLink
              key={cat.id}
              to={`/category/${cat.id}`}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}${dropTarget === cat.id ? ' drop-hover' : ''}`
              }
              onDragOver={e => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  setDropTarget(cat.id);
                }
              }}
              onDragLeave={() => setDropTarget(t => (t === cat.id ? null : t))}
              onDrop={e => onDropDocs(e, cat.id)}
            >
              <Icon size={15} strokeWidth={1.8} style={{ color: cat.color }} />
              {cat.name}
              <span className="count">{cat.documentCount}</span>
            </NavLink>
          );
        })}
      </div>

      <div className="side-foot">
        <span className="dot" />
        local-first
        <br />
        every page stays on this machine
      </div>
    </aside>
  );
}
