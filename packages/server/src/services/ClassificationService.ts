import { readFile } from 'fs/promises';
import { basename } from 'path';
import pdfParse from 'pdf-parse';
import { ClassificationResult, DocumentInput } from '@stashd/shared';
import { ModelProvider } from '../providers/ModelProvider';

export class ClassificationService {
  constructor(private readonly provider: ModelProvider) {}

  async classify(filePath: string, mimeType: string): Promise<ClassificationResult> {
    const input = await this.buildInput(filePath, mimeType);
    return this.provider.classify(input);
  }

  private async buildInput(filePath: string, mimeType: string): Promise<DocumentInput> {
    const filename = basename(filePath);

    if (mimeType === 'application/pdf') {
      const buffer = await readFile(filePath);
      let text = '';
      try {
        const result = await pdfParse(buffer);
        text = result.text;
      } catch {
        text = '(Could not extract PDF text)';
      }
      return { filename, mimeType, content: text, isImage: false };
    }

    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const heicConvert = (await import('heic-convert')).default;
      const buffer = await readFile(filePath);
      const jpeg = await heicConvert({
        buffer: buffer as unknown as ArrayBuffer,
        format: 'JPEG',
        quality: 0.9,
      });
      const b64 = Buffer.from(jpeg as ArrayBuffer).toString('base64');
      return { filename, mimeType: 'image/jpeg', content: `data:image/jpeg;base64,${b64}`, isImage: true };
    }

    const buffer = await readFile(filePath);
    const b64 = buffer.toString('base64');
    return { filename, mimeType, content: `data:${mimeType};base64,${b64}`, isImage: true };
  }
}
