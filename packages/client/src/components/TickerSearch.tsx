import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SymbolSuggestion } from '@stashd/shared';
import { searchSymbols } from '../api';

// Ticker typeahead: an input that suggests US + Canadian listings as you type
// (debounced /market/search). Arrow keys + Enter select; Enter with no
// highlighted row falls through to the raw text via onSubmitRaw, so a known
// ticker can still be typed straight in when the suggestion source is down.

export default function TickerSearch({
  placeholder = 'Search a ticker or company…',
  onSelect,
  onSubmitRaw,
  autoFocus,
  clearOnSelect = true,
}: {
  placeholder?: string;
  onSelect: (s: SymbolSuggestion) => void;
  onSubmitRaw?: (symbol: string) => void;
  autoFocus?: boolean;
  clearOnSelect?: boolean;
}) {
  const [value, setValue] = useState('');
  const [results, setResults] = useState<SymbolSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounced suggestion fetch; stale responses (an earlier keystroke resolving
  // late) are dropped by sequence number.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchSymbols(q);
        if (seq.current !== id) return;
        setResults(r);
        setOpen(true);
        setHi(r.length > 0 ? 0 : -1);
      } catch {
        if (seq.current === id) setResults([]);
      } finally {
        if (seq.current === id) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  function pick(s: SymbolSuggestion) {
    onSelect(s);
    setOpen(false);
    setResults([]);
    if (clearOnSelect) setValue('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHi(h => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHi(h => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hi >= 0 && hi < results.length) {
        pick(results[hi]);
      } else if (onSubmitRaw && value.trim()) {
        onSubmitRaw(value.trim().toUpperCase());
        if (clearOnSelect) setValue('');
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="ticker-search" ref={rootRef}>
      <Search size={13} className="ts-icon" />
      <input
        className="input ts-input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={e => setValue(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <div className="ts-pop" role="listbox">
          {results.length === 0 ? (
            <div className="ts-empty">
              {searching ? 'Searching…' : 'No matches — press Enter to use the ticker as typed.'}
            </div>
          ) : (
            results.map((s, i) => (
              <button
                key={`${s.symbol}-${s.exchange ?? ''}`}
                role="option"
                aria-selected={i === hi}
                className={`ts-item${i === hi ? ' hi' : ''}`}
                onPointerEnter={() => setHi(i)}
                onClick={() => pick(s)}
              >
                <span className="ts-sym">{s.symbol}</span>
                <span className="ts-name">{s.name}</span>
                {s.asset === 'ETF' && <span className="ts-tag">ETF</span>}
                <span className="ts-exch">{s.exchange ?? (s.country === 'CA' ? 'TSX' : '')}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
