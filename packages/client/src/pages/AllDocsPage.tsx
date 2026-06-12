import { useMemo, useState } from 'react';
import { ArchiveX } from 'lucide-react';
import { useStore } from '../store';
import { Ledger } from '../components/Ledger';
import { DocGrid } from '../components/DocGrid';
import { ViewToggle, useViewMode } from '../components/ViewToggle';
import EmptyState from '../components/EmptyState';

type SortKey = 'newest' | 'oldest' | 'name' | 'amount';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'A–Z' },
  { key: 'amount', label: 'Amount' },
];

export default function AllDocsPage() {
  const { docs, loading } = useStore();
  const [sort, setSort] = useState<SortKey>('newest');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending'>('all');
  const [view, setView] = useViewMode();

  const sorted = useMemo(() => {
    const list = docs.filter(d => statusFilter === 'all' || d.status === 'pending');
    switch (sort) {
      case 'oldest':
        return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case 'name':
        return [...list].sort((a, b) => a.originalName.localeCompare(b.originalName));
      case 'amount':
        return [...list].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
      default:
        return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }, [docs, sort, statusFilter]);

  const empty = (
    <EmptyState
      icon={ArchiveX}
      title={statusFilter === 'pending' ? 'Nothing flagged' : 'The ledger is empty'}
      subtitle={
        statusFilter === 'pending'
          ? 'Documents you file with a flag will collect here.'
          : 'Head back to the inbox and drop something in.'
      }
    />
  );

  return (
    <div className="page">
      <header className="page-head rise">
        <div className="page-eyebrow">The full ledger</div>
        <h1 className="page-title">
          All documents
        </h1>
      </header>

      <div className="sort-row rise rise-1">
        {SORTS.map(s => (
          <button key={s.key} className={`sort-btn${sort === s.key ? ' on' : ''}`} onClick={() => setSort(s.key)}>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className={`sort-btn${statusFilter === 'pending' ? ' on' : ''}`}
          onClick={() => setStatusFilter(f => (f === 'pending' ? 'all' : 'pending'))}
        >
          Flagged only
        </button>
        <ViewToggle mode={view} onChange={setView} />
      </div>

      <div className="rise rise-2">
        {loading ? (
          <div className="loading-line">Opening the ledger…</div>
        ) : view === 'grid' ? (
          <DocGrid docs={sorted}>{empty}</DocGrid>
        ) : (
          <Ledger docs={sorted} meta="">
            {empty}
          </Ledger>
        )}
      </div>
    </div>
  );
}
