import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ApplicationStage, StageKind, COLOR_PALETTE } from '@stashd/shared';
import {
  createApplicationStage,
  deleteApplicationStage,
  reorderApplicationStages,
  updateApplicationStage,
} from '../api';
import { useStore } from '../store';

// Customize the application pipeline: rename, recolor, re-kind, reorder,
// add and delete stages. The dialog owns the stage API calls and pings
// `onChanged` after each mutation so the page refetches its snapshot (the
// `stages` prop then updates through the parent).

interface Props {
  stages: ApplicationStage[];
  counts: Map<string, number>; // stageId → applications currently in it
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}

// What each kind means to the KPI math — shown as the select's labels so
// customizing stages doesn't silently break the stats.
const KIND_OPTIONS: { value: StageKind; label: string }[] = [
  { value: 'applied', label: 'Applied (starting stage)' },
  { value: 'screen', label: 'Screen (counts as a response)' },
  { value: 'interview', label: 'Interview (counts toward interview rate)' },
  { value: 'offer', label: 'Offer (counts as an offer)' },
  { value: 'rejected', label: 'Rejected (a response, closed)' },
  { value: 'withdrawn', label: 'Withdrawn / ghosted (closed)' },
];

export default function StageManagerDialog({ stages, counts, onChanged, onClose }: Props) {
  const { notify } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [kind, setKind] = useState<StageKind>('screen');
  const [terminal, setTerminal] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, errFallback: string) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : errFallback, 'err');
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(stage: ApplicationStage) {
    setEditingId(stage.id);
    setName(stage.name);
    setColor(stage.color);
    setKind(stage.kind);
    setTerminal(stage.isTerminal);
  }

  function saveEdit() {
    if (!editingId || !name.trim()) return;
    void run(
      () => updateApplicationStage(editingId, { name: name.trim(), color, kind, isTerminal: terminal }),
      'Could not update the stage',
    ).then(() => setEditingId(null));
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...stages];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void run(() => reorderApplicationStages(next.map(s => s.id)), 'Could not reorder the pipeline');
  }

  function addStage() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    void run(() => createApplicationStage({ name: trimmed }), 'Could not add the stage').then(() => setNewName(''));
  }

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog stage-dialog" role="dialog" aria-label="Manage pipeline stages">
        <div className="li-dialog-head">
          <h3>Pipeline stages</h3>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p className="stage-dialog-hint">
          Board columns, in order. A stage's <em>kind</em> is what the stats read (response rate,
          interviews, offers); <em>closed</em> stages don't count as active.
        </p>

        <div className="stage-list">
          {stages.map((stage, i) => {
            const count = counts.get(stage.id) ?? 0;
            if (editingId === stage.id) {
              return (
                <div key={stage.id} className="stage-row stage-row-edit">
                  <input className="input" value={name} autoFocus onChange={e => setName(e.target.value)} />
                  <div className="stage-swatches">
                    {COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`stage-swatch${color === c ? ' active' : ''}`}
                        style={{ background: c }}
                        aria-label={`Color ${c}`}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                  <select className="input" value={kind} onChange={e => setKind(e.target.value as StageKind)}>
                    {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <label className="stage-terminal">
                    <input type="checkbox" checked={terminal} onChange={e => setTerminal(e.target.checked)} />
                    closed (not an active application)
                  </label>
                  <div className="app-contact-form-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={busy || !name.trim()}>Save</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={stage.id} className="stage-row">
                <span className="stage-dot" style={{ background: stage.color }} />
                <span className="stage-name">{stage.name}</span>
                {stage.isTerminal && <span className="stage-flag">closed</span>}
                <span className="stage-count">{count > 0 ? `${count} app${count === 1 ? '' : 's'}` : ''}</span>
                <div className="app-event-actions">
                  <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={11} />
                  </button>
                  <button type="button" title="Move down" disabled={busy || i === stages.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={11} />
                  </button>
                  <button type="button" title="Edit stage" disabled={busy} onClick={() => beginEdit(stage)}>
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    title={count > 0 ? `${count} application${count === 1 ? '' : 's'} still here — move them first` : 'Delete stage'}
                    disabled={busy || count > 0 || stages.length <= 1}
                    onClick={() => void run(() => deleteApplicationStage(stage.id), 'Could not delete the stage')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="stage-add">
          <input
            className="input"
            value={newName}
            placeholder="New stage name…"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addStage()}
          />
          <button className="btn btn-ghost btn-sm" onClick={addStage} disabled={busy || !newName.trim()}>
            <Plus size={12} />
            Add
          </button>
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
