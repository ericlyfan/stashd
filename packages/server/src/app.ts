import express, { Express } from 'express';
import cors from 'cors';
import { StoreService } from './services/StoreService';
import { FileService } from './services/FileService';
import { ClassificationService } from './services/ClassificationService';
import { getProvider } from './providers';
import { createDocumentRoutes } from './routes/documents';
import { backfillDerivedFields } from './services/textExtraction';
import { createCategoryRoutes } from './routes/categories';
import { EmbeddingService } from './services/EmbeddingService';
import { ChatService } from './services/ChatService';
import { AgenticChatService } from './services/AgenticChatService';
import { createChatRoutes } from './routes/chat';
import { createProjectRoutes } from './routes/projects';
import { createHoldingRoutes } from './routes/holdings';
import { createWatchlistRoutes } from './routes/watchlist';

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

  for (const doc of store.getDocuments()) {
    if (!(await fileService.documentExists(doc.storagePath))) {
      console.warn(`Removing document row with missing file: ${doc.originalName}`);
      store.removeDocument(doc.id);
    }
  }

  const referenced = new Set(store.getDocuments().map(doc => doc.storagePath));
  for (const storagePath of await fileService.listDocumentFiles()) {
    if (!referenced.has(storagePath)) {
      store.queueDocumentFileDeletion(storagePath);
      await drainPendingDocumentDeletions(store, fileService);
    }
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
  const chatService = new ChatService(store, embeddingService);
  const agenticChatService = new AgenticChatService(store);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Cheap liveness check for the sidebar status bar (client heartbeat).
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/documents', createDocumentRoutes({ store, fileService, classificationService, embeddingService }));
  app.use('/api/categories', createCategoryRoutes({ store }));
  app.use('/api/chat', createChatRoutes({ store, chatService, agenticChatService }));
  app.use('/api/projects', createProjectRoutes({ store }));
  app.use('/api/holdings', createHoldingRoutes({ store }));
  app.use('/api/watchlist', createWatchlistRoutes({ store }));

  return app;
}
