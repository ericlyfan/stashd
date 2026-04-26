# Stashd Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully local AI document inbox with drag-and-drop upload, Ollama-powered classification, human-in-the-loop review, category navigation, document preview, and full-text search.

**Architecture:** Express API server persists documents to local filesystem with a JSON manifest; React client communicates with the server via REST + SSE for streaming classification feedback; AI classification flows through a strategy-pattern provider system with Ollama (Gemma 4) as the MVP provider.

**Tech Stack:** TypeScript monorepo (npm workspaces), React 18 + Vite + Tailwind CSS, Express 4, Ollama (Gemma 4), multer, pdf-parse, heic-convert, React Router v6, react-dropzone, Lucide React, pdfjs-dist, Jest + supertest (server), Vitest (client).

---

## File Map

### Monorepo Root
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

### packages/shared
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

### packages/server
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/jest.config.cjs`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/providers/ModelProvider.ts`
- Create: `packages/server/src/providers/OllamaProvider.ts`
- Create: `packages/server/src/providers/index.ts`
- Create: `packages/server/src/services/ManifestService.ts`
- Create: `packages/server/src/services/FileService.ts`
- Create: `packages/server/src/services/ClassificationService.ts`
- Create: `packages/server/src/routes/documents.ts`
- Create: `packages/server/src/routes/categories.ts`
- Create: `packages/server/src/__tests__/ManifestService.test.ts`
- Create: `packages/server/src/__tests__/FileService.test.ts`
- Create: `packages/server/src/__tests__/ClassificationService.test.ts`
- Create: `packages/server/src/__tests__/documents.test.ts`
- Create: `packages/server/src/__tests__/categories.test.ts`

### packages/client
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/vite.config.ts`
- Create: `packages/client/tailwind.config.js`
- Create: `packages/client/postcss.config.js`
- Create: `packages/client/index.html`
- Create: `packages/client/src/main.tsx`
- Create: `packages/client/src/App.tsx`
- Create: `packages/client/src/index.css`
- Create: `packages/client/src/api/client.ts`
- Create: `packages/client/src/components/Layout.tsx`
- Create: `packages/client/src/components/Sidebar.tsx`
- Create: `packages/client/src/components/CategoryList.tsx`
- Create: `packages/client/src/components/SearchBar.tsx`
- Create: `packages/client/src/components/StatsBar.tsx`
- Create: `packages/client/src/components/UploadZone.tsx`
- Create: `packages/client/src/components/FileProcessingCard.tsx`
- Create: `packages/client/src/components/ClassificationReview.tsx`
- Create: `packages/client/src/components/DocumentCard.tsx`
- Create: `packages/client/src/components/DocumentGrid.tsx`
- Create: `packages/client/src/components/NeedsReviewList.tsx`
- Create: `packages/client/src/components/RecentDocuments.tsx`
- Create: `packages/client/src/components/PreviewPane.tsx`
- Create: `packages/client/src/components/MetadataPanel.tsx`
- Create: `packages/client/src/components/NotesEditor.tsx`
- Create: `packages/client/src/pages/Dashboard.tsx`
- Create: `packages/client/src/pages/CategoryView.tsx`
- Create: `packages/client/src/pages/DocumentDetail.tsx`
- Create: `packages/client/src/pages/SearchResults.tsx`

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/jest.config.cjs`
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/vite.config.ts`
- Create: `packages/client/tailwind.config.js`
- Create: `packages/client/postcss.config.js`
- Create: `packages/client/index.html`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "stashd",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:client": "npm run dev --workspace=packages/client",
    "dev:server": "npm run dev --workspace=packages/server",
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
data/
*.local
.env
```

- [ ] **Step 4: Create .env.example**

```
PORT=3001
PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=gemma4
```

- [ ] **Step 5: Create packages/shared/package.json**

```json
{
  "name": "@stashd/shared",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

Note: `main` points to TypeScript source directly; both server and client resolve it via tsconfig `paths`.

- [ ] **Step 6: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create packages/server/package.json**

```json
{
  "name": "@stashd/server",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "@stashd/shared": "*",
    "cors": "^2.8.5",
    "express": "^4.19.0",
    "heic-convert": "^2.0.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^9.0.8",
    "jest": "^29.7.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.2",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 8: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "paths": {
      "@stashd/shared": ["../shared/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Create packages/server/jest.config.cjs**

```js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@stashd/shared$': '<rootDir>/../shared/src/index.ts',
  },
};
```

- [ ] **Step 10: Create packages/client/package.json**

```json
{
  "name": "@stashd/client",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@stashd/shared": "*",
    "clsx": "^2.1.0",
    "lucide-react": "^0.356.0",
    "pdfjs-dist": "^4.0.379",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-dropzone": "^14.2.3",
    "react-router-dom": "^6.22.0"
  },
  "devDependencies": {
    "@testing-library/react": "^14.2.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.18",
    "jsdom": "^24.0.0",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.4.0",
    "vite": "^5.1.4",
    "vitest": "^1.3.1"
  }
}
```

- [ ] **Step 11: Create packages/client/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "paths": {
      "@stashd/shared": ["../shared/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 12: Create packages/client/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@stashd/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

- [ ] **Step 13: Create packages/client/tailwind.config.js**

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          600: '#0d9488',
          700: '#0f766e',
          100: '#ccfbf1',
          50: '#f0fdfa',
        },
        warm: {
          50: '#fafaf9',
          100: '#f5f5f4',
        },
      },
      fontFamily: {
        display: ['"DM Serif Display"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 14: Create packages/client/postcss.config.js**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 15: Create packages/client/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stashd</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 16: Install all dependencies**

Run from the repo root:

```bash
npm install
```

Expected: All packages installed, `node_modules/` created in root and each package.

- [ ] **Step 17: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example packages/shared/package.json packages/shared/tsconfig.json packages/server/package.json packages/server/tsconfig.json packages/server/jest.config.cjs packages/client/package.json packages/client/tsconfig.json packages/client/vite.config.ts packages/client/tailwind.config.js packages/client/postcss.config.js packages/client/index.html
git commit -m "chore: monorepo scaffold with npm workspaces"
```

---

## Task 2: Shared Types

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create packages/shared/src/types.ts**

```typescript
export interface Document {
  id: string;
  filename: string;
  originalName: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  dateExtracted?: string;
  amount?: number;
  vendor?: string;
  confidenceScore: number;
  status: 'pending' | 'filed';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  isCustom: boolean;
}

export interface DocumentInput {
  filename: string;
  mimeType: string;
  content: string;
  isImage: boolean;
}

export interface ClassificationResult {
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  date?: string;
  amount?: number;
  vendor?: string;
  parties: string[];
  confidence: number;
}

export type ProcessingStage = 'extracting' | 'classifying' | 'complete' | 'error';

export interface SSEEvent {
  stage: ProcessingStage;
  message: string;
  classification?: ClassificationResult;
  error?: string;
}
```

- [ ] **Step 2: Create packages/shared/src/index.ts**

```typescript
export * from './types';
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/
git commit -m "feat: shared TypeScript types package"
```

---

## Task 3: ManifestService

**Files:**
- Create: `packages/server/src/services/ManifestService.ts`
- Create: `packages/server/src/__tests__/ManifestService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/ManifestService.test.ts`:

```typescript
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ManifestService } from '../services/ManifestService';
import { Document } from '@stashd/shared';

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc1',
    filename: 'doc1.pdf',
    originalName: 'test.pdf',
    storagePath: 'documents/other/doc1.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    category: 'other',
    tags: [],
    summary: 'A test document',
    confidenceScore: 0.9,
    status: 'filed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ManifestService', () => {
  let tmpDir: string;
  let service: ManifestService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stashd-manifest-'));
    service = new ManifestService(tmpDir);
    await service.load();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('seeds 13 default categories on first load', () => {
    const cats = service.getCategories();
    expect(cats).toHaveLength(13);
    expect(cats[0].id).toBe('receipts-expenses');
    expect(cats[cats.length - 1].id).toBe('other');
  });

  it('persists documents across instances', async () => {
    const doc = makeDocument();
    service.addDocument(doc);
    await service.save();

    const service2 = new ManifestService(tmpDir);
    await service2.load();
    expect(service2.getDocument('doc1')).toEqual(doc);
  });

  it('searches documents by originalName', () => {
    service.addDocument(makeDocument({ originalName: 'invoice-2025.pdf' }));
    service.addDocument(makeDocument({ id: 'doc2', originalName: 'receipt.jpg' }));
    expect(service.searchDocuments('invoice')).toHaveLength(1);
  });

  it('searches documents by summary', () => {
    service.addDocument(makeDocument({ summary: 'Home Depot lumber receipt' }));
    service.addDocument(makeDocument({ id: 'doc2', summary: 'Medical bill' }));
    expect(service.searchDocuments('lumber')).toHaveLength(1);
  });

  it('filters documents by category', () => {
    service.addDocument(makeDocument({ category: 'receipts-expenses' }));
    service.addDocument(makeDocument({ id: 'doc2', category: 'legal' }));
    expect(service.searchDocuments('', 'receipts-expenses')).toHaveLength(1);
  });

  it('returns all documents when query and category are empty', () => {
    service.addDocument(makeDocument());
    service.addDocument(makeDocument({ id: 'doc2' }));
    expect(service.searchDocuments('')).toHaveLength(2);
  });

  it('updates document fields', () => {
    service.addDocument(makeDocument());
    const updated = service.updateDocument('doc1', { tags: ['urgent'], notes: 'Important' });
    expect(updated?.tags).toEqual(['urgent']);
    expect(updated?.notes).toBe('Important');
  });

  it('returns undefined when updating nonexistent document', () => {
    expect(service.updateDocument('missing', { tags: [] })).toBeUndefined();
  });

  it('removes a document by id', () => {
    service.addDocument(makeDocument());
    expect(service.removeDocument('doc1')).toBe(true);
    expect(service.getDocument('doc1')).toBeUndefined();
  });

  it('returns false when removing nonexistent document', () => {
    expect(service.removeDocument('missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npm test -- --testPathPattern=ManifestService
```

Expected: `Cannot find module '../services/ManifestService'`

- [ ] **Step 3: Implement ManifestService**

Create `packages/server/src/services/ManifestService.ts`:

```typescript
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Document, Category } from '@stashd/shared';

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
    } catch {
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

  searchDocuments(query: string, categoryId?: string): Document[] {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npm test -- --testPathPattern=ManifestService
```

Expected: 9 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/ManifestService.ts packages/server/src/__tests__/ManifestService.test.ts
git commit -m "feat: ManifestService with JSON persistence and search"
```

---

## Task 4: FileService

**Files:**
- Create: `packages/server/src/services/FileService.ts`
- Create: `packages/server/src/__tests__/FileService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/FileService.test.ts`:

```typescript
import { mkdtemp, rm, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileService } from '../services/FileService';

describe('FileService', () => {
  let dataDir: string;
  let service: FileService;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-file-'));
    service = new FileService(dataDir);
    await service.ensureDirs();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('creates temp dir for a jobId', async () => {
    const dir = await service.createTempDir('job-abc');
    const entries = await readdir(join(dataDir, 'temp'));
    expect(entries).toContain('job-abc');
    expect(dir).toBe(join(dataDir, 'temp', 'job-abc'));
  });

  it('returns null for a missing job', async () => {
    expect(await service.getTempFilePath('nonexistent')).toBeNull();
  });

  it('returns the file path for a known job', async () => {
    await service.createTempDir('job-xyz');
    await writeFile(join(dataDir, 'temp', 'job-xyz', 'document.pdf'), 'PDF content');
    expect(await service.getTempFilePath('job-xyz')).toBe(
      join(dataDir, 'temp', 'job-xyz', 'document.pdf'),
    );
  });

  it('moves a file to the documents directory with docId as filename', async () => {
    await service.createTempDir('job-move');
    await writeFile(join(dataDir, 'temp', 'job-move', 'receipt.pdf'), 'PDF content');

    const storagePath = await service.moveToDocuments('job-move', 'receipts-expenses', 'doc123', 'receipt.pdf');

    expect(storagePath).toBe(join('documents', 'receipts-expenses', 'doc123.pdf'));
    const destFiles = await readdir(join(dataDir, 'documents', 'receipts-expenses'));
    expect(destFiles).toContain('doc123.pdf');
  });

  it('throws when moving a file for a missing jobId', async () => {
    await expect(
      service.moveToDocuments('no-such-job', 'other', 'doc999', 'file.pdf'),
    ).rejects.toThrow('No temp file for jobId: no-such-job');
  });

  it('absolutePath returns the full filesystem path', () => {
    expect(service.absolutePath('documents/other/doc1.pdf')).toBe(
      join(dataDir, 'documents', 'other', 'doc1.pdf'),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npm test -- --testPathPattern=FileService
```

Expected: `Cannot find module '../services/FileService'`

- [ ] **Step 3: Implement FileService**

Create `packages/server/src/services/FileService.ts`:

```typescript
import { mkdir, readdir, rename, rmdir, stat, unlink } from 'fs/promises';
import { extname, join } from 'path';

export class FileService {
  constructor(private readonly dataDir: string) {}

  async ensureDirs(): Promise<void> {
    await mkdir(join(this.dataDir, 'temp'), { recursive: true });
    await mkdir(join(this.dataDir, 'documents'), { recursive: true });
  }

  tempDir(jobId: string): string {
    return join(this.dataDir, 'temp', jobId);
  }

  async createTempDir(jobId: string): Promise<string> {
    const dir = this.tempDir(jobId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async getTempFilePath(jobId: string): Promise<string | null> {
    try {
      const files = await readdir(this.tempDir(jobId));
      if (files.length === 0) return null;
      return join(this.tempDir(jobId), files[0]);
    } catch {
      return null;
    }
  }

  async moveToDocuments(
    jobId: string,
    categorySlug: string,
    docId: string,
    originalName: string,
  ): Promise<string> {
    const tempPath = await this.getTempFilePath(jobId);
    if (!tempPath) throw new Error(`No temp file for jobId: ${jobId}`);

    const ext = extname(originalName);
    const destDir = join(this.dataDir, 'documents', categorySlug);
    await mkdir(destDir, { recursive: true });

    const filename = `${docId}${ext}`;
    await rename(tempPath, join(destDir, filename));
    await rmdir(this.tempDir(jobId)).catch(() => {});

    return join('documents', categorySlug, filename);
  }

  async deleteDocument(storagePath: string): Promise<void> {
    await unlink(join(this.dataDir, storagePath));
  }

  async getFileSize(absolutePath: string): Promise<number> {
    const s = await stat(absolutePath);
    return s.size;
  }

  absolutePath(storagePath: string): string {
    return join(this.dataDir, storagePath);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npm test -- --testPathPattern=FileService
```

Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/FileService.ts packages/server/src/__tests__/FileService.test.ts
git commit -m "feat: FileService for temp and document file management"
```

---

## Task 5: ModelProvider + OllamaProvider

**Files:**
- Create: `packages/server/src/providers/ModelProvider.ts`
- Create: `packages/server/src/providers/OllamaProvider.ts`
- Create: `packages/server/src/providers/index.ts`

No unit tests here — OllamaProvider requires a live Ollama instance. The interface is exercised via ClassificationService tests in Task 6.

- [ ] **Step 1: Create packages/server/src/providers/ModelProvider.ts**

```typescript
import { ClassificationResult, DocumentInput } from '@stashd/shared';

export interface ModelProvider {
  classify(doc: DocumentInput): Promise<ClassificationResult>;
}
```

- [ ] **Step 2: Create packages/server/src/providers/OllamaProvider.ts**

```typescript
import { ClassificationResult, DocumentInput } from '@stashd/shared';
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
      category: parsed.category ?? 'other',
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
```

- [ ] **Step 3: Create packages/server/src/providers/index.ts**

```typescript
import { ModelProvider } from './ModelProvider';
import { OllamaProvider } from './OllamaProvider';

const registry: Record<string, ModelProvider> = {
  ollama: new OllamaProvider(),
};

export function getProvider(name: string): ModelProvider {
  return registry[name] ?? registry['ollama'];
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/providers/
git commit -m "feat: ModelProvider interface and OllamaProvider adapter"
```

---

## Task 6: ClassificationService

**Files:**
- Create: `packages/server/src/services/ClassificationService.ts`
- Create: `packages/server/src/__tests__/ClassificationService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/ClassificationService.test.ts`:

```typescript
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClassificationResult, DocumentInput } from '@stashd/shared';
import { ClassificationService } from '../services/ClassificationService';
import { ModelProvider } from '../providers/ModelProvider';

const mockResult: ClassificationResult = {
  category: 'receipts-expenses',
  tags: ['Home Depot', 'lumber'],
  summary: 'Receipt from Home Depot for lumber.',
  parties: [],
  confidence: 0.95,
};

const mockProvider: ModelProvider = {
  classify: jest.fn().mockResolvedValue(mockResult),
};

describe('ClassificationService', () => {
  let tmpDir: string;
  let service: ClassificationService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'stashd-classify-'));
    service = new ClassificationService(mockProvider);
    (mockProvider.classify as jest.Mock).mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('passes isImage=false and text content for PDFs', async () => {
    const pdfPath = join(tmpDir, 'test.pdf');
    await writeFile(
      pdfPath,
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 0\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF'),
    );

    await service.classify(pdfPath, 'application/pdf');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(false);
    expect(arg.filename).toBe('test.pdf');
    expect(arg.mimeType).toBe('application/pdf');
  });

  it('passes isImage=true and base64 data URL for JPEGs', async () => {
    const jpgPath = join(tmpDir, 'photo.jpg');
    await writeFile(jpgPath, Buffer.from('fake-jpeg-bytes'));

    await service.classify(jpgPath, 'image/jpeg');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(true);
    expect(arg.content).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('passes isImage=true and base64 data URL for PNGs', async () => {
    const pngPath = join(tmpDir, 'scan.png');
    await writeFile(pngPath, Buffer.from('fake-png-bytes'));

    await service.classify(pngPath, 'image/png');

    const arg = (mockProvider.classify as jest.Mock).mock.calls[0][0] as DocumentInput;
    expect(arg.isImage).toBe(true);
    expect(arg.content).toMatch(/^data:image\/png;base64,/);
  });

  it('returns the ClassificationResult from the provider', async () => {
    const jpgPath = join(tmpDir, 'receipt.jpg');
    await writeFile(jpgPath, Buffer.from('fake-jpeg-bytes'));

    const result = await service.classify(jpgPath, 'image/jpeg');
    expect(result).toEqual(mockResult);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npm test -- --testPathPattern=ClassificationService
```

Expected: `Cannot find module '../services/ClassificationService'`

- [ ] **Step 3: Implement ClassificationService**

Create `packages/server/src/services/ClassificationService.ts`:

```typescript
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

    // image/jpeg, image/png
    const buffer = await readFile(filePath);
    const b64 = buffer.toString('base64');
    return { filename, mimeType, content: `data:${mimeType};base64,${b64}`, isImage: true };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npm test -- --testPathPattern=ClassificationService
```

Expected: 4 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/ClassificationService.ts packages/server/src/__tests__/ClassificationService.test.ts
git commit -m "feat: ClassificationService with PDF extraction and image base64 encoding"
```

---

## Task 7: Server App Factory + Upload Route

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/documents.ts` (upload endpoint only for now)
- Create: `packages/server/src/__tests__/documents.test.ts` (upload tests only)

- [ ] **Step 1: Write failing tests for the upload route**

Create `packages/server/src/__tests__/documents.test.ts`:

```typescript
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Express } from 'express';
import { createApp } from '../app';
import { ClassificationService } from '../services/ClassificationService';
import { ClassificationResult } from '@stashd/shared';

const mockClassification: ClassificationResult = {
  category: 'other',
  tags: [],
  summary: 'Test document.',
  parties: [],
  confidence: 0.9,
};

function makeMockClassificationService(): ClassificationService {
  return {
    classify: jest.fn().mockResolvedValue(mockClassification),
  } as unknown as ClassificationService;
}

describe('POST /api/documents/upload', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-routes-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('returns 400 for unsupported file types', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('hello world'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported/i);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/documents/upload');
    expect(res.status).toBe(400);
  });

  it('returns a jobId for a valid PDF upload', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'test.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
  });

  it('returns a jobId for a valid JPEG upload', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('fake-jpeg'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npm test -- --testPathPattern=documents
```

Expected: `Cannot find module '../app'`

- [ ] **Step 3: Create the document router (upload only)**

Create `packages/server/src/routes/documents.ts`:

```typescript
import { Router } from 'express';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { stat } from 'fs/promises';
import { ManifestService } from '../services/ManifestService';
import { FileService } from '../services/FileService';
import { ClassificationService } from '../services/ClassificationService';
import { Document, SSEEvent } from '@stashd/shared';

const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

function getMimeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

interface Services {
  manifestService: ManifestService;
  fileService: FileService;
  classificationService: ClassificationService;
}

export function createDocumentRoutes(services: Services): Router {
  const { manifestService, fileService, classificationService } = services;
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIMES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
      }
    },
  });

  // POST /api/documents/upload
  router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, err => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 50MB)' });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file attached' });

    const jobId = uuidv4();
    const dir = await fileService.createTempDir(jobId);
    await writeFile(join(dir, req.file.originalname), req.file.buffer);

    res.json({ jobId });
  });

  // GET /api/documents/process/:jobId — SSE
  router.get('/process/:jobId', async (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: SSEEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const filePath = await fileService.getTempFilePath(jobId);
      if (!filePath) {
        send({ stage: 'error', message: 'Job not found', error: 'Job not found' });
        return res.end();
      }

      const mimeType = getMimeFromExtension(filePath);

      send({ stage: 'extracting', message: 'Extracting document content…' });

      send({ stage: 'classifying', message: 'Classifying with AI…' });

      const classification = await classificationService.classify(filePath, mimeType);

      send({ stage: 'complete', message: 'Classification complete', classification });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      send({ stage: 'error', message: 'Classification failed', error });
    }

    res.end();
  });

  // POST /api/documents/file/:jobId
  router.post('/file/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { category, subcategory, tags, summary, dateExtracted, amount, vendor, notes, confidenceScore, flagForLater } = req.body as {
      category: string;
      subcategory?: string;
      tags?: string[];
      summary?: string;
      dateExtracted?: string;
      amount?: number;
      vendor?: string;
      notes?: string;
      confidenceScore?: number;
      flagForLater?: boolean;
    };

    const tempPath = await fileService.getTempFilePath(jobId);
    if (!tempPath) return res.status(404).json({ error: 'Job not found' });

    const id = uuidv4();
    const originalName = tempPath.split('/').pop() ?? 'file';
    const mimeType = getMimeFromExtension(originalName);
    const tempStats = await stat(tempPath);
    const fileSize = tempStats.size;

    const storagePath = await fileService.moveToDocuments(jobId, category, id, originalName);

    const now = new Date().toISOString();
    const doc: Document = {
      id,
      filename: storagePath.split('/').pop() ?? id,
      originalName,
      storagePath,
      fileType: mimeType,
      fileSize,
      category,
      subcategory,
      tags: Array.isArray(tags) ? tags : [],
      summary: summary ?? '',
      dateExtracted,
      amount,
      vendor,
      confidenceScore: confidenceScore ?? 0,
      status: flagForLater ? 'pending' : 'filed',
      notes,
      createdAt: now,
      updatedAt: now,
    };

    manifestService.addDocument(doc);
    await manifestService.save();

    res.json(doc);
  });

  // GET /api/documents
  router.get('/', (req, res) => {
    const { search, category } = req.query as { search?: string; category?: string };
    const docs = manifestService.searchDocuments(search ?? '', category);
    res.json(docs);
  });

  // GET /api/documents/:id
  router.get('/:id', (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  });

  // PATCH /api/documents/:id
  router.patch('/:id', async (req, res) => {
    const { category, tags, notes } = req.body as {
      category?: string;
      tags?: string[];
      notes?: string;
    };
    const updated = manifestService.updateDocument(req.params.id, {
      ...(category !== undefined && { category }),
      ...(tags !== undefined && { tags }),
      ...(notes !== undefined && { notes }),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Document not found' });
    await manifestService.save();
    res.json(updated);
  });

  // DELETE /api/documents/:id
  router.delete('/:id', async (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await fileService.deleteDocument(doc.storagePath).catch(() => {});
    manifestService.removeDocument(req.params.id);
    await manifestService.save();

    res.status(204).end();
  });

  // GET /api/documents/:id/file
  router.get('/:id/file', (req, res) => {
    const doc = manifestService.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.sendFile(fileService.absolutePath(doc.storagePath));
  });

  return router;
}
```

- [ ] **Step 4: Create the categories router**

Create `packages/server/src/routes/categories.ts`:

```typescript
import { Router } from 'express';
import { ManifestService } from '../services/ManifestService';

export function createCategoryRoutes(services: { manifestService: ManifestService }): Router {
  const { manifestService } = services;
  const router = Router();

  // GET /api/categories
  router.get('/', (_req, res) => {
    const categories = manifestService.getCategories();
    const documents = manifestService.getDocuments();
    const result = categories.map(cat => ({
      ...cat,
      documentCount: documents.filter(d => d.category === cat.id).length,
    }));
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 5: Create the app factory**

Create `packages/server/src/app.ts`:

```typescript
import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import { ManifestService } from './services/ManifestService';
import { FileService } from './services/FileService';
import { ClassificationService } from './services/ClassificationService';
import { getProvider } from './providers';
import { createDocumentRoutes } from './routes/documents';
import { createCategoryRoutes } from './routes/categories';

interface AppOverrides {
  classificationService?: ClassificationService;
}

export async function createApp(dataDir: string, overrides: AppOverrides = {}): Promise<Express> {
  const manifestService = new ManifestService(dataDir);
  await manifestService.load();

  const fileService = new FileService(dataDir);
  await fileService.ensureDirs();

  const provider = getProvider(process.env.PROVIDER ?? 'ollama');
  const classificationService = overrides.classificationService ?? new ClassificationService(provider);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/documents', createDocumentRoutes({ manifestService, fileService, classificationService }));
  app.use('/api/categories', createCategoryRoutes({ manifestService }));

  return app;
}
```

- [ ] **Step 6: Create the server entry point**

Create `packages/server/src/index.ts`:

```typescript
import path from 'path';
import { createApp } from './app';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const DATA_DIR = path.join(process.cwd(), 'data');

createApp(DATA_DIR).then(app => {
  app.listen(PORT, () => {
    console.log(`Stashd server on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd packages/server && npm test -- --testPathPattern=documents
```

Expected: 4 upload tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/
git commit -m "feat: Express server with upload, SSE, and CRUD document routes"
```

---

## Task 8: Categories Route Tests + CRUD Route Tests

**Files:**
- Modify: `packages/server/src/__tests__/documents.test.ts` (add CRUD tests)
- Create: `packages/server/src/__tests__/categories.test.ts`

- [ ] **Step 1: Add CRUD tests to documents.test.ts**

Append to `packages/server/src/__tests__/documents.test.ts`:

```typescript
describe('Document CRUD routes', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-crud-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  async function uploadAndFile(overrides: Record<string, unknown> = {}) {
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };

    const fileRes = await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Test doc', confidenceScore: 0.9, ...overrides });
    return fileRes.body as { id: string };
  }

  it('GET /api/documents returns all documents', async () => {
    await uploadAndFile();
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it('GET /api/documents?category=other filters by category', async () => {
    await uploadAndFile({ category: 'other' });
    const res = await request(app).get('/api/documents?category=legal');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('GET /api/documents/:id returns a single document', async () => {
    const doc = await uploadAndFile();
    const res = await request(app).get(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(doc.id);
  });

  it('GET /api/documents/:id returns 404 for missing document', async () => {
    const res = await request(app).get('/api/documents/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/documents/:id updates tags and notes', async () => {
    const doc = await uploadAndFile();
    const res = await request(app)
      .patch(`/api/documents/${doc.id}`)
      .send({ tags: ['updated'], notes: 'My note' });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(['updated']);
    expect(res.body.notes).toBe('My note');
  });

  it('DELETE /api/documents/:id removes the document', async () => {
    const doc = await uploadAndFile();
    const delRes = await request(app).delete(`/api/documents/${doc.id}`);
    expect(delRes.status).toBe(204);
    const getRes = await request(app).get(`/api/documents/${doc.id}`);
    expect(getRes.status).toBe(404);
  });

  it('POST /api/documents/file/:jobId with flagForLater sets status=pending', async () => {
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };
    const fileRes = await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Pending doc', confidenceScore: 0.5, flagForLater: true });
    expect(fileRes.body.status).toBe('pending');
  });
});
```

- [ ] **Step 2: Write failing categories tests**

Create `packages/server/src/__tests__/categories.test.ts`:

```typescript
import request from 'supertest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Express } from 'express';
import { createApp } from '../app';
import { ClassificationService } from '../services/ClassificationService';
import { ClassificationResult } from '@stashd/shared';

function makeMockClassificationService(): ClassificationService {
  return {
    classify: jest.fn().mockResolvedValue({
      category: 'other', tags: [], summary: '', parties: [], confidence: 0.9,
    } as ClassificationResult),
  } as unknown as ClassificationService;
}

describe('GET /api/categories', () => {
  let dataDir: string;
  let app: Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'stashd-cats-'));
    app = await createApp(dataDir, { classificationService: makeMockClassificationService() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true });
  });

  it('returns 13 default categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(13);
  });

  it('includes documentCount on each category', async () => {
    const res = await request(app).get('/api/categories');
    expect(typeof res.body[0].documentCount).toBe('number');
  });

  it('documentCount reflects filed documents', async () => {
    // Upload and file one document into 'other'
    const uploadRes = await request(app)
      .post('/api/documents/upload')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    const { jobId } = uploadRes.body as { jobId: string };
    await request(app)
      .post(`/api/documents/file/${jobId}`)
      .send({ category: 'other', tags: [], summary: 'Test', confidenceScore: 0.9 });

    const res = await request(app).get('/api/categories');
    const other = (res.body as Array<{ id: string; documentCount: number }>).find(c => c.id === 'other');
    expect(other?.documentCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run all server tests**

```bash
cd packages/server && npm test
```

Expected: All tests pass. Approximate count: 9 (ManifestService) + 6 (FileService) + 4 (ClassificationService) + 4 (upload) + 7 (CRUD) + 3 (categories) = 33 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/
git commit -m "test: CRUD and categories route tests"
```

---

## Task 9: API Client + Client Scaffold

**Files:**
- Create: `packages/client/src/main.tsx`
- Create: `packages/client/src/App.tsx`
- Create: `packages/client/src/index.css`
- Create: `packages/client/src/api/client.ts`

- [ ] **Step 1: Create packages/client/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply font-sans bg-warm-50 text-stone-800;
  }
}
```

- [ ] **Step 2: Create packages/client/src/api/client.ts**

```typescript
import { Category, ClassificationResult, Document } from '@stashd/shared';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listDocuments(search?: string, category?: string): Promise<Document[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  return req<Document[]>(`/documents?${params}`);
}

export function getDocument(id: string): Promise<Document> {
  return req<Document>(`/documents/${id}`);
}

export function updateDocument(id: string, updates: { category?: string; tags?: string[]; notes?: string }): Promise<Document> {
  return req<Document>(`/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function deleteDocument(id: string): Promise<void> {
  return req<void>(`/documents/${id}`, { method: 'DELETE' });
}

export function fileDocument(jobId: string, data: {
  category: string;
  subcategory?: string;
  tags: string[];
  summary: string;
  dateExtracted?: string;
  amount?: number;
  vendor?: string;
  notes?: string;
  confidenceScore: number;
  flagForLater?: boolean;
}): Promise<Document> {
  return req<Document>(`/documents/file/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function uploadDocument(file: File): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append('file', file);
  return req<{ jobId: string }>('/documents/upload', { method: 'POST', body: form });
}

export interface CategoryWithCount extends Category {
  documentCount: number;
}

export function listCategories(): Promise<CategoryWithCount[]> {
  return req<CategoryWithCount[]>('/categories');
}
```

- [ ] **Step 3: Create packages/client/src/App.tsx**

```typescript
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CategoryView from './pages/CategoryView';
import DocumentDetail from './pages/DocumentDetail';
import SearchResults from './pages/SearchResults';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="category/:id" element={<CategoryView />} />
          <Route path="document/:id" element={<DocumentDetail />} />
          <Route path="search" element={<SearchResults />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Create packages/client/src/main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: Verify client compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: No errors. (Pages and components don't exist yet — create placeholder stubs to satisfy imports.)

Create placeholder stubs — each file exports a single default function returning `null`:

`packages/client/src/components/Layout.tsx`:
```typescript
import { Outlet } from 'react-router-dom';
export default function Layout() { return <div><Outlet /></div>; }
```

`packages/client/src/pages/Dashboard.tsx`, `CategoryView.tsx`, `DocumentDetail.tsx`, `SearchResults.tsx`:
```typescript
export default function Dashboard() { return null; }
// (same pattern for each)
```

Re-run `npx tsc --noEmit`. Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/
git commit -m "feat: client scaffold with React Router routing and API client"
```

---

## Task 10: Layout + Sidebar + SearchBar

**Files:**
- Modify: `packages/client/src/components/Layout.tsx`
- Create: `packages/client/src/components/Sidebar.tsx`
- Create: `packages/client/src/components/CategoryList.tsx`
- Create: `packages/client/src/components/SearchBar.tsx`

- [ ] **Step 1: Create SearchBar**

Create `packages/client/src/components/SearchBar.tsx`:

```typescript
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search documents…"
        className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
      />
    </form>
  );
}
```

- [ ] **Step 2: Create CategoryList**

Create `packages/client/src/components/CategoryList.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { CategoryWithCount, listCategories } from '../api/client';

function CategoryIcon({ name }: { name: string }) {
  const iconName = name
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const Icon = (Icons as Record<string, Icons.LucideIcon | undefined>)[iconName];
  return Icon ? <Icon className="w-4 h-4" /> : <Icons.Folder className="w-4 h-4" />;
}

export default function CategoryList() {
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);

  useEffect(() => {
    listCategories().then(setCategories).catch(console.error);
  }, []);

  return (
    <nav className="mt-2 space-y-0.5">
      {categories.map(cat => (
        <NavLink
          key={cat.id}
          to={`/category/${cat.id}`}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-teal-50 text-teal-700 font-medium'
                : 'text-stone-600 hover:bg-stone-100'
            }`
          }
        >
          <span style={{ color: cat.color }}>
            <CategoryIcon name={cat.icon} />
          </span>
          <span className="flex-1 truncate">{cat.name}</span>
          {cat.documentCount > 0 && (
            <span className="text-xs text-stone-400">{cat.documentCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create Sidebar**

Create `packages/client/src/components/Sidebar.tsx`:

```typescript
import { NavLink } from 'react-router-dom';
import { Home } from 'lucide-react';
import SearchBar from './SearchBar';
import CategoryList from './CategoryList';

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-stone-200 bg-white px-3 py-4 overflow-y-auto">
      <div className="px-2 mb-4">
        <h1 className="font-display text-2xl text-stone-800">Stashd</h1>
        <p className="text-xs text-stone-400 mt-0.5">Your document inbox</p>
      </div>

      <SearchBar />

      <div className="mt-4">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-600 hover:bg-stone-100'
            }`
          }
        >
          <Home className="w-4 h-4" />
          <span>Dashboard</span>
        </NavLink>
      </div>

      <div className="mt-4">
        <p className="px-3 mb-1 text-xs font-medium text-stone-400 uppercase tracking-wider">Categories</p>
        <CategoryList />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Update Layout**

Replace `packages/client/src/components/Layout.tsx`:

```typescript
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-warm-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Start the dev server and verify layout renders**

```bash
# Terminal 1
cd packages/server && npm run dev

# Terminal 2
cd packages/client && npm run dev
```

Open http://localhost:5173. Expected: Stashd sidebar visible on the left with search bar and category list loading from the server.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/
git commit -m "feat: Layout, Sidebar, CategoryList, and SearchBar components"
```

---

## Task 11: Dashboard + UploadZone + StatsBar

**Files:**
- Create: `packages/client/src/components/StatsBar.tsx`
- Create: `packages/client/src/components/UploadZone.tsx`
- Create: `packages/client/src/components/NeedsReviewList.tsx`
- Create: `packages/client/src/components/RecentDocuments.tsx`
- Create: `packages/client/src/components/DocumentCard.tsx`
- Modify: `packages/client/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create DocumentCard**

Create `packages/client/src/components/DocumentCard.tsx`:

```typescript
import { Link } from 'react-router-dom';
import { FileText, Image } from 'lucide-react';
import { Document } from '@stashd/shared';

interface Props {
  doc: Document;
}

export default function DocumentCard({ doc }: Props) {
  const isImage = doc.fileType.startsWith('image/');

  return (
    <Link
      to={`/document/${doc.id}`}
      className="block bg-white rounded-xl border border-stone-200 p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-stone-100 rounded-lg shrink-0">
          {isImage ? <Image className="w-5 h-5 text-stone-500" /> : <FileText className="w-5 h-5 text-stone-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-800 truncate">{doc.originalName}</p>
          <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{doc.summary}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {doc.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Create StatsBar**

Create `packages/client/src/components/StatsBar.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Files, FolderOpen } from 'lucide-react';
import { listCategories, listDocuments } from '../api/client';

export default function StatsBar() {
  const [docCount, setDocCount] = useState(0);
  const [catCount, setCatCount] = useState(0);

  useEffect(() => {
    listDocuments().then(docs => setDocCount(docs.length)).catch(console.error);
    listCategories()
      .then(cats => setCatCount(cats.filter(c => c.documentCount > 0).length))
      .catch(console.error);
  }, []);

  return (
    <div className="flex gap-4">
      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-4 py-3">
        <Files className="w-5 h-5 text-teal-600" />
        <div>
          <p className="text-lg font-semibold text-stone-800">{docCount}</p>
          <p className="text-xs text-stone-500">Documents</p>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-4 py-3">
        <FolderOpen className="w-5 h-5 text-teal-600" />
        <div>
          <p className="text-lg font-semibold text-stone-800">{catCount}</p>
          <p className="text-xs text-stone-500">Categories used</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create UploadZone**

Create `packages/client/src/components/UploadZone.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { uploadDocument } from '../api/client';
import FileProcessingCard from './FileProcessingCard';

interface UploadJob {
  file: File;
  jobId: string;
}

interface Props {
  onFilingComplete: () => void;
}

export default function UploadZone({ onFilingComplete }: Props) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const onDrop = useCallback(async (accepted: File[]) => {
    for (const file of accepted) {
      try {
        const { jobId } = await uploadDocument(file);
        setJobs(prev => [...prev, { file, jobId }]);
      } catch (err) {
        console.error('Upload failed', err);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
    maxSize: 50 * 1024 * 1024,
  });

  function dismissJob(jobId: string) {
    setJobs(prev => prev.filter(j => j.jobId !== jobId));
    onFilingComplete();
  }

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-teal-600 bg-teal-50'
            : 'border-stone-300 hover:border-teal-400 hover:bg-stone-50'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="w-8 h-8 text-stone-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-stone-700">
          {isDragActive ? 'Drop files here…' : 'Drop files here or click to upload'}
        </p>
        <p className="text-xs text-stone-400 mt-1">PDF, JPG, PNG, HEIC — up to 50MB each</p>
      </div>

      {jobs.map(job => (
        <FileProcessingCard key={job.jobId} file={job.file} jobId={job.jobId} onDismiss={dismissJob} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create NeedsReviewList**

Create `packages/client/src/components/NeedsReviewList.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Document } from '@stashd/shared';
import { listDocuments } from '../api/client';
import DocumentCard from './DocumentCard';

export default function NeedsReviewList() {
  const [docs, setDocs] = useState<Document[]>([]);

  useEffect(() => {
    listDocuments()
      .then(all => setDocs(all.filter(d => d.status === 'pending')))
      .catch(console.error);
  }, []);

  if (docs.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-stone-700">Needs Review ({docs.length})</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map(doc => <DocumentCard key={doc.id} doc={doc} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create RecentDocuments**

Create `packages/client/src/components/RecentDocuments.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Document } from '@stashd/shared';
import { listDocuments } from '../api/client';
import DocumentCard from './DocumentCard';

interface Props {
  refreshKey: number;
}

export default function RecentDocuments({ refreshKey }: Props) {
  const [docs, setDocs] = useState<Document[]>([]);

  useEffect(() => {
    listDocuments()
      .then(all =>
        setDocs(
          all
            .filter(d => d.status === 'filed')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 5),
        ),
      )
      .catch(console.error);
  }, [refreshKey]);

  if (docs.length === 0) return (
    <p className="text-sm text-stone-400 text-center py-8">No filed documents yet. Upload something!</p>
  );

  return (
    <div>
      <h2 className="text-sm font-semibold text-stone-700 mb-3">Recently Filed</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map(doc => <DocumentCard key={doc.id} doc={doc} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update Dashboard page**

Replace `packages/client/src/pages/Dashboard.tsx`:

```typescript
import { useState } from 'react';
import StatsBar from '../components/StatsBar';
import UploadZone from '../components/UploadZone';
import NeedsReviewList from '../components/NeedsReviewList';
import RecentDocuments from '../components/RecentDocuments';

export default function Dashboard() {
  const [refreshKey, setRefreshKey] = useState(0);

  function onFilingComplete() {
    setRefreshKey(k => k + 1);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-3xl text-stone-800">Inbox</h1>
        <p className="text-stone-500 mt-1 text-sm">Drop documents here to file them automatically.</p>
      </div>

      <StatsBar />
      <UploadZone onFilingComplete={onFilingComplete} />
      <NeedsReviewList />
      <RecentDocuments refreshKey={refreshKey} />
    </div>
  );
}
```

- [ ] **Step 7: Verify in browser**

With server and client dev servers running, open http://localhost:5173.  
Expected: Dashboard loads with stats, upload zone, empty recent documents message. No console errors.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/
git commit -m "feat: Dashboard with stats, upload zone, and recent documents"
```

---

## Task 12: FileProcessingCard + ClassificationReview

**Files:**
- Create: `packages/client/src/components/FileProcessingCard.tsx`
- Create: `packages/client/src/components/ClassificationReview.tsx`

- [ ] **Step 1: Create ClassificationReview**

Create `packages/client/src/components/ClassificationReview.tsx`:

```typescript
import { useState } from 'react';
import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { ClassificationResult } from '@stashd/shared';
import { fileDocument } from '../api/client';

const CATEGORY_OPTIONS = [
  'receipts-expenses', 'contracts-agreements', 'identity-personal', 'insurance',
  'medical-health', 'property-construction', 'business', 'tax-finance',
  'legal', 'warranties-manuals', 'education', 'travel', 'other',
];

const CATEGORY_LABELS: Record<string, string> = {
  'receipts-expenses': 'Receipts & Expenses',
  'contracts-agreements': 'Contracts & Agreements',
  'identity-personal': 'Identity & Personal',
  'insurance': 'Insurance',
  'medical-health': 'Medical & Health',
  'property-construction': 'Property & Construction',
  'business': 'Business',
  'tax-finance': 'Tax & Finance',
  'legal': 'Legal',
  'warranties-manuals': 'Warranties & Manuals',
  'education': 'Education',
  'travel': 'Travel',
  'other': 'Other',
};

interface Props {
  jobId: string;
  classification: ClassificationResult;
  onFiled: () => void;
}

export default function ClassificationReview({ jobId, classification, onFiled }: Props) {
  const [category, setCategory] = useState(classification.category);
  const [tagsInput, setTagsInput] = useState(classification.tags.join(', '));
  const [summary, setSummary] = useState(classification.summary);
  const [vendor, setVendor] = useState(classification.vendor ?? '');
  const [amount, setAmount] = useState(classification.amount?.toString() ?? '');
  const [date, setDate] = useState(classification.date ?? '');
  const [filing, setFiling] = useState(false);

  const mandatoryReview = classification.confidence < 0.75;

  async function handleFile(flagForLater = false) {
    setFiling(true);
    try {
      await fileDocument(jobId, {
        category,
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        summary,
        vendor: vendor || undefined,
        amount: amount ? parseFloat(amount) : undefined,
        dateExtracted: date || undefined,
        confidenceScore: classification.confidence,
        flagForLater,
      });
      onFiled();
    } catch (err) {
      console.error('Filing failed', err);
    } finally {
      setFiling(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
      {mandatoryReview && (
        <div className="flex items-center gap-2 text-amber-600 text-xs bg-amber-50 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Low confidence — please review each field before filing.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-stone-500 block mb-1">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {CATEGORY_OPTIONS.map(id => (
              <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-stone-500 block mb-1">Summary</label>
          <textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            rows={2}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600 resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1">Tags (comma-separated)</label>
          <input
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1">Vendor</label>
          <input
            value={vendor}
            onChange={e => setVendor(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            step="0.01"
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => handleFile(false)}
          disabled={filing}
          className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <CheckCircle className="w-4 h-4" />
          {mandatoryReview ? 'Confirm & File' : 'Accept & File'}
        </button>

        <button
          onClick={() => handleFile(true)}
          disabled={filing}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-700 text-sm px-3 py-2 rounded-lg hover:bg-stone-100 transition-colors disabled:opacity-50"
        >
          <Clock className="w-4 h-4" />
          Flag for later
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create FileProcessingCard**

Create `packages/client/src/components/FileProcessingCard.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { FileText, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { ClassificationResult, ProcessingStage, SSEEvent } from '@stashd/shared';
import ClassificationReview from './ClassificationReview';

interface Props {
  file: File;
  jobId: string;
  onDismiss: (jobId: string) => void;
}

export default function FileProcessingCard({ file, jobId, onDismiss }: Props) {
  const [stage, setStage] = useState<ProcessingStage>('extracting');
  const [message, setMessage] = useState('Preparing…');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/documents/process/${jobId}`);

    es.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as SSEEvent;
      setStage(event.stage);
      setMessage(event.message);
      if (event.stage === 'complete' && event.classification) {
        setClassification(event.classification);
      }
      if (event.stage === 'error') {
        setError(event.error ?? 'Unknown error');
      }
      if (event.stage === 'complete' || event.stage === 'error') {
        es.close();
      }
    };

    es.onerror = () => {
      setStage('error');
      setMessage('Connection failed');
      setError('Could not connect to server');
      es.close();
    };

    return () => es.close();
  }, [jobId]);

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <FileText className="w-5 h-5 text-stone-400 shrink-0" />
        <span className="text-sm font-medium text-stone-700 flex-1 truncate">{file.name}</span>

        {stage === 'extracting' || stage === 'classifying' ? (
          <Loader2 className="w-4 h-4 text-teal-600 animate-spin shrink-0" />
        ) : stage === 'complete' ? (
          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
        )}
      </div>

      {(stage === 'extracting' || stage === 'classifying') && (
        <p className="text-xs text-stone-400">{message}</p>
      )}

      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error} — fill in fields manually below.
        </div>
      )}

      {(stage === 'complete' || error) && classification && (
        <ClassificationReview
          jobId={jobId}
          classification={classification}
          onFiled={() => onDismiss(jobId)}
        />
      )}

      {error && !classification && (
        <ClassificationReview
          jobId={jobId}
          classification={{ category: 'other', tags: [], summary: '', parties: [], confidence: 0 }}
          onFiled={() => onDismiss(jobId)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Test the full upload flow in browser**

1. Start server and client: `npm run dev:server` and `npm run dev:client` from root.
2. Open http://localhost:5173.
3. Ensure Ollama is running: `ollama serve` and `ollama pull gemma4`.
4. Drop a PDF or image onto the upload zone.
5. Expected: FileProcessingCard appears with "Preparing…" → "Extracting…" → "Classifying…" → ClassificationReview form populated with AI fields.
6. Click "Accept & File". Expected: Card dismisses, RecentDocuments refreshes showing the new document.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/FileProcessingCard.tsx packages/client/src/components/ClassificationReview.tsx
git commit -m "feat: FileProcessingCard with SSE streaming and ClassificationReview"
```

---

## Task 13: CategoryView + DocumentGrid

**Files:**
- Create: `packages/client/src/components/DocumentGrid.tsx`
- Modify: `packages/client/src/pages/CategoryView.tsx`

- [ ] **Step 1: Create DocumentGrid**

Create `packages/client/src/components/DocumentGrid.tsx`:

```typescript
import { Document } from '@stashd/shared';
import DocumentCard from './DocumentCard';

interface Props {
  docs: Document[];
  emptyMessage?: string;
}

export default function DocumentGrid({ docs, emptyMessage = 'No documents found.' }: Props) {
  if (docs.length === 0) {
    return <p className="text-sm text-stone-400 py-8 text-center">{emptyMessage}</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {docs.map(doc => <DocumentCard key={doc.id} doc={doc} />)}
    </div>
  );
}
```

- [ ] **Step 2: Implement CategoryView page**

Replace `packages/client/src/pages/CategoryView.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { CategoryWithCount, listCategories, listDocuments } from '../api/client';
import DocumentGrid from '../components/DocumentGrid';

export default function CategoryView() {
  const { id } = useParams<{ id: string }>();
  const [docs, setDocs] = useState<Document[]>([]);
  const [category, setCategory] = useState<CategoryWithCount | null>(null);

  useEffect(() => {
    if (!id) return;
    listDocuments(undefined, id).then(setDocs).catch(console.error);
    listCategories().then(cats => setCategory(cats.find(c => c.id === id) ?? null)).catch(console.error);
  }, [id]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="font-display text-3xl text-stone-800 mb-1">{category?.name ?? id}</h1>
      <p className="text-stone-500 text-sm mb-6">{docs.length} document{docs.length !== 1 ? 's' : ''}</p>
      <DocumentGrid docs={docs} emptyMessage="No documents in this category yet." />
    </div>
  );
}
```

- [ ] **Step 3: Test in browser**

Click a category in the sidebar. Expected: Category page loads showing documents in that category (or empty state message).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/DocumentGrid.tsx packages/client/src/pages/CategoryView.tsx
git commit -m "feat: CategoryView with DocumentGrid"
```

---

## Task 14: DocumentDetail Page

**Files:**
- Create: `packages/client/src/components/PreviewPane.tsx`
- Create: `packages/client/src/components/MetadataPanel.tsx`
- Create: `packages/client/src/components/NotesEditor.tsx`
- Modify: `packages/client/src/pages/DocumentDetail.tsx`

- [ ] **Step 1: Create PreviewPane**

Create `packages/client/src/components/PreviewPane.tsx`:

```typescript
interface Props {
  docId: string;
  fileType: string;
  originalName: string;
}

export default function PreviewPane({ docId, fileType, originalName }: Props) {
  const fileUrl = `/api/documents/${docId}/file`;

  if (fileType === 'application/pdf') {
    return (
      <iframe
        src={fileUrl}
        title={originalName}
        className="w-full h-full min-h-[600px] rounded-xl border border-stone-200"
      />
    );
  }

  if (fileType.startsWith('image/')) {
    return (
      <div className="flex items-center justify-center bg-stone-100 rounded-xl border border-stone-200 min-h-64 p-4">
        <img src={fileUrl} alt={originalName} className="max-w-full max-h-[600px] object-contain rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center bg-stone-100 rounded-xl border border-stone-200 h-40">
      <p className="text-sm text-stone-400">Preview not available</p>
    </div>
  );
}
```

- [ ] **Step 2: Create MetadataPanel**

Create `packages/client/src/components/MetadataPanel.tsx`:

```typescript
import { useState } from 'react';
import { Save } from 'lucide-react';
import { Document } from '@stashd/shared';
import { updateDocument } from '../api/client';

const CATEGORY_OPTIONS = [
  { id: 'receipts-expenses', name: 'Receipts & Expenses' },
  { id: 'contracts-agreements', name: 'Contracts & Agreements' },
  { id: 'identity-personal', name: 'Identity & Personal' },
  { id: 'insurance', name: 'Insurance' },
  { id: 'medical-health', name: 'Medical & Health' },
  { id: 'property-construction', name: 'Property & Construction' },
  { id: 'business', name: 'Business' },
  { id: 'tax-finance', name: 'Tax & Finance' },
  { id: 'legal', name: 'Legal' },
  { id: 'warranties-manuals', name: 'Warranties & Manuals' },
  { id: 'education', name: 'Education' },
  { id: 'travel', name: 'Travel' },
  { id: 'other', name: 'Other' },
];

interface Props {
  doc: Document;
  onUpdate: (updated: Document) => void;
}

export default function MetadataPanel({ doc, onUpdate }: Props) {
  const [category, setCategory] = useState(doc.category);
  const [tagsInput, setTagsInput] = useState(doc.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, {
        category,
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      });
      onUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<{ label: string; value: string | undefined }> = [
    { label: 'File', value: doc.originalName },
    { label: 'Type', value: doc.fileType },
    { label: 'Size', value: `${(doc.fileSize / 1024).toFixed(1)} KB` },
    { label: 'Confidence', value: `${Math.round(doc.confidenceScore * 100)}%` },
    { label: 'Date', value: doc.dateExtracted },
    { label: 'Amount', value: doc.amount != null ? `$${doc.amount.toFixed(2)}` : undefined },
    { label: 'Vendor', value: doc.vendor },
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-stone-500 mb-1">Summary</p>
        <p className="text-sm text-stone-700">{doc.summary}</p>
      </div>

      <div>
        <label className="text-xs font-medium text-stone-500 block mb-1">Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          {CATEGORY_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-stone-500 block mb-1">Tags</label>
        <input
          value={tagsInput}
          onChange={e => setTagsInput(e.target.value)}
          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
      </div>

      <div className="space-y-1.5">
        {rows.map(({ label, value }) =>
          value ? (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-stone-500">{label}</span>
              <span className="text-stone-700 font-medium">{value}</span>
            </div>
          ) : null,
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 w-full justify-center bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create NotesEditor**

Create `packages/client/src/components/NotesEditor.tsx`:

```typescript
import { useState } from 'react';
import { Document } from '@stashd/shared';
import { updateDocument } from '../api/client';

interface Props {
  doc: Document;
  onUpdate: (updated: Document) => void;
}

export default function NotesEditor({ doc, onUpdate }: Props) {
  const [notes, setNotes] = useState(doc.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { notes });
      onUpdate(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-stone-500 block">Notes</label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={handleSave}
        rows={4}
        placeholder="Add personal notes…"
        className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600 resize-none"
      />
      {saving && <p className="text-xs text-stone-400">Saving…</p>}
    </div>
  );
}
```

- [ ] **Step 4: Implement DocumentDetail page**

Replace `packages/client/src/pages/DocumentDetail.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Document } from '@stashd/shared';
import { deleteDocument, getDocument } from '../api/client';
import PreviewPane from '../components/PreviewPane';
import MetadataPanel from '../components/MetadataPanel';
import NotesEditor from '../components/NotesEditor';

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);

  useEffect(() => {
    if (!id) return;
    getDocument(id).then(setDoc).catch(console.error);
  }, [id]);

  async function handleDelete() {
    if (!doc || !confirm(`Delete "${doc.originalName}"?`)) return;
    await deleteDocument(doc.id);
    navigate('/');
  }

  if (!doc) {
    return (
      <div className="p-8">
        <p className="text-sm text-stone-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      <h1 className="font-display text-2xl text-stone-800 mb-6 truncate">{doc.originalName}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PreviewPane docId={doc.id} fileType={doc.fileType} originalName={doc.originalName} />
        </div>
        <div className="space-y-6">
          <MetadataPanel doc={doc} onUpdate={setDoc} />
          <NotesEditor doc={doc} onUpdate={setDoc} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Test document detail in browser**

1. File a document from the Dashboard.
2. Click it in the Recent Documents list.
3. Expected: DocumentDetail page loads with file preview, metadata panel with AI fields, and notes editor. Editing category/tags and clicking Save updates the document.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/PreviewPane.tsx packages/client/src/components/MetadataPanel.tsx packages/client/src/components/NotesEditor.tsx packages/client/src/pages/DocumentDetail.tsx
git commit -m "feat: DocumentDetail page with preview, metadata editing, and notes"
```

---

## Task 15: SearchResults Page

**Files:**
- Modify: `packages/client/src/pages/SearchResults.tsx`

- [ ] **Step 1: Implement SearchResults page**

Replace `packages/client/src/pages/SearchResults.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Document } from '@stashd/shared';
import { listDocuments } from '../api/client';
import DocumentGrid from '../components/DocumentGrid';

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    listDocuments(query)
      .then(setDocs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="font-display text-3xl text-stone-800 mb-1">Search</h1>
      <p className="text-stone-500 text-sm mb-6">
        {loading ? 'Searching…' : `${docs.length} result${docs.length !== 1 ? 's' : ''} for "${query}"`}
      </p>
      {!loading && (
        <DocumentGrid docs={docs} emptyMessage={`No documents matching "${query}".`} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Test search in browser**

1. File several documents from the Dashboard.
2. Type a keyword in the search bar and press Enter.
3. Expected: SearchResults page shows matching documents or a "No documents" message.

- [ ] **Step 3: Run all server tests**

```bash
cd packages/server && npm test
```

Expected: All tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/SearchResults.tsx
git commit -m "feat: SearchResults page with full-text search"
```

---

## Running the Application

Start all three services:

```bash
# Terminal 1 — Ollama
ollama serve
ollama pull gemma4  # first time only

# Terminal 2 — API server
npm run dev:server

# Terminal 3 — React client
npm run dev:client
```

Open http://localhost:5173. The `data/` directory is created automatically on first server start.
