import { Document } from '@stashd/shared';
import DocumentCard from './DocumentCard';

export default function DocumentGrid({ docs }: { docs: Document[] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 14,
    }}>
      {docs.map(d => <DocumentCard key={d.id} doc={d} />)}
    </div>
  );
}
