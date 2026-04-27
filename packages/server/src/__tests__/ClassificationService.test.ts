import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClassificationResult, DocumentInput } from '@stashd/shared';
import { ClassificationService } from '../services/ClassificationService';
import { ModelProvider } from '../providers/ModelProvider';

const mockResult: ClassificationResult = {
  category: 'receipts-expenses',
  tags: ['Home Depot', 'lumber'],
  summary: 'Receipt from Home Depot for lumber.',
  parties: [],
  confidence: 0.95,
};

const mockProvider: ModelProvider = {
  classify: jest.fn().mockResolvedValue(mockResult),
};

describe('ClassificationService', () => {
  let tmpDir: string;
  let service: ClassificationService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stashd-classify-'));
    service = new ClassificationService(mockProvider);
    (mockProvider.classify as jest.Mock).mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('passes isImage=false and text content for PDFs', async () => {
    const pdfPath = join(tmpDir, 'test.pdf');
    await writeFile(
      pdfPath,
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 0\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF'),
    );

    await service.classify(pdfPath, 'application/pdf');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(false);
    expect(arg.filename).toBe('test.pdf');
    expect(arg.mimeType).toBe('application/pdf');
  });

  it('passes isImage=true and base64 data URL for JPEGs', async () => {
    const jpgPath = join(tmpDir, 'photo.jpg');
    await writeFile(jpgPath, Buffer.from('fake-jpeg-bytes'));

    await service.classify(jpgPath, 'image/jpeg');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(true);
    expect(arg.content).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('passes isImage=true and base64 data URL for PNGs', async () => {
    const pngPath = join(tmpDir, 'scan.png');
    await writeFile(pngPath, Buffer.from('fake-png-bytes'));

    await service.classify(pngPath, 'image/png');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(true);
    expect(arg.content).toMatch(/^data:image\/png;base64,/);
  });

  it('returns the ClassificationResult from the provider', async () => {
    const jpgPath = join(tmpDir, 'receipt.jpg');
    await writeFile(jpgPath, Buffer.from('fake-jpeg-bytes'));

    const result = await service.classify(jpgPath, 'image/jpeg');
    expect(result).toEqual(mockResult);
  });
});
