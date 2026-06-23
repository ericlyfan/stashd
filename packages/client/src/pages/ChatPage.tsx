import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatMessage, ChatSSEEvent, Conversation, Document, ToolCallRecord } from '@stashd/shared';
import {
  ArrowUp,
  ChevronDown,
  FileText,
  History,
  MessagesSquare,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useStore } from '../store';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  ChatMode,
  CategoryWithCount,
  ProjectSummary,
  sendChatMessage,
  setConversationPins,
  updateConversationMode,
} from '../api';
import { relTime } from '../lib/format';

// ── Message rendering ───────────────────────────────────────────────────────
// The assistant is told to answer in plain prose with [doc:<id>] citations.
// This renders paragraphs/bullets and swaps citation markers for doc chips —
// deliberately not a markdown engine.

// Loose on length: models occasionally drop a character or two off the end of
// a UUID, so anything id-shaped is captured and resolved by prefix instead.
const CITE_RE = /\[doc:([0-9a-f][0-9a-f-]{6,40})\]/gi;

// What a citation marker resolved to; `docId` is absent when nothing in the
// stash (or the message's citation record) matches.
interface CiteRef {
  docId?: string;
  name: string;
}

type CiteResolver = (rawId: string) => CiteRef;

function renderInline(text: string, cite: CiteResolver): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(CITE_RE)) {
    if (m.index! > last) nodes.push(renderBold(text.slice(last, m.index), key++));
    const ref = cite(m[1]);
    nodes.push(
      ref.docId ? (
        <Link key={key++} className="cite-chip" to={`/doc/${ref.docId}`} title="Open document">
          <FileText size={11} />
          {ref.name}
        </Link>
      ) : (
        <span key={key++} className="cite-chip dangling" title="Document not found">
          <FileText size={11} />
          {ref.name}
        </span>
      ),
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) nodes.push(renderBold(text.slice(last), key++));
  return nodes;
}

// **bold** is the one markdown habit models can't drop; render it rather than
// show literal asterisks.
function renderBold(text: string, key: number): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return <Fragment key={key}>{text}</Fragment>;
  return (
    <Fragment key={key}>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p))}
    </Fragment>
  );
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_RULE_RE = /^\s*\|[\s\-:|]+\|\s*$/;

function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function MessageBody({ content, cite }: { content: string; cite: CiteResolver }) {
  const blocks = content.split(/\n{2,}/).filter(b => b.trim());
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter(l => l.trim());

        // "### Heading" leading the block becomes a rubric line.
        let heading: string | undefined;
        if (/^#{1,6}\s+/.test(lines[0])) {
          heading = lines.shift()!.replace(/^#{1,6}\s+/, '');
        }
        const headingNode = heading && <div className="msg-h">{renderInline(heading, cite)}</div>;
        if (lines.length === 0) return <Fragment key={i}>{headingNode}</Fragment>;

        // Pipe tables (the model reaches for these when comparing).
        if (lines.length >= 2 && lines.every(l => TABLE_ROW_RE.test(l)) && TABLE_RULE_RE.test(lines[1])) {
          const [head, , ...rows] = lines;
          return (
            <Fragment key={i}>
              {headingNode}
              <table className="msg-table">
                <thead>
                  <tr>
                    {splitCells(head).map((c, j) => (
                      <th key={j}>{renderInline(c, cite)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.filter(r => !TABLE_RULE_RE.test(r)).map((r, j) => (
                    <tr key={j}>
                      {splitCells(r).map((c, k) => (
                        <td key={k}>{renderInline(c, cite)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fragment>
          );
        }

        const isList = lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <Fragment key={i}>
              {headingNode}
              <ul>
                {lines.map((l, j) => (
                  <li key={j}>{renderInline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), cite)}</li>
                ))}
              </ul>
            </Fragment>
          );
        }

        return (
          <Fragment key={i}>
            {headingNode}
            <p>
              {lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(l, cite)}
                </Fragment>
              ))}
            </p>
          </Fragment>
        );
      })}
    </>
  );
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// The model's actions, rendered as a faint work-log above the answer.
function ToolTrace({ calls }: { calls: ToolCallRecord[] }) {
  return (
    <div className="msg-trace">
      {calls.map((c, i) => (
        <div key={i} className="msg-trace-line" title={JSON.stringify(c.args)}>
          <Wrench size={11} />
          <span>{c.summary}</span>
        </div>
      ))}
    </div>
  );
}

function SourcesFooter({ msg }: { msg: ChatMessage }) {
  if (!msg.citations?.length) return null;
  return (
    <div className="msg-sources">
      <span className="msg-sources-label">sources</span>
      {msg.citations.map(c => (
        <Link key={c.docId} className="cite-chip" to={`/doc/${c.docId}`} title="Open document">
          <FileText size={11} />
          {c.name}
        </Link>
      ))}
    </div>
  );
}

// ── Pinned documents (“On the desk”) ────────────────────────────────────────

function PinBar({
  pinnedDocIds,
  onChange,
}: {
  pinnedDocIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { docs, categoryById } = useStore();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picking) inputRef.current?.focus();
  }, [picking]);

  // Close the picker on outside click.
  useEffect(() => {
    if (!picking) return;
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setPicking(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [picking]);

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return docs
      .filter(d => !pinnedDocIds.includes(d.id))
      .filter(d => !q || d.originalName.toLowerCase().includes(q) || d.vendor?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [docs, pinnedDocIds, filter]);

  const pinned = pinnedDocIds.map(id => docs.find(d => d.id === id)).filter(Boolean);

  return (
    <div className="chat-desk">
      <span className="chat-desk-label" title="Pinned documents are read in full on every turn">
        <Paperclip size={12} />
        On the desk
      </span>

      <div className="chat-desk-items">
        {pinned.map(doc => (
          <span key={doc!.id} className="pin-chip">
            <Link to={`/doc/${doc!.id}`} title={doc!.originalName}>
              {doc!.originalName}
            </Link>
            <button
              aria-label={`Unpin ${doc!.originalName}`}
              onClick={() => onChange(pinnedDocIds.filter(id => id !== doc!.id))}
            >
              <X size={11} />
            </button>
          </span>
        ))}

        <div className="pin-picker" ref={popRef}>
          <button className="pin-add" onClick={() => setPicking(p => !p)} aria-label="Pin a document">
            <Plus size={11} />
            pin a document
          </button>
          {picking && (
            <div className="pin-pop">
              <input
                ref={inputRef}
                value={filter}
                placeholder="Search the stash…"
                onChange={e => setFilter(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setPicking(false)}
              />
              <div className="pin-options">
                {candidates.map(d => (
                  <button
                    key={d.id}
                    onClick={() => {
                      onChange([...pinnedDocIds, d.id]);
                      setPicking(false);
                      setFilter('');
                    }}
                  >
                    <FileText size={13} />
                    <span className="pin-option-name">{d.originalName}</span>
                    <span className="pin-option-cat" style={{ color: categoryById(d.category)?.color }}>
                      {categoryById(d.category)?.name ?? d.category}
                    </span>
                  </button>
                ))}
                {candidates.length === 0 && <div className="pin-none">no matches</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat modes ──────────────────────────────────────────────────────────────
// The two engines a conversation can be answered by; the mode is fixed per
// conversation (chosen on the New Chat screen, switchable from the header).

interface ModeMeta {
  id: ChatMode;
  label: string;
  blurb: string;
}

const MODES: ModeMeta[] = [
  {
    id: 'classic',
    label: 'Current',
    blurb: 'Fast answers grounded in your documents, cited line by line.',
  },
  {
    id: 'agentic',
    label: 'Agentic',
    blurb: 'A multi-step agent that searches, reads and acts across the stash.',
  },
];

// Ground the example prompts in the actual stash so they're one click from a
// real answer, not hypotheticals. Draws on documents, drawers and ledgers and
// returns up to four; shared by the New Chat screen and the in-thread empty
// state.
function stashSuggestions(
  docs: Document[],
  categories: CategoryWithCount[],
  projects: ProjectSummary[],
): string[] {
  if (docs.length === 0) {
    return ['What kinds of documents can you read?', 'How do I add a document to my stash?'];
  }

  const out: string[] = [];

  // The most recently filed document, by real name.
  const newest = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (newest) out.push(`Summarize “${newest.originalName}”`);

  // A real vendor you've actually paid.
  const priced = docs.find(d => d.vendor && d.amount);
  if (priced) out.push(`How much did I pay ${priced.vendor}?`);

  // Your flagged-for-review backlog.
  const flagged = docs.filter(d => d.status === 'pending').length;
  if (flagged > 0) {
    out.push(`What are the ${flagged} ${flagged === 1 ? 'document' : 'documents'} I flagged for review?`);
  }

  // The fullest custom drawer.
  const drawer = [...categories]
    .filter(c => c.isCustom && c.documentCount > 0)
    .sort((a, b) => b.documentCount - a.documentCount)[0];
  if (drawer) out.push(`What’s in my ${drawer.name} drawer?`);

  // An active ledger with real spend.
  const project = projects.find(p => p.status === 'active' && p.totals.total > 0);
  if (project) out.push(`How much have I spent on ${project.name}?`);

  // The most common tag across the stash (only if it actually repeats).
  const tagCounts = new Map<string, number>();
  for (const d of docs) for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTag && topTag[1] > 1) out.push(`Show me everything tagged “${topTag[0]}”`);

  // A dependable catch-all to round out the set.
  out.push('Which documents should I review or flag?');

  return [...new Set(out)].slice(0, 4);
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyThread({ onSuggest }: { onSuggest: (text: string) => void }) {
  const { docs, categories, projects } = useStore();
  const suggestions = useMemo(
    () => stashSuggestions(docs, categories, projects),
    [docs, categories, projects],
  );

  return (
    <div className="chat-empty">
      <div className="chat-empty-seal">
        <Sparkles size={20} />
      </div>
      <h2>Ask the stash anything</h2>
      <p>
        Answers come from your documents’ actual text, cited line by line. The assistant can also
        re-file, tag, and flag documents when you ask.
      </p>
      <div className="chat-empty-suggestions">
        {suggestions.map(s => (
          <button key={s} onClick={() => onSuggest(s)}>
            <span className="chat-empty-quote">“</span>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Conversation history ────────────────────────────────────────────────────
// Past conversations live in a header dropdown rather than a second sidebar,
// so the chat page is a single column that always opens on New Chat.

function HistoryMenu({
  conversations,
  activeId,
  onDelete,
}: {
  conversations: Conversation[];
  activeId?: string;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = conversations.find(c => c.id === activeId);

  return (
    <div className="chat-hist" ref={ref}>
      <button
        className="chat-hist-btn"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Past conversations"
      >
        <History size={14} />
        <span className="chat-hist-current">{active ? active.title : 'History'}</span>
        <ChevronDown size={13} className={`chat-hist-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="chat-hist-pop" role="menu">
          <div className="chat-hist-rubric">Correspondence</div>
          {conversations.length === 0 && (
            <div className="chat-hist-empty">
              <MessagesSquare size={14} />
              Nothing on file yet
            </div>
          )}
          {conversations.map(conv => (
            <div key={conv.id} className={`chat-hist-item${conv.id === activeId ? ' active' : ''}`}>
              <Link to={`/chat/${conv.id}`} onClick={() => setOpen(false)}>
                <span className="chat-hist-title">
                  {conv.title}
                  {conv.mode === 'agentic' && <span className="chat-rail-mode">Agentic</span>}
                </span>
                <span className="chat-hist-date">{relTime(conv.updatedAt)}</span>
              </Link>
              <button
                aria-label="Delete conversation"
                title="Delete conversation"
                onClick={() => onDelete(conv.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

interface StreamState {
  text: string;
  tools: ToolCallRecord[];
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { docs, categories, projects, refresh, notify } = useStore();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinnedDocIds, setPinnedDocIds] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [stream, setStream] = useState<StreamState | null>(null);
  // For an open conversation, `mode` mirrors that conversation's stored mode;
  // for a fresh New Chat it seeds from the last-used default in localStorage.
  const [mode, setMode] = useState<ChatMode>(() =>
    window.localStorage.getItem('stashd.chatMode') === 'agentic' ? 'agentic' : 'classic',
  );
  const busy = stream !== null;
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = () => listConversations().then(setConversations).catch(() => undefined);

  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    if (!id) {
      setMessages([]);
      setPinnedDocIds([]);
      // A fresh New Chat starts from the last-used default, not whatever the
      // previously open conversation happened to use.
      setMode(window.localStorage.getItem('stashd.chatMode') === 'agentic' ? 'agentic' : 'classic');
      return;
    }
    getConversation(id)
      .then(detail => {
        setMessages(detail.messages);
        setPinnedDocIds(detail.pinnedDocIds);
        setMode(detail.mode);
      })
      .catch(() => {
        notify('Conversation not found', 'err');
        navigate('/chat', { replace: true });
      });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the thread pinned to the bottom while answers stream in.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, stream]);

  // Hand focus back to the composer whenever it becomes usable.
  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy, id]);

  // Switch the chat mode. For an open conversation this persists per
  // conversation (so the thread remembers it); on the New Chat screen it just
  // updates the default used for the next conversation we create.
  function changeMode(next: ChatMode) {
    if (next === mode) return;
    setMode(next);
    window.localStorage.setItem('stashd.chatMode', next);
    if (!id) return;
    setConversations(prev => prev.map(c => (c.id === id ? { ...c, mode: next } : c)));
    updateConversationMode(id, next).catch(err =>
      notify(err instanceof Error ? err.message : 'Could not switch chat mode', 'err'),
    );
  }

  // Resolve a (possibly truncated) citation id to a real document: exact or
  // prefix match against the message's recorded citations first (survives doc
  // deletion), then the live doc list (covers mid-stream rendering).
  function citeFor(msg?: ChatMessage): CiteResolver {
    return rawId => {
      const cited = msg?.citations?.find(c => c.docId === rawId || c.docId.startsWith(rawId));
      if (cited) return { docId: cited.docId, name: cited.name };
      const doc = docs.find(d => d.id === rawId) ?? docs.find(d => d.id.startsWith(rawId));
      if (doc) return { docId: doc.id, name: doc.originalName };
      return { name: 'document' };
    };
  }

  function autosize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  function suggest(text: string) {
    setInput(text);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    let convId = id;
    if (!convId) {
      try {
        const conv = await createConversation(mode);
        convId = conv.id;
        navigate(`/chat/${conv.id}`, { replace: true });
        if (pinnedDocIds.length) await setConversationPins(conv.id, pinnedDocIds);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not start a conversation', 'err');
        return;
      }
    }

    setInput('');
    requestAnimationFrame(autosize);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: convId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setStream({ text: '', tools: [] });

    let touchedDocs = false;
    try {
      await sendChatMessage(convId, text, (event: ChatSSEEvent) => {
        if (event.type === 'token') {
          setStream(s => s && { ...s, text: s.text + event.text });
        } else if (event.type === 'tool') {
          // Any text streamed before a tool round was deliberation, not the
          // answer — drop it and show the action instead.
          if (event.call.tool === 'update_doc') touchedDocs = true;
          setStream(s => s && { text: '', tools: [...s.tools, event.call] });
        } else if (event.type === 'done') {
          setMessages(prev => [...prev, event.message]);
        } else if (event.type === 'error') {
          notify(event.error, 'err');
        }
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The assistant is unreachable', 'err');
    } finally {
      setStream(null);
      refreshConversations();
      if (touchedDocs) refresh();
    }
  }

  async function updatePins(ids: string[]) {
    setPinnedDocIds(ids);
    if (!id) return; // applied when the conversation is created
    try {
      await setConversationPins(id, ids);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update pins', 'err');
    }
  }

  async function removeConversation(convId: string) {
    try {
      await deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (convId === id) navigate('/chat', { replace: true });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete conversation', 'err');
    }
  }

  // Streaming status line: reflect the latest action so the wait reads as
  // work, not silence.
  const streamStatus =
    stream && stream.tools.length > 0
      ? stream.tools[stream.tools.length - 1].summary.toLowerCase()
      : 'reading the stash…';

  const suggestions = useMemo(
    () => stashSuggestions(docs, categories, projects),
    [docs, categories, projects],
  );

  // Counts that ground the New Chat greeting in the actual stash.
  const drawersInUse = categories.filter(c => c.documentCount > 0).length;
  const flaggedCount = docs.filter(d => d.status === 'pending').length;

  // The centered "New Chat" screen when no conversation is open yet (nothing
  // sent). Once a message exists we render the normal thread instead.
  const showStart = !id && messages.length === 0 && !stream;

  // One composer markup, placed either in the centered start screen or at the
  // foot of the thread — only one is mounted at a time, so the single
  // textareaRef stays valid.
  const composer = (
    <div className="chat-compose">
      <textarea
        ref={textareaRef}
        value={input}
        rows={1}
        placeholder="Ask about your documents…"
        disabled={busy}
        onChange={e => {
          setInput(e.target.value);
          autosize();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="chat-compose-side">
        <span className="chat-compose-hint">
          <kbd>↵</kbd> send · <kbd>⇧↵</kbd> line
        </span>
        <button
          className="chat-send"
          onClick={send}
          disabled={busy || !input.trim()}
          aria-label="Send message"
        >
          <ArrowUp size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );

  // Compact segmented mode switch used in the thread header.
  const modeToggle = (
    <div className="chat-mode" role="radiogroup" aria-label="Chat mode">
      {MODES.map(m => (
        <button
          key={m.id}
          className={mode === m.id ? 'active' : ''}
          onClick={() => changeMode(m.id)}
          disabled={busy}
          role="radio"
          aria-checked={mode === m.id}
          type="button"
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="chat-layout">
      <section className="chat-main">
        <div className="chat-topbar">
          <HistoryMenu conversations={conversations} activeId={id} onDelete={removeConversation} />
          <div className="chat-topbar-right">
            {!showStart && modeToggle}
            <button
              className="chat-newchat"
              onClick={() => navigate('/chat')}
              disabled={showStart}
              title="Start a new conversation"
            >
              <Plus size={14} strokeWidth={2.2} />
              New chat
            </button>
          </div>
        </div>

        {showStart ? (
          <div className="chat-start">
            <div className="chat-start-inner">
              <div className="chat-empty-seal">
                <Sparkles size={22} />
              </div>
              <h1>Ask the stash</h1>
              <p>
                {docs.length === 0 ? (
                  <>
                    Your stash is empty for now — drop in a document and I’ll answer from its actual
                    text, cited line by line.
                  </>
                ) : (
                  <>
                    Your stash holds{' '}
                    <strong>
                      {docs.length} {docs.length === 1 ? 'document' : 'documents'}
                    </strong>{' '}
                    across{' '}
                    <strong>
                      {drawersInUse} {drawersInUse === 1 ? 'drawer' : 'drawers'}
                    </strong>
                    {flaggedCount > 0 && (
                      <>
                        , <strong>{flaggedCount} flagged</strong> for review
                      </>
                    )}
                    . Every answer is drawn from their actual text and cited line by line.
                  </>
                )}
              </p>

              <div className="chat-mode-pick" role="radiogroup" aria-label="Chat mode">
                {MODES.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    className={`chat-mode-card${mode === m.id ? ' active' : ''}`}
                    onClick={() => changeMode(m.id)}
                  >
                    <span className="chat-mode-card-label">
                      {m.id === 'agentic' ? <Wrench size={13} /> : <Sparkles size={13} />}
                      {m.label}
                    </span>
                    <span className="chat-mode-card-blurb">{m.blurb}</span>
                  </button>
                ))}
              </div>

              {composer}

              <div className="chat-start-suggest">
                {suggestions.map(s => (
                  <button key={s} onClick={() => suggest(s)}>
                    <span className="chat-empty-quote">“</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-sheet">
          <PinBar pinnedDocIds={pinnedDocIds} onChange={updatePins} />

          <div className="chat-thread" ref={threadRef}>
            {messages.length === 0 && !stream && <EmptyThread onSuggest={suggest} />}

            {messages.map((msg, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(msg.createdAt);
              return (
                <Fragment key={msg.id}>
                  {newDay && (
                    <div className="chat-day">
                      <span>{dayLabel(msg.createdAt)}</span>
                    </div>
                  )}
                  <article className={`chat-msg ${msg.role}`}>
                    <div className="msg-rubric">
                      {msg.role === 'assistant' && <Sparkles size={11} />}
                      <span>{msg.role === 'assistant' ? 'Stash’d' : 'You'}</span>
                      <span className="msg-time">{clockTime(msg.createdAt)}</span>
                    </div>
                    {msg.toolCalls && <ToolTrace calls={msg.toolCalls} />}
                    <div className="msg-body">
                      <MessageBody content={msg.content} cite={citeFor(msg)} />
                    </div>
                    {msg.role === 'assistant' && <SourcesFooter msg={msg} />}
                  </article>
                </Fragment>
              );
            })}

            {stream && (
              <article className="chat-msg assistant streaming">
                <div className="msg-rubric">
                  <Sparkles size={11} />
                  <span>Stash’d</span>
                </div>
                {stream.tools.length > 0 && <ToolTrace calls={stream.tools} />}
                {stream.text ? (
                  <div className="msg-body">
                    <MessageBody content={stream.text} cite={citeFor()} />
                  </div>
                ) : (
                  <div className="msg-thinking">
                    <span className="msg-thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    {streamStatus}
                  </div>
                )}
              </article>
            )}
          </div>

          {composer}
        </div>
        )}
      </section>
    </div>
  );
}
