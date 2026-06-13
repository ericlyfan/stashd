import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { LineItem, LineItemInput, Project } from '@stashd/shared';
import { StoreService } from '../services/StoreService';

interface Services {
  store: StoreService;
}

// Text fields: trim and treat empty as cleared (undefined). Anything not a
// string is ignored.
function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// Money / quantity fields: accept a finite number or a numeric string; empty or
// unparseable becomes undefined (cleared).
function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Builds a LineItemInput that contains a key only when the request supplied it,
// so PATCH stays a true partial update. `documentId` resolves to a real
// document id, an explicit null (clear), or is omitted (left untouched).
function readLineItemInput(body: Record<string, unknown>, store: StoreService): LineItemInput {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const input: LineItemInput = {};
  if (has('category')) input.category = cleanText(body.category);
  if (has('vendor')) input.vendor = cleanText(body.vendor);
  if (has('description')) input.description = cleanText(body.description) ?? '';
  if (has('quantity')) input.quantity = cleanNumber(body.quantity);
  if (has('datePaid')) input.datePaid = cleanText(body.datePaid);
  if (has('invoiceNumber')) input.invoiceNumber = cleanText(body.invoiceNumber);
  if (has('amountRequested')) input.amountRequested = cleanNumber(body.amountRequested);
  if (has('amountPaid')) input.amountPaid = cleanNumber(body.amountPaid);
  if (has('taxAmount')) input.taxAmount = cleanNumber(body.taxAmount);
  if (has('totalPaid')) input.totalPaid = cleanNumber(body.totalPaid);
  if (has('status')) input.status = cleanText(body.status);
  if (has('notes')) input.notes = cleanText(body.notes);
  if (has('documentId')) {
    const id = cleanText(body.documentId);
    // Only honor a link to a document that actually exists; otherwise clear it.
    input.documentId = id && store.getDocument(id) ? id : null;
  }
  return input;
}

export function createProjectRoutes(services: Services): Router {
  const { store } = services;
  const router = Router();

  // GET /api/projects — all projects with their money rollups
  router.get('/', (_req, res) => {
    res.json(store.listProjects());
  });

  // POST /api/projects — create a project
  router.post('/', (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'A project name is required' });
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: uuidv4(),
      name: name.trim(),
      description: cleanText(description),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    store.addProject(project);
    res.status(201).json({ ...project, totals: { itemCount: 0, requested: 0, paid: 0, tax: 0, total: 0 } });
  });

  // The document → ledger link direction. Declared before "/:id" so the literal
  // path wins over the param route.
  // GET /api/projects/by-document/:docId
  router.get('/by-document/:docId', (req, res) => {
    res.json(store.getDocumentLinks(req.params.docId));
  });

  // GET /api/projects/:id — project detail with line items
  router.get('/:id', (req, res) => {
    const detail = store.getProjectDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Project not found' });
    res.json(detail);
  });

  // PATCH /api/projects/:id — rename / re-describe / archive
  router.patch('/:id', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, status } = req.body as {
      name?: string;
      description?: string;
      status?: string;
    };
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'A project name can’t be blank' });
    }
    if (status !== undefined && status !== 'active' && status !== 'archived') {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = store.updateProject(project.id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: cleanText(description) }),
      ...(status !== undefined && { status }),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ...updated!, totals: store.getProjectDetail(project.id)!.totals });
  });

  // DELETE /api/projects/:id — remove the project and all its line items
  router.delete('/:id', (req, res) => {
    if (!store.removeProject(req.params.id)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(204).end();
  });

  // POST /api/projects/:id/items — add a line item
  router.post('/:id/items', (req, res) => {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const input = readLineItemInput((req.body ?? {}) as Record<string, unknown>, store);
    const now = new Date().toISOString();
    const item: LineItem = {
      id: uuidv4(),
      projectId: project.id,
      description: input.description ?? '',
      category: input.category,
      vendor: input.vendor,
      quantity: input.quantity,
      datePaid: input.datePaid,
      invoiceNumber: input.invoiceNumber,
      amountRequested: input.amountRequested,
      amountPaid: input.amountPaid,
      taxAmount: input.taxAmount,
      totalPaid: input.totalPaid,
      status: input.status,
      notes: input.notes,
      documentId: input.documentId ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    store.addLineItem(item);
    store.updateProject(project.id, { updatedAt: now });
    res.status(201).json(item);
  });

  // PATCH /api/projects/:id/items/:itemId — update a line item
  router.patch('/:id/items/:itemId', (req, res) => {
    const item = store.getLineItem(req.params.itemId);
    if (!item || item.projectId !== req.params.id) {
      return res.status(404).json({ error: 'Line item not found' });
    }
    const input = readLineItemInput((req.body ?? {}) as Record<string, unknown>, store);
    const now = new Date().toISOString();
    const updated = store.updateLineItem(item.id, { ...input, updatedAt: now });
    store.updateProject(item.projectId, { updatedAt: now });
    res.json(updated);
  });

  // DELETE /api/projects/:id/items/:itemId — remove a line item
  router.delete('/:id/items/:itemId', (req, res) => {
    const item = store.getLineItem(req.params.itemId);
    if (!item || item.projectId !== req.params.id) {
      return res.status(404).json({ error: 'Line item not found' });
    }
    store.removeLineItem(item.id);
    store.updateProject(item.projectId, { updatedAt: new Date().toISOString() });
    res.status(204).end();
  });

  return router;
}
