import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { uploadDocument, subscribeClassify, ClassificationResult } from '../api/client';
import { useApp } from '../state';
import { IconUpload, IconRefresh, IconSparkle, IconCamera, IconNote, IconX } from './icons';
import { isImageFile } from '../lib/format';
import ClassificationReview from './ClassificationReview';

type Stage = 'uploading' | 'extracting' | 'classifying' | 'review' | 'error';

interface UploadJob {
  id: string;
  fileName: string;
  fileType: string;
  stage: Stage;
  jobId?: string;
  classification?: ClassificationResult;
  error?: string;
}

const STAGE_STEPS: Array<{ key: Stage; label: string }> = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'extracting', label: 'Reading' },
  { key: 'classifying', label: 'Classifying' },
];

function FileProcessingCard({ job, onDismiss }: { job: UploadJob; onDismiss: () => void }) {
  const stepIdx = STAGE_STEPS.findIndex(s => s.key === job.stage);
  return (
    <div className="rise-in" style={{
      background: 'var(--surface)', borderRadius: 12,
      boxShadow: 'var(--shadow-sm)',
      padding: '13px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: job.stage === 'error' ? 'rgba(220,38,38,0.1)' : 'var(--accent-tint)',
        color: job.stage === 'error' ? 'var(--red)' : 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isImageFile(job.fileType) ? <IconCamera size={16} /> : <IconNote size={16} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: 'var(--ink)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{job.fileName}</div>
        {job.stage === 'error' ? (
          <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 3 }}>{job.error ?? 'Something went wrong'}</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
            {STAGE_STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10.5, fontWeight: 600,
                  color: active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--ink-4)',
                }}>
                  {active ? (
                    s.key === 'classifying'
                      ? <IconSparkle size={11} style={{ animation: 'pulse 1.2s ease-in-out infinite' }} />
                      : <IconRefresh size={10} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: done ? 'var(--green)' : 'var(--ink-4)',
                    }} />
                  )}
                  {s.label}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {job.stage === 'error' ? (
        <button
          onClick={onDismiss}
          style={{
            width: 24, height: 24, borderRadius: 12, flexShrink: 0,
            background: 'rgba(28,25,23,0.05)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--ink-3)', cursor: 'pointer',
          }}
        ><IconX size={11} /></button>
      ) : null}
    </div>
  );
}

export default function UploadZone() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const updateJob = (id: string, updates: Partial<UploadJob>) =>
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));

  const removeJob = (id: string) => setJobs(prev => prev.filter(j => j.id !== id));

  const processFile = useCallback(async (file: File, id: string) => {
    try {
      const { jobId } = await uploadDocument(file);
      updateJob(id, { jobId, stage: 'extracting' });
      const es = subscribeClassify(jobId, (event) => {
        if (event.stage === 'extracting') {
          updateJob(id, { stage: 'extracting' });
        } else if (event.stage === 'classifying') {
          updateJob(id, { stage: 'classifying' });
        } else if (event.stage === 'complete' && event.classification) {
          es.close();
          updateJob(id, { stage: 'review', classification: event.classification });
        } else if (event.stage === 'error') {
          es.close();
          updateJob(id, { stage: 'error', error: event.error ?? 'Classification failed' });
        }
      });
    } catch (err) {
      updateJob(id, { stage: 'error', error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    for (const file of accepted) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setJobs(prev => [...prev, { id, fileName: file.name, fileType: file.type, stage: 'uploading' }]);
      processFile(file, id);
    }
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    noClick: false,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
  });

  // Expose the file picker to the toolbar Add button while mounted.
  const { filePickerRef } = useApp();
  useEffect(() => {
    filePickerRef.current = open;
    return () => { filePickerRef.current = null; };
  }, [open, filePickerRef]);

  // When Add is clicked from another page, we arrive with openPicker state:
  // open the browser dialog once, then clear the flag. The ref guards against
  // the effect re-running before the cleared state lands (StrictMode runs
  // mount effects twice in dev).
  const location = useLocation();
  const navigate = useNavigate();
  const pickerOpened = useRef(false);
  useEffect(() => {
    if ((location.state as { openPicker?: boolean } | null)?.openPicker && !pickerOpened.current) {
      pickerOpened.current = true;
      open();
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate, open]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        {...getRootProps()}
        style={{
          padding: jobs.length > 0 ? '26px 20px' : '48px 24px',
          background: isDragActive ? 'rgba(13,148,136,0.08)' : 'var(--accent-tint)',
          border: `1.5px dashed ${isDragActive ? 'var(--accent)' : 'rgba(13,148,136,0.35)'}`,
          borderRadius: 14,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s, padding 0.2s',
        }}
      >
        <input {...getInputProps()} />
        <div style={{
          width: 46, height: 46, borderRadius: 13,
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(13,148,136,0.32)',
        }}><IconUpload size={21} /></div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 19, color: 'var(--ink)', letterSpacing: 0.2,
        }}>{isDragActive ? 'Drop to stash' : 'Drop files here'}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
          PDFs, photos, scans — up to 50MB each.{' '}
          <span
            onClick={(e) => { e.stopPropagation(); open(); }}
            style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
          >Browse files</span>
        </div>
      </div>

      {jobs.map(job =>
        job.stage === 'review' && job.jobId && job.classification ? (
          <ClassificationReview
            key={job.id}
            jobId={job.jobId}
            fileName={job.fileName}
            fileType={job.fileType}
            classification={job.classification}
            onFiled={() => removeJob(job.id)}
            onDiscard={() => removeJob(job.id)}
          />
        ) : (
          <FileProcessingCard key={job.id} job={job} onDismiss={() => removeJob(job.id)} />
        )
      )}
    </div>
  );
}
