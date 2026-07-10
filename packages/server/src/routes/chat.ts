import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import {
  Conversation,
  ChatSSEEvent,
  ChatAttachment,
  extensionOf,
  isSupportedFilename,
  mimeFromExtension,
  SUPPORTED_EXTENSIONS,
} from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { AgenticChatService } from '../services/AgenticChatService';
import { extractText } from '../services/textExtraction';
import { wrap } from '../middleware';

interface Services {
  store: StoreService;
  agenticChatService: AgenticChatService;
}

const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_TEXT_CAP = 20000;
// Chat-only context is read as text; image types yield no text, so they're
// rejected rather than attached as empty context.
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

export function createChatRoutes(services: Services): Router {
  const { store, agenticChatService } = services;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    // Browsers send multipart filenames as raw UTF-8 bytes; busboy's default
    // is latin1, which turns CJK names into mojibake.
    defParamCharset: 'utf8',
    // Validate by extension, not the browser MIME (unreliable for Office/email).
    // Reject through the callback (not a silent `false`) so the client sees the
    // real reason instead of a generic "A file is required".
    fileFilter: (_req, file, cb) => {
      if (isSupportedFilename(file.originalname)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type. Accepted: ${SUPPORTED_EXTENSIONS.join(', ')}`));
      }
    },
  });

  // GET /api/chat — all conversations, most recent first
  router.get('/', (_req, res) => {
    res.json(store.listConversations());
  });

  // POST /api/chat — start a conversation. A legacy `mode` in the body (from
  // the retired classic/agentic toggle) is silently ignored.
  router.post('/', (req, res) => {
    const { title } = (req.body ?? {}) as { title?: string };
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: uuidv4(),
      title: typeof title === 'string' && title.trim() ? title.trim() : 'New conversation',
      createdAt: now,
      updatedAt: now,
    };
    store.addConversation(conversation);
    res.json(conversation);
  });

  // GET /api/chat/:id — conversation with messages and pins
  router.get('/:id', (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  });

  // DELETE /api/chat/:id
  router.delete('/:id', (req, res) => {
    if (!store.removeConversation(req.params.id)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.status(204).end();
  });

  // PUT /api/chat/:id/pins — replace the pinned-document list
  router.put('/:id/pins', (req, res) => {
    const conversation = store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const { docIds } = req.body as { docIds?: unknown };
    if (!Array.isArray(docIds) || !docIds.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'docIds must be an array of document ids' });
    }
    const valid = docIds.filter(id => store.getDocument(id));
    store.setPins(req.params.id, valid);
    res.json({ pinnedDocIds: valid });
  });

  // POST /api/chat/:id/attachments — drop a file into the conversation as
  // throwaway context: extract its text and store it, but never file it in the
  // stash. Text-bearing types only (images yield no text).
  router.post(
    '/:id/attachments',
    (req, res, next) => {
      upload.single('file')(req, res, err => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large (max 50MB)' });
        }
        if (err) {
          return res.status(400).json({ error: err.message });
        }
        next();
      });
    },
    wrap(async (req, res) => {
      if (!store.getConversation(req.params.id)) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'A file is required' });
      if (IMAGE_EXTS.has(extensionOf(file.originalname))) {
        return res.status(400).json({ error: 'Images can’t be attached to chat — they carry no text to read.' });
      }

      // The client-supplied filename can carry path segments ("../../x.md");
      // basename() confines the write to the temp dir.
      const safeName = basename(file.originalname);

      // extractText dispatches by the path's extension, so write a temp file
      // that preserves the original name, extract, then clean up.
      let dir: string | undefined;
      let text = '';
      try {
        dir = await mkdtemp(join(tmpdir(), 'stashd-chat-'));
        const tempPath = join(dir, safeName);
        await writeFile(tempPath, file.buffer);
        text = (await extractText(tempPath, mimeFromExtension(safeName)))?.slice(0, ATTACHMENT_TEXT_CAP) ?? '';
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      }

      if (!text.trim()) {
        return res.status(422).json({ error: 'No readable text could be extracted from this file.' });
      }

      const attachment: ChatAttachment = {
        id: uuidv4(),
        conversationId: req.params.id,
        name: safeName,
        mime: mimeFromExtension(safeName),
        text,
        createdAt: new Date().toISOString(),
      };
      store.addChatAttachment(attachment);
      res.status(201).json(attachment);
    }),
  );

  // DELETE /api/chat/:id/attachments/:attId
  router.delete('/:id/attachments/:attId', (req, res) => {
    if (!store.removeChatAttachment(req.params.id, req.params.attId)) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    res.status(204).end();
  });

  // POST /api/chat/:id/actions/:actionId — resolve a queued write proposal
  // (confirm-before-apply). { approve: true } executes the server-stored args;
  // { approve: false } dismisses. 409 once resolved either way.
  router.post('/:id/actions/:actionId', wrap(async (req, res) => {
    const { approve } = (req.body ?? {}) as { approve?: unknown };
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ error: 'approve (boolean) is required' });
    }
    const outcome = await agenticChatService.resolveAction(req.params.id, req.params.actionId, approve);
    if (!outcome.ok) return res.status(outcome.code).json({ error: outcome.error });
    res.json(outcome.resolution);
  }));

  // POST /api/chat/:id/messages — send a user message, stream the answer (SSE)
  router.post('/:id/messages', wrap(async (req, res) => {
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: ChatSSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    await agenticChatService.respond(req.params.id, content.trim(), send);
    res.end();
  }));

  return router;
}
