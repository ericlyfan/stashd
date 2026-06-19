import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Document } from '@stashd/shared';
import { listDocuments } from '../api';
import { Ledger } from '../components/Ledger';
import { DocGrid } from '../components/DocGrid';
import { ViewToggle, useViewMode } from '../components/ViewToggle';
import { SelectButton, SelectionBar, SelectionProvider } from '../components/Selection';
import EmptyState from '../components/EmptyState';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [results, setResults] = useState<Document[] | null>(null);
  const [view, setView] = useViewMode();

  // Debounced server-side search.
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      listDocuments(q)
        .then(docs => !cancelled && setResults(docs))
        .catch(() => !cancelled && setResults([]));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const empty = (
    <EmptyState
      icon={SearchX}
      title="No matches"
      subtitle="Try a vendor name, a tag, or a word from the document’s summary."
    />
  );

  return (
    <SelectionProvider>
    <div className="page">
      <header className="page-head rise">
        <div className="page-eyebrow">Search</div>
        <h1 className="page-title">
          “<em>{q}</em>”
        </h1>
        {results !== null && (
          <p className="page-sub">
            {results.length} {results.length === 1 ? 'match' : 'matches'} across names, summaries,
            tags, and vendors
          </p>
        )}
      </header>

      <div className="sort-row rise rise-1">
        <div style={{ flex: 1 }} />
        <SelectButton />
        <ViewToggle mode={view} onChange={setView} />
      </div>

      <div className="rise rise-2">
        {results === null ? (
          <div className="loading-line">Searching the stash…</div>
        ) : view === 'grid' ? (
          <DocGrid docs={results}>{empty}</DocGrid>
        ) : (
          <Ledger docs={results} meta="">
            {empty}
          </Ledger>
        )}
      </div>

      <SelectionBar docs={results ?? []} />
    </div>
    </SelectionProvider>
  );
}
