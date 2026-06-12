import { useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';

export type ViewMode = 'grid' | 'list';

const KEY = 'stashd:view-mode';

// One shared preference across Category / All docs / Search pages.
export function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() =>
    localStorage.getItem(KEY) === 'list' ? 'list' : 'grid',
  );
  const set = (m: ViewMode) => {
    localStorage.setItem(KEY, m);
    setMode(m);
  };
  return [mode, set];
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      <button
        className={`sort-btn${mode === 'grid' ? ' on' : ''}`}
        aria-label="Grid view"
        title="Grid view"
        onClick={() => onChange('grid')}
      >
        <LayoutGrid size={13} />
      </button>
      <button
        className={`sort-btn${mode === 'list' ? ' on' : ''}`}
        aria-label="List view"
        title="List view"
        onClick={() => onChange('list')}
      >
        <Rows3 size={13} />
      </button>
    </div>
  );
}
