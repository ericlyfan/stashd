import { readFile } from 'fs/promises';
import { basename } from 'path';
import { Category, ClassificationResult, DocumentInput } from '@stashd/shared';
import { ModelProvider } from '../providers/ModelProvider';
import { extractPdfText, truncateText } from './textExtraction';

export interface ClassifyOutcome {
  classification: ClassificationResult;
  // Searchable text: pdf-parse output for PDFs, model transcription for images.
  extractedText?: string;
}

export class ClassificationService {
  constructor(private readonly provider: ModelProvider) {}

  async classify(filePath: string, mimeType: string, existingCategories: Category[]): Promise<ClassifyOutcome> {
    const input = await this.buildInput(filePath, mimeType);
    const classification = await this.provider.classify(input, existingCategories);
    const extractedText = input.isImage
      ? classification.transcription && truncateText(classification.transcription)
      : input.content && input.content !== '(Could not extract PDF text)'
        ? truncateText(input.content)
        : undefined;
    return { classification, extractedText: extractedText || undefined };
  }

  private async buildInput(filePath: string, mimeType: string): Promise<DocumentInput> {
    const filename = basename(filePath);

    if (mimeType === 'application/pdf') {
      const text = await extractPdfText(filePath);
      return { filename, mimeType, content: text ?? '(Could not extract PDF text)', isImage: false };
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
