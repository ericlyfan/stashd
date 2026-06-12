import { readFile } from 'fs/promises';
import { basename } from 'path';
import { Category, ClassificationResult, DocumentInput } from '@stashd/shared';
import { ModelProvider } from '../providers/ModelProvider';
import { buildCustomCategory, slugsLookAlike } from './categoryStyle';
import { extractPdfText, truncateText } from './textExtraction';

export interface ClassifyOutcome {
  classification: ClassificationResult;
  // Searchable text: pdf-parse output for PDFs, model transcription for images.
  extractedText?: string;
}

// How long a proposed-but-not-yet-filed category keeps influencing later
// classifications. Long enough to cover a review session, short enough that
// a rejected proposal doesn't haunt the taxonomy.
const PROPOSAL_TTL_MS = 30 * 60 * 1000;

export class ClassificationService {
  // Categories proposed by recent classifications that don't exist yet.
  // Without this, a batch of similar documents classifies against the same
  // pre-batch category list and each invents its own near-synonym
  // (e.g. "service-quotes" vs "service-quotations").
  private readonly proposals = new Map<string, number>();

  // Serializes model calls so each classification's prompt is built *after*
  // the previous one resolved — otherwise a simultaneous batch never sees
  // each other's proposals and the registry is useless exactly when it
  // matters. Ollama processes requests serially anyway, so this costs no
  // real wall-clock time.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly provider: ModelProvider) {}

  classify(filePath: string, mimeType: string, existingCategories: Category[]): Promise<ClassifyOutcome> {
    const run = this.chain.then(() => this.doClassify(filePath, mimeType, existingCategories));
    this.chain = run.catch(() => {});
    return run;
  }

  private async doClassify(
    filePath: string,
    mimeType: string,
    existingCategories: Category[],
  ): Promise<ClassifyOutcome> {
    const input = await this.buildInput(filePath, mimeType);

    const categories = [...existingCategories, ...this.provisionalCategories(existingCategories)];
    const classification = await this.provider.classify(input, categories);
    classification.category = this.resolveCategory(classification.category, categories);

    const extractedText = input.isImage
      ? classification.transcription && truncateText(classification.transcription)
      : input.content && input.content !== '(Could not extract PDF text)'
        ? truncateText(input.content)
        : undefined;
    return { classification, extractedText: extractedText || undefined };
  }

  // Proposals that are still pending (not expired, not yet real categories),
  // shaped as Category so the prompt builder treats them like any other.
  private provisionalCategories(existing: Category[]): Category[] {
    const now = Date.now();
    const known = new Set(existing.map(c => c.id));
    const result: Category[] = [];
    for (const [slug, at] of this.proposals) {
      if (now - at > PROPOSAL_TTL_MS || known.has(slug)) {
        this.proposals.delete(slug);
      } else {
        result.push(buildCustomCategory(slug));
      }
    }
    return result;
  }

  // Snap a proposed new category onto an existing/provisional near-synonym;
  // genuinely new slugs are registered as proposals for subsequent files in
  // the batch.
  private resolveCategory(proposed: string, categories: Category[]): string {
    if (categories.some(c => c.id === proposed)) return proposed;
    const lookalike = categories.find(c => slugsLookAlike(c.id, proposed));
    if (lookalike) return lookalike.id;
    this.proposals.set(proposed, Date.now());
    return proposed;
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
