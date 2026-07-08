import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  ApplicationContact,
  ApplicationContactInput,
  ApplicationDetail,
  ApplicationStage,
  ApplicationStageInput,
  JobApplicationInput,
  StageKind,
  WorkMode,
  COLOR_PALETTE,
} from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import {
  createJobApplication,
  loadApplicationsSnapshot,
  moveJobApplication,
  realignApplicationStage,
} from '../services/applications';

interface Services {
  store: StoreService;
}

const WORK_MODES: WorkMode[] = ['remote', 'hybrid', 'onsite'];
const STAGE_KINDS: StageKind[] = ['applied', 'screen', 'interview', 'offer', 'rejected', 'withdrawn'];

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// YYYY-MM-DD (a date input's value); anything else is dropped.
function cleanDate(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) return undefined;
  return text;
}

// Any parseable timestamp, normalized to ISO (event occurredAt is backdatable).
function cleanTimestamp(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function createApplicationRoutes(services: Services): Router {
  const { store } = services;
  const router = Router();

  // The editable application fields from a request body (the readLineItemInput
  // pattern): only keys present on the body land on the input, `documentId:
  // null` clears the link, and a documentId is only honored when the document
  // actually exists.
  function readApplicationInput(body: Record<string, unknown>): Omit<JobApplicationInput, 'stageId'> {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const input: Omit<JobApplicationInput, 'stageId'> = {};
    if (has('company')) input.company = cleanText(body.company);
    if (has('role')) input.role = cleanText(body.role);
    if (has('url')) input.url = cleanText(body.url);
    if (has('location')) input.location = cleanText(body.location);
    if (has('workMode')) {
      const mode = cleanText(body.workMode)?.toLowerCase();
      input.workMode = WORK_MODES.includes(mode as WorkMode) ? (mode as WorkMode) : null;
    }
    if (has('description')) input.description = cleanText(body.description);
    if (has('source')) input.source = cleanText(body.source);
    if (has('compensation')) input.compensation = cleanText(body.compensation);
    if (has('appliedDate')) input.appliedDate = cleanDate(body.appliedDate);
    if (has('notes')) input.notes = cleanText(body.notes);
    if (has('documentId')) {
      const docId = cleanText(body.documentId);
      input.documentId = docId && store.getDocument(docId) ? docId : null;
    }
    return input;
  }

  // ── Stages (declared before /:id so "stages" isn't read as an id) ─────────

  // POST /api/applications/stages — add a pipeline stage
  router.post('/stages', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanText(body.name);
    if (!name) return res.status(400).json({ error: 'A stage name is required' });
    const existing = store.listApplicationStages();
    const kind = cleanText(body.kind)?.toLowerCase();
    const stage: ApplicationStage = {
      id: uuidv4(),
      name,
      position: existing.reduce((max, s) => Math.max(max, s.position), 0) + 1,
      color: cleanText(body.color) ?? COLOR_PALETTE[existing.length % COLOR_PALETTE.length],
      kind: STAGE_KINDS.includes(kind as StageKind) ? (kind as StageKind) : 'screen',
      isTerminal: body.isTerminal === true,
    };
    store.addApplicationStage(stage);
    res.status(201).json(stage);
  });

  // PATCH /api/applications/stages/reorder — persist a manual pipeline order
  router.patch('/stages/reorder', (req, res) => {
    const ids = (req.body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      return res.status(400).json({ error: 'ids must be an array of stage ids' });
    }
    store.reorderApplicationStages(ids as string[]);
    res.json(store.listApplicationStages());
  });

  // PATCH /api/applications/stages/:id — rename / recolor / re-kind / terminal
  router.patch('/stages/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const input: ApplicationStageInput = {};
    if (has('name')) input.name = cleanText(body.name);
    if (has('color')) input.color = cleanText(body.color);
    if (has('kind')) {
      const kind = cleanText(body.kind)?.toLowerCase();
      if (STAGE_KINDS.includes(kind as StageKind)) input.kind = kind as StageKind;
    }
    if (has('isTerminal')) input.isTerminal = body.isTerminal === true;
    const updated = store.updateApplicationStage(req.params.id, input);
    if (!updated) return res.status(404).json({ error: 'Stage not found' });
    res.json(updated);
  });

  // DELETE /api/applications/stages/:id — only when empty, never the last one
  router.delete('/stages/:id', (req, res) => {
    const stage = store.getApplicationStage(req.params.id);
    if (!stage) return res.status(404).json({ error: 'Stage not found' });
    const count = store.countApplicationsInStage(stage.id);
    if (count > 0) {
      return res.status(400).json({ error: `${count} application${count === 1 ? '' : 's'} still in "${stage.name}" — move them first` });
    }
    if (store.listApplicationStages().length <= 1) {
      return res.status(400).json({ error: 'The pipeline needs at least one stage' });
    }
    store.removeApplicationStage(stage.id);
    res.status(204).end();
  });

  // ── Applications ───────────────────────────────────────────────────────────

  // GET /api/applications — the whole tracker: enriched applications + stages + stats
  router.get('/', (_req, res) => {
    res.json(loadApplicationsSnapshot(store));
  });

  // POST /api/applications — create; writes the initial status event
  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = readApplicationInput(body);
    if (!input.company || !input.role) {
      return res.status(400).json({ error: 'Company and role are required' });
    }
    if (store.listApplicationStages().length === 0) {
      return res.status(400).json({ error: 'No pipeline stages exist' });
    }
    const app = createJobApplication(store, {
      ...input,
      company: input.company,
      role: input.role,
      workMode: input.workMode ?? undefined,
      documentId: input.documentId ?? undefined,
      stageId: cleanText(body.stageId),
    });
    res.status(201).json(app);
  });

  // GET /api/applications/:id — detail: enriched application + events + contacts
  router.get('/:id', (req, res) => {
    const snapshot = loadApplicationsSnapshot(store);
    const app = snapshot.applications.find(a => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const detail: ApplicationDetail = {
      ...app,
      events: store.listApplicationEvents(app.id),
      contacts: store.listApplicationContacts(app.id),
    };
    res.json(detail);
  });

  // PATCH /api/applications/:id — edit fields (the stage changes via /events)
  router.patch('/:id', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = store.updateJobApplication(req.params.id, {
      ...readApplicationInput(body),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Application not found' });
    res.json(updated);
  });

  // DELETE /api/applications/:id — cascades events + contacts
  router.delete('/:id', (req, res) => {
    if (!store.removeJobApplication(req.params.id)) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.status(204).end();
  });

  // ── Status events ──────────────────────────────────────────────────────────

  // POST /api/applications/:id/events — move to a stage (the board-drag endpoint)
  router.post('/:id/events', (req, res) => {
    const app = store.getJobApplication(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stageId = cleanText(body.stageId);
    const stage = stageId ? store.getApplicationStage(stageId) : undefined;
    if (!stage) return res.status(400).json({ error: 'A valid stageId is required' });

    // The new event may be backdated behind an existing one, so the current
    // stage follows whichever event is latest, not necessarily this one.
    const event = moveJobApplication(store, app.id, stage, cleanText(body.note), cleanTimestamp(body.occurredAt));
    res.status(201).json(event);
  });

  // PATCH /api/applications/:id/events/:eventId — fix a date / note
  router.patch('/:id/events/:eventId', (req, res) => {
    const existing = store.getApplicationEvent(req.params.eventId);
    if (!existing || existing.applicationId !== req.params.id) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const input: { occurredAt?: string; note?: string } = {};
    if (has('occurredAt')) {
      const ts = cleanTimestamp(body.occurredAt);
      if (!ts) return res.status(400).json({ error: 'occurredAt must be a valid date' });
      input.occurredAt = ts;
    }
    if (has('note')) input.note = cleanText(body.note) ?? '';
    const updated = store.updateApplicationEvent(existing.id, input);
    realignApplicationStage(store, req.params.id);
    res.json(updated);
  });

  // DELETE /api/applications/:id/events/:eventId — undo a mis-drag
  router.delete('/:id/events/:eventId', (req, res) => {
    const existing = store.getApplicationEvent(req.params.eventId);
    if (!existing || existing.applicationId !== req.params.id) {
      return res.status(404).json({ error: 'Event not found' });
    }
    store.removeApplicationEvent(existing.id);
    realignApplicationStage(store, req.params.id);
    res.status(204).end();
  });

  // ── Contacts ───────────────────────────────────────────────────────────────

  function readContactInput(body: Record<string, unknown>): ApplicationContactInput {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const input: ApplicationContactInput = {};
    if (has('name')) input.name = cleanText(body.name);
    if (has('title')) input.title = cleanText(body.title);
    if (has('email')) input.email = cleanText(body.email);
    if (has('url')) input.url = cleanText(body.url);
    if (has('notes')) input.notes = cleanText(body.notes);
    return input;
  }

  // POST /api/applications/:id/contacts
  router.post('/:id/contacts', (req, res) => {
    const app = store.getJobApplication(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const input = readContactInput((req.body ?? {}) as Record<string, unknown>);
    if (!input.name) return res.status(400).json({ error: 'A contact name is required' });
    const contact: ApplicationContact = {
      id: uuidv4(),
      applicationId: app.id,
      name: input.name,
      title: input.title,
      email: input.email,
      url: input.url,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    store.addApplicationContact(contact);
    res.status(201).json(contact);
  });

  // PATCH /api/applications/:id/contacts/:contactId
  router.patch('/:id/contacts/:contactId', (req, res) => {
    const existing = store.getApplicationContact(req.params.contactId);
    if (!existing || existing.applicationId !== req.params.id) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const updated = store.updateApplicationContact(existing.id, readContactInput((req.body ?? {}) as Record<string, unknown>));
    res.json(updated);
  });

  // DELETE /api/applications/:id/contacts/:contactId
  router.delete('/:id/contacts/:contactId', (req, res) => {
    const existing = store.getApplicationContact(req.params.contactId);
    if (!existing || existing.applicationId !== req.params.id) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    store.removeApplicationContact(existing.id);
    res.status(204).end();
  });

  return router;
}
