import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import pdfParse from 'pdf-parse';
import { extensionOf } from '@stashd/shared';
import { StoreService } from './StoreService';
import { FileService } from './FileService';
import { emailToText, parseEmail } from './emailParse';
import { perceptualHashFile, simhash64 } from './nearDuplicate';

// Keep stored text bounded: enough for search, not the whole book.
export const MAX_EXTRACTED_CHARS = 20_000;

// Collapse horizontal whitespace but keep line structure: the email viewer
// splits stored text on '\n' to rebuild headers/body, and chunkText prefers
// paragraph/newline boundaries when splitting for embeddings.
export function truncateText(text: string): string {
  const trimmed = text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

async function extractPlainText(filePath: string): Promise<string | undefined> {
  try {
    return truncateText(await readFile(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function extractDocxText(filePath: string): Promise<string | undefined> {
  try {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ path: filePath });
    return truncateText(value);
  } catch {
    return undefined;
  }
}

// Flatten every sheet to text: one "=== Sheet ===" header per sheet, then its
// rows as CSV. Good enough for search and for the model to read structure.
async function extractSpreadsheetText(filePath: string): Promise<string | undefined> {
  try {
    // Under Node16 CJS interop the API lands on `.default`, not the namespace.
    const mod = await import('xlsx');
    const XLSX = ((mod as { default?: typeof import('xlsx') }).default ?? mod);
    const wb = XLSX.readFile(filePath, { cellDates: true });
    const parts = wb.SheetNames.map(name => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      return wb.SheetNames.length > 1 ? `=== ${name} ===\n${csv}` : csv;
    });
    return truncateText(parts.join('\n\n'));
  } catch {
    return undefined;
  }
}

// Pull searchable text out of a file by extension. Images carry no extractable
// text here (their text comes from the model's transcription at classify
// time), so they return undefined. New text-bearing formats plug in by adding
// a case. Never throws — extraction failures degrade to "no text".
export async function extractText(filePath: string, _mime: string): Promise<string | undefined> {
  switch (extensionOf(filePath)) {
    case 'pdf':
      return extractPdfText(filePath);
    case 'txt':
    case 'md':
    case 'csv':
      return extractPlainText(filePath);
    case 'docx':
      return extractDocxText(filePath);
    case 'xlsx':
      return extractSpreadsheetText(filePath);
    case 'eml':
    case 'msg': {
      const email = await parseEmail(filePath);
      return email ? truncateText(emailToText(email)) : undefined;
    }
    default:
      return undefined;
  }
}

// One-time catch-up for documents filed before extractedText / contentHash
// existed. Text covers every text-bearing type via extractText — image text
// needs a model call, which happens at classify time. Hashes cover every file.
export async function backfillDerivedFields(
  store: StoreService,
  fileService: FileService,
): Promise<void> {
  let changed = 0;
  for (const doc of store.getDocuments()) {
    const updates: {
      extractedText?: string;
      contentHash?: string;
      simHash?: string;
      perceptualHash?: string;
      originalName?: string;
    } = {};

    const repairedName = repairMojibakeName(doc.originalName);
    if (repairedName) updates.originalName = repairedName;

    if (doc.extractedText === undefined) {
      const text = await extractText(fileService.absolutePath(doc.storagePath), doc.fileType);
      if (text) updates.extractedText = text;
    } else if (!doc.extractedText.includes('\n')) {
      // Text stored before 2026-07-09 had every newline collapsed to a space
      // (the old truncateText), which broke the email viewer's header/body
      // split and chunkText's paragraph breaks. Re-extract to restore line
      // structure; a doc whose text is genuinely one line re-extracts to the
      // same string and is left alone. Images return undefined here, so their
      // classify-time transcription is never touched.
      const text = await extractText(fileService.absolutePath(doc.storagePath), doc.fileType);
      if (text && text !== doc.extractedText) updates.extractedText = text;
    }
    if (doc.contentHash === undefined) {
      try {
        updates.contentHash = hashBuffer(await readFile(fileService.absolutePath(doc.storagePath)));
      } catch {
        // File missing on disk — nothing to hash.
      }
    }

    // Near-dup signatures for the pre-existing corpus so re-uploads match it.
    // SimHash reads whatever text we have (just-extracted or already stored);
    // the perceptual hash decodes images from disk (a no-op for other types).
    // Recomputed whenever the text was re-extracted so it matches what new
    // uploads hash.
    if (doc.simHash === undefined || updates.extractedText !== undefined) {
      const sim = simhash64(updates.extractedText ?? doc.extractedText);
      if (sim && sim !== doc.simHash) updates.simHash = sim;
    }
    if (doc.perceptualHash === undefined) {
      const pHash = await perceptualHashFile(fileService.absolutePath(doc.storagePath), doc.fileType);
      if (pHash) updates.perceptualHash = pHash;
    }

    if (Object.keys(updates).length > 0) {
      store.updateDocument(doc.id, updates);
      // Changed text invalidates the doc's embedding chunks; dropping them
      // here lets EmbeddingService.init() (which runs right after this
      // backfill) re-chunk with the restored line structure.
      if (updates.extractedText !== undefined) store.deleteDocChunks(doc.id);
      changed++;
    }
  }
  if (changed > 0) {
    console.log(`Backfilled extracted text / content hashes for ${changed} document${changed === 1 ? '' : 's'}`);
  }
}
