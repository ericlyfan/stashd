import { Link } from 'react-router-dom';
import { Document, SearchHit } from '@stashd/shared';
import { useStore } from '../store';
import { formatAmount, relTime } from '../lib/format';
import { CategoryStamp, StatusStamp } from './Stamps';

export function LedgerRow({ doc, showCategory = true }: { doc: Document; showCategory?: boolean }) {
  const { categoryById } = useStore();
  const snippet = (doc as SearchHit).snippet;
  return (
    <Link
      to={`/doc/${doc.id}`}
      className="ledger-row"
      draggable
      onDragStart={e => e.dataTransfer.setData('application/x-stashd-docs', JSON.stringify([doc.id]))}
    >
      <div className="row-title">{doc.originalName}</div>
      <div className="row-side">
        {doc.status === 'pending' && <StatusStamp status="pending" />}
        {doc.amount !== undefined && doc.amount !== null && (
          <span className="row-amount">{formatAmount(doc.amount)}</span>
        )}
        {showCategory && <CategoryStamp category={categoryById(doc.category)} slug={doc.category} />}
        <span className="row-meta">{relTime(doc.createdAt)}</span>
      </div>
      {snippet ? (
        <div className="row-summary row-snippet">{snippet}</div>
      ) : (
        doc.summary && <div className="row-summary">{doc.summary}</div>
      )}
    </Link>
  );
}

export function Ledger({
  docs,
  title,
  meta,
  showCategory = true,
  children,
}: {
  docs: Document[];
  title?: string;
  meta?: string;
  showCategory?: boolean;
  children?: React.ReactNode; // rendered when docs is empty
}) {
  return (
    <div className="ledger">
      {title && (
        <div className="ledger-head">
          <h2>{title}</h2>
          {meta && <span className="meta">{meta}</span>}
        </div>
      )}
      {docs.length === 0
        ? children
        : docs.map(doc => <LedgerRow key={doc.id} doc={doc} showCategory={showCategory} />)}
    </div>
  );
}
