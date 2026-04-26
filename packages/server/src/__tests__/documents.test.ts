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
