import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { useApp } from '../state';
import { deleteDocument } from '../api/client';
import { relTime, fmtMoney, isImageFile, categoryLabel } from '../lib/format';
import { iconFor, IconCamera, IconTrash } from './icons';
import ConfirmDialog from './ConfirmDialog';

function Thumb({ color, fileType }: { color: string; fileType: string }) {
  if (isImageFile(fileType)) {
    return (
      <div style={{
        height: 96, borderRadius: '10px 10px 0 0',
        background: `linear-gradient(135deg, ${color}22, ${color}0c)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color,
      }}>
        <IconCamera size={26} />
      </div>
    );
  }
  return (
    <div style={{
      height: 96, borderRadius: '10px 10px 0 0',
      background: 'var(--surface-2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        width: 58, height: 74, background: '#fff', borderRadius: 3,
        boxShadow: '0 2px 8px rgba(28,25,23,0.10), 0 0 0 0.5px rgba(28,25,23,0.06)',
        padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: 3,
        transform: 'translateY(14px)',
      }}>
        <div style={{ height: 4, background: color, opacity: 0.65, borderRadius: 1, width: '55%' }} />
        <div style={{ height: 2, background: 'rgba(28,25,23,0.1)', borderRadius: 1, marginTop: 4 }} />
        <div style={{ height: 2, background: 'rgba(28,25,23,0.1)', borderRadius: 1, width: '85%' }} />
        <div style={{ height: 2, background: 'rgba(28,25,23,0.1)', borderRadius: 1, width: '72%' }} />
        <div style={{ height: 2, background: 'rgba(28,25,23,0.1)', borderRadius: 1, width: '90%' }} />
      </div>
    </div>
  );
}

interface DocumentCardProps {
  doc: Document;
  onDeleted?: () => void;
}

export default function DocumentCard({ doc, onDeleted }: DocumentCardProps) {
  const navigate = useNavigate();
  const { categoryById, refresh } = useApp();
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cat = categoryById(doc.category);
  const color = cat?.color ?? 'var(--accent)';
  const Ico = iconFor(cat?.icon);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDocument(doc.id);
      setConfirming(false);
      await refresh();
      onDeleted?.();
    } catch (err) {
      console.error('Delete failed', err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        onClick={() => navigate(`/document/${doc.id}`)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: 'var(--surface)',
          borderRadius: 10,
          boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
          transform: hovered ? 'translateY(-1px)' : 'none',
          transition: 'box-shadow 0.15s, transform 0.15s',
          cursor: 'pointer', overflow: 'hidden',
          position: 'relative',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <Thumb color={color} fileType={doc.fileType} />
        {hovered ? (
          <button
            title="Delete document"
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 26, height: 26, borderRadius: 7,
              background: 'rgba(255,255,255,0.92)',
              border: '0.5px solid var(--line)',
              boxShadow: '0 1px 4px rgba(28,25,23,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--red)', cursor: 'pointer',
            }}
          ><IconTrash size={13} /></button>
        ) : null}
        <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 7px 2px 6px', borderRadius: 4,
            background: `${color}12`, color,
            fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
          }}>
            <Ico size={10} />
            {cat?.name ?? categoryLabel(doc.category)}
          </span>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--ink)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            letterSpacing: -0.05,
          }}>{doc.originalName}</div>
          {doc.summary ? (
            <div style={{
              fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45,
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            } as React.CSSProperties}>{doc.summary}</div>
          ) : null}
          <div style={{
            marginTop: 'auto', paddingTop: 4,
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 10.5, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums',
          }}>
            <span>{relTime(doc.createdAt)}</span>
            {doc.amount != null ? <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>{fmtMoney(doc.amount)}</span> : null}
            {doc.status === 'pending' ? (
              <span style={{
                marginLeft: 'auto', padding: '1px 6px', borderRadius: 3,
                background: 'rgba(217,119,6,0.12)', color: 'var(--amber)',
                fontWeight: 600,
              }}>Needs review</span>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete document?"
        message={`"${doc.originalName}" and its stored file will be permanently removed.`}
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
