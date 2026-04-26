import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Express } from 'express';
import { createApp } from '../app';
import { ClassificationService } from '../services/ClassificationService';
import { ClassificationResult } from '@stashd/shared';

const mockClassification: ClassificationResult = {
  category: 'other',
  tags: [],
  summary: 'Test document.',
  parties: [],
  confidence: 0.9,
};

function makeMockClassificationService(): ClassificationService {
  return {
    classify: jest.fn().mockResolvedValue(mockClassification),
  } as unknown as ClassificationService;
}

describe('POST /api/documents/upload', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-routes-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('returns 400 for unsupported file types', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('hello world'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported/i);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/documents/upload');
    expect(res.status).toBe(400);
  });

  it('returns a jobId for a valid PDF upload', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'test.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
  });

  it('returns a jobId for a valid JPEG upload', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('fake-jpeg'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe('string');
  });
});

describe('Document CRUD routes', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-crud-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  async function uploadAndFile(overrides: Record<string, unknown> = {}) {
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };

    const fileRes = await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Test doc', confidenceScore: 0.9, ...overrides });
    return fileRes.body as { id: string };
  }

  it('GET /api/documents returns all documents', async () => {
    await uploadAndFile();
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it('GET /api/documents?category=other filters by category', async () => {
    await uploadAndFile({ category: 'other' });
    const res = await request(app).get('/api/documents?category=legal');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('GET /api/documents/:id returns a single document', async () => {
    const doc = await uploadAndFile();
    const res = await request(app).get(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(doc.id);
  });

  it('GET /api/documents/:id returns 404 for missing document', async () => {
    const res = await request(app).get('/api/documents/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/documents/:id updates tags and notes', async () => {
    const doc = await uploadAndFile();
    const res = await request(app)
      .patch(`/api/documents/${doc.id}`)
      .send({ tags: ['updated'], notes: 'My note' });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(['updated']);
    expect(res.body.notes).toBe('My note');
  });

  it('DELETE /api/documents/:id removes the document', async () => {
    const doc = await uploadAndFile();
    const delRes = await request(app).delete(`/api/documents/${doc.id}`);
    expect(delRes.status).toBe(204);
    const getRes = await request(app).get(`/api/documents/${doc.id}`);
    expect(getRes.status).toBe(404);
  });

  it('POST /api/documents/file/:jobId with flagForLater sets status=pending', async () => {
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };
    const fileRes = await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Pending doc', confidenceScore: 0.5, flagForLater: true });
    expect(fileRes.body.status).toBe('pending');
  });
});
