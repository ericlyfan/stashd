import { readFile } from 'fs/promises';
import pdfParse from 'pdf-parse';
import { ManifestService } from './ManifestService';
import { FileService } from './FileService';

// Keep manifest.json from ballooning: enough text for search, not the whole book.
export const MAX_EXTRACTED_CHARS = 20_000;

export function truncateText(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? trimmed.slice(0, MAX_EXTRACTED_CHARS) : trimmed;
}

export async function extractPdfText(filePath: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(filePath);
    const result = await pdfParse(buffer);
    return truncateText(result.text);
  } catch {
    return undefined;
  }
}

// One-time catch-up for documents filed before extractedText existed.
// PDFs only — image text needs a model call, which happens at classify time.
export async function backfillExtractedText(
  manifestService: ManifestService,
  fileService: FileService,
): Promise<void> {
  let changed = 0;
  for (const doc of manifestService.getDocuments()) {
    if (doc.extractedText !== undefined || doc.fileType !== 'application/pdf') continue;
    const text = await extractPdfText(fileService.absolutePath(doc.storagePath));
    if (text) {
      doc.extractedText = text;
      changed++;
    }
  }
  if (changed > 0) {
    await manifestService.save();
    console.log(`Backfilled extracted text for ${changed} document${changed === 1 ? '' : 's'}`);
  }
}
