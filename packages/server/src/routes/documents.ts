import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { StoreService } from '../services/StoreService';
import { FileService } from '../services/FileService';
import { ClassificationService } from '../services/ClassificationService';
import { EmbeddingService } from '../services/EmbeddingService';
import { CategoryId, Document, mimeFromExtension, SSEEvent, UploadResponse } from '@stashd/shared';
import { buildCustomCategory, slugifyCategory } from '../services/categoryStyle';
import { extractPdfText, hashBuffer } from '../services/textExtraction';

const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

// Job ids are server-generated UUIDs; anything else in a :jobId param is a
// path-traversal attempt (e.g. ".."), not a real job.
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Services {
  store: StoreService;
  fileService: FileService;
  classificationService: ClassificationService;
  embeddingService: EmbeddingService;
}

export function createDocumentRoutes(services: Services): Router {
  const { store, fileService, classificationService, embeddingService } = services;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    // Browsers send multipart filenames as raw UTF-8 bytes; busboy's default
    // is latin1, which turns CJK names into mojibake.
    defParamCharset: 'utf8',
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
    await writeFile(join(dir, basename(req.file.originalname)), req.file.buffer);

    // Duplicate check is advisory only — the upload always proceeds; the
    // client decides what to surface.
    const existing = store.findDocumentByHash(hashBuffer(req.file.buffer));
    const response: UploadResponse = {
      jobId,
      ...(existing && {
        duplicate: { id: existing.id, originalName: existing.originalName, category: existing.category },
      }),
    };
    res.json(response);
  });

  // DELETE /api/documents/job/:jobId — discard an in-flight upload (temp file
  // + sidecar). Idempotent: discarding an unknown job is a 204 too.
  router.delete('/job/:jobId', async (req, res) => {
    if (!JOB_ID_RE.test(req.params.jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    await fileService.removeTempDir(req.params.jobId);
    res.status(204).end();
  });

  // GET /api/documents/process/:jobId — SSE
  router.get('/process/:jobId', async (req, res) => {
    const { jobId } = req.params;
    if (!JOB_ID_RE.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

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

      const mimeType = mimeFromExtension(filePath);

      send({ stage: 'extracting', message: 'Extracting document content…' });
      send({ stage: 'classifying', message: 'Classifying with AI…' });

      const { classification, extractedText } = await classificationService.classify(
        filePath,
        mimeType,
        store.getCategories(),
      );
      // Persist alongside the temp file so it survives a server restart
      // between classify and file (matters for images, which can't be
      // re-extracted without another model call).
      if (extractedText) await fileService.saveJobText(jobId, extractedText);

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
    if (!JOB_ID_RE.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
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

    if (typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'Category is required' });
    }
    const categoryId = slugifyCategory(category);
    if (!store.getCategory(categoryId)) {
      store.addCategory(buildCustomCategory(categoryId));
    }

    const id = uuidv4();
    const originalName = basename(tempPath);
    const mimeType = mimeFromExtension(originalName);
    const fileSize = await fileService.getFileSize(tempPath);
    const contentHash = hashBuffer(await readFile(tempPath));

    // Text captured at classify time (sidecar file); last-resort re-parse
    // for PDFs whose sidecar is missing.
    let extractedText = await fileService.readJobText(jobId);
    if (!extractedText && mimeType === 'application/pdf') {
      extractedText = await extractPdfText(tempPath);
    }
    await fileService.deleteJobText(jobId);

    const storagePath = await fileService.moveToDocuments(jobId, categoryId, id, originalName);

    const now = new Date().toISOString();
    const doc: Document = {
      id,
      filename: basename(storagePath),
      originalName,
      storagePath,
      fileType: mimeType,
      fileSize,
      category: categoryId as CategoryId,
      subcategory,
      tags: Array.isArray(tags) ? tags : [],
      summary: summary ?? '',
      dateExtracted,
      amount,
      vendor,
      confidenceScore: confidenceScore ?? 0,
      status: flagForLater ? 'pending' : 'filed',
      notes,
      extractedText,
      contentHash,
      createdAt: now,
      updatedAt: now,
    };

    store.addDocument(doc);

    // Vector-index in the background; filing never waits on the embedder.
    void embeddingService.indexDocument(doc).catch((err: unknown) => {
      console.warn(`Embedding failed for ${doc.originalName}:`, (err as Error).message);
    });

    res.json(doc);
  });

  // GET /api/documents
  router.get('/', (req, res) => {
    const { search, category } = req.query as { search?: string; category?: string };
    res.json(store.searchDocuments(search ?? '', category as CategoryId | undefined));
  });

  // PATCH /api/documents — batch update
  router.patch('/', async (req, res) => {
    const { ids, category, status, addTags, removeTags } = req.body as {
      ids?: unknown;
      category?: string;
      status?: string;
      addTags?: string[];
      removeTags?: string[];
    };
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every(item => typeof item === 'string');
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'ids must be a non-empty array of document ids' });
    }
    if (status !== undefined && status !== 'pending' && status !== 'filed') {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (addTags !== undefined && !isStringArray(addTags)) {
      return res.status(400).json({ error: 'addTags must be an array of strings' });
    }
    if (removeTags !== undefined && !isStringArray(removeTags)) {
      return res.status(400).json({ error: 'removeTags must be an array of strings' });
    }
    if (category !== undefined && !store.getCategory(category)) {
      return res.status(400).json({ error: 'Unknown category' });
    }

    let updated = 0;
    const now = new Date().toISOString();
    for (const id of ids as string[]) {
      const doc = store.getDocument(id);
      if (!doc) continue;
      let tags = doc.tags;
      if (addTags?.length || removeTags?.length) {
        tags = doc.tags.filter(t => !removeTags?.includes(t));
        for (const t of addTags ?? []) {
          if (t.trim() && !tags.includes(t)) tags = [...tags, t.trim()];
        }
      }
      store.updateDocument(id, {
        ...(category !== undefined && { category: category as CategoryId }),
        ...(status !== undefined && { status }),
        tags,
        updatedAt: now,
      });
      updated++;
    }
    res.json({ updated });
  });

  // GET /api/documents/:id
  router.get('/:id', (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  });

  // PATCH /api/documents/:id
  router.patch('/:id', async (req, res) => {
    const { category, tags, notes, status } = req.body as {
      category?: string;
      tags?: string[];
      notes?: string;
      status?: string;
    };
    if (status !== undefined && status !== 'pending' && status !== 'filed') {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updated = store.updateDocument(req.params.id, {
      ...(category !== undefined && { category: category as CategoryId }),
      ...(tags !== undefined && { tags }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && { status }),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Document not found' });
    res.json(updated);
  });

  // DELETE /api/documents/:id
  router.delete('/:id', async (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await fileService.deleteDocument(doc.storagePath).catch((err: unknown) => {
      console.warn(`Could not delete file for document ${req.params.id}:`, (err as Error).message);
    });
    store.removeDocument(req.params.id);
    embeddingService.removeDocument(req.params.id);

    res.status(204).end();
  });

  // GET /api/documents/:id/file
  router.get('/:id/file', (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.sendFile(fileService.absolutePath(doc.storagePath));
  });

  return router;
}
