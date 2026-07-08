export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: AgentRole;
  content: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

export interface AgentToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentTool {
  name: string;
  schema: AgentToolSchema;
  execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface AgentModelRequest {
  messages: AgentMessage[];
  tools: AgentToolSchema[];
  allowTools: boolean;
}

export interface AgentModelResponse {
  content: string;
  toolCalls: AgentToolCall[];
}

// Called with each content chunk as it streams in. A client that cannot stream
// may ignore it; the workflow still relies on the resolved `content`.
export type AgentTokenHandler = (text: string) => void;

export interface AgentModelClient {
  chat(request: AgentModelRequest, onToken?: AgentTokenHandler): Promise<AgentModelResponse>;
}

export type AgentTraceEvent =
  | { type: 'model_response'; runId: string; step: number; contentPreview: string; toolCalls: AgentToolCall[] }
  | { type: 'tool_result'; runId: string; step: number; tool: string; args: Record<string, unknown>; result: string }
  | { type: 'step_limit'; runId: string; step: number; maxToolIterations: number };

export interface AgentTraceSink {
  record(event: AgentTraceEvent): void;
}

export interface AgentRunOptions {
  maxToolIterations?: number;
  runId?: string;
  contextMessages?: AgentMessage[];
  // Forwarded each content chunk as the model streams. Tokens stream every
  // round; the consumer is expected to discard a round's text when that round
  // turns out to end in a tool call (as the chat UI does on a `tool` event).
  onToken?: AgentTokenHandler;
}

export interface AgentRunResult {
  answer: string;
  messages: AgentMessage[];
  trace: AgentTraceEvent[];
  stoppedByLimit: boolean;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
// A generous backstop against pathological tool output — each tool already
// self-limits (read_doc 8k of text, search snippets, project item caps), so
// this must sit comfortably above a normal full read or it mangles every one.
const TOOL_RESULT_CHAR_LIMIT = 14000;

const SYSTEM_PROMPT = `You are Stashd's agentic document assistant.

You answer questions about the user's stash by using tools step by step.

Rules:
- Use tools before answering when the user asks about documents, facts inside documents, totals, dates, comparisons, or anything that depends on the stash.
- Do not fabricate document facts. Ground factual claims in search_docs or read_doc results, or in the retrieval seed when it clearly and completely answers the question.
- A retrieval seed of possibly-relevant excerpts may accompany the question. Treat seed excerpts as an unconfirmed starting point: they are similarity-ranked fragments that can be partial, stale, or off-topic. You MUST call read_doc before citing a seed document as fact whenever the excerpt looks partial or the question requires precision — dates, amounts, names, or specific figures.
- For project, ledger, payment, budget, vendor spend, or cost questions, use list_projects and read_project before document search. If the user names a project like an address or number, find the project first, then read it with any vendor/query filter.
- For anything the seed does not cover: search first when you do not know the relevant document ids, and read a document before extracting detailed facts from it.
- If a tool returns no results, revise the query once or say plainly that you could not find supporting evidence.
- If a tool returns an error, adjust your next tool call or explain the limitation. Do not pretend the failed tool succeeded.
- Use list_categories to learn how the stash is organized or to pick a target drawer.
- Only call update_doc (re-categorize, add/remove tags, flag/unflag) when the user explicitly asks you to change a document. Never modify a document just to answer a question, and confirm what you changed.
- You can write to the ledgers: add_line_item records a cost against a project, and create_project starts a new ledger. Only call these when the user explicitly asks to add/record a cost or create a project. If a requested cost belongs to a project that does not exist yet, create it first, then add the line. Never add ledger entries just to answer a question, and confirm exactly what you added.
- Keep answers concise and cite source documents using [doc:<id>] immediately after claims from a document. Ledger-only facts can be identified as coming from the project ledger.
- When the available evidence is incomplete, say what is missing rather than guessing.`;

function makeRunId(): string {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function preview(text: string, limit = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}...`;
}

// Compact (no indentation) to keep tool results token-cheap for the model.
function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
  return json ?? 'null';
}

export function formatToolResult(value: unknown, limit = TOOL_RESULT_CHAR_LIMIT): string {
  const text = stableJson(value);
  if (text.length <= limit) return text;
  return stableJson({
    ok: true,
    truncated: true,
    note: `Tool result exceeded ${limit} characters and was truncated before returning to the model.`,
    preview: text.slice(0, limit),
  });
}

export class ConsoleAgentTraceSink implements AgentTraceSink {
  record(event: AgentTraceEvent): void {
    if (event.type === 'tool_result') {
      console.info(
        `[agent:${event.runId}] step ${event.step} ${event.tool} ${JSON.stringify(event.args)} -> ${preview(event.result, 500)}`,
      );
      return;
    }
    if (event.type === 'model_response') {
      const calls = event.toolCalls.map(c => c.name).join(', ') || 'none';
      console.info(`[agent:${event.runId}] step ${event.step} model tool_calls=${calls} content="${event.contentPreview}"`);
      return;
    }
    console.warn(`[agent:${event.runId}] step limit reached after ${event.maxToolIterations} tool iteration(s)`);
  }
}

export class AgenticWorkflow {
  private readonly toolsByName: Map<string, AgentTool>;
  private readonly systemPrompt: string;

  constructor(
    private readonly model: AgentModelClient,
    tools: AgentTool[],
    private readonly traceSink: AgentTraceSink = new ConsoleAgentTraceSink(),
    systemPrompt = SYSTEM_PROMPT,
  ) {
    this.toolsByName = new Map(tools.map(tool => [tool.name, tool]));
    this.systemPrompt = systemPrompt;
  }

  async run(question: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const runId = options.runId ?? makeRunId();
    const trace: AgentTraceEvent[] = [];
    const messages: AgentMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...(options.contextMessages ?? []),
      { role: 'user', content: question },
    ];

    let stoppedByLimit = false;

    for (let step = 1; step <= maxToolIterations; step++) {
      const response = await this.model.chat(
        {
          messages,
          tools: this.schemas(),
          allowTools: true,
        },
        options.onToken,
      );
      this.record(trace, {
        type: 'model_response',
        runId,
        step,
        contentPreview: preview(response.content),
        toolCalls: response.toolCalls,
      });

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content });
        return { answer: response.content.trim(), messages, trace, stoppedByLimit };
      }

      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const result = await this.executeTool(call);
        this.record(trace, {
          type: 'tool_result',
          runId,
          step,
          tool: call.name,
          args: call.arguments,
          result,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    stoppedByLimit = true;
    this.record(trace, { type: 'step_limit', runId, step: maxToolIterations + 1, maxToolIterations });
    messages.push({
      role: 'tool',
      content: formatToolResult({
        ok: false,
        error: `Step limit reached after ${maxToolIterations} tool iteration(s). Answer only from gathered tool results; say what remains unresolved.`,
      }),
    });

    const final = await this.model.chat(
      {
        messages,
        tools: [],
        allowTools: false,
      },
      options.onToken,
    );
    this.record(trace, {
      type: 'model_response',
      runId,
      step: maxToolIterations + 1,
      contentPreview: preview(final.content),
      toolCalls: final.toolCalls,
    });
    messages.push({ role: 'assistant', content: final.content });
    return { answer: final.content.trim(), messages, trace, stoppedByLimit };
  }

  private schemas(): AgentToolSchema[] {
    return [...this.toolsByName.values()].map(tool => tool.schema);
  }

  private async executeTool(call: AgentToolCall): Promise<string> {
    const tool = this.toolsByName.get(call.name);
    if (!tool) {
      return formatToolResult({ ok: false, error: `Unknown tool: ${call.name}` });
    }

    try {
      return formatToolResult(await tool.execute(call.arguments ?? {}));
    } catch (err) {
      return formatToolResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Tool failed',
      });
    }
  }

  private record(trace: AgentTraceEvent[], event: AgentTraceEvent): void {
    trace.push(event);
    this.traceSink.record(event);
  }
}
