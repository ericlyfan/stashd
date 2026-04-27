import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Document, Category, CategoryId } from '@stashd/shared';

interface Manifest {
  documents: Document[];
  categories: Category[];
}

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'receipts-expenses', name: 'Receipts & Expenses', color: '#0d9488', icon: 'receipt', isCustom: false },
  { id: 'contracts-agreements', name: 'Contracts & Agreements', color: '#6366f1', icon: 'file-signature', isCustom: false },
  { id: 'identity-personal', name: 'Identity & Personal', color: '#f59e0b', icon: 'id-card', isCustom: false },
  { id: 'insurance', name: 'Insurance', color: '#3b82f6', icon: 'shield', isCustom: false },
  { id: 'medical-health', name: 'Medical & Health', color: '#ef4444', icon: 'heart-pulse', isCustom: false },
  { id: 'property-construction', name: 'Property & Construction', color: '#8b5cf6', icon: 'home', isCustom: false },
  { id: 'business', name: 'Business', color: '#0ea5e9', icon: 'briefcase', isCustom: false },
  { id: 'tax-finance', name: 'Tax & Finance', color: '#10b981', icon: 'landmark', isCustom: false },
  { id: 'legal', name: 'Legal', color: '#f97316', icon: 'scale', isCustom: false },
  { id: 'warranties-manuals', name: 'Warranties & Manuals', color: '#64748b', icon: 'wrench', isCustom: false },
  { id: 'education', name: 'Education', color: '#ec4899', icon: 'graduation-cap', isCustom: false },
  { id: 'travel', name: 'Travel', color: '#14b8a6', icon: 'plane', isCustom: false },
  { id: 'other', name: 'Other', color: '#9ca3af', icon: 'folder', isCustom: false },
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
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
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
