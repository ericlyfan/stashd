import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import pdfParse from 'pdf-parse';
import { StoreService } from './StoreService';
import { FileService } from './FileService';

// Keep stored text bounded: enough for search, not the whole book.
export const MAX_EXTRACTED_CHARS = 20_000;

export function truncateText(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? trimmed.slice(0, MAX_EXTRACTED_CHARS) : trimmed;
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// Repair filenames stored before multipart names were decoded as UTF-8:
// re-interpret the latin1-mojibake bytes as UTF-8. Returns undefined when the
// name can't be (or doesn't need to be) repaired.
export function repairMojibakeName(name: string): string | undefined {
  // Real UTF-8 text (codepoints above latin1) can't be mojibake; pure ASCII
  // round-trips unchanged. Only the latin1 range in between is suspect.
  if (!/[\u0080-\u00ff]/.test(name)) return undefined;
  if ([...name].some(c => c.codePointAt(0)! > 0xff)) return undefined;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (decoded === name || decoded.includes('�')) return undefined;
  return decoded;
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

// One-time catch-up for documents filed before extractedText / contentHash
// existed. Text is PDFs only — image text needs a model call, which happens
// at classify time. Hashes cover every file type.
export async function backfillDerivedFields(
  store: StoreService,
  fileService: FileService,
): Promise<void> {
  let changed = 0;
  for (const doc of store.getDocuments()) {
    const updates: { extractedText?: string; contentHash?: string; originalName?: string } = {};

    const repairedName = repairMojibakeName(doc.originalName);
    if (repairedName) updates.originalName = repairedName;

    if (doc.extractedText === undefined && doc.fileType === 'application/pdf') {
      const text = await extractPdfText(fileService.absolutePath(doc.storagePath));
      if (text) updates.extractedText = text;
    }
    if (doc.contentHash === undefined) {
      try {
        updates.contentHash = hashBuffer(await readFile(fileService.absolutePath(doc.storagePath)));
      } catch {
        // File missing on disk — nothing to hash.
      }
    }

    if (Object.keys(updates).length > 0) {
      store.updateDocument(doc.id, updates);
      changed++;
    }
  }
  if (changed > 0) {
    console.log(`Backfilled extracted text / content hashes for ${changed} document${changed === 1 ? '' : 's'}`);
  }
}
