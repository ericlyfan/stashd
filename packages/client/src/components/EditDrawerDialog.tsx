import { useState } from 'react';
import { useStore } from '../store';
import { CategoryWithCount, updateCategory } from '../api';
import { categoryIcon, CATEGORY_COLORS, ICON_SLUGS } from '../lib/categoryMeta';

export default function EditDrawerDialog({
  category,
  onClose,
}: {
  category: CategoryWithCount;
  onClose: () => void;
}) {
  const { refresh, notify } = useStore();
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  const [color, setColor] = useState(category.color);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      notify('The drawer needs a name', 'err');
      return;
    }
    setBusy(true);
    try {
      await updateCategory(category.id, { name: name.trim(), icon, color });
      await refresh();
      notify('Drawer updated');
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update drawer', 'err');
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-edit-drawer" role="dialog" aria-label="Edit drawer">
        <h3>Edit drawer</h3>

        <label className="edit-field">
          <span className="edit-label">Name</span>
          <input
            className="side-add-input"
            value={name}
            autoFocus
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </label>

        <div className="edit-field">
          <span className="edit-label">Icon</span>
          <div className="icon-grid">
            {ICON_SLUGS.map(slug => {
              const Icon = categoryIcon(slug);
              return (
                <button
                  key={slug}
                  className={`icon-pick${icon === slug ? ' on' : ''}`}
                  aria-label={`Icon ${slug}`}
                  style={{ color }}
                  onClick={() => setIcon(slug)}
                >
                  <Icon size={16} strokeWidth={1.8} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="edit-field">
          <span className="edit-label">Color</span>
          <div className="color-row">
            {CATEGORY_COLORS.map(c => (
              <button
                key={c}
                className={`color-pick${color === c ? ' on' : ''}`}
                aria-label={`Color ${c}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-wax" onClick={save} disabled={busy}>
            {busy ? 'Working…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
