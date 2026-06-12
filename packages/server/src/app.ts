import express, { Express } from 'express';
import cors from 'cors';
import { ManifestService } from './services/ManifestService';
import { FileService } from './services/FileService';
import { ClassificationService } from './services/ClassificationService';
import { getProvider } from './providers';
import { createDocumentRoutes } from './routes/documents';
import { backfillExtractedText } from './services/textExtraction';
import { createCategoryRoutes } from './routes/categories';

interface AppOverrides {
  classificationService?: ClassificationService;
}

export async function createApp(dataDir: string, overrides: AppOverrides = {}): Promise<Express> {
  const manifestService = new ManifestService(dataDir);
  await manifestService.load();

  const fileService = new FileService(dataDir);
  await fileService.ensureDirs();

  // Catch up documents filed before extractedText existed; runs in the
  // background so startup isn't blocked by a large stash.
  void backfillExtractedText(manifestService, fileService).catch((err: unknown) => {
    console.warn('Text backfill failed:', (err as Error).message);
  });

  const provider = getProvider(process.env.PROVIDER ?? 'ollama');
  const classificationService = overrides.classificationService ?? new ClassificationService(provider);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/documents', createDocumentRoutes({ manifestService, fileService, classificationService }));
  app.use('/api/categories', createCategoryRoutes({ manifestService }));

  return app;
}
