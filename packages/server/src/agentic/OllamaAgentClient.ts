import {
  AgentMessage,
  AgentModelClient,
  AgentModelRequest,
  AgentModelResponse,
  AgentTokenHandler,
  AgentToolCall,
} from './AgenticWorkflow';

const OLLAMA_BASE = process.env.AGENT_OLLAMA_URL ?? process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.AGENT_OLLAMA_MODEL ?? 'glm-4.7:cloud';
const OLLAMA_API_KEY = process.env.AGENT_OLLAMA_API_KEY ?? process.env.OLLAMA_API_KEY;

interface OllamaToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
}

function normalizeToolCall(call: OllamaToolCall): AgentToolCall | undefined {
  const name = call.function?.name;
  if (!name) return undefined;

  let args: Record<string, unknown> = {};
  const rawArgs = call.function?.arguments;
  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      else args = { __argument_error: 'Tool arguments must be a JSON object.' };
    } catch (err) {
      args = { __argument_error: err instanceof Error ? err.message : 'Could not parse tool arguments.' };
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs;
  }

  return { id: call.id, name, arguments: args };
}

function toOllamaMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(msg => {
    if (msg.role !== 'tool') return msg;
    return {
      role: 'tool',
      content: msg.content,
      ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    };
  });
}

export class OllamaAgentClient implements AgentModelClient {
  constructor(
    private readonly baseUrl = OLLAMA_BASE,
    private readonly model = OLLAMA_MODEL,
    private readonly apiKey = OLLAMA_API_KEY,
  ) {}

  async chat(request: AgentModelRequest, onToken?: AgentTokenHandler): Promise<AgentModelResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const stream = !!onToken;
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: toOllamaMessages(request.messages),
        stream,
        options: { temperature: 0.1 },
        ...(request.allowTools && request.tools.length > 0 && { tools: request.tools }),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
    }

    const raw = stream ? await this.readStream(res, onToken!) : ((await res.json()) as OllamaChatResponse);
    if (raw.error) throw new Error(raw.error);

    return {
      content: raw.message?.content ?? '',
      toolCalls: (raw.message?.tool_calls ?? []).map(normalizeToolCall).filter((c): c is AgentToolCall => !!c),
    };
  }

  // Read Ollama's NDJSON stream, forwarding content chunks as they arrive and
  // accumulating the full content + tool calls into one response-shaped object.
  private async readStream(res: Response, onToken: AgentTokenHandler): Promise<OllamaChatResponse> {
    if (!res.body) throw new Error('Ollama returned no response body to stream');

    let content = '';
    const toolCalls: OllamaToolCall[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handle = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as OllamaChatResponse;
      if (chunk.error) throw new Error(chunk.error);
      const piece = chunk.message?.content;
      if (piece) {
        content += piece;
        onToken(piece);
      }
      if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handle(line);
    }
    if (buffer.trim()) handle(buffer);

    return { message: { content, tool_calls: toolCalls } };
  }
}
