import { CategoryId, Document, SearchHit } from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { buildCustomCategory, slugifyCategory } from '../services/categoryStyle';
import { AgentTool } from './AgenticWorkflow';

export interface AgentCategorySummary {
  id: string;
  name: string;
  documentCount: number;
}

export interface AgentDocumentChange {
  category?: string;
  addTags?: string[];
  removeTags?: string[];
  flag?: boolean;
}

export interface AgentDocumentUpdateResult {
  document: Document;
  actions: string[];
}

export interface AgentDocumentCorpus {
  searchDocuments(query: string, limit: number): Promise<SearchHit[]> | SearchHit[];
  getDocument(id: string): Promise<Document | undefined> | Document | undefined;
  listCategories(): Promise<AgentCategorySummary[]> | AgentCategorySummary[];
  updateDocument(
    id: string,
    change: AgentDocumentChange,
  ): Promise<AgentDocumentUpdateResult | undefined> | AgentDocumentUpdateResult | undefined;
}

export interface DocumentAgentToolOptions {
  searchLimit?: number;
  snippetChars?: number;
  readTextChars?: number;
}

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_SNIPPET_CHARS = 420;
const DEFAULT_READ_TEXT_CHARS = 8000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function truncate(value: string | undefined, limit: number): { text: string; truncated: boolean } {
  const content = value?.trim() || '';
  if (!content) return { text: '', truncated: false };
  if (content.length <= limit) return { text: content, truncated: false };
  return { text: content.slice(0, limit), truncated: true };
}

function compactDoc(doc: Document): Record<string, unknown> {
  return {
    id: doc.id,
    name: doc.originalName,
    category: doc.category,
    tags: doc.tags,
    summary: doc.summary,
    date: doc.dateExtracted,
    amount: doc.amount,
    vendor: doc.vendor,
    status: doc.status,
  };
}

export function createDocumentAgentTools(
  corpus: AgentDocumentCorpus,
  options: DocumentAgentToolOptions = {},
): AgentTool[] {
  const searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const readTextChars = options.readTextChars ?? DEFAULT_READ_TEXT_CHARS;

  return [
    {
      name: 'search_docs',
      schema: {
        type: 'function',
        function: {
          name: 'search_docs',
          description:
            'Search the Stashd document corpus by keywords. Use this first to discover relevant document ids. Returns compact metadata and short snippets only.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', description: 'Specific keywords, names, dates, amounts, or topics to search for.' },
              limit: { type: 'number', description: 'Maximum result count, 1-8. Defaults to 5.' },
            },
            required: ['query'],
          },
        },
      },
      async execute(args) {
        const query = text(args.query);
        if (!query) return { ok: false, error: 'query is required' };

        const limit = numberArg(args.limit, searchLimit, 1, 8);
        const hits = (await corpus.searchDocuments(query, limit)).slice(0, limit);
        return {
          ok: true,
          query,
          count: hits.length,
          results: hits.map(hit => {
            const snippet = truncate(hit.snippet || hit.extractedText || hit.summary, snippetChars);
            return {
              ...compactDoc(hit),
              snippet: snippet.text,
              snippet_truncated: snippet.truncated,
            };
          }),
        };
      },
    },
    {
      name: 'read_doc',
      schema: {
        type: 'function',
        function: {
          name: 'read_doc',
          description:
            'Read one document by id. Use after search_docs before quoting, summarizing, comparing, or extracting details from a document.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              doc_id: { type: 'string', description: 'The exact document id returned by search_docs.' },
            },
            required: ['doc_id'],
          },
        },
      },
      async execute(args) {
        const docId = text(args.doc_id);
        if (!docId) return { ok: false, error: 'doc_id is required' };

        const doc = await corpus.getDocument(docId);
        if (!doc) return { ok: false, error: `Document not found: ${docId}` };

        const extracted = truncate(doc.extractedText || '', readTextChars);
        return {
          ok: true,
          document: compactDoc(doc),
          text: extracted.text || '(no extracted text available)',
          text_truncated: extracted.truncated,
        };
      },
    },
    {
      name: 'list_categories',
      schema: {
        type: 'function',
        function: {
          name: 'list_categories',
          description:
            'List the category drawers (with document counts) the stash is organized into. Use to answer what kinds of documents exist, or to pick a target drawer before update_doc.',
          parameters: { type: 'object', additionalProperties: false, properties: {} },
        },
      },
      async execute() {
        const categories = await corpus.listCategories();
        return { ok: true, count: categories.length, categories };
      },
    },
    {
      name: 'update_doc',
      schema: {
        type: 'function',
        function: {
          name: 'update_doc',
          description:
            'Modify a document only when the user explicitly asks: re-categorize it (a new drawer is created if needed), add/remove tags, or flag/unflag it for review. Never call this to answer a question.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              doc_id: { type: 'string', description: 'The exact document id to modify.' },
              category: { type: 'string', description: 'New category name or slug. Created if it does not exist.' },
              add_tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
              remove_tags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove.' },
              flag: { type: 'boolean', description: 'true to flag for review, false to resolve the flag.' },
            },
            required: ['doc_id'],
          },
        },
      },
      async execute(args) {
        const docId = text(args.doc_id);
        if (!docId) return { ok: false, error: 'doc_id is required' };

        const change: AgentDocumentChange = {
          category: text(args.category) || undefined,
          addTags: stringArray(args.add_tags),
          removeTags: stringArray(args.remove_tags),
          flag: typeof args.flag === 'boolean' ? args.flag : undefined,
        };
        if (!change.category && !change.addTags?.length && !change.removeTags?.length && change.flag === undefined) {
          return { ok: false, error: 'No changes requested. Provide category, add_tags, remove_tags, or flag.' };
        }

        const result = await corpus.updateDocument(docId, change);
        if (!result) return { ok: false, error: `Document not found: ${docId}` };
        if (result.actions.length === 0) return { ok: false, error: 'No changes were applied.' };
        return { ok: true, document: compactDoc(result.document), actions: result.actions };
      },
    },
  ];
}

export class StoreDocumentCorpus implements AgentDocumentCorpus {
  constructor(private readonly store: StoreService) {}

  searchDocuments(query: string, limit: number): SearchHit[] {
    return this.store.searchDocuments(query).slice(0, limit);
  }

  // Resolve exactly, then by unique id prefix — the model sometimes drops
  // trailing UUID characters (same reason citations resolve by prefix).
  getDocument(id: string): Document | undefined {
    const exact = this.store.getDocument(id);
    if (exact) return exact;
    const matches = this.store.getDocuments().filter(d => d.id.startsWith(id));
    return matches.length === 1 ? matches[0] : undefined;
  }

  listCategories(): AgentCategorySummary[] {
    const counts = this.store.getCategoryCounts();
    return this.store.getCategories().map(c => ({ id: c.id, name: c.name, documentCount: counts[c.id] ?? 0 }));
  }

  updateDocument(id: string, change: AgentDocumentChange): AgentDocumentUpdateResult | undefined {
    const doc = this.getDocument(id);
    if (!doc) return undefined;

    const actions: string[] = [];
    const updates: Parameters<StoreService['updateDocument']>[1] = { updatedAt: new Date().toISOString() };

    if (change.category) {
      const categoryId = slugifyCategory(change.category);
      if (!this.store.getCategory(categoryId)) this.store.addCategory(buildCustomCategory(categoryId));
      updates.category = categoryId as CategoryId;
      actions.push(`moved to ${categoryId}`);
    }
    const addTags = change.addTags ?? [];
    const removeTags = change.removeTags ?? [];
    if (addTags.length || removeTags.length) {
      let tags = doc.tags.filter(t => !removeTags.includes(t));
      for (const t of addTags) if (!tags.includes(t)) tags = [...tags, t];
      updates.tags = tags;
      if (addTags.length) actions.push(`tagged ${addTags.join(', ')}`);
      if (removeTags.length) actions.push(`untagged ${removeTags.join(', ')}`);
    }
    if (change.flag !== undefined) {
      updates.status = change.flag ? 'pending' : 'filed';
      actions.push(change.flag ? 'flagged for review' : 'flag resolved');
    }
    if (actions.length === 0) return { document: doc, actions };

    return { document: this.store.updateDocument(doc.id, updates) ?? doc, actions };
  }
}

export class FixtureDocumentCorpus implements AgentDocumentCorpus {
  constructor(private readonly documents: Document[]) {}

  searchDocuments(query: string, limit: number): SearchHit[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.documents
      .map(doc => {
        const haystack = [doc.originalName, doc.category, doc.vendor, doc.summary, doc.tags.join(' '), doc.extractedText]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { doc, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ doc }) => ({
        ...doc,
        snippet: truncate(doc.extractedText || doc.summary, DEFAULT_SNIPPET_CHARS).text,
      }));
  }

  getDocument(id: string): Document | undefined {
    return this.documents.find(doc => doc.id === id) ?? this.documents.find(doc => doc.id.startsWith(id));
  }

  listCategories(): AgentCategorySummary[] {
    const counts = new Map<string, number>();
    for (const doc of this.documents) counts.set(doc.category, (counts.get(doc.category) ?? 0) + 1);
    return [...counts].map(([id, documentCount]) => ({ id, name: id, documentCount }));
  }

  updateDocument(id: string, change: AgentDocumentChange): AgentDocumentUpdateResult | undefined {
    const doc = this.getDocument(id);
    if (!doc) return undefined;

    const actions: string[] = [];
    if (change.category) {
      doc.category = slugifyCategory(change.category) as CategoryId;
      actions.push(`moved to ${doc.category}`);
    }
    const removeTags = change.removeTags ?? [];
    const addTags = change.addTags ?? [];
    if (addTags.length || removeTags.length) {
      doc.tags = doc.tags.filter(t => !removeTags.includes(t));
      for (const t of addTags) if (!doc.tags.includes(t)) doc.tags.push(t);
      if (addTags.length) actions.push(`tagged ${addTags.join(', ')}`);
      if (removeTags.length) actions.push(`untagged ${removeTags.join(', ')}`);
    }
    if (change.flag !== undefined) {
      doc.status = change.flag ? 'pending' : 'filed';
      actions.push(change.flag ? 'flagged for review' : 'flag resolved');
    }
    return { document: doc, actions };
  }
}

