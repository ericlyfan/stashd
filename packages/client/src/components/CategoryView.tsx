import { Document } from '@stashd/shared';
import { getCategoryMeta } from './icons';
import { DocList } from './InboxView';

interface CategoryViewProps {
  categoryId: string;
  docs: Document[];
  onSelect: (doc: Document) => void;
}

export default function CategoryView({ categoryId, docs, onSelect }: CategoryViewProps) {
  const isAll = categoryId === '__all';
  const meta = isAll
    ? { icon: null, color: 'var(--ink-3)' }
    : getCategoryMeta(categoryId);

  const list = isAll ? docs : docs.filter(d => d.category === categoryId);
  const sorted = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Get the display name from the category data - we derive it from ID for now
  const catName = isAll ? 'All Documents' : categoryId
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');

  const Ico = meta.icon;

  return (
    <div>
      <div style={{ padding: '20px 28px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: isAll ? 'rgba(0,0,0,0.06)' : `${meta.color}14`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: isAll ? 'var(--ink-3)' : meta.color,
          }}>
            {Ico ? <Ico size={16} /> : null}
          </div>
          <div>
            <h1 style={{
              margin: 0, fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600, letterSpacing: -0.3, color: 'var(--ink)',
            }}>{catName}</h1>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>
              {list.length} {list.length === 1 ? 'document' : 'documents'}
            </div>
          </div>
        </div>
      </div>
      <DocList
        docs={sorted}
        onSelect={onSelect}
        showCategory={isAll}
        emptyTitle={isAll ? 'No documents yet' : `No ${catName.toLowerCase()} yet`}
        emptySubtitle="When you upload a document of this type, it'll land here."
      />
    </div>
  );
}
