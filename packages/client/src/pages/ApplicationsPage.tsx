import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Briefcase,
  LayoutGrid,
  List,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import { ApplicationsSnapshot, EnrichedApplication, JobApplicationInput } from '@stashd/shared';
import {
  addApplicationEvent,
  createApplication,
  deleteApplication,
  getApplications,
  updateApplication,
} from '../api';
import { useStore } from '../store';
import ApplicationBoard from '../components/ApplicationBoard';
import ApplicationDialog from '../components/ApplicationDialog';
import StageManagerDialog from '../components/StageManagerDialog';
import EmptyState from '../components/EmptyState';
import { formatDate, relTime } from '../lib/format';

const VIEW_KEY = 'stashd.applicationsView';

type View = 'board' | 'table';
type Range = 'all' | '30' | '90' | 'year';

// ── Table sorting (the holdings-table pattern) ───────────────────────────────
type SortKey = 'company' | 'role' | 'stage' | 'applied' | 'days' | 'activity' | 'source' | 'location' | 'comp';

function sortValue(a: EnrichedApplication, k: SortKey): string | number | undefined {
  switch (k) {
    case 'company': return a.company.toLowerCase();
    case 'role': return a.role.toLowerCase();
    case 'stage': return a.stage?.position;
    case 'applied': return a.appliedDate;
    case 'days': return a.daysInStage;
    case 'activity': return a.lastActivityAt;
    case 'source': return a.source?.toLowerCase();
    case 'location': return a.location?.toLowerCase();
    case 'comp': return a.compensation?.toLowerCase();
  }
}

function compareApps(a: EnrichedApplication, b: EnrichedApplication, key: SortKey, dir: 1 | -1): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va === undefined && vb === undefined) return a.company.localeCompare(b.company);
  if (va === undefined) return 1; // unknowns sink to the bottom either way
  if (vb === undefined) return -1;
  const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
  return cmp * dir;
}

function SortTh({
  label, k, sort, onSort, numeric,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={numeric ? 'num-col' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button className={`th-sort${active ? ' active' : ''}`} onClick={() => onSort(k)}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );
}

function pct(v?: number): string {
  return v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

const WORK_MODE_LABEL: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

export default function ApplicationsPage() {
  const { notify } = useStore();
  const [snap, setSnap] = useState<ApplicationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'board'));

  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<Range>('all');
  const [staleOnly, setStaleOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'activity', dir: -1 });

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EnrichedApplication | null>(null);
  const [managingStages, setManagingStages] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getApplications();
      setSnap(s);
      // Keep an open edit dialog's header/stage in step with server truth.
      setEditing(cur => (cur ? s.applications.find(a => a.id === cur.id) ?? cur : cur));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load applications', 'err');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // The chat's application write tools announce themselves with this window
  // event (the page owns its own data, so the global store refresh can't help).
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener('stashd:applications-changed', onChanged);
    return () => window.removeEventListener('stashd:applications-changed', onChanged);
  }, [load]);

  function changeView(next: View) {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  function toggleSort(key: SortKey) {
    setSort(cur =>
      cur.key === key
        ? { key, dir: cur.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'company' || key === 'role' ? 1 : -1 },
    );
  }

  function toggleStageFilter(id: string) {
    setStageFilter(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(input: JobApplicationInput) {
    setBusy(true);
    try {
      if (editing) {
        const { stageId, ...fields } = input;
        await updateApplication(editing.id, fields);
        // A stage change goes through the events endpoint so history stays
        // truthful (the PATCH deliberately can't move stages).
        if (stageId && stageId !== editing.stageId) {
          await addApplicationEvent(editing.id, { stageId });
        }
      } else {
        await createApplication(input);
      }
      await load();
      setEditing(null);
      setAdding(false);
      notify(editing ? 'Application updated' : 'Application added');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the application', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteApplication(editing.id);
      await load();
      setEditing(null);
      notify('Application deleted');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete the application', 'err');
    } finally {
      setBusy(false);
    }
  }

  // Board drag: optimistic column move, then the event POST; a failure (or
  // success — stats and days-in-stage shift too) reconciles via reload.
  async function moveStage(app: EnrichedApplication, stageId: string) {
    const stage = snap?.stages.find(s => s.id === stageId);
    setSnap(cur =>
      cur
        ? { ...cur, applications: cur.applications.map(a => (a.id === app.id ? { ...a, stageId, stage: stage ?? a.stage } : a)) }
        : cur,
    );
    try {
      await addApplicationEvent(app.id, { stageId });
      notify(`${app.company} → ${stage?.name ?? 'moved'}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not move the application', 'err');
    }
    await load();
  }

  const stages = snap?.stages ?? [];
  const stats = snap?.stats;
  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of snap?.applications ?? []) m.set(a.stageId, (m.get(a.stageId) ?? 0) + 1);
    return m;
  }, [snap]);

  // Source values already in use, for the dialog's datalist.
  const sources = useMemo(
    () => [...new Set((snap?.applications ?? []).map(a => a.source).filter((s): s is string => !!s))],
    [snap],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let cutoff: string | undefined;
    if (range === '30' || range === '90') {
      cutoff = new Date(Date.now() - Number(range) * 86_400_000).toISOString().slice(0, 10);
    } else if (range === 'year') {
      cutoff = `${new Date().getFullYear()}-01-01`;
    }
    return (snap?.applications ?? []).filter(a => {
      if (stageFilter.size > 0 && !stageFilter.has(a.stageId)) return false;
      if (staleOnly && !a.stale) return false;
      if (cutoff && (!a.appliedDate || a.appliedDate < cutoff)) return false;
      if (!q) return true;
      return [a.company, a.role, a.location, a.source, a.notes, a.compensation]
        .some(f => f?.toLowerCase().includes(q));
    });
  }, [snap, query, stageFilter, range, staleOnly]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareApps(a, b, sort.key, sort.dir)), [filtered, sort]);

  const filtering = query.trim() !== '' || stageFilter.size > 0 || range !== 'all' || staleOnly;
  const total = snap?.applications.length ?? 0;

  if (loading) {
    return (
      <div className="page">
        <div className="loading-line">Opening the pipeline…</div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <header className="page-head rise">
        <div className="page-eyebrow">
          <Briefcase size={12} style={{ verticalAlign: '-1px', marginRight: 7 }} />
          Applications
        </div>
        <div className="page-title-row">
          <h1 className="page-title">Job <em>applications</em></h1>
          <div style={{ flex: 1 }} />
          {total > 0 && (
            <div className="app-view-toggle" role="tablist" aria-label="View">
              <button
                role="tab"
                aria-selected={view === 'board'}
                className={view === 'board' ? 'active' : ''}
                onClick={() => changeView('board')}
                title="Board view"
              >
                <LayoutGrid size={13} />
                Board
              </button>
              <button
                role="tab"
                aria-selected={view === 'table'}
                className={view === 'table' ? 'active' : ''}
                onClick={() => changeView('table')}
                title="Table view"
              >
                <List size={13} />
                Table
              </button>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setManagingStages(true)} title="Customize the pipeline stages">
            <SlidersHorizontal size={13} />
            Stages
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add application
          </button>
        </div>
        <p className="page-sub">
          Where every application stands — from applied to offer — with the full history of how it
          got there.
        </p>
      </header>

      {total === 0 ? (
        <div className="rise rise-1">
          <EmptyState
            icon={Briefcase}
            title="No applications yet"
            subtitle="Track each application you send — company, role, source — and drag it across the pipeline as things move."
          >
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add application
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          {stats && (
            <div className="stats portfolio-stats app-stats rise rise-1" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
              <div className="stat" style={{ ['--accent' as never]: 'var(--wax)' }}>
                <div className="num">{stats.active}</div>
                <div className="lbl">Active <span className="stat-sub">of {stats.total}</span></div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: '#3b82f6' }}>
                <div className="num">{stats.appliedThisMonth}</div>
                <div className="lbl">This month</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: '#0ea5e9' }}>
                <div className="num">{pct(stats.responseRate)}</div>
                <div className="lbl">Response rate</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: '#6366f1' }}>
                <div className="num">{pct(stats.interviewRate)}</div>
                <div className="lbl">Interview rate</div>
              </div>
              <div className="stat" style={{ ['--accent' as never]: 'var(--moss)' }}>
                <div className="num">{stats.offers}</div>
                <div className="lbl">Offers</div>
              </div>
              <button
                className={`stat stat-action${staleOnly ? ' active' : ''}`}
                style={{ ['--accent' as never]: stats.needsFollowUp > 0 ? '#f59e0b' : 'var(--ink-3)' }}
                onClick={() => setStaleOnly(v => !v)}
                title="Active applications with no update in 2+ weeks — click to filter"
              >
                <div className={`num${stats.needsFollowUp > 0 ? ' app-stale-num' : ''}`}>
                  {stats.needsFollowUp > 0 && <AlertTriangle size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />}
                  {stats.needsFollowUp}
                </div>
                <div className="lbl">Needs follow-up</div>
              </button>
            </div>
          )}

          <div className="app-filters rise rise-2">
            <div className="app-filter-search">
              <Search size={13} />
              <input
                value={query}
                placeholder="Filter by company, role, notes…"
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="app-filter-stages">
              {stages.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`app-stage-chip${stageFilter.has(s.id) ? ' active' : ''}`}
                  onClick={() => toggleStageFilter(s.id)}
                >
                  <span className="stage-dot" style={{ background: s.color }} />
                  {s.name}
                  <span className="app-chip-count">{stageCounts.get(s.id) ?? 0}</span>
                </button>
              ))}
            </div>
            <select className="app-filter-range" value={range} onChange={e => setRange(e.target.value as Range)} title="Applied date range">
              <option value="all">All time</option>
              <option value="30">Applied ≤ 30d</option>
              <option value="90">Applied ≤ 90d</option>
              <option value="year">This year</option>
            </select>
            {filtering && (
              <span className="app-filter-note">
                {filtered.length} of {total}
                {staleOnly && ' · needs follow-up'}
              </span>
            )}
          </div>

          {view === 'board' ? (
            <div className="rise rise-3">
              <ApplicationBoard
                stages={stages}
                applications={filtered}
                onOpen={app => setEditing(app)}
                onMove={(app, stageId) => void moveStage(app, stageId)}
              />
            </div>
          ) : (
            <div className="li-table-wrap rise rise-3">
              <table className="li-table app-table">
                <thead>
                  <tr>
                    <SortTh label="Company" k="company" sort={sort} onSort={toggleSort} />
                    <SortTh label="Role" k="role" sort={sort} onSort={toggleSort} />
                    <SortTh label="Stage" k="stage" sort={sort} onSort={toggleSort} />
                    <SortTh label="Applied" k="applied" sort={sort} onSort={toggleSort} />
                    <SortTh label="In stage" k="days" sort={sort} onSort={toggleSort} numeric />
                    <SortTh label="Last activity" k="activity" sort={sort} onSort={toggleSort} />
                    <SortTh label="Source" k="source" sort={sort} onSort={toggleSort} />
                    <SortTh label="Location" k="location" sort={sort} onSort={toggleSort} />
                    <SortTh label="Comp" k="comp" sort={sort} onSort={toggleSort} />
                    <th aria-label="Extras" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(app => (
                    <tr key={app.id} className={app.stale ? 'app-row-stale' : undefined} onClick={() => setEditing(app)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setEditing(app)}>
                      <td className="app-td-company">{app.company}</td>
                      <td className="app-td-role">{app.role}</td>
                      <td>
                        {app.stage && (
                          <span className="app-stage-cell">
                            <span className="stage-dot" style={{ background: app.stage.color }} />
                            {app.stage.name}
                          </span>
                        )}
                      </td>
                      <td>{formatDate(app.appliedDate)}</td>
                      <td className="num-col">
                        {app.daysInStage !== undefined ? `${app.daysInStage}d` : '—'}
                        {app.stale && <AlertTriangle size={11} className="app-stale-icon" />}
                      </td>
                      <td>{app.lastActivityAt ? relTime(app.lastActivityAt) : '—'}</td>
                      <td>{app.source ?? '—'}</td>
                      <td>
                        {app.location ?? (app.workMode ? '' : '—')}
                        {app.workMode && <span className="app-mode-tag">{WORK_MODE_LABEL[app.workMode]}</span>}
                      </td>
                      <td className="app-td-comp" title={app.compensation}>{app.compensation ?? '—'}</td>
                      <td className="app-td-icons">
                        {app.documentId && <Paperclip size={11} />}
                        {app.notes && <StickyNote size={11} />}
                        {app.contactCount > 0 && (
                          <span className="app-card-contacts" title={`${app.contactCount} contact${app.contactCount === 1 ? '' : 's'}`}>
                            <Users size={11} />
                            {app.contactCount}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={10} className="app-table-empty">Nothing matches the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {(adding || editing) && (
        <ApplicationDialog
          application={editing ?? undefined}
          stages={stages}
          sources={sources}
          busy={busy}
          onSave={input => void save(input)}
          onDelete={editing ? () => void remove() : undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onMutated={() => void load()}
        />
      )}

      {managingStages && (
        <StageManagerDialog
          stages={stages}
          counts={stageCounts}
          onChanged={load}
          onClose={() => setManagingStages(false)}
        />
      )}
    </div>
  );
}
