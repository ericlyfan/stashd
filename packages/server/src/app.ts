import express, { Express } from 'express';
import { StoreService } from './services/StoreService';
import { FileService } from './services/FileService';
import { ClassificationService } from './services/ClassificationService';
import { getProvider } from './providers';
import { createDocumentRoutes } from './routes/documents';
import { backfillDerivedFields } from './services/textExtraction';
import { createCategoryRoutes } from './routes/categories';
import { EmbeddingService } from './services/EmbeddingService';
import { AgenticChatService } from './services/AgenticChatService';
import { createChatRoutes } from './routes/chat';
import { createProjectRoutes } from './routes/projects';
import { createHoldingRoutes } from './routes/holdings';
import { createWatchlistRoutes } from './routes/watchlist';
import { createMarketRoutes } from './routes/market';
import { createApplicationRoutes } from './routes/applications';
import { errorHandler } from './middleware';

interface AppOverrides {
  classificationService?: ClassificationService;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

async function drainPendingDocumentDeletions(store: StoreService, fileService: FileService): Promise<void> {
  for (const storagePath of store.listPendingDocumentDeletions()) {
    try {
      await fileService.deleteDocument(storagePath);
      store.completeDocumentFileDeletion(storagePath);
    } catch (err: unknown) {
      if (isEnoent(err)) {
        store.completeDocumentFileDeletion(storagePath);
      } else {
        console.warn(`Could not delete queued document file ${storagePath}:`, (err as Error).message);
      }
    }
  }
}

async function reconcileDocumentStorage(store: StoreService, fileService: FileService): Promise<void> {
  await drainPendingDocumentDeletions(store, fileService);

  // A row whose file is missing is QUARANTINED, never deleted: the mark hides
  // it from lists/search/counts but keeps the metadata, extracted text and
  // ledger/holding/application links intact, and it revives automatically the
  // moment the file reappears. Hard-deleting here (the pre-2026-07-09
  // behavior) turned a moved/renamed/partially-restored data dir into a
  // silent purge of the whole stash — and worse, restoring the files
  // afterwards fed them to the orphan sweep below.
  let quarantined = 0;
  let revived = 0;
  for (const doc of store.getDocumentsIncludingMissing()) {
    const exists = await fileService.documentExists(doc.storagePath);
    if (!exists && !doc.missingSince) {
      store.markDocumentMissing(doc.id, new Date().toISOString());
      console.error(`Document file missing — row quarantined (hidden, not deleted): ${doc.originalName} (${doc.storagePath})`);
      quarantined++;
    } else if (exists && doc.missingSince) {
      store.clearDocumentMissing(doc.id);
      console.log(`Document file restored — row revived: ${doc.originalName}`);
      revived++;
    }
  }
  if (quarantined > 0) {
    console.error(
      `${quarantined} document(s) quarantined because their files are missing from data/documents/. ` +
        'Nothing was deleted: restore the files (same paths) and restart to revive them.',
    );
  }
  if (revived > 0) console.log(`${revived} quarantined document(s) revived (files are back).`);

  // Orphan file sweep — files on disk no row references. This IS destructive,
  // so it refuses to run on a mass orphaning (an empty/replaced DB against an
  // intact documents dir would orphan the entire stash). Legitimate orphans
  // appear one-ish at a time (a crash between delete-queue and unlink), so
  // anything past the threshold means the DB and disk disagree wholesale —
  // require STASHD_FORCE_RECONCILE=1 to proceed. Quarantined rows keep their
  // paths referenced, so a just-restored file is never swept as an orphan.
  const referenced = new Set(store.getDocumentsIncludingMissing().map(doc => doc.storagePath));
  const onDisk = await fileService.listDocumentFiles();
  const orphans = onDisk.filter(storagePath => !referenced.has(storagePath));
  if (orphans.length === 0) return;

  const limit = Math.max(10, Math.ceil(onDisk.length * 0.1));
  const massOrphaning = orphans.length > limit || referenced.size === 0;
  if (massOrphaning && process.env.STASHD_FORCE_RECONCILE !== '1') {
    console.error(
      `Refusing to delete ${orphans.length} orphaned document file(s) (of ${onDisk.length} on disk, ${referenced.size} referenced) — ` +
        'this looks like a database/disk mismatch (restored backup? wrong data dir?), not routine cleanup. ' +
        'No files were touched. If these files really should go, restart with STASHD_FORCE_RECONCILE=1.',
    );
    return;
  }
  for (const storagePath of orphans) {
    store.queueDocumentFileDeletion(storagePath);
    await drainPendingDocumentDeletions(store, fileService);
  }
}

export async function createApp(dataDir: string, overrides: AppOverrides = {}): Promise<Express> {
  const store = new StoreService(dataDir);
  await store.load();

  const fileService = new FileService(dataDir);
  await fileService.ensureDirs();
  await reconcileDocumentStorage(store, fileService);

  const embeddingService = new EmbeddingService(store);

  // Catch up documents filed before extractedText / contentHash existed,
  // then build/refresh the vector index; both run in the background so
  // startup isn't blocked by a large stash or a cold embedding model.
  void backfillDerivedFields(store, fileService)
    .catch((err: unknown) => {
      console.warn('Backfill failed:', (err as Error).message);
    })
    .then(() => embeddingService.init())
    .catch((err: unknown) => {
      console.warn(
        `Vector index unavailable (is the embedding model pulled? ollama pull ${process.env.OLLAMA_EMBED_MODEL ?? 'embeddinggemma'}):`,
        (err as Error).message,
      );
    });

  const provider = getProvider(process.env.PROVIDER ?? 'ollama');
  const classificationService = overrides.classificationService ?? new ClassificationService(provider);
  // The one chat engine: the agentic loop, seeded with the same embeddings-
  // backed retrieval the retired classic ChatService used.
  const agenticChatService = new AgenticChatService(store, embeddingService);

  const app = express();
  // Deliberately NO cors() here: the client reaches the API same-origin through
  // the Vite proxy (`/api` → :3001), and the server holds the user's whole
  // stash with no auth — absent CORS headers are what stop arbitrary web pages
  // from reading it. If a second origin ever legitimately needs the API, add
  // cors() restricted to that origin, never the open default.
  app.use(express.json());

  // Cheap liveness check for the sidebar status bar (client heartbeat).
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/documents', createDocumentRoutes({ store, fileService, classificationService, embeddingService }));
  app.use('/api/categories', createCategoryRoutes({ store }));
  app.use('/api/chat', createChatRoutes({ store, agenticChatService }));
  app.use('/api/projects', createProjectRoutes({ store }));
  app.use('/api/holdings', createHoldingRoutes({ store }));
  app.use('/api/watchlist', createWatchlistRoutes({ store }));
  app.use('/api/market', createMarketRoutes());
  app.use('/api/applications', createApplicationRoutes({ store }));

  // Terminal error middleware — must be last, after every route, so a rejected
  // async handler (funneled here via wrap()) becomes a JSON 500 instead of
  // crashing the process.
  app.use(errorHandler);

  return app;
}
