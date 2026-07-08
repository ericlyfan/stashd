import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  ApplicationContact,
  ApplicationContactInput,
  ApplicationEvent,
  ApplicationStage,
  EnrichedApplication,
  JobApplicationInput,
  WorkMode,
} from '@stashd/shared';
import {
  addApplicationContact,
  addApplicationEvent,
  deleteApplicationContact,
  deleteApplicationEvent,
  getApplication,
  updateApplicationContact,
  updateApplicationEvent,
} from '../api';
import { useStore } from '../store';
import { formatDate } from '../lib/format';
import DocumentBrowser from './DocumentBrowser';

// The wide two-pane application dialog: the editable form up top, and — when
// editing — a status-history timeline and the contacts list side by side
// below. The parent owns the main save/delete (the HoldingDialog convention);
// the dialog itself owns the event/contact sub-entities, refetching its own
// detail and pinging `onMutated` so the page's snapshot stays current.

interface Props {
  application?: EnrichedApplication; // present when editing, absent when adding
  stages: ApplicationStage[];
  sources: string[]; // previously-used source values, for the datalist
  busy?: boolean;
  // `input.stageId` carries the picked stage; on edit the parent turns a stage
  // change into a status event (never a PATCH) so history stays truthful.
  onSave: (input: JobApplicationInput) => void;
  onDelete?: () => void;
  onClose: () => void;
  onMutated?: () => void;
}

const DEFAULT_SOURCES = ['Referral', 'LinkedIn', 'Company site', 'Recruiter', 'Job board'];
const MS_PER_DAY = 86_400_000;

function daysBetween(newerIso: string, olderIso: string): number | undefined {
  const a = Date.parse(newerIso);
  const b = Date.parse(olderIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.max(0, Math.round((a - b) / MS_PER_DAY));
}

// A date-input value (YYYY-MM-DD) from an ISO timestamp, and back (noon UTC so
// the calendar day survives timezone display). Both directions use the *local*
// calendar day — slicing the ISO string would show tomorrow's date to an
// evening user west of Greenwich.
function isoToDateInput(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}
function dateInputToIso(date: string): string {
  return new Date(`${date}T12:00:00Z`).toISOString();
}

export default function ApplicationDialog({ application, stages, sources, busy, onSave, onDelete, onClose, onMutated }: Props) {
  const { docs, notify } = useStore();

  const [company, setCompany] = useState(application?.company ?? '');
  const [role, setRole] = useState(application?.role ?? '');
  const [url, setUrl] = useState(application?.url ?? '');
  const [location, setLocation] = useState(application?.location ?? '');
  const [workMode, setWorkMode] = useState<string>(application?.workMode ?? '');
  const [source, setSource] = useState(application?.source ?? '');
  const [compensation, setCompensation] = useState(application?.compensation ?? '');
  const [appliedDate, setAppliedDate] = useState(application?.appliedDate ?? new Date().toLocaleDateString('en-CA'));
  const [stageId, setStageId] = useState(application?.stageId ?? stages.find(s => !s.isTerminal)?.id ?? stages[0]?.id ?? '');
  const [description, setDescription] = useState(application?.description ?? '');
  const [notes, setNotes] = useState(application?.notes ?? '');
  const [documentId, setDocumentId] = useState<string | undefined>(application?.documentId);
  const [browserOpen, setBrowserOpen] = useState(false);

  // Edit mode: the timeline + contacts, fetched (and refetched after each
  // sub-entity mutation) from the detail endpoint.
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [contacts, setContacts] = useState<ApplicationContact[]>([]);
  const appId = application?.id;

  const reloadDetail = useCallback(async () => {
    if (!appId) return;
    try {
      const detail = await getApplication(appId);
      setEvents(detail.events);
      setContacts(detail.contacts);
    } catch {
      // The dialog stays usable on the form alone.
    }
  }, [appId]);

  useEffect(() => {
    void reloadDetail();
  }, [reloadDetail]);

  const stageById = new Map(stages.map(s => [s.id, s]));
  const sourceOptions = [...new Set([...DEFAULT_SOURCES, ...sources])];
  const linkedDoc = docs.find(d => d.id === documentId);

  function submit() {
    onSave({
      company: company.trim(),
      role: role.trim(),
      url: url.trim(),
      location: location.trim(),
      workMode: (workMode || null) as WorkMode | null,
      source: source.trim(),
      compensation: compensation.trim(),
      appliedDate: appliedDate || undefined,
      stageId,
      description: description.trim(),
      notes: notes.trim(),
      documentId: documentId ?? null,
    });
  }

  async function mutate(fn: () => Promise<unknown>, errFallback: string) {
    try {
      await fn();
      await reloadDetail();
      onMutated?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : errFallback, 'err');
    }
  }

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`dialog app-dialog${application ? ' app-dialog-wide' : ''}`} role="dialog" aria-label={application ? 'Edit application' : 'New application'}>
        <div className="li-dialog-head">
          <h3>{application ? <>Application · <span className="h-ticker">{application.company}</span></> : 'New application'}</h3>
          <button className="li-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="li-dialog-body">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="app-company">Company</label>
              <input id="app-company" className="input" value={company} autoFocus={!application} placeholder="e.g. Shopify" onChange={e => setCompany(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="app-role">Role / title</label>
              <input id="app-role" className="input" value={role} placeholder="e.g. Staff Engineer" onChange={e => setRole(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="app-url">Job posting URL <span className="field-opt">optional</span></label>
            <input id="app-url" className="input" type="url" value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)} />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="app-location">Location</label>
              <input id="app-location" className="input" value={location} placeholder="e.g. Toronto, ON" onChange={e => setLocation(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="app-mode">Work mode</label>
              <select id="app-mode" className="input" value={workMode} onChange={e => setWorkMode(e.target.value)}>
                <option value="">—</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="app-source">Source</label>
              <input id="app-source" className="input" list="app-sources" value={source} placeholder="Referral, LinkedIn…" onChange={e => setSource(e.target.value)} />
              <datalist id="app-sources">
                {sourceOptions.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="app-comp">Compensation <span className="field-opt">optional</span></label>
              <input id="app-comp" className="input" value={compensation} placeholder="e.g. 180–220k CAD + equity" onChange={e => setCompensation(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="app-applied">Applied date</label>
              <input id="app-applied" className="input" type="date" value={appliedDate} onChange={e => setAppliedDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="app-stage">Stage</label>
              <select id="app-stage" className="input" value={stageId} onChange={e => setStageId(e.target.value)}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <details className="app-jd" open={!!description && !application}>
            <summary>Job description {description.trim() ? '' : <span className="field-opt">empty</span>}</summary>
            <textarea
              className="textarea app-jd-text"
              value={description}
              rows={7}
              placeholder="Paste the posting here so it survives the listing being taken down…"
              onChange={e => setDescription(e.target.value)}
            />
          </details>

          <div className="field">
            <label className="field-label" htmlFor="app-notes">Notes</label>
            <textarea id="app-notes" className="textarea" value={notes} rows={2} placeholder="Prep notes, impressions, follow-up reminders…" onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Supporting document</label>
            {linkedDoc ? (
              <div className="li-doc-row">
                <div className="li-doc-link">
                  <FileText size={13} />
                  <span className="li-doc-name">{linkedDoc.originalName}</span>
                  <button type="button" aria-label="Unlink document" onClick={() => setDocumentId(undefined)}>
                    <X size={12} />
                  </button>
                </div>
                <button type="button" className="li-doc-change" onClick={() => setBrowserOpen(true)}>
                  Change
                </button>
              </div>
            ) : documentId ? (
              <div className="li-doc-link dangling">
                <FileText size={13} />
                <span className="li-doc-name">Linked document (no longer in the stash)</span>
                <button type="button" aria-label="Clear link" onClick={() => setDocumentId(undefined)}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="pin-picker">
                <button type="button" className="pin-add" onClick={() => setBrowserOpen(true)}>
                  <Plus size={11} />
                  link a document
                </button>
                <span className="li-doc-hint">
                  <Link2 size={11} />
                  optional — the resume you sent, the JD, an offer letter
                </span>
              </div>
            )}
          </div>

          {application && (
            <div className="app-dialog-panes">
              <TimelinePane
                applicationId={application.id}
                events={events}
                stageById={stageById}
                onMutate={mutate}
              />
              <ContactsPane
                applicationId={application.id}
                contacts={contacts}
                onMutate={mutate}
              />
            </div>
          )}
        </div>

        {browserOpen && (
          <DocumentBrowser
            current={documentId}
            onPick={id => {
              setDocumentId(id);
              setBrowserOpen(false);
            }}
            onClose={() => setBrowserOpen(false)}
          />
        )}

        <div className="li-dialog-foot">
          {application && onDelete && (
            <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !company.trim() || !role.trim()}>
            {busy ? 'Saving…' : application ? 'Save changes' : 'Add application'}
          </button>
        </div>
      </div>
    </div>
  );
}

type Mutate = (fn: () => Promise<unknown>, errFallback: string) => Promise<void>;

// The status-history timeline (newest first): stage dot + name + date, the
// computed time spent in each stage, and per-event date/note corrections.
function TimelinePane({
  applicationId,
  events,
  stageById,
  onMutate,
}: {
  applicationId: string;
  events: ApplicationEvent[];
  stageById: Map<string, ApplicationStage>;
  onMutate: Mutate;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  function beginEdit(event: ApplicationEvent) {
    setEditingId(event.id);
    setEditDate(isoToDateInput(event.occurredAt));
    setEditNote(event.note ?? '');
  }

  return (
    <div className="app-pane">
      <div className="app-pane-title">Timeline</div>
      <div className="app-timeline">
        {events.map((event, i) => {
          const stage = event.stageId ? stageById.get(event.stageId) : undefined;
          const spent = i === 0
            ? daysBetween(new Date().toISOString(), event.occurredAt)
            : daysBetween(events[i - 1].occurredAt, event.occurredAt);
          return (
            <div key={event.id} className="app-event">
              <span className="app-event-dot" style={{ background: stage?.color ?? 'var(--ink-3)' }} />
              {editingId === event.id ? (
                <div className="app-event-edit">
                  <input className="input" type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                  <input className="input" value={editNote} placeholder="note" onChange={e => setEditNote(e.target.value)} />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (!editDate) return;
                      void onMutate(
                        () => updateApplicationEvent(applicationId, event.id, { occurredAt: dateInputToIso(editDate), note: editNote }),
                        'Could not update the event',
                      ).then(() => setEditingId(null));
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="app-event-main">
                    <span className="app-event-stage">{event.stageName}</span>
                    <span className="app-event-date">{formatDate(event.occurredAt)}</span>
                    {spent !== undefined && (
                      <span className="app-event-spent">{i === 0 ? `${spent}d so far` : `${spent}d`}</span>
                    )}
                    {event.note && <span className="app-event-note">{event.note}</span>}
                  </div>
                  <div className="app-event-actions">
                    <button type="button" title="Edit date / note" onClick={() => beginEdit(event)}>
                      <Pencil size={11} />
                    </button>
                    {events.length > 1 && (
                      <button
                        type="button"
                        title="Delete this entry (undoes the stage change)"
                        onClick={() => void onMutate(() => deleteApplicationEvent(applicationId, event.id), 'Could not delete the event')}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {events.length === 0 && <div className="app-pane-empty">No history yet.</div>}
      </div>
    </div>
  );
}

// Recruiters / hiring managers / referrers for this application, with an
// inline add/edit form (no nested dialog).
function ContactsPane({
  applicationId,
  contacts,
  onMutate,
}: {
  applicationId: string;
  contacts: ApplicationContact[];
  onMutate: Mutate;
}) {
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' when adding
  const [form, setForm] = useState<ApplicationContactInput>({});

  function begin(contact?: ApplicationContact) {
    setEditingId(contact?.id ?? 'new');
    setForm(contact ? { name: contact.name, title: contact.title, email: contact.email, url: contact.url, notes: contact.notes } : {});
  }

  function saveForm() {
    if (!form.name?.trim()) return;
    const input: ApplicationContactInput = {
      name: form.name.trim(),
      title: form.title?.trim() ?? '',
      email: form.email?.trim() ?? '',
      url: form.url?.trim() ?? '',
      notes: form.notes?.trim() ?? '',
    };
    void onMutate(
      () => (editingId === 'new'
        ? addApplicationContact(applicationId, input)
        : updateApplicationContact(applicationId, editingId!, input)),
      'Could not save the contact',
    ).then(() => setEditingId(null));
  }

  return (
    <div className="app-pane">
      <div className="app-pane-title">
        Contacts
        <button type="button" className="app-pane-add" title="Add a contact" onClick={() => begin()}>
          <Plus size={12} />
        </button>
      </div>
      <div className="app-contacts">
        {contacts.map(contact =>
          editingId === contact.id ? (
            <ContactForm key={contact.id} form={form} setForm={setForm} onSave={saveForm} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={contact.id} className="app-contact">
              <div className="app-contact-main">
                <span className="app-contact-name">{contact.name}</span>
                {contact.title && <span className="app-contact-title">{contact.title}</span>}
                {(contact.email || contact.url || contact.notes) && (
                  <span className="app-contact-meta">
                    {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                    {contact.url && (
                      <a href={contact.url} target="_blank" rel="noreferrer" title={contact.url}>
                        <ExternalLink size={10} /> profile
                      </a>
                    )}
                    {contact.notes && <span>{contact.notes}</span>}
                  </span>
                )}
              </div>
              <div className="app-event-actions">
                <button type="button" title="Edit contact" onClick={() => begin(contact)}>
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title="Remove contact"
                  onClick={() => void onMutate(() => deleteApplicationContact(applicationId, contact.id), 'Could not remove the contact')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ),
        )}
        {editingId === 'new' && <ContactForm form={form} setForm={setForm} onSave={saveForm} onCancel={() => setEditingId(null)} />}
        {contacts.length === 0 && editingId !== 'new' && (
          <div className="app-pane-empty">No contacts yet — recruiters, hiring managers, referrers.</div>
        )}
      </div>
    </div>
  );
}

function ContactForm({
  form,
  setForm,
  onSave,
  onCancel,
}: {
  form: ApplicationContactInput;
  setForm: (f: ApplicationContactInput) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="app-contact-form">
      <div className="app-contact-grid">
        <input className="input" value={form.name ?? ''} placeholder="Name" autoFocus onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="input" value={form.title ?? ''} placeholder="Role (Recruiter, Hiring manager…)" onChange={e => setForm({ ...form, title: e.target.value })} />
        <input className="input" type="email" value={form.email ?? ''} placeholder="Email" onChange={e => setForm({ ...form, email: e.target.value })} />
        <input className="input" value={form.url ?? ''} placeholder="LinkedIn / profile URL" onChange={e => setForm({ ...form, url: e.target.value })} />
      </div>
      <input className="input" value={form.notes ?? ''} placeholder="Notes" onChange={e => setForm({ ...form, notes: e.target.value })} />
      <div className="app-contact-form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={!form.name?.trim()}>Save</button>
      </div>
    </div>
  );
}
