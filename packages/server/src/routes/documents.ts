import { Router } from 'express';
import { writeFile } from 'fs/promises';
import { join, basename } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { ManifestService } from '../services/ManifestService';
import { FileService } from '../services/FileService';
import { ClassificationService } from '../services/ClassificationService';
import { CategoryId, Document, mimeFromExtension, SearchHit, SSEEvent } from '@stashd/shared';
import { buildCustomCategory, slugifyCategory } from '../services/categoryStyle';
import { extractPdfText } from '../services/textExtraction';

const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

// The text fragment around the first match, so the client can show *why* a
// document matched. Only sourced from extractedText — other matching fields
// (name, summary, tags) are already visible on the result itself.
function makeSnippet(doc: Document, query: string): string | undefined {
  const q = query.trim().toLowerCase();
  const text = doc.extractedText;
  if (!q || !text) return undefined;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + q.length + 80);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
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
    await writeFile(join(dir, basename(req.file.originalname)), req.file.buffer);

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

      const mimeType = mimeFromExtension(filePath);

      send({ stage: 'extracting', message: 'Extracting document content…' });
      send({ stage: 'classifying', message: 'Classifying with AI…' });

      const { classification, extractedText } = await classificationService.classify(
        filePath,
        mimeType,
        manifestService.getCategories(),
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
    if (!manifestService.getCategory(categoryId)) {
      manifestService.addCategory(buildCustomCategory(categoryId));
    }

    const id = uuidv4();
    const originalName = basename(tempPath);
    const mimeType = mimeFromExtension(originalName);
    const fileSize = await fileService.getFileSize(tempPath);

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
    if (!search) return res.json(docs);
    const hits: SearchHit[] = docs.map(doc => ({ ...doc, snippet: makeSnippet(doc, search) }));
    res.json(hits);
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
    if (category !== undefined && !manifestService.getCategory(category)) {
      return res.status(400).json({ error: 'Unknown category' });
    }

    let updated = 0;
    const now = new Date().toISOString();
    for (const id of ids as string[]) {
      const doc = manifestService.getDocument(id);
      if (!doc) continue;
      let tags = doc.tags;
      if (addTags?.length || removeTags?.length) {
        tags = doc.tags.filter(t => !removeTags?.includes(t));
        for (const t of addTags ?? []) {
          if (t.trim() && !tags.includes(t)) tags = [...tags, t.trim()];
        }
      }
      manifestService.updateDocument(id, {
        ...(category !== undefined && { category: category as CategoryId }),
        ...(status !== undefined && { status }),
        tags,
        updatedAt: now,
      });
      updated++;
    }
    await manifestService.save();
    res.json({ updated });
  });

  // GET /api/documents/:id
  router.get('/:id', (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
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
    const updated = manifestService.updateDocument(req.params.id, {
      ...(category !== undefined && { category: category as CategoryId }),
      ...(tags !== undefined && { tags }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && { status }),
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

    await fileService.deleteDocument(doc.storagePath).catch((err: unknown) => {
      console.warn(`Could not delete file for document ${req.params.id}:`, (err as Error).message);
    });
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
