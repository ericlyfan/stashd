import { v4 as uuidv4 } from 'uuid';
import { CategoryId, ChatMessage, ChatSSEEvent, Citation, Document, LineItem, ToolCallRecord } from '@stashd/shared';
import { StoreService } from './StoreService';
import { EmbeddingService } from './EmbeddingService';
import { buildCustomCategory, slugifyCategory } from './categoryStyle';

// Chat uses the same Ollama endpoint/model as classification — the multimodal
// gemma there supports native tool calling.
const OLLAMA_BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

const MAX_TOOL_ROUNDS = 6;
const RETRIEVE_K = 6;
const PINNED_TEXT_CAP = 8000;
const READ_TEXT_CAP = 12000;
const HISTORY_LIMIT = 20;

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        'Full-text search across every document in the stash (names, summaries, tags, vendors, body text). Use when the provided excerpts are not enough or the user asks about documents you have not seen.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Keywords to search for' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_doc',
      description: 'Read a single document: full metadata plus its complete extracted text. Use before summarizing, comparing or extracting details from a document.',
      parameters: {
        type: 'object',
        properties: { doc_id: { type: 'string', description: 'The document id' } },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_doc',
      description:
        'Modify a document when the user asks you to: re-categorize, add/remove tags, or flag/unflag it for review. Only call this when the user explicitly requests a change.',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string' },
          category: { type: 'string', description: 'New category name or slug (created if it does not exist)' },
          add_tags: { type: 'array', items: { type: 'string' } },
          remove_tags: { type: 'array', items: { type: 'string' } },
          flag: { type: 'boolean', description: 'true to flag for review, false to resolve the flag' },
        },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_categories',
      description: 'List all category drawers with their document counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description:
        'List the cost-tracking ledgers (projects) with their money totals. Use for questions about project spending, budgets, or what projects exist.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_project',
      description:
        "Read one project ledger in full: every line item (category, vendor, dates, amounts, status) plus totals and a breakdown by category and vendor. Use before answering detailed financial questions about a project's costs.",
      parameters: {
        type: 'object',
        properties: { project: { type: 'string', description: 'The project id or name' } },
        required: ['project'],
      },
    },
  },
];

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function docCard(doc: Document): Record<string, unknown> {
  return {
    id: doc.id,
    name: doc.originalName,
    category: doc.category,
    tags: doc.tags,
    summary: doc.summary,
    date: doc.dateExtracted,
    amount: doc.amount,
    vendor: doc.vendor,
    flagged: doc.status === 'pending',
  };
}

export class ChatService {
  constructor(
    private readonly store: StoreService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Append a user message to the conversation and stream the assistant's
   * answer: RAG context for the question, then an Ollama tool loop, emitting
   * SSE events through `send`. The persisted assistant message is returned in
   * the final `done` event.
   */
  async respond(conversationId: string, userText: string, send: (event: ChatSSEEvent) => void): Promise<void> {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      send({ type: 'error', error: 'Conversation not found' });
      return;
    }

    const now = new Date().toISOString();
    this.store.addMessage({
      id: uuidv4(),
      conversationId,
      role: 'user',
      content: userText,
      createdAt: now,
    });
    if (conversation.messages.length === 0) {
      this.store.touchConversation(conversationId, {
        title: userText.length > 64 ? `${userText.slice(0, 64)}…` : userText,
        updatedAt: now,
      });
    }

    const toolCalls: ToolCallRecord[] = [];
    try {
      const messages = await this.buildMessages(conversation.messages, conversation.pinnedDocIds, userText);
      const content = await this.runToolLoop(messages, toolCalls, send);
      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        conversationId,
        role: 'assistant',
        content,
        citations: this.extractCitations(content),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        createdAt: new Date().toISOString(),
      };
      this.store.addMessage(assistantMsg);
      this.store.touchConversation(conversationId, { updatedAt: assistantMsg.createdAt });
      send({ type: 'done', message: assistantMsg });
    } catch (err) {
      send({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
    }
  }

  private async buildMessages(
    history: ChatMessage[],
    pinnedDocIds: string[],
    userText: string,
  ): Promise<OllamaChatMessage[]> {
    const categories = this.store.getCategories();
    const counts = this.store.getCategoryCounts();
    const categoryList = categories
      .map(c => `- ${c.id} (${c.name}, ${counts[c.id] ?? 0} docs)`)
      .join('\n');

    // A lightweight roster of the cost ledgers so the model knows they exist;
    // read_project pulls the line-item detail on demand.
    const projects = this.store.listProjects();
    const projectList = projects.length
      ? projects
          .map(
            p =>
              `- ${p.id} (${p.name}${p.status === 'archived' ? ', archived' : ''}): ${p.totals.itemCount} line items, ${formatMoney(p.totals.total)} total paid`,
          )
          .join('\n')
      : '(no projects yet)';

    const sections: string[] = [
      `You are the assistant inside Stashd, a personal document organizer with a cost-tracking section called Ledgers. You answer questions about the user's filed documents and project costs, and can act on documents with your tools.

Today's date: ${new Date().toISOString().slice(0, 10)}.

Rules:
- Ground every claim about a document in its actual content (the excerpts below, pinned documents, or read_doc results). If you cannot find something, say so plainly.
- Cite documents inline using the exact form [doc:<id>] right after the claim it supports, e.g. "the rent is $2,400 [doc:abc-123]". Always cite when you state facts from a document.
- For money or project questions, use list_projects / read_project to get the figures rather than guessing. Refer to projects by name in your answer.
- Use search_docs / read_doc freely to investigate. Only call update_doc when the user explicitly asks for a change.
- Answer in plain conversational prose. Keep it concise.

Category drawers:
${categoryList}

Cost ledgers (projects):
${projectList}`,
    ];

    const pinned = pinnedDocIds
      .map(id => this.store.getDocument(id))
      .filter((d): d is Document => !!d);
    if (pinned.length > 0) {
      const blocks = pinned.map(doc => {
        const text = doc.extractedText?.slice(0, PINNED_TEXT_CAP) ?? '(no extracted text)';
        return `--- Pinned document [doc:${doc.id}] "${doc.originalName}" (category: ${doc.category}${doc.vendor ? `, vendor: ${doc.vendor}` : ''}${doc.dateExtracted ? `, date: ${doc.dateExtracted}` : ''}) ---\n${text}`;
      });
      sections.push(`The user pinned these documents to this conversation — they are primary context:\n\n${blocks.join('\n\n')}`);
    }

    // Dynamic RAG for everything that isn't pinned. Degrades to nothing if the
    // local embedding model isn't up — the model can still search_docs.
    const retrieved = await this.embeddings.retrieve(userText, RETRIEVE_K).catch(() => []);
    const fresh = retrieved.filter(c => !pinnedDocIds.includes(c.docId));
    if (fresh.length > 0) {
      const blocks = fresh.map(c => `[doc:${c.docId}] "${c.docName}" (${c.category}):\n${c.text}`);
      sections.push(`Possibly relevant excerpts from the stash (ranked by similarity to the question):\n\n${blocks.join('\n\n')}`);
    }

    const messages: OllamaChatMessage[] = [{ role: 'system', content: sections.join('\n\n') }];
    for (const msg of history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: userText });
    return messages;
  }

  /**
   * Streamed chat with native tool calling. Content tokens are forwarded as
   * they arrive; when a round ends in tool calls instead, the client is told
   * via `tool` events (and discards any partial text it showed).
   */
  private async runToolLoop(
    messages: OllamaChatMessage[],
    toolCalls: ToolCallRecord[],
    send: (event: ChatSSEEvent) => void,
  ): Promise<string> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { content, calls } = await this.streamChat(messages, round < MAX_TOOL_ROUNDS - 1, send);
      if (calls.length === 0) return content.trim();

      messages.push({ role: 'assistant', content, tool_calls: calls });
      for (const call of calls) {
        const record = this.executeTool(call.function.name, call.function.arguments ?? {});
        toolCalls.push(record.record);
        send({ type: 'tool', call: record.record });
        messages.push({ role: 'tool', content: record.result });
      }
    }
    throw new Error('The assistant got stuck calling tools — try rephrasing the question.');
  }

  private async streamChat(
    messages: OllamaChatMessage[],
    allowTools: boolean,
    send: (event: ChatSSEEvent) => void,
  ): Promise<{ content: string; calls: OllamaToolCall[] }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
        ...(allowTools && { tools: TOOLS }),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
    }

    let content = '';
    const calls: OllamaToolCall[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as {
          message?: { content?: string; tool_calls?: OllamaToolCall[] };
          error?: string;
        };
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) {
          content += chunk.message.content;
          send({ type: 'token', text: chunk.message.content });
        }
        if (chunk.message?.tool_calls) calls.push(...chunk.message.tool_calls);
      }
    }
    return { content, calls };
  }

  // Tools execute synchronously against the store; each returns both the JSON
  // payload fed back to the model and a human-readable record for the UI.
  private executeTool(name: string, args: Record<string, unknown>): { result: string; record: ToolCallRecord } {
    try {
      switch (name) {
        case 'search_docs': {
          const query = String(args.query ?? '');
          const hits = this.store.searchDocuments(query).slice(0, 8);
          return {
            result: JSON.stringify(hits.map(h => ({ ...docCard(h), snippet: h.snippet }))),
            record: { tool: name, args, summary: `Searched the stash for “${query}” — ${hits.length} hit${hits.length === 1 ? '' : 's'}` },
          };
        }
        case 'read_doc': {
          const doc = this.store.getDocument(String(args.doc_id ?? ''));
          if (!doc) return this.toolError(name, args, 'Document not found');
          return {
            result: JSON.stringify({
              ...docCard(doc),
              notes: doc.notes,
              text: doc.extractedText?.slice(0, READ_TEXT_CAP) ?? '(no extracted text available for this document)',
            }),
            record: { tool: name, args, summary: `Read “${doc.originalName}”` },
          };
        }
        case 'update_doc': {
          const doc = this.store.getDocument(String(args.doc_id ?? ''));
          if (!doc) return this.toolError(name, args, 'Document not found');

          const actions: string[] = [];
          const updates: Parameters<StoreService['updateDocument']>[1] = { updatedAt: new Date().toISOString() };

          if (typeof args.category === 'string' && args.category.trim()) {
            const categoryId = slugifyCategory(args.category);
            if (!this.store.getCategory(categoryId)) this.store.addCategory(buildCustomCategory(categoryId));
            updates.category = categoryId as CategoryId;
            actions.push(`moved to ${categoryId}`);
          }
          const addTags = Array.isArray(args.add_tags) ? args.add_tags.map(String).filter(t => t.trim()) : [];
          const removeTags = Array.isArray(args.remove_tags) ? args.remove_tags.map(String) : [];
          if (addTags.length || removeTags.length) {
            let tags = doc.tags.filter(t => !removeTags.includes(t));
            for (const t of addTags) if (!tags.includes(t)) tags = [...tags, t];
            updates.tags = tags;
            if (addTags.length) actions.push(`tagged ${addTags.join(', ')}`);
            if (removeTags.length) actions.push(`untagged ${removeTags.join(', ')}`);
          }
          if (typeof args.flag === 'boolean') {
            updates.status = args.flag ? 'pending' : 'filed';
            actions.push(args.flag ? 'flagged for review' : 'flag resolved');
          }
          if (actions.length === 0) return this.toolError(name, args, 'No changes requested');

          const updated = this.store.updateDocument(doc.id, updates)!;
          return {
            result: JSON.stringify({ ok: true, document: docCard(updated) }),
            record: { tool: name, args, summary: `Updated “${doc.originalName}”: ${actions.join('; ')}` },
          };
        }
        case 'list_categories': {
          const counts = this.store.getCategoryCounts();
          const cats = this.store.getCategories().map(c => ({ id: c.id, name: c.name, documents: counts[c.id] ?? 0 }));
          return {
            result: JSON.stringify(cats),
            record: { tool: name, args, summary: 'Listed the category drawers' },
          };
        }
        case 'list_projects': {
          const projects = this.store.listProjects().map(p => ({
            id: p.id,
            name: p.name,
            status: p.status,
            ...p.totals,
          }));
          return {
            result: JSON.stringify(projects),
            record: { tool: name, args, summary: `Listed the cost ledgers — ${projects.length} project${projects.length === 1 ? '' : 's'}` },
          };
        }
        case 'read_project': {
          const key = String(args.project ?? '');
          const detail =
            this.store.getProjectDetail(key) ??
            (() => {
              // The model often passes the project name rather than its id.
              const match = this.store.listProjects().find(p => p.name.toLowerCase() === key.toLowerCase());
              return match ? this.store.getProjectDetail(match.id) : undefined;
            })();
          if (!detail) return this.toolError(name, args, 'Project not found');

          const groupBy = (pick: (it: LineItem) => string | undefined) => {
            const out: Record<string, number> = {};
            for (const it of detail.items) {
              const key = pick(it)?.trim() || 'Uncategorized';
              out[key] = (out[key] ?? 0) + (it.totalPaid ?? 0);
            }
            return out;
          };

          return {
            result: JSON.stringify({
              id: detail.id,
              name: detail.name,
              description: detail.description,
              status: detail.status,
              totals: detail.totals,
              byCategory: groupBy(it => it.category),
              byVendor: groupBy(it => it.vendor),
              items: detail.items.map(it => ({
                category: it.category,
                vendor: it.vendor,
                description: it.description,
                quantity: it.quantity,
                datePaid: it.datePaid,
                invoiceNumber: it.invoiceNumber,
                amountRequested: it.amountRequested,
                amountPaid: it.amountPaid,
                taxAmount: it.taxAmount,
                totalPaid: it.totalPaid,
                status: it.status,
                notes: it.notes,
                documentId: it.documentId,
              })),
            }),
            record: { tool: name, args, summary: `Read the “${detail.name}” ledger — ${detail.items.length} line item${detail.items.length === 1 ? '' : 's'}` },
          };
        }
        default:
          return this.toolError(name, args, `Unknown tool: ${name}`);
      }
    } catch (err) {
      return this.toolError(name, args, err instanceof Error ? err.message : 'Tool failed');
    }
  }

  private toolError(tool: string, args: Record<string, unknown>, error: string): { result: string; record: ToolCallRecord } {
    return { result: JSON.stringify({ error }), record: { tool, args, summary: `${tool} failed: ${error}` } };
  }

  // Models occasionally drop trailing characters off a cited UUID, so match
  // anything id-shaped and resolve it by unique prefix against real documents.
  private extractCitations(content: string): Citation[] | undefined {
    const ids = [...content.matchAll(/\[doc:([0-9a-f][0-9a-f-]{6,40})\]/gi)].map(m => m[1]);
    const citations: Citation[] = [];
    for (const rawId of new Set(ids)) {
      let doc = this.store.getDocument(rawId);
      if (!doc) {
        const matches = this.store.getDocuments().filter(d => d.id.startsWith(rawId));
        if (matches.length === 1) doc = matches[0];
      }
      if (doc && !citations.some(c => c.docId === doc!.id)) {
        citations.push({ docId: doc.id, name: doc.originalName });
      }
    }
    return citations.length ? citations : undefined;
  }
}
