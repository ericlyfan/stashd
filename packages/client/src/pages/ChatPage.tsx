import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatMessage, ChatSSEEvent, Conversation, ToolCallRecord } from '@stashd/shared';
import {
  ArrowUp,
  FileText,
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
  sendChatMessage,
  setConversationPins,
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

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyThread({ onSuggest }: { onSuggest: (text: string) => void }) {
  const { docs } = useStore();

  // Ground the examples in the actual stash so they're one click from a real
  // answer, not hypotheticals.
  const suggestions = useMemo(() => {
    const out: string[] = [];
    const newest = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (newest) out.push(`Summarize “${newest.originalName}”`);
    const priced = docs.find(d => d.vendor && d.amount);
    if (priced) out.push(`How much did I pay ${priced.vendor}?`);
    out.push(
      docs.length > 0
        ? 'Which documents should I review or flag?'
        : 'What kinds of documents can you read?',
    );
    return out.slice(0, 3);
  }, [docs]);

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

// ── Page ────────────────────────────────────────────────────────────────────

interface StreamState {
  text: string;
  tools: ToolCallRecord[];
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { docs, refresh, notify } = useStore();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinnedDocIds, setPinnedDocIds] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [stream, setStream] = useState<StreamState | null>(null);
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
      return;
    }
    getConversation(id)
      .then(detail => {
        setMessages(detail.messages);
        setPinnedDocIds(detail.pinnedDocIds);
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
        const conv = await createConversation();
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

  return (
    <div className="chat-layout">
      <aside className="chat-rail">
        <div className="chat-rail-head">
          <span className="chat-rail-rubric">Correspondence</span>
          <button
            className="chat-new"
            onClick={() => navigate('/chat')}
            disabled={!id && messages.length === 0}
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="chat-rail-list">
          {conversations.map(conv => (
            <div key={conv.id} className={`chat-rail-item${conv.id === id ? ' active' : ''}`}>
              <Link to={`/chat/${conv.id}`}>
                <span className="chat-rail-title">{conv.title}</span>
                <span className="chat-rail-date">{relTime(conv.updatedAt)}</span>
              </Link>
              <button
                aria-label="Delete conversation"
                title="Delete conversation"
                onClick={() => removeConversation(conv.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="chat-rail-empty">
              <MessagesSquare size={14} />
              Nothing on file yet
            </div>
          )}
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-head">
          <h1>Ask the stash</h1>
          <p>Every answer is drawn from your documents and cited.</p>
        </header>

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
        </div>
      </section>
    </div>
  );
}
