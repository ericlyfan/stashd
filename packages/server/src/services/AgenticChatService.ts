import { v4 as uuidv4 } from 'uuid';
import {
  ChatActionResolution,
  ChatAttachment,
  ChatMessage,
  ChatSSEEvent,
  Citation,
  Document,
  ToolCallRecord,
} from '@stashd/shared';
import { StoreService } from './StoreService';
import { EmbeddingService, RetrievedChunk } from './EmbeddingService';
import { resolveApplication, resolveStage } from './applications';
import {
  AgentMessage,
  AgentTool,
  AgentTraceEvent,
  AgentTraceSink,
  AgenticWorkflow,
  createApplicationAgentTools,
  createDocumentAgentTools,
  createPortfolioAgentTools,
  createProjectAgentTools,
  formatToolResult,
  OllamaAgentClient,
  StoreDocumentCorpus,
} from '../agentic';

const HISTORY_LIMIT = 12;
const PINNED_TEXT_CAP = 8000;
// The RAG seed: top-K chunks injected into the roster so common lookups don't
// burn a tool round. Smaller than the classic chat's 6 — it's a starting
// point, not the full context; the agent reads/searches for anything deeper.
const SEED_K = 4;

function preview(text: string, limit = 180): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}...`;
}

// The agent's write tools, all gated behind confirm-before-apply: a call to
// any of these is persisted as a pending action and surfaced as an approval
// card — it never mutates the store until the user applies it. A new write
// tool MUST be added here (and to the client's APP_WRITE/STORE_WRITE sets in
// ChatSurface.tsx), or it ships ungated.
const WRITE_TOOLS = new Set([
  'update_doc',
  'create_project',
  'add_line_item',
  'add_application',
  'move_application',
  'update_application',
]);

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Best-effort human preview of a proposed write, resolved against the store
// (doc names, current stages) so the approval card shows what will actually
// change. Falls back to the raw args; the real resolution/validation happens
// again at apply time, so an inaccurate preview can't cause a wrong write.
function proposalSummary(store: StoreService, tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'update_doc': {
      const rawId = str(args.doc_id);
      let doc = store.getDocument(rawId);
      if (!doc && rawId) {
        const matches = store.getDocuments().filter(d => d.id.startsWith(rawId));
        if (matches.length === 1) doc = matches[0];
      }
      const target = doc ? `“${doc.originalName}”` : `document ${rawId || '(unspecified)'}`;
      const parts: string[] = [];
      if (str(args.category)) parts.push(`move to ${str(args.category)}`);
      const addTags = strList(args.add_tags);
      if (addTags.length) parts.push(`add tag${addTags.length > 1 ? 's' : ''} ${addTags.join(', ')}`);
      const removeTags = strList(args.remove_tags);
      if (removeTags.length) parts.push(`remove tag${removeTags.length > 1 ? 's' : ''} ${removeTags.join(', ')}`);
      if (typeof args.flag === 'boolean') parts.push(args.flag ? 'flag for review' : 'resolve the review flag');
      return `Update ${target}: ${parts.join(' · ') || '(no changes listed)'}`;
    }
    case 'create_project':
      return `Create ledger “${str(args.name) || '(unnamed)'}”`;
    case 'add_line_item': {
      const key = str(args.project);
      const lower = key.toLowerCase();
      const project = store
        .listProjects()
        .find(p => p.id === key || p.name.toLowerCase() === lower || p.name.toLowerCase().includes(lower));
      const amount = num(args.total_paid) ?? (num(args.amount_paid) !== undefined ? num(args.amount_paid)! + (num(args.tax_amount) ?? 0) : undefined);
      const bits = [str(args.description) || '(no description)'];
      if (str(args.vendor)) bits.push(str(args.vendor));
      if (amount !== undefined) bits.push(`$${amount.toLocaleString()}`);
      return `Add to ledger “${project?.name ?? (key || '(unspecified)')}”: ${bits.join(' — ')}`;
    }
    case 'add_application':
      return `Add application: ${str(args.company) || '(no company)'} — ${str(args.role) || '(no role)'}`;
    case 'move_application': {
      const app = resolveApplication(store, str(args.application));
      const stage = resolveStage(store, str(args.stage));
      const from = app ? store.getApplicationStage(app.stageId)?.name : undefined;
      const who = app ? `${app.company} — ${app.role}` : `“${str(args.application)}”`;
      return `Move application ${who}${from ? ` from ${from}` : ''} to ${stage?.name ?? `“${str(args.stage)}”`}`;
    }
    case 'update_application': {
      const app = resolveApplication(store, str(args.application));
      const fields = Object.keys(args).filter(k => k !== 'application' && str(args[k]));
      const who = app ? `${app.company} — ${app.role}` : `“${str(args.application)}”`;
      return `Update application ${who}${fields.length ? ` (${fields.join(', ')})` : ''}`;
    }
    default:
      return `Run ${tool}`;
  }
}

function summarizeTool(event: Extract<AgentTraceEvent, { type: 'tool_result' }>): ToolCallRecord {
  // Write-tool proposals: the gate queues them instead of executing, and its
  // result carries the pending-action id + human summary for the approval
  // card. Checked first so the per-tool branches below (which describe an
  // executed change) never claim a queued one happened.
  try {
    const parsed = JSON.parse(event.result) as { queued?: unknown; actionId?: unknown; summary?: unknown };
    if (parsed.queued === true && typeof parsed.actionId === 'string') {
      return {
        tool: event.tool,
        args: event.args,
        summary: typeof parsed.summary === 'string' ? parsed.summary : `Proposed a ${event.tool} change`,
        actionId: parsed.actionId,
        status: 'pending',
      };
    }
  } catch {
    // Not JSON — fall through to the generic summaries.
  }

  if (event.tool === 'search_docs') {
    const query = typeof event.args.query === 'string' ? event.args.query : '';
    let count: number | undefined;
    try {
      const parsed = JSON.parse(event.result) as { count?: unknown };
      if (typeof parsed.count === 'number') count = parsed.count;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: `Agent searched the stash${query ? ` for "${query}"` : ''}${count !== undefined ? ` - ${count} hit${count === 1 ? '' : 's'}` : ''}`,
    };
  }

  if (event.tool === 'read_doc') {
    let name: string | undefined;
    try {
      const parsed = JSON.parse(event.result) as { document?: { name?: unknown }; error?: unknown };
      if (typeof parsed.document?.name === 'string') name = parsed.document.name;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: name ? `Agent read "${name}"` : 'Agent tried to read a document',
    };
  }

  if (event.tool === 'list_projects') {
    let count: number | undefined;
    try {
      const parsed = JSON.parse(event.result) as { projects?: unknown[] };
      count = parsed.projects?.length;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: `Agent listed project ledgers${count !== undefined ? ` - ${count} project${count === 1 ? '' : 's'}` : ''}`,
    };
  }

  if (event.tool === 'list_categories') {
    let count: number | undefined;
    try {
      const parsed = JSON.parse(event.result) as { count?: unknown };
      if (typeof parsed.count === 'number') count = parsed.count;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: `Agent listed the category drawers${count !== undefined ? ` - ${count} drawer${count === 1 ? '' : 's'}` : ''}`,
    };
  }

  if (event.tool === 'update_doc') {
    try {
      const parsed = JSON.parse(event.result) as {
        ok?: unknown;
        document?: { name?: unknown };
        actions?: unknown;
        error?: unknown;
      };
      if (parsed.ok && Array.isArray(parsed.actions)) {
        const name = typeof parsed.document?.name === 'string' ? `"${parsed.document.name}"` : 'a document';
        return { tool: event.tool, args: event.args, summary: `Agent updated ${name}: ${parsed.actions.join('; ')}` };
      }
      if (typeof parsed.error === 'string') {
        return { tool: event.tool, args: event.args, summary: `Agent could not update a document: ${parsed.error}` };
      }
    } catch {
      // Keep the generic summary below.
    }
    return { tool: event.tool, args: event.args, summary: 'Agent updated a document' };
  }

  if (event.tool === 'read_project') {
    let name: string | undefined;
    let matched: number | undefined;
    try {
      const parsed = JSON.parse(event.result) as { project?: { name?: unknown }; matchedItemCount?: unknown };
      if (typeof parsed.project?.name === 'string') name = parsed.project.name;
      if (typeof parsed.matchedItemCount === 'number') matched = parsed.matchedItemCount;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: `Agent read ${name ? `"${name}"` : 'a project ledger'}${matched !== undefined ? ` - ${matched} matching line item${matched === 1 ? '' : 's'}` : ''}`,
    };
  }

  if (event.tool === 'add_application' || event.tool === 'move_application' || event.tool === 'update_application') {
    try {
      const parsed = JSON.parse(event.result) as {
        ok?: unknown;
        error?: unknown;
        application?: { company?: unknown; role?: unknown; stage?: unknown };
        changed?: unknown;
      };
      if (typeof parsed.error === 'string') {
        return { tool: event.tool, args: event.args, summary: `Agent could not change an application: ${parsed.error}` };
      }
      const company = typeof parsed.application?.company === 'string' ? parsed.application.company : 'an application';
      if (event.tool === 'add_application') {
        const role = typeof parsed.application?.role === 'string' ? ` — ${parsed.application.role}` : '';
        return { tool: event.tool, args: event.args, summary: `Agent added application: ${company}${role}` };
      }
      if (event.tool === 'move_application') {
        const stage = typeof parsed.application?.stage === 'string' ? ` to ${parsed.application.stage}` : '';
        return { tool: event.tool, args: event.args, summary: `Agent moved ${company}${stage}` };
      }
      const changed = Array.isArray(parsed.changed) ? ` (${parsed.changed.join(', ')})` : '';
      return { tool: event.tool, args: event.args, summary: `Agent updated the ${company} application${changed}` };
    } catch {
      return { tool: event.tool, args: event.args, summary: 'Agent changed a job application' };
    }
  }

  if (event.tool === 'get_applications') {
    let total: number | undefined;
    let active: number | undefined;
    try {
      const parsed = JSON.parse(event.result) as { stats?: { total?: unknown; active?: unknown } };
      if (typeof parsed.stats?.total === 'number') total = parsed.stats.total;
      if (typeof parsed.stats?.active === 'number') active = parsed.stats.active;
    } catch {
      // Keep the generic summary below.
    }
    return {
      tool: event.tool,
      args: event.args,
      summary: `Agent read the job-application pipeline${total !== undefined ? ` - ${total} application${total === 1 ? '' : 's'}${active !== undefined ? `, ${active} active` : ''}` : ''}`,
    };
  }

  return { tool: event.tool, args: event.args, summary: `Agent used ${event.tool}: ${preview(event.result)}` };
}

function pinnedContext(docs: Document[]): AgentMessage | undefined {
  if (!docs.length) return undefined;
  const content = docs
    .map(doc => {
      const text = doc.extractedText?.slice(0, PINNED_TEXT_CAP) || '(no extracted text available)';
      return `--- Pinned document [doc:${doc.id}] "${doc.originalName}" (category: ${doc.category}) ---\n${text}`;
    })
    .join('\n\n');
  return {
    role: 'system',
    content: `The user pinned these documents to this conversation. Treat them as already-read primary evidence, but still use search_docs/read_doc if more evidence is needed.\n\n${content}`,
  };
}

function attachmentContext(attachments: ChatAttachment[]): AgentMessage | undefined {
  if (!attachments.length) return undefined;
  const content = attachments
    .map(a => `--- Attached file "${a.name}" (${a.mime}) ---\n${a.text.slice(0, PINNED_TEXT_CAP)}`)
    .join('\n\n');
  return {
    role: 'system',
    content: `The user attached these files to this conversation as context only — they are NOT in the stash and have no [doc:] id to cite, but treat them as primary source material for this question.\n\n${content}`,
  };
}

export class AgenticChatService {
  constructor(
    private readonly store: StoreService,
    private readonly embeddings: EmbeddingService,
  ) {}

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
        title: userText.length > 64 ? `${userText.slice(0, 64)}...` : userText,
        updatedAt: now,
      });
    }

    const toolCalls: ToolCallRecord[] = [];
    const traceSink: AgentTraceSink = {
      record: event => {
        if (event.type !== 'tool_result') return;
        const call = summarizeTool(event);
        toolCalls.push(call);
        send({ type: 'tool', call });
      },
    };

    try {
      const agent = new AgenticWorkflow(
        new OllamaAgentClient(),
        this.gateWriteTools(this.buildTools(), conversationId),
        traceSink,
      );
      const result = await agent.run(userText, {
        contextMessages: await this.contextMessages(
          conversationId,
          conversation.messages,
          conversation.pinnedDocIds,
          conversation.attachments,
          userText,
        ),
        // Stream the answer token-by-token. Deliberation text from a round that
        // ends in a tool call is discarded client-side on the `tool` event.
        onToken: text => send({ type: 'token', text }),
      });

      const answer =
        result.answer ||
        (result.stoppedByLimit
          ? 'I ran out of tool steps before I could finish. Try narrowing the question.'
          : 'I could not produce an answer for that.');
      // The answer already streamed via onToken; only push text if nothing came
      // through (empty model output / fallback) so the bubble isn't blank.
      if (!result.answer) send({ type: 'token', text: answer });

      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        conversationId,
        role: 'assistant',
        content: answer,
        citations: this.extractCitations(answer),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        createdAt: new Date().toISOString(),
      };
      this.store.addMessage(assistantMsg);
      this.store.touchConversation(conversationId, { updatedAt: assistantMsg.createdAt });
      send({ type: 'done', message: assistantMsg });
    } catch (err) {
      send({ type: 'error', error: err instanceof Error ? err.message : 'Agentic chat failed' });
    }
  }

  // Every tool the chat agent can use. Also the executor set for approved
  // write proposals — resolveAction runs the same implementations, ungated.
  private buildTools(): AgentTool[] {
    return [
      ...createProjectAgentTools(this.store),
      ...createDocumentAgentTools(new StoreDocumentCorpus(this.store)),
      ...createPortfolioAgentTools(this.store),
      ...createApplicationAgentTools(this.store),
    ];
  }

  // Confirm-before-apply, enforced server-side: a write tool handed to the
  // workflow never executes. It persists a pending action (tool + args +
  // preview summary) and tells the model the change is queued; the store
  // mutation happens only in resolveAction, from the server-stored args, so
  // there is no code path from model output (or a UI-skipping client) to the
  // store.
  private gateWriteTools(tools: AgentTool[], conversationId: string): AgentTool[] {
    return tools.map(tool => {
      if (!WRITE_TOOLS.has(tool.name)) return tool;
      return {
        ...tool,
        execute: (args: Record<string, unknown>) => {
          const summary = proposalSummary(this.store, tool.name, args ?? {});
          const action = {
            id: uuidv4(),
            conversationId,
            tool: tool.name,
            args: args ?? {},
            summary,
            createdAt: new Date().toISOString(),
          };
          this.store.addChatAction(action);
          return {
            ok: true,
            queued: true,
            actionId: action.id,
            summary,
            note:
              'Queued for user approval — NOT applied yet. The user sees an approval card for exactly this change and can apply or dismiss it. Tell the user what you proposed and that it awaits their approval; never claim it already happened.',
          };
        },
      };
    });
  }

  // The only code path that executes a proposed write. Runs the same tool
  // implementation the agent saw — ungated, with the server-stored args; the
  // client sends only the action id, so a bypassing client has nothing to
  // forge. Double-submits are safe: tool bodies are synchronous store calls
  // (no real I/O between the pending-status check and the resolve), so a
  // second request can't interleave, and it 409s on the resolved status.
  async resolveAction(
    conversationId: string,
    actionId: string,
    approve: boolean,
  ): Promise<{ ok: true; resolution: ChatActionResolution } | { ok: false; code: number; error: string }> {
    const action = this.store.getChatAction(actionId);
    if (!action || action.conversationId !== conversationId) {
      return { ok: false, code: 404, error: 'Action not found' };
    }
    if (action.status !== 'pending') {
      return { ok: false, code: 409, error: `This change was already ${action.status}` };
    }

    if (!approve) {
      this.store.resolveChatAction(actionId, 'declined');
      return { ok: true, resolution: { actionId, status: 'declined' } };
    }

    const tool = this.buildTools().find(t => t.name === action.tool);
    if (!tool) {
      const error = `Tool no longer available: ${action.tool}`;
      this.store.resolveChatAction(actionId, 'failed', error);
      return { ok: true, resolution: { actionId, status: 'failed', resultSummary: error } };
    }

    let result: unknown;
    try {
      result = await tool.execute(action.args);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'The change could not be applied' };
    }
    const failed =
      typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false
        ? String((result as { error?: unknown }).error ?? 'The change could not be applied')
        : undefined;
    if (failed) {
      this.store.resolveChatAction(actionId, 'failed', failed);
      return { ok: true, resolution: { actionId, status: 'failed', resultSummary: failed } };
    }

    // Reuse the display summarizer for the receipt, minus its "Agent ..."
    // framing — the user applied this one.
    const raw = summarizeTool({
      type: 'tool_result',
      runId: 'apply',
      step: 0,
      tool: action.tool,
      args: action.args,
      result: formatToolResult(result),
    }).summary.replace(/^Agent /, '');
    const resultSummary = raw.charAt(0).toUpperCase() + raw.slice(1);
    this.store.resolveChatAction(actionId, 'applied', resultSummary);
    return { ok: true, resolution: { actionId, status: 'applied', resultSummary } };
  }

  private async contextMessages(
    conversationId: string,
    history: ChatMessage[],
    pinnedDocIds: string[],
    attachments: ChatAttachment[],
    userText: string,
  ): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [this.rosterContext(await this.retrieveSeed(userText, pinnedDocIds))];

    const pinned = pinnedDocIds
      .map(id => this.store.getDocument(id))
      .filter((doc): doc is Document => !!doc);
    const pinnedMsg = pinnedContext(pinned);
    if (pinnedMsg) messages.push(pinnedMsg);

    const attachmentMsg = attachmentContext(attachments);
    if (attachmentMsg) messages.push(attachmentMsg);

    const actionsMsg = this.actionStatusContext(conversationId);
    if (actionsMsg) messages.push(actionsMsg);

    for (const msg of history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: msg.role, content: msg.content });
    }
    return messages;
  }

  // Keep the agent honest about its earlier proposals: without this it would
  // have no way to know whether a queued write was ever applied. Statuses are
  // read fresh each turn.
  private actionStatusContext(conversationId: string): AgentMessage | undefined {
    const actions = this.store.getChatActions(conversationId).slice(-10);
    if (!actions.length) return undefined;
    const lines = actions.map(
      a => `- [${a.status}] ${a.summary}${a.status === 'failed' && a.resultSummary ? ` (${a.resultSummary})` : ''}`,
    );
    return {
      role: 'system',
      content: `Changes you proposed earlier in this conversation, with their current status — "pending" means still awaiting the user's approval and NOT applied; "declined" means the user dismissed it (do not re-propose unless asked again); "applied" means it happened:\n${lines.join('\n')}`,
    };
  }

  // The RAG seed: the same sqlite-vec retrieval the classic chat used
  // (EmbeddingService.retrieve — do not duplicate that query logic), trimmed
  // to SEED_K and with pinned docs excluded (they already ride along in full).
  // Degrades to an empty seed whenever embeddings are unavailable — the model
  // never pulled, the local Ollama down, or init still in flight — exactly as
  // classic degraded to search_docs-only; retrieval failures never throw.
  private async retrieveSeed(userText: string, pinnedDocIds: string[]): Promise<RetrievedChunk[]> {
    if (!this.embeddings.isReady) return [];
    const retrieved = await this.embeddings.retrieve(userText, SEED_K).catch(() => []);
    return retrieved.filter(c => !pinnedDocIds.includes(c.docId));
  }

  // A lightweight orientation message so the agent knows the date and what
  // drawers/ledgers exist without spending a tool round to discover them. The
  // tools still pull the actual detail on demand. The RAG seed rides along
  // here so common lookups can be answered without burning a tool round.
  private rosterContext(seed: RetrievedChunk[]): AgentMessage {
    const counts = this.store.getCategoryCounts();
    const categoryList = this.store
      .getCategories()
      .map(c => `- ${c.id} (${c.name}, ${counts[c.id] ?? 0} docs)`)
      .join('\n');
    const projects = this.store.listProjects();
    const projectList = projects.length
      ? projects
          .map(p => `- ${p.id} (${p.name}${p.status === 'archived' ? ', archived' : ''}): ${p.totals.itemCount} line items`)
          .join('\n')
      : '(no projects yet)';
    const sections = [
      `Today's date: ${new Date().toISOString().slice(0, 10)}.\n\nCategory drawers:\n${categoryList}\n\nCost ledgers (projects):\n${projectList}`,
    ];
    if (seed.length > 0) {
      // Same [doc:id] excerpt format the classic chat used, so citations and
      // the client's prefix resolution keep working unchanged.
      const blocks = seed.map(c => `[doc:${c.docId}] "${c.docName}" (${c.category}):\n${c.text}`);
      sections.push(
        `Retrieval seed — excerpts ranked by similarity to the question. These are an unconfirmed starting point, not verified evidence:\n\n${blocks.join('\n\n')}`,
      );
    }
    return { role: 'system', content: sections.join('\n\n') };
  }

  // Loose citation resolution: models can shorten UUIDs, so resolve unique
  // prefixes against real document ids (the client mirrors this).
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
