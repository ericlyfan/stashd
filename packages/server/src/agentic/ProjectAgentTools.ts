import { LineItem, ProjectDetail } from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { AgentTool } from './AgenticWorkflow';

const DEFAULT_ITEM_LIMIT = 40;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function money(value: number | undefined): number {
  return value ?? 0;
}

function includesAllTerms(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const lower = haystack.toLowerCase();
  return terms.every(term => lower.includes(term));
}

function lineHaystack(item: LineItem, linkedName?: string): string {
  return [
    item.category,
    item.vendor,
    item.description,
    item.datePaid,
    item.invoiceNumber,
    item.status,
    item.notes,
    item.documentId,
    linkedName,
    item.amountRequested,
    item.amountPaid,
    item.taxAmount,
    item.totalPaid,
  ]
    .filter(v => v !== undefined && v !== null)
    .join(' ');
}

function compactLineItem(store: StoreService, item: LineItem): Record<string, unknown> {
  const linkedDoc = item.documentId ? store.getDocument(item.documentId) : undefined;
  return {
    id: item.id,
    category: item.category,
    vendor: item.vendor,
    description: item.description,
    quantity: item.quantity,
    datePaid: item.datePaid,
    invoiceNumber: item.invoiceNumber,
    amountRequested: item.amountRequested,
    amountPaid: item.amountPaid,
    taxAmount: item.taxAmount,
    totalPaid: item.totalPaid,
    status: item.status,
    notes: item.notes,
    documentId: item.documentId,
    documentName: linkedDoc?.originalName,
  };
}

function matchingProject(store: StoreService, key: string): ProjectDetail | undefined {
  const exact = store.getProjectDetail(key);
  if (exact) return exact;

  const lower = key.toLowerCase();
  const projects = store.listProjects();
  const match =
    projects.find(project => project.name.toLowerCase() === lower) ??
    projects.find(project => project.name.toLowerCase().includes(lower) || project.id.toLowerCase().startsWith(lower));
  return match ? store.getProjectDetail(match.id) : undefined;
}

function totals(items: LineItem[]): Record<string, number> {
  return items.reduce(
    (acc, item) => ({
      itemCount: acc.itemCount + 1,
      requested: acc.requested + money(item.amountRequested),
      paid: acc.paid + money(item.amountPaid),
      tax: acc.tax + money(item.taxAmount),
      total: acc.total + money(item.totalPaid),
    }),
    { itemCount: 0, requested: 0, paid: 0, tax: 0, total: 0 },
  );
}

export function createProjectAgentTools(store: StoreService): AgentTool[] {
  return [
    {
      name: 'list_projects',
      schema: {
        type: 'function',
        function: {
          name: 'list_projects',
          description:
            'List project ledgers with ids, names, descriptions and money totals. Use first for questions about projects, payments, vendor spend, budgets, costs, or addresses/numbers that may be project names.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      },
      execute() {
        return {
          ok: true,
          projects: store.listProjects().map(project => ({
            id: project.id,
            name: project.name,
            description: project.description,
            status: project.status,
            totals: project.totals,
          })),
        };
      },
    },
    {
      name: 'read_project',
      schema: {
        type: 'function',
        function: {
          name: 'read_project',
          description:
            'Read a project ledger by id or name. Use query to filter line items by vendor, description, invoice, notes, amount, linked document, or category, e.g. project "4190" with query "Costco". Returns filtered totals and compact line items.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              project: { type: 'string', description: 'Project id or project name/address, such as "4190".' },
              query: { type: 'string', description: 'Optional filter for vendor, description, invoice, notes, amount or document name.' },
              limit: { type: 'number', description: 'Maximum line items to return, 1-80. Defaults to 40.' },
            },
            required: ['project'],
          },
        },
      },
      execute(args) {
        const key = text(args.project);
        if (!key) return { ok: false, error: 'project is required' };

        const detail = matchingProject(store, key);
        if (!detail) return { ok: false, error: `Project not found: ${key}` };

        const query = text(args.query);
        const limit = numberArg(args.limit, DEFAULT_ITEM_LIMIT, 1, 80);
        const matched = query
          ? detail.items.filter(item => {
              const linkedDoc = item.documentId ? store.getDocument(item.documentId) : undefined;
              return includesAllTerms(lineHaystack(item, linkedDoc?.originalName), query);
            })
          : detail.items;
        const returned = matched.slice(0, limit);

        return {
          ok: true,
          project: {
            id: detail.id,
            name: detail.name,
            description: detail.description,
            status: detail.status,
            totals: detail.totals,
          },
          query: query || undefined,
          matchedItemCount: matched.length,
          returnedItemCount: returned.length,
          filteredTotals: totals(matched),
          items: returned.map(item => compactLineItem(store, item)),
          truncated: matched.length > returned.length,
        };
      },
    },
  ];
}

