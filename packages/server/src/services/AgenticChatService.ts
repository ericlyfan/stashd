import { v4 as uuidv4 } from 'uuid';
import { ChatAttachment, ChatMessage, ChatSSEEvent, Citation, Document, ToolCallRecord } from '@stashd/shared';
import { StoreService } from './StoreService';
import { EmbeddingService, RetrievedChunk } from './EmbeddingService';
import {
  AgentMessage,
  AgentTraceEvent,
  AgentTraceSink,
  AgenticWorkflow,
  createApplicationAgentTools,
  createDocumentAgentTools,
  createPortfolioAgentTools,
  createProjectAgentTools,
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

function summarizeTool(event: Extract<AgentTraceEvent, { type: 'tool_result' }>): ToolCallRecord {
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
        [
          ...createProjectAgentTools(this.store),
          ...createDocumentAgentTools(new StoreDocumentCorpus(this.store)),
          ...createPortfolioAgentTools(this.store),
          ...createApplicationAgentTools(this.store),
        ],
        traceSink,
      );
      const result = await agent.run(userText, {
        contextMessages: await this.contextMessages(
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

  private async contextMessages(
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

    for (const msg of history.slice(-HISTORY_LIMIT)) {
      messages.push({ role: msg.role, content: msg.content });
    }
    return messages;
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
