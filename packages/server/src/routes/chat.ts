import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Conversation, ChatSSEEvent, ChatMode } from '@stashd/shared';
import { StoreService } from '../services/StoreService';
import { ChatService } from '../services/ChatService';
import { AgenticChatService } from '../services/AgenticChatService';

interface Services {
  store: StoreService;
  chatService: ChatService;
  agenticChatService: AgenticChatService;
}

export function createChatRoutes(services: Services): Router {
  const { store, chatService, agenticChatService } = services;
  const router = Router();

  // GET /api/chat — all conversations, most recent first
  router.get('/', (_req, res) => {
    res.json(store.listConversations());
  });

  // POST /api/chat — start a conversation (mode is fixed per conversation)
  router.post('/', (req, res) => {
    const { title, mode } = (req.body ?? {}) as { title?: string; mode?: string };
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: uuidv4(),
      title: typeof title === 'string' && title.trim() ? title.trim() : 'New conversation',
      mode: mode === 'agentic' ? 'agentic' : 'classic',
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

  // PATCH /api/chat/:id — change the conversation's chat mode
  router.patch('/:id', (req, res) => {
    const { mode } = req.body as { mode?: string };
    if (mode !== 'classic' && mode !== 'agentic') {
      return res.status(400).json({ error: "mode must be 'classic' or 'agentic'" });
    }
    if (!store.setConversationMode(req.params.id, mode)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ mode });
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
    // The conversation's stored mode is the source of truth for which engine
    // answers — set when the chat was started, switchable via PATCH.
    const chatMode: ChatMode = store.getConversationMode(req.params.id) ?? 'classic';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: ChatSSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    await (chatMode === 'agentic' ? agenticChatService : chatService).respond(req.params.id, content.trim(), send);
    res.end();
  });

  return router;
}
