import { useState } from 'react';
import { ProjectSummary } from '@stashd/shared';

interface Props {
  project?: ProjectSummary; // present when editing
  busy?: boolean;
  onSave: (values: { name: string; description?: string }) => void;
  onClose: () => void;
}

export default function ProjectDialog({ project, busy, onSave, onClose }: Props) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');

  function submit() {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim() || undefined });
  }

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={project ? 'Edit project' : 'New project'}>
        <h3>{project ? 'Edit project' : 'New project'}</h3>

        <div className="field">
          <label className="field-label" htmlFor="proj-name">Name</label>
          <input
            id="proj-name"
            className="input"
            value={name}
            autoFocus
            placeholder="e.g. Kitchen renovation"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label className="field-label" htmlFor="proj-desc">Description <span className="field-opt">optional</span></label>
          <textarea
            id="proj-desc"
            className="textarea"
            value={description}
            placeholder="What is this ledger tracking?"
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
