import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Conversation, ChatSSEEvent } from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { ChatService } from '../services/ChatService';

interface Services {
  store: StoreService;
  chatService: ChatService;
}

export function createChatRoutes(services: Services): Router {
  const { store, chatService } = services;
  const router = Router();

  // GET /api/chat — all conversations, most recent first
  router.get('/', (_req, res) => {
    res.json(store.listConversations());
  });

  // POST /api/chat — start a conversation
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

  // POST /api/chat/:id/messages — send a user message, stream the answer (SSE)
  router.post('/:id/messages', async (req, res) => {
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: ChatSSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    await chatService.respond(req.params.id, content.trim(), send);
    res.end();
  });

  return router;
}
