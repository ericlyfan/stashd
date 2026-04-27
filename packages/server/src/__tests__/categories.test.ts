import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Express } from 'express';
import { createApp } from '../app';
import { ClassificationService } from '../services/ClassificationService';
import { ClassificationResult } from '@stashd/shared';

function makeMockClassificationService(): ClassificationService {
  return {
    classify: jest.fn().mockResolvedValue({
      category: 'other', tags: [], summary: '', parties: [], confidence: 0.9,
    } as ClassificationResult),
  } as unknown as ClassificationService;
}

describe('GET /api/categories', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-cats-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('returns 13 default categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(13);
  });

  it('includes documentCount on each category', async () => {
    const res = await request(app).get('/api/categories');
    expect(typeof res.body[0].documentCount).toBe('number');
  });

  it('documentCount reflects filed documents', async () => {
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };
    await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Test', confidenceScore: 0.9 });

    const res = await request(app).get('/api/categories');
    const other = (res.body as Array<{ id: string; documentCount: number }>).find(c => c.id === 'other');
    expect(other?.documentCount).toBe(1);
  });
});
