import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { listDocuments } from '../api/client';
import { IconSearch } from '../components/icons';
import DocumentGrid from '../components/DocumentGrid';
import EmptyState from '../components/EmptyState';

export default function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [results, setResults] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    listDocuments(query)
      .then(docs => { if (!cancelled) setResults(docs); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  return (
    <div style={{ padding: '26px 32px 40px', maxWidth: 1060, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
          fontSize: 25, letterSpacing: 0.2, color: 'var(--ink)',
        }}>Search</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3 }}>
          {query
            ? loading
              ? `Searching for “${query}”…`
              : `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”`
            : 'Type in the search bar above and press Enter.'}
        </div>
      </div>

      {query && !loading && results.length === 0 ? (
        <EmptyState
          icon={IconSearch}
          title="No matches"
          subtitle="Try different keywords — search covers names, summaries, tags, vendors, and notes."
        />
      ) : (
        <DocumentGrid docs={results} />
      )}
    </div>
  );
}
