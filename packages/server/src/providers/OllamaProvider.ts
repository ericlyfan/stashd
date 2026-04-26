import { CategoryId, ClassificationResult, DocumentInput } from '@stashd/shared';
import { ModelProvider } from './ModelProvider';

const OLLAMA_BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4';

const SYSTEM_PROMPT = `You are a document classification assistant. Analyze the provided document and return ONLY a JSON object with these exact fields:
{
  "category": one of: "receipts-expenses"|"contracts-agreements"|"identity-personal"|"insurance"|"medical-health"|"property-construction"|"business"|"tax-finance"|"legal"|"warranties-manuals"|"education"|"travel"|"other",
  "subcategory": optional string,
  "tags": array of up to 5 keyword strings,
  "summary": "1-2 sentence plain-language description",
  "date": optional "YYYY-MM-DD" string if a primary date is present,
  "amount": optional number if a monetary amount is present,
  "vendor": optional string for the business or vendor name,
  "parties": array of person or organization names involved,
  "confidence": number 0-1 representing your confidence
}
Respond ONLY with valid JSON. No markdown, no explanation.`;

export class OllamaProvider implements ModelProvider {
  async classify(doc: DocumentInput): Promise<ClassificationResult> {
    const body: Record<string, unknown> = {
      model: OLLAMA_MODEL,
      system: SYSTEM_PROMPT,
      prompt: doc.isImage
        ? `Classify this document image. Filename: ${doc.filename}`
        : `Classify this document.\n\nFilename: ${doc.filename}\n\nContent:\n${doc.content.slice(0, 8000)}`,
      format: 'json',
      stream: false,
    };

    if (doc.isImage) {
      body.images = [doc.content.replace(/^data:[^;]+;base64,/, '')];
    }

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { response: string };
    const parsed = JSON.parse(data.response) as Partial<ClassificationResult>;

    return {
      category: (parsed.category ?? 'other') as CategoryId,
      subcategory: parsed.subcategory,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      summary: parsed.summary ?? '',
      date: parsed.date,
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
      vendor: parsed.vendor,
      parties: Array.isArray(parsed.parties) ? parsed.parties : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
  }
}
