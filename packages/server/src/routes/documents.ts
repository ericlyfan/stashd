import { Router } from "express";
import { readFile, writeFile } from "fs/promises";
import { join, basename } from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { StoreService } from "../services/StoreService";
import { FileService } from "../services/FileService";
import { ClassificationService } from "../services/ClassificationService";
import { EmbeddingService } from "../services/EmbeddingService";
import {
  CategoryId,
  Document,
  isSupportedFilename,
  mimeFromExtension,
  SSEEvent,
  SUPPORTED_EXTENSIONS,
  UploadResponse,
} from "@stashd/shared";
import { buildCustomCategory, slugifyCategory } from "../services/categoryStyle";
import { extractText, hashBuffer } from "../services/textExtraction";
import { EmailAttachment, parseEmail } from "../services/emailParse";

const EMAIL_MIMES = ["message/rfc822", "application/vnd.ms-outlook"];

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

  // File one email attachment as its own document: classify it independently
  // (reusing the same model pipeline as a normal upload) and file it flagged
  // for review, noting which email it came from. Runs in the background so
  // filing the parent email never waits on the model.
  async function spinOffAttachment(att: EmailAttachment, parent: Document): Promise<void> {
    const jobId = uuidv4();
    const dir = await fileService.createTempDir(jobId);
    const safeName = basename(att.filename);
    await writeFile(join(dir, safeName), att.content);
    const tempPath = join(dir, safeName);
    const mimeType = mimeFromExtension(safeName);

    const { classification, extractedText } = await classificationService.classify(
      tempPath,
      mimeType,
      store.getCategories(),
    );

    const categoryId = slugifyCategory(classification.category);
    if (!store.getCategory(categoryId)) {
      store.addCategory(buildCustomCategory(categoryId));
    }

    const id = uuidv4();
    const storagePath = await fileService.moveToDocuments(jobId, categoryId, id, safeName);
    const now = new Date().toISOString();
    const doc: Document = {
      id,
      filename: basename(storagePath),
      originalName: safeName,
      storagePath,
      fileType: mimeType,
      fileSize: att.content.length,
      category: categoryId as CategoryId,
      subcategory: classification.subcategory,
      tags: Array.isArray(classification.tags) ? classification.tags : [],
      summary: classification.summary ?? "",
      dateExtracted: classification.date,
      amount: classification.amount,
      vendor: classification.vendor,
      confidenceScore: classification.confidence ?? 0,
      // Flagged so the user gets a second look at auto-extracted attachments.
      status: "pending",
      notes: `Attachment from email “${parent.originalName}”.`,
      extractedText,
      contentHash: hashBuffer(att.content),
      createdAt: now,
      updatedAt: now,
    };
    store.addDocument(doc);
    void embeddingService.indexDocument(doc).catch((err: unknown) => {
      console.warn(`Embedding failed for ${doc.originalName}:`, (err as Error).message);
    });
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    // Browsers send multipart filenames as raw UTF-8 bytes; busboy's default
    // is latin1, which turns CJK names into mojibake.
    defParamCharset: "utf8",
    // Validate by extension, not the browser-reported mime: browsers send
    // inconsistent (often empty/octet-stream) mimes for office and email
    // formats, and the whole pipeline keys off the extension anyway.
    fileFilter: (_req, file, cb) => {
      if (isSupportedFilename(file.originalname)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type. Accepted: ${SUPPORTED_EXTENSIONS.join(", ")}`));
      }
    },
  });

  // POST /api/documents/upload
  router.post(
    "/upload",
    (req, res, next) => {
      upload.single("file")(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 50MB)" });
        }
        if (err) {
          return res.status(400).json({ error: err.message });
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: "No file attached" });

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
    },
  );

  // DELETE /api/documents/job/:jobId — discard an in-flight upload (temp file
  // + sidecar). Idempotent: discarding an unknown job is a 204 too.
  router.delete("/job/:jobId", async (req, res) => {
    if (!JOB_ID_RE.test(req.params.jobId)) {
      return res.status(400).json({ error: "Invalid job id" });
    }
    await fileService.removeTempDir(req.params.jobId);
    res.status(204).end();
  });

  // GET /api/documents/process/:jobId — SSE
  router.get("/process/:jobId", async (req, res) => {
    const { jobId } = req.params;
    if (!JOB_ID_RE.test(jobId)) {
      return res.status(400).json({ error: "Invalid job id" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: SSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const filePath = await fileService.getTempFilePath(jobId);
      if (!filePath) {
        send({ stage: "error", message: "Job not found", error: "Job not found" });
        return res.end();
      }

      const mimeType = mimeFromExtension(filePath);

      send({ stage: "extracting", message: "Extracting document content…" });
      send({ stage: "classifying", message: "Classifying with AI…" });

      const { classification, extractedText } = await classificationService.classify(
        filePath,
        mimeType,
        store.getCategories(),
      );
      // Persist alongside the temp file so it survives a server restart
      // between classify and file (matters for images, which can't be
      // re-extracted without another model call).
      if (extractedText) await fileService.saveJobText(jobId, extractedText);

      send({ stage: "complete", message: "Classification complete", classification });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      send({ stage: "error", message: "Classification failed", error });
    }

    res.end();
  });

  // POST /api/documents/file/:jobId
  router.post("/file/:jobId", async (req, res) => {
    const { jobId } = req.params;
    if (!JOB_ID_RE.test(jobId)) {
      return res.status(400).json({ error: "Invalid job id" });
    }
    const {
      category,
      subcategory,
      tags,
      summary,
      dateExtracted,
      amount,
      vendor,
      notes,
      confidenceScore,
      flagForLater,
    } = req.body as {
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
    if (!tempPath) return res.status(404).json({ error: "Job not found" });

    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "Category is required" });
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

    // Text captured at classify time (sidecar file); last-resort re-extract
    // for any text-bearing type whose sidecar is missing (images have none).
    let extractedText = await fileService.readJobText(jobId);
    if (!extractedText) {
      extractedText = await extractText(tempPath, mimeType);
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
      summary: summary ?? "",
      dateExtracted,
      amount,
      vendor,
      confidenceScore: confidenceScore ?? 0,
      status: flagForLater ? "pending" : "filed",
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

    // Emails fan out: each supported attachment becomes its own document,
    // classified independently and filed flagged. Backgrounded so the email's
    // response returns immediately; the client refreshes to pick them up.
    let attachmentsSpawned = 0;
    if (EMAIL_MIMES.includes(mimeType)) {
      const email = await parseEmail(fileService.absolutePath(storagePath));
      const supported = (email?.attachments ?? []).filter((a) => isSupportedFilename(a.filename));
      attachmentsSpawned = supported.length;
      for (const att of supported) {
        void spinOffAttachment(att, doc).catch((err: unknown) => {
          console.warn(`Attachment spin-off failed for ${att.filename}:`, (err as Error).message);
        });
      }
    }

    res.json({ ...doc, attachmentsSpawned });
  });

  // GET /api/documents
  router.get("/", (req, res) => {
    const { search, category } = req.query as { search?: string; category?: string };
    res.json(store.searchDocuments(search ?? "", category as CategoryId | undefined));
  });

  // PATCH /api/documents — batch update
  router.patch("/", async (req, res) => {
    const { ids, category, status, addTags, removeTags } = req.body as {
      ids?: unknown;
      category?: string;
      status?: string;
      addTags?: string[];
      removeTags?: string[];
    };
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((item) => typeof item === "string");
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return res.status(400).json({ error: "ids must be a non-empty array of document ids" });
    }
    if (status !== undefined && status !== "pending" && status !== "filed") {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (addTags !== undefined && !isStringArray(addTags)) {
      return res.status(400).json({ error: "addTags must be an array of strings" });
    }
    if (removeTags !== undefined && !isStringArray(removeTags)) {
      return res.status(400).json({ error: "removeTags must be an array of strings" });
    }
    if (category !== undefined && !store.getCategory(category)) {
      return res.status(400).json({ error: "Unknown category" });
    }

    let updated = 0;
    const now = new Date().toISOString();
    for (const id of ids as string[]) {
      const doc = store.getDocument(id);
      if (!doc) continue;
      let tags = doc.tags;
      if (addTags?.length || removeTags?.length) {
        tags = doc.tags.filter((t) => !removeTags?.includes(t));
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

  // DELETE /api/documents — batch delete. Declared on "/" (not "/:id") so it
  // never shadows the single-document delete; mirrors the per-id cleanup
  // (file + row + vector index) for each id, skipping ones already gone.
  router.delete("/", async (req, res) => {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return res.status(400).json({ error: "ids must be a non-empty array of document ids" });
    }
    let deleted = 0;
    for (const id of ids as string[]) {
      const doc = store.getDocument(id);
      if (!doc) continue;
      await fileService.deleteDocument(doc.storagePath).catch((err: unknown) => {
        console.warn(`Could not delete file for document ${id}:`, (err as Error).message);
      });
      store.removeDocument(id);
      embeddingService.removeDocument(id);
      deleted++;
    }
    res.json({ deleted });
  });

  // GET /api/documents/:id
  router.get("/:id", (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json(doc);
  });

  // PATCH /api/documents/:id
  router.patch("/:id", async (req, res) => {
    const { category, tags, notes, status } = req.body as {
      category?: string;
      tags?: string[];
      notes?: string;
      status?: string;
    };
    if (status !== undefined && status !== "pending" && status !== "filed") {
      return res.status(400).json({ error: "Invalid status" });
    }
    const updated = store.updateDocument(req.params.id, {
      ...(category !== undefined && { category: category as CategoryId }),
      ...(tags !== undefined && { tags }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && { status }),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: "Document not found" });
    res.json(updated);
  });

  // DELETE /api/documents/:id
  router.delete("/:id", async (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    await fileService.deleteDocument(doc.storagePath).catch((err: unknown) => {
      console.warn(`Could not delete file for document ${req.params.id}:`, (err as Error).message);
    });
    store.removeDocument(req.params.id);
    embeddingService.removeDocument(req.params.id);

    res.status(204).end();
  });

  // GET /api/documents/:id/file
  router.get("/:id/file", (req, res) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.sendFile(fileService.absolutePath(doc.storagePath));
  });

  return router;
}
