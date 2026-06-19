import { Link } from 'react-router-dom';
import { ArchiveX, Flag } from 'lucide-react';
import { useStore } from '../store';
import { DropTray } from '../components/DropZone';
import UploadTray from '../components/UploadTray';
import { Ledger } from '../components/Ledger';
import EmptyState from '../components/EmptyState';
import { categoryIcon } from '../lib/categoryMeta';
import { formatAmount } from '../lib/format';

export default function InboxPage() {
  const { docs, categories, loading } = useStore();

  const flagged = docs.filter(d => d.status === 'pending');
  const recent = [...docs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const totalAmount = docs.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const usedCategories = categories.filter(c => c.documentCount > 0);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="page">
      <header className="page-head rise">
        <div className="page-eyebrow">{today}</div>
        <h1 className="page-title">
          The <em>inbox</em> is open.
        </h1>
        <p className="page-sub">
          Drop a document in. The AI reads it, proposes a filing, and waits for your sign-off —
          nothing leaves this machine.
        </p>
      </header>

      <div className="rise rise-1">
        <DropTray />
      </div>

      <UploadTray />

      {!loading && (
        <div className="stats rise rise-2">
          <div className="stat">
            <div className="num">{docs.length}</div>
            <div className="lbl">Documents filed</div>
          </div>
          <div className="stat">
            <div className="num">{usedCategories.length}</div>
            <div className="lbl">Drawers in use</div>
          </div>
          <div className="stat">
            <div className="num">{flagged.length}</div>
            <div className="lbl">Flagged for review</div>
          </div>
          <div className="stat">
            <div className="num">{totalAmount > 0 ? formatAmount(totalAmount) : '—'}</div>
            <div className="lbl">Amounts tracked</div>
          </div>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="rise rise-2" style={{ marginBottom: 34 }}>
          <Ledger
            docs={flagged}
            title="Flagged for a second look"
            meta={`${flagged.length} waiting`}
          />
        </div>
      )}

      <div className="rise rise-3">
        <div className="sect">
          <h2>Fresh ink</h2>
          {docs.length > 6 && <Link className="more" to="/all">View all documents →</Link>}
        </div>
        <Ledger docs={recent} meta="">
          <EmptyState
            icon={ArchiveX}
            title="Nothing stashed yet"
            subtitle="Drop your first document above — a receipt, a lease, anything on paper."
          />
        </Ledger>
      </div>

      {usedCategories.length > 0 && (
        <div className="rise rise-4">
          <div className="sect">
            <h2>The cabinet</h2>
          </div>
          <div className="cabinet">
            {usedCategories.map(cat => {
              const Icon = categoryIcon(cat.icon);
              return (
                <Link
                  key={cat.id}
                  to={`/category/${cat.id}`}
                  className="drawer"
                  style={{ ['--cat-color' as never]: cat.color }}
                >
                  <div className="d-icon">
                    <Icon size={20} strokeWidth={1.7} />
                  </div>
                  <div className="d-name">{cat.name}</div>
                  <div className="d-count">
                    {cat.documentCount} {cat.documentCount === 1 ? 'document' : 'documents'}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {flagged.length === 0 && docs.length > 0 && (
        <p
          style={{
            marginTop: 40,
            textAlign: 'center',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          <Flag size={11} style={{ verticalAlign: '-1px', marginRight: 6 }} />
          Nothing flagged — the ledger is in order
        </p>
      )}
    </div>
  );
}
