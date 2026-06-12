import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArchiveX, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { deleteCategory } from '../api';
import EditDrawerDialog from '../components/EditDrawerDialog';
import { Ledger } from '../components/Ledger';
import { DocGrid } from '../components/DocGrid';
import { ViewToggle, useViewMode } from '../components/ViewToggle';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { categoryIcon, nameFromSlug } from '../lib/categoryMeta';
import { formatAmount } from '../lib/format';

export default function CategoryPage() {
  const { id } = useParams<{ id: string }>();
  const { docs, categoryById, refresh, notify } = useStore();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useViewMode();

  const cat = categoryById(id);
  const list = docs
    .filter(d => d.category === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = list.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const Icon = categoryIcon(cat?.icon);
  const color = cat?.color ?? '#8d8472';

  async function removeDrawer() {
    if (!id) return;
    setBusy(true);
    try {
      await deleteCategory(id);
      await refresh();
      notify('Drawer removed');
      navigate('/');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove drawer', 'err');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const empty = (
    <EmptyState
      icon={ArchiveX}
      title="This drawer is empty"
      subtitle="File a document under this category and it will appear here."
    />
  );

  return (
    <div className="page">
      <header className="page-head rise">
        <div className="page-eyebrow" style={{ color }}>
          <Icon size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
          Drawer
        </div>
        <div className="page-title-row">
          <h1 className="page-title">{cat?.name ?? nameFromSlug(id ?? '')}</h1>
          {cat && (
            <button className="btn btn-ghost btn-sm" title="Edit this drawer" onClick={() => setEditing(true)}>
              <Pencil size={13} />
              Edit
            </button>
          )}
          {cat?.isCustom && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={list.length > 0}
              title={
                list.length > 0
                  ? `Move or delete its ${list.length} document${list.length === 1 ? '' : 's'} first`
                  : 'Remove this drawer'
              }
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={13} />
              Remove drawer
            </button>
          )}
        </div>
        <p className="page-sub">
          {list.length} {list.length === 1 ? 'document' : 'documents'}
          {total > 0 && <> · {formatAmount(total)} in tracked amounts</>}
        </p>
      </header>

      <div className="sort-row rise rise-1">
        <div style={{ flex: 1 }} />
        <ViewToggle mode={view} onChange={setView} />
      </div>

      <div className="rise rise-2">
        {view === 'grid' ? (
          <DocGrid docs={list} showCategory={false}>
            {empty}
          </DocGrid>
        ) : (
          <Ledger docs={list} showCategory={false} meta="">
            {empty}
          </Ledger>
        )}
      </div>

      {editing && cat && <EditDrawerDialog category={cat} onClose={() => setEditing(false)} />}

      {confirming && (
        <ConfirmDialog
          title="Remove this drawer?"
          body={`“${cat?.name ?? id}” will be removed from the cabinet. This doesn’t touch any documents.`}
          confirmLabel="Remove drawer"
          busy={busy}
          onConfirm={removeDrawer}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
