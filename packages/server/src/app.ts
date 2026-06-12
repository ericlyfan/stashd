import express, { Express } from 'express';
import cors from 'cors';
import { StoreService } from './services/StoreService';
import { FileService } from './services/FileService';
import { ClassificationService } from './services/ClassificationService';
import { getProvider } from './providers';
import { createDocumentRoutes } from './routes/documents';
import { backfillDerivedFields } from './services/textExtraction';
import { createCategoryRoutes } from './routes/categories';

interface AppOverrides {
  classificationService?: ClassificationService;
}

export async function createApp(dataDir: string, overrides: AppOverrides = {}): Promise<Express> {
  const store = new StoreService(dataDir);
  await store.load();

  const fileService = new FileService(dataDir);
  await fileService.ensureDirs();

  // Catch up documents filed before extractedText / contentHash existed;
  // runs in the background so startup isn't blocked by a large stash.
  void backfillDerivedFields(store, fileService).catch((err: unknown) => {
    console.warn('Backfill failed:', (err as Error).message);
  });

  const provider = getProvider(process.env.PROVIDER ?? 'ollama');
  const classificationService = overrides.classificationService ?? new ClassificationService(provider);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/documents', createDocumentRoutes({ store, fileService, classificationService }));
  app.use('/api/categories', createCategoryRoutes({ store }));

  return app;
}
