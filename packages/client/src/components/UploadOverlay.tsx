import { useState, useEffect, useRef } from 'react';
import { uploadDocument, subscribeClassify, ClassificationResult } from '../api/client';
import { getCategoryMeta, IconUpload, IconX, IconCheck, IconCamera, IconNote, IconRefresh, IconSparkle } from './icons';
import { PrimaryButton, GhostButton } from './chrome';
import { PendingJob, isImageFile } from './InboxView';

type FileStatus = 'queued' | 'uploading' | 'extracting' | 'classifying' | 'done' | 'error';

interface ProcessingFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  jobId?: string;
  classification?: ClassificationResult;
  error?: string;
}

function UploadRow({ pf }: { pf: ProcessingFile }) {
  const isImg = isImageFile(pf.file.type);
  const classification = pf.classification;
  const meta = classification ? getCategoryMeta(classification.category) : null;
  const Ico = meta?.icon;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 9,
        background: pf.status === 'done' && meta ? `${meta.color}14` : 'rgba(0,0,0,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: pf.status === 'done' && meta ? meta.color : 'var(--ink-3)',
        flexShrink: 0,
      }}>
        {isImg ? <IconCamera size={18} /> : <IconNote size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{pf.file.name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          {pf.status === 'uploading' ? <><IconRefresh size={11} style={{ animation: 'spin 1s linear infinite' }} />Uploading…</> : null}
          {pf.status === 'extracting' ? <><IconRefresh size={11} style={{ animation: 'spin 1s linear infinite' }} />Reading content…</> : null}
          {pf.status === 'classifying' ? <><IconSparkle size={11} />Classifying with Gemma…</> : null}
          {pf.status === 'done' && classification ? (
            Ico ? <><Ico size={11} style={{ color: meta!.color }} />{classification.category.split('-')[0]}</> : null
          ) : null}
          {pf.status === 'error' ? <span style={{ color: 'var(--red)' }}>{pf.error ?? 'Error'}</span> : null}
          {pf.status === 'queued' ? 'Queued' : null}
        </div>
        <div style={{ height: 3, background: 'rgba(0,0,0,0.06)', borderRadius: 2, marginTop: 7, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pf.progress}%`,
            background: pf.status === 'error' ? 'var(--red)' : pf.status === 'done' && meta ? meta.color : 'var(--accent)',
            transition: 'width 0.18s ease-out',
          }} />
        </div>
      </div>
      <div style={{ width: 22, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        {pf.status === 'done' ? (
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--green)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><IconCheck size={12} /></div>
        ) : null}
      </div>
    </div>
  );
}

interface UploadOverlayProps {
  visible: boolean;
  onClose: () => void;
  onComplete: (jobs: PendingJob[]) => void;
}

export default function UploadOverlay({ visible, onClose, onComplete }: UploadOverlayProps) {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!visible) setFiles([]);
  }, [visible]);

  const allDone = files.length > 0 && files.every(f => f.status === 'done' || f.status === 'error');

  function updateFile(id: string, updates: Partial<ProcessingFile>) {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }

  async function processFile(pf: ProcessingFile) {
    updateFile(pf.id, { status: 'uploading', progress: 15 });
    try {
      const { jobId } = await uploadDocument(pf.file);
      updateFile(pf.id, { jobId, status: 'extracting', progress: 30 });

      await new Promise<void>((resolve, reject) => {
        const es = subscribeClassify(jobId, (event) => {
          if (event.stage === 'extracting') {
            updateFile(pf.id, { status: 'extracting', progress: 45 });
          } else if (event.stage === 'classifying') {
            updateFile(pf.id, { status: 'classifying', progress: 70 });
          } else if (event.stage === 'complete' && event.classification) {
            updateFile(pf.id, {
              status: 'done', progress: 100,
              classification: event.classification,
            });
            es.close();
            resolve();
          } else if (event.stage === 'error') {
            updateFile(pf.id, { status: 'error', progress: 100, error: event.error ?? 'Failed' });
            es.close();
            reject(new Error(event.error));
          }
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      updateFile(pf.id, { status: 'error', progress: 100, error: msg });
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    const newFiles: ProcessingFile[] = arr.map(file => ({
      id: `${Date.now()}_${Math.random()}`,
      file,
      status: 'queued' as FileStatus,
      progress: 0,
    }));
    setFiles(prev => [...prev, ...newFiles]);
    newFiles.forEach(pf => processFile(pf));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  function handleReviewAndFile() {
    const jobs: PendingJob[] = files
      .filter(f => f.status === 'done' && f.jobId && f.classification)
      .map(f => ({
        jobId: f.jobId!,
        fileName: f.file.name,
        fileType: f.file.type,
        classification: f.classification!,
      }));
    onComplete(jobs);
  }

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(20,20,20,0.32)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '90%',
          background: 'var(--surface)',
          borderRadius: 18,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '0.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18, fontWeight: 600, color: 'var(--ink)',
            flex: 1,
          }}>
            {files.length === 0 ? "Add to Stash’d" : allDone ? 'Ready to file' : 'Processing…'}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 14,
              background: 'rgba(0,0,0,0.05)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          ><IconX size={14} /></button>
        </div>

        {/* Body */}
        {files.length === 0 ? (
          <div style={{ padding: 24 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                width: '100%', padding: '54px 24px',
                background: dragOver ? 'rgba(13,111,106,0.08)' : 'var(--accent-tint)',
                border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--accent-soft)'}`,
                borderRadius: 14,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                cursor: 'pointer', color: 'var(--accent)',
              }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 6px 18px rgba(13,111,106,0.3)',
              }}><IconUpload size={24} /></div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 19, fontWeight: 600, color: 'var(--ink)',
              }}>Drop files here</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 340 }}>
                PDFs, photos, scans — up to 50MB each. Stash'd will read and classify them.
              </div>
              <div style={{
                marginTop: 8, fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                padding: '6px 14px', borderRadius: 6,
                background: 'rgba(255,255,255,0.7)',
              }}>or click to browse</div>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); }}
            />
          </div>
        ) : (
          <div style={{
            padding: '8px 8px',
            maxHeight: 420, overflow: 'auto',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {files.map(f => <UploadRow key={f.id} pf={f} />)}
          </div>
        )}

        {/* Footer */}
        {files.length > 0 ? (
          <div style={{
            padding: '14px 22px',
            borderTop: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>
              {allDone
                ? `${files.filter(f => f.status === 'done').length} ready to file`
                : 'Reading and classifying with Gemma…'
              }
            </div>
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton
              onClick={handleReviewAndFile}
              disabled={!allDone}
            >
              <IconCheck size={14} />
              Review & file
            </PrimaryButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
