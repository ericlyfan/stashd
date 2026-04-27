import { mkdtemp, rm, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileService } from '../services/FileService';

describe('FileService', () => {
  let dataDir: string;
  let service: FileService;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-file-'));
    service = new FileService(dataDir);
    await service.ensureDirs();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('creates temp dir for a jobId', async () => {
    const dir = await service.createTempDir('job-abc');
    const entries = await readdir(join(dataDir, 'temp'));
    expect(entries).toContain('job-abc');
    expect(dir).toBe(join(dataDir, 'temp', 'job-abc'));
  });

  it('returns null for a missing job', async () => {
    expect(await service.getTempFilePath('nonexistent')).toBeNull();
  });

  it('returns the file path for a known job', async () => {
    await service.createTempDir('job-xyz');
    await writeFile(join(dataDir, 'temp', 'job-xyz', 'document.pdf'), 'PDF content');
    expect(await service.getTempFilePath('job-xyz')).toBe(
      join(dataDir, 'temp', 'job-xyz', 'document.pdf'),
    );
  });

  it('moves a file to the documents directory with docId as filename', async () => {
    await service.createTempDir('job-move');
    await writeFile(join(dataDir, 'temp', 'job-move', 'receipt.pdf'), 'PDF content');

    const storagePath = await service.moveToDocuments('job-move', 'receipts-expenses', 'doc123', 'receipt.pdf');

    expect(storagePath).toBe(join('documents', 'receipts-expenses', 'doc123.pdf'));
    const destFiles = await readdir(join(dataDir, 'documents', 'receipts-expenses'));
    expect(destFiles).toContain('doc123.pdf');
  });

  it('throws when moving a file for a missing jobId', async () => {
    await expect(
      service.moveToDocuments('no-such-job', 'other', 'doc999', 'file.pdf'),
    ).rejects.toThrow('No temp file for jobId: no-such-job');
  });

  it('absolutePath returns the full filesystem path', () => {
    expect(service.absolutePath('documents/other/doc1.pdf')).toBe(
      join(dataDir, 'documents', 'other', 'doc1.pdf'),
    );
  });
});
