import { v4 as uuidv4 } from 'uuid';
import {
  ApplicationEvent,
  ApplicationStage,
  ApplicationStats,
  ApplicationsSnapshot,
  EnrichedApplication,
  JobApplication,
  JobApplicationInput,
  StageKind,
} from '@stashd/shared';
import { StoreService } from './StoreService';

// Applications snapshot assembly, shared by the applications route and the
// chat's get_applications tool (the services/portfolio.ts pattern). Pure
// computation lives in buildApplicationsSnapshot; loadApplicationsSnapshot
// does the store fetching around it.

// An active application with no status event for this many days needs a
// follow-up (the "Needs follow-up" KPI tile + row/card markers).
export const STALE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

// Stage kinds that count as "the company responded" — a rejection is a
// response; a withdrawal or silence isn't.
const RESPONSE_KINDS: StageKind[] = ['screen', 'interview', 'offer', 'rejected'];
// Kinds that count as "reached an interview" (offer implies one).
const INTERVIEW_KINDS: StageKind[] = ['interview', 'offer'];

// The stage kinds an application has ever entered, read from its event history
// via the stage table (events whose stage was since deleted are skipped —
// their kind is unknowable).
function kindsReached(events: ApplicationEvent[], stageById: Map<string, ApplicationStage>): Set<StageKind> {
  const kinds = new Set<StageKind>();
  for (const event of events) {
    const stage = event.stageId ? stageById.get(event.stageId) : undefined;
    if (stage) kinds.add(stage.kind);
  }
  return kinds;
}

// Enrich each application with its resolved stage and history-derived fields,
// then roll the pipeline up into the KPI stats. Pure — events come in newest
// first (as StoreService returns them).
export function buildApplicationsSnapshot(
  applications: JobApplication[],
  stages: ApplicationStage[],
  eventsByApplication: Map<string, ApplicationEvent[]>,
  contactCounts: Map<string, number>,
  now = new Date(),
): ApplicationsSnapshot {
  const stageById = new Map(stages.map(s => [s.id, s]));
  const thisMonth = now.toISOString().slice(0, 7); // YYYY-MM

  let active = 0;
  let appliedThisMonth = 0;
  let responded = 0;
  let interviewed = 0;
  let offers = 0;
  let needsFollowUp = 0;

  const enriched: EnrichedApplication[] = applications.map(app => {
    const stage = stageById.get(app.stageId);
    const events = eventsByApplication.get(app.id) ?? [];
    const lastActivityAt = events[0]?.occurredAt;
    // Staleness is measured from the latest status event; an application that
    // somehow has none falls back to its creation time.
    const lastMs = Date.parse(lastActivityAt ?? app.createdAt);
    const daysSince = Number.isNaN(lastMs) ? undefined : Math.max(0, Math.floor((now.getTime() - lastMs) / MS_PER_DAY));
    const isActive = !(stage?.isTerminal ?? false);
    const stale = isActive && daysSince !== undefined && daysSince >= STALE_DAYS;

    if (isActive) active += 1;
    if (app.appliedDate?.startsWith(thisMonth)) appliedThisMonth += 1;
    const kinds = kindsReached(events, stageById);
    if (RESPONSE_KINDS.some(k => kinds.has(k))) responded += 1;
    if (INTERVIEW_KINDS.some(k => kinds.has(k))) interviewed += 1;
    if (kinds.has('offer')) offers += 1;
    if (stale) needsFollowUp += 1;

    return {
      ...app,
      stage,
      lastActivityAt,
      daysInStage: daysSince,
      eventCount: events.length,
      contactCount: contactCounts.get(app.id) ?? 0,
      stale,
    };
  });

  const total = applications.length;
  const stats: ApplicationStats = {
    total,
    active,
    appliedThisMonth,
    responseRate: total > 0 ? responded / total : undefined,
    interviewRate: total > 0 ? interviewed / total : undefined,
    offers,
    needsFollowUp,
  };

  return { applications: enriched, stages, stats };
}

// Fetch everything a snapshot needs and build it.
export function loadApplicationsSnapshot(store: StoreService): ApplicationsSnapshot {
  return buildApplicationsSnapshot(
    store.listJobApplications(),
    store.listApplicationStages(),
    store.listAllApplicationEvents(),
    store.applicationContactCounts(),
  );
}

// ── Actions (shared by the route and the chat tools) ─────────────────────────

// Create an application plus its opening history event. `fields.stageId` is
// honored when it names a real stage, else the first non-terminal stage.
// Throws when the pipeline is empty (can't place the application anywhere).
export function createJobApplication(
  store: StoreService,
  fields: Omit<JobApplicationInput, 'documentId'> & { company: string; role: string; documentId?: string },
): JobApplication {
  const stages = store.listApplicationStages();
  if (stages.length === 0) throw new Error('No pipeline stages exist');
  const stage = (fields.stageId && store.getApplicationStage(fields.stageId)) || stages.find(s => !s.isTerminal) || stages[0];

  const now = new Date().toISOString();
  const app: JobApplication = {
    id: uuidv4(),
    company: fields.company,
    role: fields.role,
    url: fields.url,
    location: fields.location,
    workMode: fields.workMode ?? undefined,
    description: fields.description,
    source: fields.source,
    compensation: fields.compensation,
    stageId: stage.id,
    // Default to the server's *local* calendar date — the UTC date is
    // tomorrow for an evening user west of Greenwich.
    appliedDate: fields.appliedDate ?? new Date().toLocaleDateString('en-CA'),
    documentId: fields.documentId,
    notes: fields.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.addJobApplication(app);
  // The opening history entry, dated to the applied date so stage durations
  // start from when the application actually went out — but never stamped in
  // the future (noon UTC of "today" can be hours ahead), or every later
  // stage-change event would sort before it and realignApplicationStage would
  // snap the application straight back to this stage.
  const openedAt = Date.parse(`${app.appliedDate}T12:00:00Z`);
  store.addApplicationEvent({
    id: uuidv4(),
    applicationId: app.id,
    stageId: stage.id,
    stageName: stage.name,
    occurredAt: !Number.isNaN(openedAt) && openedAt < Date.now() ? new Date(openedAt).toISOString() : now,
  });
  return app;
}

// The application's current stage follows whichever event is latest — called
// after any event append/edit/delete (kept when that stage was since deleted,
// or when no events remain).
export function realignApplicationStage(store: StoreService, applicationId: string): void {
  const latest = store.listApplicationEvents(applicationId)[0];
  if (latest?.stageId && store.getApplicationStage(latest.stageId)) {
    store.setJobApplicationStage(applicationId, latest.stageId, new Date().toISOString());
  }
}

// Move an application to a stage by appending a status event (never a direct
// stage write), then re-derive the current stage.
export function moveJobApplication(
  store: StoreService,
  applicationId: string,
  stage: ApplicationStage,
  note?: string,
  occurredAt?: string,
): ApplicationEvent {
  const event: ApplicationEvent = {
    id: uuidv4(),
    applicationId,
    stageId: stage.id,
    stageName: stage.name,
    occurredAt: occurredAt ?? new Date().toISOString(),
    note,
  };
  store.addApplicationEvent(event);
  realignApplicationStage(store, applicationId);
  return event;
}

// ── Loose reference resolution (for the chat tools) ─────────────────────────

// Resolve "the Shopify application" / an id / an id prefix / "company role"
// text to one application. Returns undefined when nothing (or more than one
// thing) matches, so the model has to be more specific rather than acting on
// a guess.
export function resolveApplication(store: StoreService, ref: string): JobApplication | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  const all = store.listJobApplications();
  const byId = all.find(a => a.id === needle) ?? all.filter(a => a.id.startsWith(needle));
  if (!Array.isArray(byId)) return byId;
  if (byId.length === 1) return byId[0];

  const matches = all.filter(a =>
    a.company.toLowerCase().includes(needle) ||
    needle.includes(a.company.toLowerCase()) ||
    `${a.company} ${a.role}`.toLowerCase().includes(needle),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

// Resolve a stage by id or (unique, case-insensitive) name / name prefix.
export function resolveStage(store: StoreService, ref: string): ApplicationStage | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  const stages = store.listApplicationStages();
  const byId = stages.find(s => s.id.toLowerCase() === needle);
  if (byId) return byId;
  const exact = stages.filter(s => s.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const prefixed = stages.filter(s => s.name.toLowerCase().startsWith(needle));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}
