import { Router } from 'express';
import { writeFile, stat } from 'fs/promises';
import { join } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { ManifestService } from '../services/ManifestService';
import { FileService } from '../services/FileService';
import { ClassificationService } from '../services/ClassificationService';
import { CategoryId, Document, SSEEvent } from '@stashd/shared';

const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

function getMimeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

interface Services {
  manifestService: ManifestService;
  fileService: FileService;
  classificationService: ClassificationService;
}

export function createDocumentRoutes(services: Services): Router {
  const { manifestService, fileService, classificationService } = services;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
      }
    },
  });

  // POST /api/documents/upload
  router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, err => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 50MB)' });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file attached' });

    const jobId = uuidv4();
    const dir = await fileService.createTempDir(jobId);
    await writeFile(join(dir, req.file.originalname), req.file.buffer);

    res.json({ jobId });
  });

  // GET /api/documents/process/:jobId — SSE
  router.get('/process/:jobId', async (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: SSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const filePath = await fileService.getTempFilePath(jobId);
      if (!filePath) {
        send({ stage: 'error', message: 'Job not found', error: 'Job not found' });
        return res.end();
      }

      const mimeType = getMimeFromExtension(filePath);

      send({ stage: 'extracting', message: 'Extracting document content…' });
      send({ stage: 'classifying', message: 'Classifying with AI…' });

      const classification = await classificationService.classify(filePath, mimeType);

      send({ stage: 'complete', message: 'Classification complete', classification });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      send({ stage: 'error', message: 'Classification failed', error });
    }

    res.end();
  });

  // POST /api/documents/file/:jobId
  router.post('/file/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { category, subcategory, tags, summary, dateExtracted, amount, vendor, notes, confidenceScore, flagForLater } = req.body as {
      category: string;
      subcategory?: string;
      tags?: string[];
      summary?: string;
      dateExtracted?: string;
      amount?: number;
      vendor?: string;
      notes?: string;
      confidenceScore?: number;
      flagForLater?: boolean;
    };

    const tempPath = await fileService.getTempFilePath(jobId);
    if (!tempPath) return res.status(404).json({ error: 'Job not found' });

    const id = uuidv4();
    const originalName = tempPath.split('/').pop() ?? 'file';
    const mimeType = getMimeFromExtension(originalName);
    const tempStats = await stat(tempPath);
    const fileSize = tempStats.size;

    const storagePath = await fileService.moveToDocuments(jobId, category, id, originalName);

    const now = new Date().toISOString();
    const doc: Document = {
      id,
      filename: storagePath.split('/').pop() ?? id,
      originalName,
      storagePath,
      fileType: mimeType,
      fileSize,
      category: category as CategoryId,
      subcategory,
      tags: Array.isArray(tags) ? tags : [],
      summary: summary ?? '',
      dateExtracted,
      amount,
      vendor,
      confidenceScore: confidenceScore ?? 0,
      status: flagForLater ? 'pending' : 'filed',
      notes,
      createdAt: now,
      updatedAt: now,
    };

    manifestService.addDocument(doc);
    await manifestService.save();

    res.json(doc);
  });

  // GET /api/documents
  router.get('/', (req, res) => {
    const { search, category } = req.query as { search?: string; category?: string };
    const docs = manifestService.searchDocuments(search ?? '', category as CategoryId | undefined);
    res.json(docs);
  });

  // GET /api/documents/:id
  router.get('/:id', (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  });

  // PATCH /api/documents/:id
  router.patch('/:id', async (req, res) => {
    const { category, tags, notes } = req.body as {
      category?: string;
      tags?: string[];
      notes?: string;
    };
    const updated = manifestService.updateDocument(req.params.id, {
      ...(category !== undefined && { category: category as CategoryId }),
      ...(tags !== undefined && { tags }),
      ...(notes !== undefined && { notes }),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Document not found' });
    await manifestService.save();
    res.json(updated);
  });

  // DELETE /api/documents/:id
  router.delete('/:id', async (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await fileService.deleteDocument(doc.storagePath).catch(() => {});
    manifestService.removeDocument(req.params.id);
    await manifestService.save();

    res.status(204).end();
  });

  // GET /api/documents/:id/file
  router.get('/:id/file', (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.sendFile(fileService.absolutePath(doc.storagePath));
  });

  return router;
}
