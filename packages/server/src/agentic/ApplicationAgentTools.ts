import { JobApplicationInput, WorkMode } from '@stashd/shared';
import { AgentTool } from './AgenticWorkflow';
import { StoreService } from '../services/StoreService';
import {
  createJobApplication,
  loadApplicationsSnapshot,
  moveJobApplication,
  resolveApplication,
  resolveStage,
} from '../services/applications';

// Job-application tools for the agentic loop: get_applications (read) plus
// the explicitly-gated writes add_application / move_application /
// update_application. Compact JSON so results don't blow the context budget;
// errors return as objects for the tool message.

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanMode(value: unknown): WorkMode | undefined {
  const mode = cleanText(value)?.toLowerCase();
  return ['remote', 'hybrid', 'onsite'].includes(mode ?? '') ? (mode as WorkMode) : undefined;
}

export function createApplicationAgentTools(store: StoreService): AgentTool[] {
  return [
    {
      name: 'get_applications',
      schema: {
        type: 'function',
        function: {
          name: 'get_applications',
          description:
            "Read the user's job-application tracker: every application with its company, role, current pipeline stage, applied date, days in stage and staleness flag, plus pipeline-wide stats (active count, response rate, interview rate, offers, follow-ups needed). Use for any question about the user's job search, applications, interviews, or offers.",
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      },
      async execute() {
        const snap = loadApplicationsSnapshot(store);
        const pct = (v?: number) => (v === undefined ? undefined : +(v * 100).toFixed(1));
        return {
          ok: true,
          stats: {
            total: snap.stats.total,
            active: snap.stats.active,
            appliedThisMonth: snap.stats.appliedThisMonth,
            responseRatePct: pct(snap.stats.responseRate),
            interviewRatePct: pct(snap.stats.interviewRate),
            offers: snap.stats.offers,
            needsFollowUp: snap.stats.needsFollowUp,
          },
          pipeline: snap.stages.map(s => `${s.name}${s.isTerminal ? ' (closed)' : ''}`),
          applications: snap.applications.map(a => ({
            company: a.company,
            role: a.role,
            stage: a.stage?.name ?? a.stageId,
            applied: a.appliedDate,
            daysInStage: a.daysInStage,
            lastActivity: a.lastActivityAt?.slice(0, 10),
            needsFollowUp: a.stale || undefined,
            source: a.source,
            location: a.location,
            workMode: a.workMode,
            compensation: a.compensation,
            notes: a.notes?.slice(0, 200),
          })),
        };
      },
    },
    {
      name: 'add_application',
      schema: {
        type: 'function',
        function: {
          name: 'add_application',
          description:
            'Track a new job application. Only call when the user explicitly says they applied somewhere or asks to add/record an application.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              company: { type: 'string', description: 'The company name' },
              role: { type: 'string', description: 'The role / job title' },
              url: { type: 'string', description: 'Job posting URL' },
              location: { type: 'string' },
              work_mode: { type: 'string', description: 'remote | hybrid | onsite' },
              source: { type: 'string', description: 'Where it came from: Referral, LinkedIn, Recruiter…' },
              compensation: { type: 'string', description: 'Salary / comp info as free text' },
              applied_date: { type: 'string', description: 'ISO date applied (YYYY-MM-DD); defaults to today' },
              notes: { type: 'string' },
            },
            required: ['company', 'role'],
          },
        },
      },
      async execute(args) {
        const company = cleanText(args.company);
        const role = cleanText(args.role);
        if (!company || !role) return { ok: false, error: 'Both company and role are required' };
        const app = createJobApplication(store, {
          company,
          role,
          url: cleanText(args.url),
          location: cleanText(args.location),
          workMode: cleanMode(args.work_mode),
          source: cleanText(args.source),
          compensation: cleanText(args.compensation),
          appliedDate: cleanText(args.applied_date),
          notes: cleanText(args.notes),
        });
        const stageName = store.getApplicationStage(app.stageId)?.name ?? app.stageId;
        return { ok: true, application: { id: app.id, company: app.company, role: app.role, stage: stageName, applied: app.appliedDate } };
      },
    },
    {
      name: 'move_application',
      schema: {
        type: 'function',
        function: {
          name: 'move_application',
          description:
            "Move a job application to another pipeline stage (e.g. mark it Interviewing, Offer, or Rejected). Appends to its status history. Only call when the user explicitly asks to update an application's status.",
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              application: { type: 'string', description: 'The application: its company name (or company + role, or id)' },
              stage: { type: 'string', description: 'The target stage name (see get_applications for the pipeline)' },
              note: { type: 'string', description: 'Optional note to record with the change' },
            },
            required: ['application', 'stage'],
          },
        },
      },
      async execute(args) {
        const app = resolveApplication(store, String(args.application ?? ''));
        if (!app) return { ok: false, error: 'Could not find exactly one matching application — check get_applications and be more specific' };
        const stage = resolveStage(store, String(args.stage ?? ''));
        if (!stage) return { ok: false, error: 'Unknown stage — the pipeline stages are listed by get_applications' };
        if (app.stageId === stage.id) return { ok: false, error: `${app.company} is already in ${stage.name}` };
        moveJobApplication(store, app.id, stage, cleanText(args.note));
        return { ok: true, application: { company: app.company, role: app.role, stage: stage.name } };
      },
    },
    {
      name: 'update_application',
      schema: {
        type: 'function',
        function: {
          name: 'update_application',
          description:
            "Edit a job application's fields: notes, compensation, location, URL, source, work mode, applied date, company or role. Cannot change the stage — use move_application for that. Only call when the user explicitly asks for a change.",
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              application: { type: 'string', description: 'The application: its company name (or company + role, or id)' },
              company: { type: 'string' },
              role: { type: 'string' },
              url: { type: 'string' },
              location: { type: 'string' },
              work_mode: { type: 'string', description: 'remote | hybrid | onsite' },
              source: { type: 'string' },
              compensation: { type: 'string' },
              applied_date: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
              notes: { type: 'string', description: 'Replaces the notes field' },
            },
            required: ['application'],
          },
        },
      },
      async execute(args) {
        const app = resolveApplication(store, String(args.application ?? ''));
        if (!app) return { ok: false, error: 'Could not find exactly one matching application — check get_applications and be more specific' };
        const input: Omit<JobApplicationInput, 'stageId' | 'documentId'> = {};
        if (cleanText(args.company)) input.company = cleanText(args.company);
        if (cleanText(args.role)) input.role = cleanText(args.role);
        if (cleanText(args.url)) input.url = cleanText(args.url);
        if (cleanText(args.location)) input.location = cleanText(args.location);
        const mode = cleanMode(args.work_mode);
        if (mode) input.workMode = mode;
        if (cleanText(args.source)) input.source = cleanText(args.source);
        if (cleanText(args.compensation)) input.compensation = cleanText(args.compensation);
        if (cleanText(args.applied_date)) input.appliedDate = cleanText(args.applied_date);
        if (cleanText(args.notes)) input.notes = cleanText(args.notes);
        const changed = Object.keys(input);
        if (changed.length === 0) return { ok: false, error: 'No editable fields were provided' };
        store.updateJobApplication(app.id, { ...input, updatedAt: new Date().toISOString() });
        return { ok: true, application: { company: input.company ?? app.company, role: input.role ?? app.role }, changed };
      },
    },
  ];
}
