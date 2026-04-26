import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManifestService } from '../services/ManifestService';
import { Document } from '@stashd/shared';

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc1',
    filename: 'doc1.pdf',
    originalName: 'test.pdf',
    storagePath: 'documents/other/doc1.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    category: 'other',
    tags: [],
    summary: 'A test document',
    confidenceScore: 0.9,
    status: 'filed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ManifestService', () => {
  let tmpDir: string;
  let service: ManifestService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stashd-manifest-'));
    service = new ManifestService(tmpDir);
    await service.load();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('seeds 13 default categories on first load', () => {
    const cats = service.getCategories();
    expect(cats).toHaveLength(13);
    expect(cats[0].id).toBe('receipts-expenses');
    expect(cats[cats.length - 1].id).toBe('other');
  });

  it('persists documents across instances', async () => {
    const doc = makeDocument();
    service.addDocument(doc);
    await service.save();

    const service2 = new ManifestService(tmpDir);
    await service2.load();
    expect(service2.getDocument('doc1')).toEqual(doc);
  });

  it('searches documents by originalName', () => {
    service.addDocument(makeDocument({ originalName: 'invoice-2025.pdf' }));
    service.addDocument(makeDocument({ id: 'doc2', originalName: 'receipt.jpg' }));
    expect(service.searchDocuments('invoice')).toHaveLength(1);
  });

  it('searches documents by summary', () => {
    service.addDocument(makeDocument({ summary: 'Home Depot lumber receipt' }));
    service.addDocument(makeDocument({ id: 'doc2', summary: 'Medical bill' }));
    expect(service.searchDocuments('lumber')).toHaveLength(1);
  });

  it('filters documents by category', () => {
    service.addDocument(makeDocument({ category: 'receipts-expenses' }));
    service.addDocument(makeDocument({ id: 'doc2', category: 'legal' }));
    expect(service.searchDocuments('', 'receipts-expenses')).toHaveLength(1);
  });

  it('returns all documents when query and category are empty', () => {
    service.addDocument(makeDocument());
    service.addDocument(makeDocument({ id: 'doc2' }));
    expect(service.searchDocuments('')).toHaveLength(2);
  });

  it('updates document fields', () => {
    service.addDocument(makeDocument());
    const updated = service.updateDocument('doc1', { tags: ['urgent'], notes: 'Important' });
    expect(updated?.tags).toEqual(['urgent']);
    expect(updated?.notes).toBe('Important');
  });

  it('returns undefined when updating nonexistent document', () => {
    expect(service.updateDocument('missing', { tags: [] })).toBeUndefined();
  });

  it('removes a document by id', () => {
    service.addDocument(makeDocument());
    expect(service.removeDocument('doc1')).toBe(true);
    expect(service.getDocument('doc1')).toBeUndefined();
  });

  it('returns false when removing nonexistent document', () => {
    expect(service.removeDocument('missing')).toBe(false);
  });
});
