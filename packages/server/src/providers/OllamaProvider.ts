import { Category, ClassificationResult, DocumentInput } from '@stashd/shared';
import { ModelProvider } from './ModelProvider';
import { slugifyCategory } from '../services/categoryStyle';

const OLLAMA_BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

function buildSystemPrompt(categories: Category[]): string {
  const list = categories.map(c => `- "${c.id}" (${c.name})`).join('\n');
  return `You are a document classification assistant. Analyze the provided document and return ONLY a JSON object with these exact fields:
{
  "category": string — see category rules below,
  "subcategory": optional string,
  "tags": array of up to 5 keyword strings,
  "summary": "1-2 sentence plain-language description",
  "date": optional "YYYY-MM-DD" string if a primary date is present,
  "amount": optional number if a monetary amount is present,
  "vendor": optional string for the business or vendor name,
  "parties": array of person or organization names involved,
  "confidence": number 0-1 representing your confidence
}

Existing categories:
${list}

Category rules: If an existing category fits, return its exact id. If no existing category fits, return a new category name as a plain string slug (e.g. 'medical-health'). Do not force-fit into an existing category.

Respond ONLY with valid JSON. No markdown, no explanation.`;
}

export class OllamaProvider implements ModelProvider {
  async classify(doc: DocumentInput, existingCategories: Category[]): Promise<ClassificationResult> {
    const body: Record<string, unknown> = {
      model: OLLAMA_MODEL,
      system: buildSystemPrompt(existingCategories),
      prompt: doc.isImage
        ? `Classify this document image. Filename: ${doc.filename}`
        : `Classify this document.\n\nFilename: ${doc.filename}\n\nContent:\n${doc.content.slice(0, 8000)}`,
      format: 'json',
      stream: false,
    };

    if (doc.isImage) {
      body.images = [doc.content.replace(/^data:[^;]+;base64,/, '')];
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { response: string };
    const parsed = JSON.parse(data.response) as Partial<ClassificationResult>;

    return {
      category: typeof parsed.category === 'string' && parsed.category.trim()
        ? slugifyCategory(parsed.category)
        : 'other',
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
