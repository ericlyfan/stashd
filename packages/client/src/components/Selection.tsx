import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CheckSquare, FolderInput, Trash2, X } from 'lucide-react';
import { Document } from '@stashd/shared';
import { batchDeleteDocuments, batchUpdateDocuments } from '../api';
import { useStore } from '../store';
import { categoryIcon, nameFromSlug } from '../lib/categoryMeta';
import ConfirmDialog from './ConfirmDialog';

interface SelectionState {
  selectMode: boolean;
  selected: ReadonlySet<string>;
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
  enter: () => void;
  exit: () => void;
}

// Default for cards/rows rendered outside a provider (e.g. the inbox queue):
// selection is simply off, so they behave as plain links.
const DISABLED: SelectionState = {
  selectMode: false,
  selected: new Set(),
  count: 0,
  isSelected: () => false,
  toggle: () => {},
  setAll: () => {},
  clear: () => {},
  enter: () => {},
  exit: () => {},
};

const SelectionContext = createContext<SelectionState | null>(null);

export function useSelection(): SelectionState {
  return useContext(SelectionContext) ?? DISABLED;
}

// Scopes a multi-select session to one page: unmounting (navigating away)
// resets it, so selections never leak between pages.
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const enter = useCallback(() => setSelectMode(true), []);
  const exit = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // Esc leaves select mode.
  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') exit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, exit]);

  const value = useMemo<SelectionState>(
    () => ({
      selectMode,
      selected,
      count: selected.size,
      isSelected: (id: string) => selected.has(id),
      toggle,
      setAll,
      clear,
      enter,
      exit,
    }),
    [selectMode, selected, toggle, setAll, clear, enter, exit],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

// Toolbar toggle that enters/leaves select mode. Drop it in a page's sort row.
export function SelectButton() {
  const sel = useSelection();
  return (
    <button
      className={`sort-btn${sel.selectMode ? ' on' : ''}`}
      onClick={() => (sel.selectMode ? sel.exit() : sel.enter())}
    >
      <CheckSquare size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
      {sel.selectMode ? 'Done' : 'Select'}
    </button>
  );
}

// The floating action bar shown while in select mode. `docs` is the page's
// visible list, used for select-all. Self-hides when not selecting.
export function SelectionBar({ docs }: { docs: Document[] }) {
  const sel = useSelection();
  const { categories, refresh, notify } = useStore();
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!sel.selectMode) return null;

  const ids = [...sel.selected];
  const n = ids.length;
  const noun = n === 1 ? 'document' : 'documents';
  const allSelected = docs.length > 0 && docs.every(d => sel.isSelected(d.id));

  async function move(categoryId: string) {
    setMoveOpen(false);
    if (n === 0) return;
    setBusy(true);
    try {
      await batchUpdateDocuments(ids, { category: categoryId });
      await refresh();
      notify(`Moved ${n} ${noun} to ${nameFromSlug(categoryId)}`);
      sel.exit();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not move documents', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await batchDeleteDocuments(ids);
      await refresh();
      notify(`Deleted ${n} ${noun}`);
      sel.exit();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete documents', 'err');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="select-bar" role="toolbar" aria-label="Selection actions">
        <span className="select-count">{n} selected</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => (allSelected ? sel.clear() : sel.setAll(docs.map(d => d.id)))}
        >
          {allSelected ? 'Clear' : 'Select all'}
        </button>

        <div style={{ flex: 1 }} />

        <div className="select-move">
          <button
            className="btn btn-ghost btn-sm"
            disabled={n === 0 || busy}
            onClick={() => setMoveOpen(o => !o)}
          >
            <FolderInput size={14} />
            Move to…
          </button>
          {moveOpen && (
            <>
              <div className="select-move-backdrop" onClick={() => setMoveOpen(false)} />
              <div className="select-move-menu" role="menu">
                {categories.map(c => {
                  const Icon = categoryIcon(c.icon);
                  return (
                    <button key={c.id} role="menuitem" onClick={() => move(c.id)}>
                      <Icon size={14} style={{ color: c.color }} />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <button className="btn btn-wax btn-sm" disabled={n === 0 || busy} onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
          Delete
        </button>
        <button className="btn btn-ghost btn-sm" onClick={sel.exit} aria-label="Done selecting">
          <X size={15} />
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Delete ${n} ${noun}?`}
          body={`The selected ${noun} and ${n === 1 ? 'its file' : 'their files'} will be permanently removed from the stash. There is no undo.`}
          confirmLabel={`Delete ${n}`}
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
