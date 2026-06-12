import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ClassificationResult, Document } from '@stashd/shared';
import {
  CategoryWithCount,
  FilePayload,
  fileDocument,
  listCategories,
  listDocuments,
  subscribeClassify,
  uploadDocument,
} from './api';

// ── Upload queue ──────────────────────────────────────────────────────────

export type QueueStatus = 'uploading' | 'processing' | 'ready' | 'filing' | 'error';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  status: QueueStatus;
  stageMessage: string;
  jobId?: string;
  classification?: ClassificationResult;
  error?: string;
  previewUrl: string;
}

export interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

const ALLOWED_EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
const MAX_SIZE = 50 * 1024 * 1024;

function mimeFromName(name: string, fallback: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? fallback;
}

interface StoreState {
  docs: Document[];
  categories: CategoryWithCount[];
  loading: boolean;
  refresh: () => Promise<void>;
  categoryById: (id?: string) => CategoryWithCount | undefined;

  queue: QueueItem[];
  addFiles: (files: FileList | File[]) => void;
  dismissItem: (id: string) => void;
  fileItem: (id: string, payload: FilePayload) => Promise<Document | null>;

  reviewItemId: string | null;
  openReview: (id: string | null) => void;

  toasts: Toast[];
  notify: (text: string, kind?: 'ok' | 'err') => void;
}

const StoreContext = createContext<StoreState | null>(null);

let nextLocalId = 1;
let nextToastId = 1;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const sources = useRef(new Map<string, EventSource>());
  // Mirror of reviewItemId so async callbacks can read the latest value.
  const reviewRef = useRef<string | null>(null);
  reviewRef.current = reviewItemId;

  const notify = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = nextToastId++;
    setToasts(prev => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([listDocuments(), listCategories()]);
      setDocs(d);
      setCategories(c);
    } catch (err) {
      console.error('Failed to load data', err);
      notify('Could not reach the Stash’d server', 'err');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!ALLOWED_EXT.test(file.name)) {
          notify(`“${file.name}” isn’t a supported type (PDF, JPG, PNG, HEIC)`, 'err');
          continue;
        }
        if (file.size > MAX_SIZE) {
          notify(`“${file.name}” is over the 50 MB limit`, 'err');
          continue;
        }

        const id = `q${nextLocalId++}`;
        const mime = mimeFromName(file.name, file.type || 'application/octet-stream');
        const item: QueueItem = {
          id,
          file,
          name: file.name,
          size: file.size,
          mime,
          status: 'uploading',
          stageMessage: 'Uploading…',
          previewUrl: URL.createObjectURL(file),
        };
        setQueue(prev => [...prev, item]);

        uploadDocument(file)
          .then(({ jobId }) => {
            patchItem(id, { jobId, status: 'processing', stageMessage: 'Reading document…' });
            const es = subscribeClassify(jobId, event => {
              if (event.stage === 'extracting' || event.stage === 'classifying') {
                patchItem(id, { stageMessage: event.message });
              } else if (event.stage === 'complete' && event.classification) {
                sources.current.delete(id);
                patchItem(id, {
                  status: 'ready',
                  stageMessage: 'Classified — ready to review',
                  classification: event.classification,
                });
                // Pop the review sheet open if the user isn't already in one.
                if (reviewRef.current === null) setReviewItemId(id);
              } else if (event.stage === 'error') {
                sources.current.delete(id);
                patchItem(id, {
                  status: 'error',
                  stageMessage: event.error ?? 'Classification failed',
                  error: event.error,
                });
              }
            });
            sources.current.set(id, es);
          })
          .catch((err: Error) => {
            patchItem(id, { status: 'error', stageMessage: err.message, error: err.message });
          });
      }
    },
    [notify, patchItem],
  );

  const dismissItem = useCallback((id: string) => {
    sources.current.get(id)?.close();
    sources.current.delete(id);
    setQueue(prev => {
      const it = prev.find(q => q.id === id);
      if (it) URL.revokeObjectURL(it.previewUrl);
      return prev.filter(q => q.id !== id);
    });
    setReviewItemId(curr => (curr === id ? null : curr));
  }, []);

  const fileItem = useCallback(
    async (id: string, payload: FilePayload): Promise<Document | null> => {
      const item = queue.find(q => q.id === id);
      if (!item?.jobId) return null;
      patchItem(id, { status: 'filing', stageMessage: 'Filing…' });
      try {
        const doc = await fileDocument(item.jobId, payload);
        dismissItem(id);
        await refresh();
        return doc;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Filing failed';
        patchItem(id, { status: 'ready', stageMessage: 'Classified — ready to review' });
        notify(msg, 'err');
        return null;
      }
    },
    [queue, patchItem, dismissItem, refresh, notify],
  );

  const value = useMemo<StoreState>(
    () => ({
      docs,
      categories,
      loading,
      refresh,
      categoryById: (id?: string) => categories.find(c => c.id === id),
      queue,
      addFiles,
      dismissItem,
      fileItem,
      reviewItemId,
      openReview: setReviewItemId,
      toasts,
      notify,
    }),
    [docs, categories, loading, refresh, queue, addFiles, dismissItem, fileItem, reviewItemId, toasts, notify],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
