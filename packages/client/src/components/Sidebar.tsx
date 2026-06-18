import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, Inbox, Library, Pin, Plus, Search, Sparkles } from "lucide-react";
import { useStore } from "../store";
import { batchUpdateDocuments, createCategory, reorderCategories, updateCategory } from "../api";
import { categoryIcon } from "../lib/categoryMeta";
import type { CategoryWithCount } from "../api";

// Documents dragged onto a drawer file them there; drawers dragged onto each
// other reorder the cabinet. Two MIME types keep the two gestures apart.
const DRAG_MIME = "application/x-stashd-docs";
const DRAWER_MIME = "application/x-stashd-drawer";
const COLLAPSE_KEY = "stashd:cabinet-collapsed";

// Pinned drawers float to the top; within a group, a manual position (set by
// drag-reordering) wins, otherwise drawers fall back to usage then name.
function sortDrawers(cats: CategoryWithCount[]): CategoryWithCount[] {
  const pos = (c: CategoryWithCount) => (c.position > 0 ? c.position : Number.MAX_SAFE_INTEGER);
  return [...cats].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      pos(a) - pos(b) ||
      b.documentCount - a.documentCount ||
      a.name.localeCompare(b.name),
  );
}

export default function Sidebar() {
  const { categories, setCategories, docs, projects, queue, refresh, notify } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [reorderOver, setReorderOver] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
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
      const name = categories.find((c) => c.id === categoryId)?.name ?? categoryId;
      notify(`Filed ${ids.length} ${ids.length === 1 ? "document" : "documents"} under ${name}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not move documents", "err");
    }
  }

  const inboxCount = queue.length + docs.filter((d) => d.status === "pending").length;
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const onLedgers = location.pathname.startsWith("/ledger");

  // Keep the box in sync when arriving at /search via URL, clear elsewhere.
  useEffect(() => {
    if (location.pathname === "/search") setQuery(params.get("q") ?? "");
    else setQuery("");
  }, [location.pathname, params]);

  // “/” focuses search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSearchChange(v: string) {
    setQuery(v);
    if (v.trim()) navigate(`/search?q=${encodeURIComponent(v)}`, { replace: location.pathname === "/search" });
    else if (location.pathname === "/search") navigate("/");
  }

  async function submitNewCategory() {
    const name = newName.trim();
    if (!name) return;
    try {
      const cat = await createCategory(name);
      await refresh();
      setAdding(false);
      setNewName("");
      navigate(`/category/${cat.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not create category", "err");
    }
  }

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Pin/unpin a drawer. Optimistic so the row jumps immediately; on failure we
  // refetch to snap back to the server's truth.
  async function togglePin(e: React.MouseEvent, cat: CategoryWithCount) {
    e.preventDefault();
    e.stopPropagation();
    const pinned = !cat.pinned;
    setCategories((cs) => cs.map((c) => (c.id === cat.id ? { ...c, pinned } : c)));
    try {
      await updateCategory(cat.id, { pinned });
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not pin drawer", "err");
      refresh();
    }
  }

  // Drop the dragged drawer just before the target, then persist the whole
  // order. Optimistic position stamps keep the list from flickering.
  async function onReorderDrop(targetId: string) {
    setReorderOver(null);
    if (!dragId || dragId === targetId) return;
    const order = sorted.map((c) => c.id).filter((id) => id !== dragId);
    const insertAt = order.indexOf(targetId);
    order.splice(insertAt, 0, dragId);

    const posById = new Map(order.map((id, i) => [id, i + 1]));
    setCategories((cs) => cs.map((c) => ({ ...c, position: posById.get(c.id) ?? c.position })));
    try {
      await reorderCategories(order);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not reorder drawers", "err");
      refresh();
    }
  }

  const sorted = sortDrawers(categories);
  const pinnedCount = sorted.filter((c) => c.pinned).length;

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
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search the stash…"
          aria-label="Search documents"
        />
        <kbd>/</kbd>
      </div>

      <nav className="side-section">
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Inbox size={15} strokeWidth={1.8} />
          Inbox
          {inboxCount > 0 && <span className="nav-badge">{inboxCount}</span>}
        </NavLink>
        <NavLink to="/all" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Library size={15} strokeWidth={1.8} />
          All documents
          <span className="count">{docs.length}</span>
        </NavLink>
        <NavLink to="/ledgers" className={({ isActive }) => `nav-item${isActive || onLedgers ? " active" : ""}`}>
          <BookOpen size={15} strokeWidth={1.8} />
          Ledgers
          {activeProjects > 0 && <span className="count">{activeProjects}</span>}
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Sparkles size={15} strokeWidth={1.8} />
          Ask the stash
        </NavLink>
      </nav>

      <div className="side-section">
        <div className="side-label side-label-row">
          <button
            className="side-collapse"
            aria-expanded={!collapsed}
            title={collapsed ? "Expand cabinet" : "Collapse cabinet"}
            onClick={toggleCollapsed}
          >
            <ChevronDown className={`side-chevron${collapsed ? " collapsed" : ""}`} size={12} strokeWidth={2.25} />
            The Cabinet
          </button>
          <button
            className="side-add"
            aria-label="Add category"
            title="Add category"
            onClick={() => setAdding((a) => !a)}
          >
            <Plus size={20} strokeWidth={2.25} />
          </button>
        </div>
        {!collapsed && (
          <>
            {adding && (
              <input
                className="side-add-input"
                autoFocus
                value={newName}
                placeholder="New drawer name…"
                aria-label="New category name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewCategory();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewName("");
                  }
                }}
              />
            )}
            {sorted.map((cat, i) => {
              const Icon = categoryIcon(cat.icon);
              // Thin rule between the pinned group and the rest.
              const showSep = pinnedCount > 0 && i === pinnedCount && pinnedCount < sorted.length;
              return (
                <div key={cat.id}>
                  {showSep && <div className="drawer-sep" />}
                  <NavLink
                    to={`/category/${cat.id}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(cat.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(DRAWER_MIME, cat.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setReorderOver(null);
                    }}
                    className={({ isActive }) =>
                      `nav-item drawer-item${isActive ? " active" : ""}` +
                      `${dropTarget === cat.id ? " drop-hover" : ""}` +
                      `${reorderOver === cat.id ? " reorder-over" : ""}` +
                      `${dragId === cat.id ? " dragging" : ""}` +
                      `${cat.pinned ? " pinned" : ""}`
                    }
                    onDragOver={(e) => {
                      const types = e.dataTransfer.types;
                      if (types.includes(DRAWER_MIME)) {
                        e.preventDefault();
                        setReorderOver(cat.id);
                      } else if (types.includes(DRAG_MIME)) {
                        e.preventDefault();
                        setDropTarget(cat.id);
                      }
                    }}
                    onDragLeave={() => {
                      setDropTarget((t) => (t === cat.id ? null : t));
                      setReorderOver((t) => (t === cat.id ? null : t));
                    }}
                    onDrop={(e) => {
                      if (e.dataTransfer.types.includes(DRAWER_MIME)) {
                        e.preventDefault();
                        onReorderDrop(cat.id);
                      } else {
                        onDropDocs(e, cat.id);
                      }
                    }}
                  >
                    <Icon size={15} strokeWidth={1.8} style={{ color: cat.color }} />
                    <span className="drawer-name">{cat.name}</span>
                    <button
                      className="drawer-pin"
                      aria-label={cat.pinned ? "Unpin drawer" : "Pin drawer to top"}
                      title={cat.pinned ? "Unpin" : "Pin to top"}
                      onClick={(e) => togglePin(e, cat)}
                    >
                      <Pin size={12} strokeWidth={1.9} />
                    </button>
                    <span className="count">{cat.documentCount}</span>
                  </NavLink>
                </div>
              );
            })}
          </>
        )}
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
