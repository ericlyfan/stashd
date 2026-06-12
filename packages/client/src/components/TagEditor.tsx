import { useRef, useState } from 'react';
import { X } from 'lucide-react';

export default function TagEditor({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const t = draft.trim().replace(/,+$/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="tag-editor" onClick={() => inputRef.current?.focus()}>
      {tags.map(tag => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={e => {
              e.stopPropagation();
              onChange(tags.filter(t => t !== tag));
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={tags.length ? '' : placeholder ?? 'Add a tag, press Enter'}
      />
    </div>
  );
}
