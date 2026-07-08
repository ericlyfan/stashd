import { useState } from 'react';
import { AlertTriangle, Paperclip, StickyNote, Users } from 'lucide-react';
import { ApplicationStage, EnrichedApplication } from '@stashd/shared';
import { formatDate } from '../lib/format';

// The kanban view: one column per pipeline stage (position order), cards per
// application, native HTML5 drag to change status. Same DnD idiom as the
// sidebar's drawer reorder — a dedicated MIME keeps the gesture from
// colliding with document drags (and the global drop curtain ignores it,
// since file drags carry the Files type, not this one).
const APP_MIME = 'application/x-stashd-application';

interface Props {
  stages: ApplicationStage[];
  applications: EnrichedApplication[];
  onOpen: (app: EnrichedApplication) => void;
  onMove: (app: EnrichedApplication, stageId: string) => void;
}

export default function ApplicationBoard({ stages, applications, onOpen, onMove }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const byStage = new Map<string, EnrichedApplication[]>();
  for (const app of applications) {
    const list = byStage.get(app.stageId);
    if (list) list.push(app);
    else byStage.set(app.stageId, [app]);
  }

  return (
    <div className="app-board">
      {stages.map(stage => {
        const cards = byStage.get(stage.id) ?? [];
        return (
          <div
            key={stage.id}
            className={`app-col${stage.isTerminal ? ' app-col-terminal' : ''}${dragOver === stage.id ? ' drop-hover' : ''}`}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(APP_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOver(stage.id);
            }}
            onDragLeave={e => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOver(cur => (cur === stage.id ? null : cur));
            }}
            onDrop={e => {
              if (!e.dataTransfer.types.includes(APP_MIME)) return;
              e.preventDefault();
              setDragOver(null);
              // Clear here, not just in onDragEnd: a successful drop re-renders
              // the card into its new column, unmounting the original element
              // before its dragend can fire — the stuck ghost state otherwise
              // survives until a page refresh.
              setDraggingId(null);
              const id = e.dataTransfer.getData(APP_MIME);
              const app = applications.find(a => a.id === id);
              if (app && app.stageId !== stage.id) onMove(app, stage.id);
            }}
          >
            <div className="app-col-head">
              <span className="stage-dot" style={{ background: stage.color }} />
              <span className="app-col-name">{stage.name}</span>
              <span className="app-col-count">{cards.length}</span>
            </div>
            <div className="app-col-cards">
              {cards.map(app => (
                <button
                  key={app.id}
                  type="button"
                  className={`app-card${draggingId === app.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData(APP_MIME, app.id);
                    setDraggingId(app.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOver(null);
                  }}
                  onClick={() => onOpen(app)}
                >
                  <span className="app-card-company">{app.company}</span>
                  <span className="app-card-role">{app.role}</span>
                  <span className="app-card-meta">
                    {app.appliedDate && <span title={`Applied ${formatDate(app.appliedDate)}`}>{formatDate(app.appliedDate)}</span>}
                    {app.daysInStage !== undefined && <span className="app-card-days">{app.daysInStage}d here</span>}
                    {app.stale && (
                      <span className="app-card-stale" title="No update in a while — follow up?">
                        <AlertTriangle size={11} />
                      </span>
                    )}
                    <span className="app-card-icons">
                      {app.documentId && <Paperclip size={11} />}
                      {app.notes && <StickyNote size={11} />}
                      {app.contactCount > 0 && (
                        <span className="app-card-contacts" title={`${app.contactCount} contact${app.contactCount === 1 ? '' : 's'}`}>
                          <Users size={11} />
                          {app.contactCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
              {cards.length === 0 && <div className="app-col-empty">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
