import { useState } from 'react';
import { WatchlistItem } from '@stashd/shared';

// Edit a watched stock's folder + thesis note ("why am I watching this?").
// Folders are free text with a datalist of the ones already in use.

interface Props {
  item: WatchlistItem;
  folders: string[]; // existing folder names, for the datalist
  busy?: boolean;
  onSave: (values: { folder: string; notes: string }) => void;
  onClose: () => void;
}

export default function WatchlistDialog({ item, folders, busy, onSave, onClose }: Props) {
  const [folder, setFolder] = useState(item.folder ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={`Edit ${item.symbol} watch entry`}>
        <h3>
          Watching <span className="h-ticker">{item.symbol}</span>
          {item.name && <span className="wl-dialog-name">{item.name}</span>}
        </h3>

        <div className="field">
          <label className="field-label" htmlFor="wl-folder">Folder <span className="field-opt">optional</span></label>
          <input
            id="wl-folder"
            className="input"
            value={folder}
            list="wl-folders"
            placeholder="e.g. AI plays, Dividend ideas"
            onChange={e => setFolder(e.target.value)}
          />
          <datalist id="wl-folders">
            {folders.map(f => <option key={f} value={f} />)}
          </datalist>
        </div>

        <div className="field" style={{ marginBottom: 4 }}>
          <label className="field-label" htmlFor="wl-notes">Thesis <span className="field-opt">optional</span></label>
          <textarea
            id="wl-notes"
            className="textarea"
            value={notes}
            rows={4}
            placeholder="Why are you watching this? Entry price you'd like, catalysts, risks…"
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ folder: folder.trim(), notes: notes.trim() })} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
