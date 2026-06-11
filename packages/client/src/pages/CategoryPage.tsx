import { useParams } from 'react-router-dom';
import { useApp } from '../state';
import { categoryLabel } from '../lib/format';
import { iconFor, IconFolder } from '../components/icons';
import DocumentGrid from '../components/DocumentGrid';
import EmptyState from '../components/EmptyState';

export default function CategoryPage() {
  const { id = 'all' } = useParams();
  const { docs, categoryById } = useApp();

  const isAll = id === 'all';
  const cat = isAll ? undefined : categoryById(id);
  const color = cat?.color ?? 'var(--ink-3)';
  const Ico = isAll ? IconFolder : iconFor(cat?.icon);
  const name = isAll ? 'All Documents' : cat?.name ?? categoryLabel(id);

  const list = (isAll ? docs : docs.filter(d => d.category === id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div style={{ padding: '26px 32px 40px', maxWidth: 1060, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: isAll ? 'rgba(28,25,23,0.06)' : `${color}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color,
        }}><Ico size={18} /></div>
        <div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 25, letterSpacing: 0.2, color: 'var(--ink)',
          }}>{name}</h1>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
            {list.length} {list.length === 1 ? 'document' : 'documents'}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={Ico}
          color={isAll ? undefined : color}
          title={isAll ? 'No documents yet' : `No ${name.toLowerCase()} yet`}
          subtitle="When a document lands in this category, it'll show up here."
        />
      ) : (
        <DocumentGrid docs={list} />
      )}
    </div>
  );
}
