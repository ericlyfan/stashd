import { Document } from '@stashd/shared';
import { StoreService } from './StoreService';

// Embeddings run against a *local* Ollama by default — the cloud endpoint used
// for classification/chat doesn't serve embedding models. Separate env vars so
// the two can point at different instances.
const EMBED_BASE = process.env.OLLAMA_EMBED_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'embeddinggemma';
const EMBED_API_KEY = process.env.OLLAMA_EMBED_API_KEY;

// embeddinggemma is trained with task-specific prefixes; Ollama does not add
// them for /api/embed, so we do. Harmless on models that ignore them.
const QUERY_PREFIX = 'task: search result | query: ';

// ~350 tokens per chunk keeps well inside embeddinggemma's 2048-token window
// even with the title prefix.
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 200;

// Bounds each /api/embed call so a wedged local Ollama can't stall the chat's
// RAG seed or wedge the indexing queue (it's a serialized promise chain — one
// hung call blocks every document behind it). Generous for a cold model load.
const EMBED_TIMEOUT_MS = 60_000;

export interface RetrievedChunk {
  docId: string;
  docName: string;
  category: string;
  seq: number;
  text: string;
  distance: number;
}

/**
 * Split text into overlapping chunks, preferring paragraph then sentence
 * boundaries so excerpts read coherently when quoted back to the model.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      // Walk back to the nicest break in the second half of the window.
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
      );
      if (breakAt > CHUNK_SIZE / 2) end = start + breakAt + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

export class EmbeddingService {
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;

  constructor(private readonly store: StoreService) {}

  /**
   * Probe the embedding model, size the vec index, and (re)index anything
   * missing. Called in the background at boot; until it resolves, retrieval
   * and indexing degrade gracefully (chat falls back to keyword search).
   */
  async init(): Promise<void> {
    const [probe] = await this.embedRaw(['stashd index probe']);
    const wiped = this.store.ensureVecIndex(EMBED_MODEL, probe.length);
    this.ready = true;
    if (wiped) console.log(`Vector index built for ${EMBED_MODEL} (${probe.length} dims)`);

    const pending = this.store.getDocIdsNeedingIndex();
    if (pending.length > 0) console.log(`Embedding backfill: ${pending.length} document(s) to index`);
    for (const id of pending) {
      const doc = this.store.getDocument(id);
      if (doc) await this.indexDocument(doc).catch((err: unknown) => {
        console.warn(`Embedding failed for ${doc.originalName}:`, (err as Error).message);
      });
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * (Re)build a document's chunks + vectors. Serialized through an internal
   * queue so a batch of filings doesn't stampede the local Ollama.
   */
  indexDocument(doc: Document): Promise<void> {
    const task = this.queue.then(async () => {
      if (!this.ready) return;
      const current = this.store.getDocument(doc.id);
      if (!current) return;
      const body = current.extractedText?.trim() || [current.summary, current.vendor, current.tags.join(', ')].filter(Boolean).join('\n');
      const chunks = chunkText(body);
      if (chunks.length === 0) {
        this.store.deleteDocChunks(doc.id);
        return;
      }
      const embeddings = await this.embedRaw(chunks.map(c => `title: ${current.originalName} | text: ${c}`));
      if (!this.store.getDocument(doc.id)) return;
      this.store.replaceDocChunks(
        doc.id,
        chunks.map((text, i) => ({ text, embedding: embeddings[i] })),
      );
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  removeDocument(docId: string): void {
    this.store.deleteDocChunks(docId);
  }

  /** Embed a question and return the K nearest chunks across the stash. */
  async retrieve(query: string, k = 6): Promise<RetrievedChunk[]> {
    if (!this.ready) return [];
    const [embedding] = await this.embedRaw([QUERY_PREFIX + query]);
    return this.store.searchChunks(embedding, k);
  }

  private async embedRaw(inputs: string[]): Promise<Float32Array[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (EMBED_API_KEY) headers.Authorization = `Bearer ${EMBED_API_KEY}`;
    const res = await fetch(`${EMBED_BASE}/api/embed`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    });
    if (!res.ok) {
      throw new Error(`Embedding model responded ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings.map(e => Float32Array.from(e));
  }
}
