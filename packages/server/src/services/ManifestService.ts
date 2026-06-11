import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Document, Category, CategoryId } from '@stashd/shared';

interface Manifest {
  documents: Document[];
  categories: Category[];
}

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'other', name: 'Other', icon: 'folder', color: '#a8a29e', isCustom: false },
];

export class ManifestService {
  private manifest: Manifest = { documents: [], categories: [] };
  private readonly manifestPath: string;

  constructor(dataDir: string) {
    this.manifestPath = join(dataDir, 'manifest.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(raw) as Manifest;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
      this.manifest = { documents: [], categories: DEFAULT_CATEGORIES };
      await this.save();
    }
  }

  async save(): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
  }

  getDocuments(): Document[] {
    return this.manifest.documents;
  }

  getDocument(id: string): Document | undefined {
    return this.manifest.documents.find(d => d.id === id);
  }

  addDocument(doc: Document): void {
    this.manifest.documents.push(doc);
  }

  updateDocument(
    id: string,
    updates: Partial<Pick<Document, 'category' | 'tags' | 'notes' | 'status' | 'updatedAt'>>,
  ): Document | undefined {
    const idx = this.manifest.documents.findIndex(d => d.id === id);
    if (idx === -1) return undefined;
    this.manifest.documents[idx] = { ...this.manifest.documents[idx], ...updates };
    return this.manifest.documents[idx];
  }

  removeDocument(id: string): boolean {
    const idx = this.manifest.documents.findIndex(d => d.id === id);
    if (idx === -1) return false;
    this.manifest.documents.splice(idx, 1);
    return true;
  }

  getCategories(): Category[] {
    return this.manifest.categories;
  }

  getCategory(id: string): Category | undefined {
    return this.manifest.categories.find(c => c.id === id);
  }

  addCategory(category: Category): void {
    if (!this.getCategory(category.id)) {
      this.manifest.categories.push(category);
    }
  }

  searchDocuments(query: string, categoryId?: CategoryId): Document[] {
    const q = query.toLowerCase();
    return this.manifest.documents.filter(doc => {
      if (categoryId && doc.category !== categoryId) return false;
      if (!q) return true;
      return (
        doc.originalName.toLowerCase().includes(q) ||
        doc.summary.toLowerCase().includes(q) ||
        doc.tags.some(t => t.toLowerCase().includes(q)) ||
        (doc.vendor?.toLowerCase().includes(q) ?? false) ||
        doc.category.toLowerCase().includes(q) ||
        (doc.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }
}
