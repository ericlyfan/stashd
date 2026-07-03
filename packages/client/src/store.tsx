import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ClassificationResult,
  Document,
  isSupportedFilename,
  mimeFromExtension,
  ProjectSummary,
  SSEEvent,
  SUPPORTED_EXTENSIONS,
  UploadResponse,
} from '@stashd/shared';
import {
  CategoryWithCount,
  FilePayload,
  discardJob,
  fileDocument,
  listCategories,
  listDocuments,
  listProjects,
  subscribeClassify,
  uploadDocument,
} from './api';

// ── Upload queue ──────────────────────────────────────────────────────────

export type QueueStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'filing' | 'error';

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
  // An already-filed document with identical bytes — warn, never block.
  duplicateOf?: UploadResponse['duplicate'];
  // A content-level near-copy found at classify time (SimHash/dHash) — a softer
  // advisory than an exact byte-match; only surfaced when duplicateOf is unset.
  nearDuplicateOf?: SSEEvent['nearDuplicate'];
  error?: string;
  previewUrl: string;
}

// How many files upload + classify at once. The rest wait as "queued" so a
// 20-file drop doesn't hammer the Ollama instance with parallel model calls.
const MAX_CONCURRENT = 3;

export interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

const MAX_SIZE = 50 * 1024 * 1024;

interface StoreState {
  docs: Document[];
  categories: CategoryWithCount[];
  setCategories: React.Dispatch<React.SetStateAction<CategoryWithCount[]>>;
  projects: ProjectSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
  categoryById: (id?: string) => CategoryWithCount | undefined;

  queue: QueueItem[];
  addFiles: (files: FileList | File[]) => void;
  dismissItem: (id: string) => void;
  dismissItems: (ids: string[]) => void;
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const sources = useRef(new Map<string, EventSource>());
  // Mirrors so async callbacks can read the latest values.
  const reviewRef = useRef<string | null>(null);
  reviewRef.current = reviewItemId;
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;

  const notify = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = nextToastId++;
    setToasts(prev => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [d, c, p] = await Promise.all([listDocuments(), listCategories(), listProjects()]);
      setDocs(d);
      setCategories(c);
      setProjects(p);
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

  // ── Pipeline: items wait as "queued" and at most MAX_CONCURRENT are in
  // flight (upload + classify) at any moment. ──────────────────────────────
  const activeCount = useRef(0);
  const waiting = useRef<{ id: string; file: File }[]>([]);
  // begin → (on completion) pump → begin: a ref breaks the useCallback cycle.
  const pumpRef = useRef<() => void>(() => {});

  const begin = useCallback(
    (id: string, file: File) => {
      activeCount.current++;
      const settle = () => {
        activeCount.current--;
        pumpRef.current();
      };

      patchItem(id, { status: 'uploading', stageMessage: 'Uploading…' });
      uploadDocument(file)
        .then(({ jobId, duplicate }) => {
          patchItem(id, { jobId, duplicateOf: duplicate, status: 'processing', stageMessage: 'Reading document…' });
          const es = subscribeClassify(jobId, event => {
            if (event.stage === 'extracting' || event.stage === 'classifying') {
              patchItem(id, { stageMessage: event.message });
            } else if (event.stage === 'complete' && event.classification) {
              sources.current.delete(id);
              patchItem(id, {
                status: 'ready',
                stageMessage: 'Classified — ready to review',
                classification: event.classification,
                nearDuplicateOf: event.nearDuplicate,
              });
              // Pop the review sheet open if the user isn't already in one.
              if (reviewRef.current === null) setReviewItemId(id);
              settle();
            } else if (event.stage === 'error') {
              sources.current.delete(id);
              patchItem(id, {
                status: 'error',
                stageMessage: event.error ?? 'Classification failed',
                error: event.error,
              });
              settle();
            }
          });
          sources.current.set(id, es);
        })
        .catch((err: Error) => {
          patchItem(id, { status: 'error', stageMessage: err.message, error: err.message });
          settle();
        });
    },
    [patchItem],
  );

  const pump = useCallback(() => {
    while (activeCount.current < MAX_CONCURRENT && waiting.current.length > 0) {
      const next = waiting.current.shift()!;
      begin(next.id, next.file);
    }
  }, [begin]);
  pumpRef.current = pump;

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!isSupportedFilename(file.name)) {
          notify(`“${file.name}” isn’t a supported type (${SUPPORTED_EXTENSIONS.join(', ')})`, 'err');
          continue;
        }
        if (file.size > MAX_SIZE) {
          notify(`“${file.name}” is over the 50 MB limit`, 'err');
          continue;
        }

        const id = `q${nextLocalId++}`;
        const mime = mimeFromExtension(file.name, file.type || 'application/octet-stream');
        const item: QueueItem = {
          id,
          file,
          name: file.name,
          size: file.size,
          mime,
          status: 'queued',
          stageMessage: 'Waiting…',
          previewUrl: URL.createObjectURL(file),
        };
        setQueue(prev => [...prev, item]);
        waiting.current.push({ id, file });
      }
      pump();
    },
    [notify, pump],
  );

  const dismissItems = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    waiting.current = waiting.current.filter(w => !drop.has(w.id));
    // Clean up the server-side temp upload too — unless the item is mid-file,
    // where the temp file has already moved into permanent storage.
    for (const it of queueRef.current) {
      if (drop.has(it.id) && it.jobId && it.status !== 'filing') {
        void discardJob(it.jobId).catch(() => {});
      }
    }
    for (const id of drop) {
      sources.current.get(id)?.close();
      sources.current.delete(id);
    }
    setQueue(prev => {
      for (const it of prev) {
        if (drop.has(it.id)) URL.revokeObjectURL(it.previewUrl);
      }
      return prev.filter(q => !drop.has(q.id));
    });
    setReviewItemId(curr => (curr !== null && drop.has(curr) ? null : curr));
  }, []);

  const dismissItem = useCallback((id: string) => dismissItems([id]), [dismissItems]);

  const fileItem = useCallback(
    async (id: string, payload: FilePayload): Promise<Document | null> => {
      const item = queue.find(q => q.id === id);
      if (!item?.jobId) return null;
      patchItem(id, { status: 'filing', stageMessage: 'Filing…' });
      try {
        const doc = await fileDocument(item.jobId, payload);
        dismissItem(id);
        // Batch flow: move straight on to the next classified item.
        const next = queue.find(q => q.id !== id && q.status === 'ready');
        if (next) setReviewItemId(next.id);
        await refresh();
        // Email attachments are classified + filed in the background; nudge a
        // couple of refreshes so they appear without a manual reload.
        if (doc.attachmentsSpawned && doc.attachmentsSpawned > 0) {
          const n = doc.attachmentsSpawned;
          notify(`Filing ${n} attachment${n === 1 ? '' : 's'} from this email — flagged for review`);
          setTimeout(() => void refresh(), 2500);
          setTimeout(() => void refresh(), 6000);
        }
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
      setCategories,
      projects,
      loading,
      refresh,
      categoryById: (id?: string) => categories.find(c => c.id === id),
      queue,
      addFiles,
      dismissItem,
      dismissItems,
      fileItem,
      reviewItemId,
      openReview: setReviewItemId,
      toasts,
      notify,
    }),
    [docs, categories, setCategories, projects, loading, refresh, queue, addFiles, dismissItem, dismissItems, fileItem, reviewItemId, toasts, notify],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
