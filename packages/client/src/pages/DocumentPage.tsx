import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileQuestion, FlagOff, Trash2 } from 'lucide-react';
import { Document } from '@stashd/shared';
import { deleteDocument, fileUrl, getDocument, updateDocument } from '../api';
import { useStore } from '../store';
import Viewer from '../components/Viewer';
import TagEditor from '../components/TagEditor';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { ConfidenceMeter, StatusStamp } from '../components/Stamps';
import { fileKindLabel, formatAmount, formatBytes, formatDate } from '../lib/format';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { categories, refresh, notify } = useStore();

  const [doc, setDoc] = useState<Document | null>(null);
  const [missing, setMissing] = useState(false);

  // Editable fields
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getDocument(id)
      .then(d => {
        if (cancelled) return;
        setDoc(d);
        setCategory(d.category);
        setTags(d.tags);
        setNotes(d.notes ?? '');
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dirty = useMemo(() => {
    if (!doc) return false;
    return (
      category !== doc.category ||
      notes !== (doc.notes ?? '') ||
      tags.length !== doc.tags.length ||
      tags.some((t, i) => t !== doc.tags[i])
    );
  }, [doc, category, tags, notes]);

  async function save() {
    if (!doc || !dirty) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { category, tags, notes });
      setDoc(updated);
      await refresh();
      notify('Changes saved to the ledger');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Save failed', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function resolveFlag() {
    if (!doc || doc.status !== 'pending') return;
    setResolving(true);
    try {
      const updated = await updateDocument(doc.id, { status: 'filed' });
      setDoc(updated);
      await refresh();
      notify(`“${doc.originalName}” reviewed and filed`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to resolve flag', 'err');
    } finally {
      setResolving(false);
    }
  }

  async function remove() {
    if (!doc) return;
    setDeleting(true);
    try {
      await deleteDocument(doc.id);
      await refresh();
      notify(`“${doc.originalName}” deleted`);
      navigate(-1);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'err');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (missing) {
    return (
      <div className="page">
        <EmptyState icon={FileQuestion} title="Document not found" subtitle="It may have been deleted.">
          <Link className="btn" to="/all">
            <ArrowLeft size={14} />
            Back to the ledger
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="page">
        <div className="loading-line">Pulling the file…</div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <header className="page-head rise" style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-eyebrow">
            <button
              onClick={() => navigate(-1)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                fontFamily: 'var(--mono)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--wax)',
              }}
            >
              <ArrowLeft size={11} style={{ verticalAlign: '-1px', marginRight: 6 }} />
              Back
            </button>
          </div>
          <h1 className="page-title" style={{ fontSize: 30, overflowWrap: 'break-word' }}>
            {doc.originalName}
          </h1>
          <p className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <StatusStamp status={doc.status} />
            <span>filed {formatDate(doc.createdAt)}</span>
            <ConfidenceMeter value={doc.confidenceScore} />
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          {doc.status === 'pending' && (
            <button className="btn btn-primary" onClick={resolveFlag} disabled={resolving}>
              <FlagOff size={14} />
              {resolving ? 'Resolving…' : 'Resolve flag'}
            </button>
          )}
          <a className="btn" href={fileUrl(doc.id)} download={doc.originalName}>
            <Download size={14} />
            Download
          </a>
          <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </header>

      <div className="detail rise rise-1">
        <div className="viewer-pane">
          <Viewer doc={doc} />
        </div>

        <div>
          <div className="meta-card">
            <div className="field">
              <label className="field-label" htmlFor="dp-category">Category</label>
              <select
                id="dp-category"
                className="input"
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {!categories.some(c => c.id === category) && (
                  <option value={category}>{category}</option>
                )}
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Tags</label>
              <TagEditor tags={tags} onChange={setTags} />
            </div>

            <div className="field" style={{ marginBottom: dirty ? 16 : 0 }}>
              <label className="field-label" htmlFor="dp-notes">Notes</label>
              <textarea
                id="dp-notes"
                className="textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Anything future-you should know…"
              />
            </div>

            {dirty && (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>

          <div className="meta-card">
            {doc.summary && (
              <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>
                {doc.summary}
              </p>
            )}
            <dl className="meta-grid" style={{ margin: 0 }}>
              {doc.vendor && (
                <>
                  <dt>Vendor</dt>
                  <dd>{doc.vendor}</dd>
                </>
              )}
              {doc.subcategory && (
                <>
                  <dt>Subcat.</dt>
                  <dd>{doc.subcategory}</dd>
                </>
              )}
              {doc.amount !== undefined && doc.amount !== null && (
                <>
                  <dt>Amount</dt>
                  <dd style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{formatAmount(doc.amount)}</dd>
                </>
              )}
              {doc.dateExtracted && (
                <>
                  <dt>Doc date</dt>
                  <dd>{formatDate(doc.dateExtracted)}</dd>
                </>
              )}
              <dt>Type</dt>
              <dd>{fileKindLabel(doc.fileType)}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(doc.fileSize)}</dd>
              <dt>Updated</dt>
              <dd>{formatDate(doc.updatedAt)}</dd>
            </dl>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this document?"
          body={`“${doc.originalName}” and its file will be permanently removed from the stash. There is no undo.`}
          confirmLabel="Delete it"
          busy={deleting}
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
