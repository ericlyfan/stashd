import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Plus } from 'lucide-react';
import { useStore } from '../store';
import { createProject } from '../api';
import ProjectDialog from '../components/ProjectDialog';
import EmptyState from '../components/EmptyState';
import { formatAmount, relTime } from '../lib/format';

export default function LedgersPage() {
  const { projects, refresh, notify } = useStore();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = projects.filter(p => p.status === 'active');
  const archived = projects.filter(p => p.status === 'archived');
  const grandTotal = projects.reduce((sum, p) => sum + p.totals.total, 0);

  async function create(values: { name: string; description?: string }) {
    setBusy(true);
    try {
      const project = await createProject(values.name, values.description);
      await refresh();
      setCreating(false);
      navigate(`/ledger/${project.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create project', 'err');
    } finally {
      setBusy(false);
    }
  }

  function card(p: (typeof projects)[number]) {
    return (
      <Link key={p.id} to={`/ledger/${p.id}`} className={`ledger-card${p.status === 'archived' ? ' archived' : ''}`}>
        <div className="lc-head">
          <span className="lc-name">{p.name}</span>
          {p.status === 'archived' && <span className="lc-archived">Archived</span>}
        </div>
        {p.description && <p className="lc-desc">{p.description}</p>}
        <div className="lc-total">{p.totals.total > 0 ? formatAmount(p.totals.total) : '—'}</div>
        <div className="lc-foot">
          <span>{p.totals.itemCount} {p.totals.itemCount === 1 ? 'line item' : 'line items'}</span>
          <span className="lc-when">{relTime(p.updatedAt)}</span>
        </div>
      </Link>
    );
  }

  return (
    <div className="page">
      <header className="page-head rise">
        <div className="page-eyebrow">
          <BookOpen size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
          Ledgers
        </div>
        <div className="page-title-row">
          <h1 className="page-title">Cost <em>ledgers</em></h1>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            New project
          </button>
        </div>
        <p className="page-sub">
          Track project costs line by line — vendors, invoices, taxes, totals. A purpose-built
          alternative to the cost-tracking spreadsheet, with documents from your stash attached
          where you have them.
        </p>
      </header>

      {projects.length > 0 && (
        <div className="stats rise rise-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat">
            <div className="num">{active.length}</div>
            <div className="lbl">Active projects</div>
          </div>
          <div className="stat">
            <div className="num">{projects.reduce((n, p) => n + p.totals.itemCount, 0)}</div>
            <div className="lbl">Line items tracked</div>
          </div>
          <div className="stat">
            <div className="num">{grandTotal > 0 ? formatAmount(grandTotal) : '—'}</div>
            <div className="lbl">Total paid, all projects</div>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rise rise-1">
          <EmptyState
            icon={BookOpen}
            title="No ledgers yet"
            subtitle="Create a project and start logging its costs — each gets its own line items, categories, and vendors."
          >
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={14} />
              New project
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="ledger-card-grid rise rise-2">{active.map(card)}</div>
          {archived.length > 0 && (
            <>
              <div className="sect"><h2>Archived</h2></div>
              <div className="ledger-card-grid">{archived.map(card)}</div>
            </>
          )}
        </>
      )}

      {creating && <ProjectDialog busy={busy} onSave={create} onClose={() => setCreating(false)} />}
    </div>
  );
}
