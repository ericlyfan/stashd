import Database from 'better-sqlite3';
import { existsSync, renameSync, readFileSync } from 'fs';
import { join } from 'path';
import { Document, Category, CategoryId, SearchHit } from '@stashd/shared';

// Markers FTS5 snippet() wraps matches in; stripped before the snippet is
// sent to the client, and used to tell "real match in body text" apart from
// "snippet of a column that didn't match".
const SNIP_OPEN = '\u0002';
const SNIP_CLOSE = '\u0003';

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'other', name: 'Other', icon: 'folder', color: '#a8a29e', isCustom: false },
];

interface DocumentRow {
  rowid: number;
  id: string;
  filename: string;
  original_name: string;
  storage_path: string;
  file_type: string;
  file_size: number;
  category: string;
  subcategory: string | null;
  tags: string;
  summary: string;
  date_extracted: string | null;
  amount: number | null;
  vendor: string | null;
  confidence_score: number;
  status: string;
  notes: string | null;
  extracted_text: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_custom: number;
}

function rowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    storagePath: row.storage_path,
    fileType: row.file_type,
    fileSize: row.file_size,
    category: row.category as CategoryId,
    subcategory: row.subcategory ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    summary: row.summary,
    dateExtracted: row.date_extracted ?? undefined,
    amount: row.amount ?? undefined,
    vendor: row.vendor ?? undefined,
    confidenceScore: row.confidence_score,
    status: row.status as Document['status'],
    notes: row.notes ?? undefined,
    extractedText: row.extracted_text ?? undefined,
    contentHash: row.content_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, color: row.color, icon: row.icon, isCustom: row.is_custom === 1 };
}

// Turn free-typed user input into an FTS5 MATCH expression: each word becomes
// a quoted prefix term ("home"* "dep"*), ANDed together. Returns undefined when
// nothing tokenizable remains.
function buildMatchQuery(query: string): string | undefined {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/["']/g, '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return undefined;
  return tokens.map(t => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

/**
 * SQLite-backed metadata store: replaces the old whole-file manifest.json.
 * All writes are immediate (WAL mode), and search runs through an FTS5 index
 * kept in sync by triggers.
 */
export class StoreService {
  private db!: Database.Database;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async load(): Promise<void> {
    this.db = new Database(join(this.dataDir, 'stashd.db'));
    this.db.pragma('journal_mode = WAL');
    this.createSchema();
    this.migrateFromManifest();
    if ((this.db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n === 0) {
      for (const cat of DEFAULT_CATEGORIES) this.addCategory(cat);
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        date_extracted TEXT,
        amount REAL,
        vendor TEXT,
        confidence_score REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'filed',
        notes TEXT,
        extracted_text TEXT,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
      CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);

      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        original_name, summary, tags, vendor, category, notes, extracted_text,
        content='documents', content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, original_name, summary, tags, vendor, category, notes, extracted_text)
        VALUES (new.rowid, new.original_name, new.summary, new.tags, new.vendor, new.category, new.notes, new.extracted_text);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, original_name, summary, tags, vendor, category, notes, extracted_text)
        VALUES ('delete', old.rowid, old.original_name, old.summary, old.tags, old.vendor, old.category, old.notes, old.extracted_text);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, original_name, summary, tags, vendor, category, notes, extracted_text)
        VALUES ('delete', old.rowid, old.original_name, old.summary, old.tags, old.vendor, old.category, old.notes, old.extracted_text);
        INSERT INTO documents_fts(rowid, original_name, summary, tags, vendor, category, notes, extracted_text)
        VALUES (new.rowid, new.original_name, new.summary, new.tags, new.vendor, new.category, new.notes, new.extracted_text);
      END;
    `);
  }

  // One-time import of the legacy manifest.json. Only runs against an empty
  // database; the manifest is renamed (not deleted) afterwards so the old
  // data stays recoverable.
  private migrateFromManifest(): void {
    const manifestPath = join(this.dataDir, 'manifest.json');
    if (!existsSync(manifestPath)) return;
    const docCount = (this.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n;
    const catCount = (this.db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
    if (docCount > 0 || catCount > 0) return;

    let manifest: { documents?: Document[]; categories?: Category[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      console.warn('manifest.json is unreadable — starting with an empty database');
      return;
    }

    const importAll = this.db.transaction(() => {
      for (const cat of manifest.categories ?? []) this.addCategory(cat);
      for (const doc of manifest.documents ?? []) this.addDocument(doc);
    });
    importAll();

    renameSync(manifestPath, `${manifestPath}.migrated`);
    console.log(
      `Migrated manifest.json → stashd.db (${manifest.documents?.length ?? 0} documents, ` +
      `${manifest.categories?.length ?? 0} categories); original kept as manifest.json.migrated`,
    );
  }

  // ── Documents ───────────────────────────────────────────────────────────

  getDocuments(categoryId?: CategoryId): Document[] {
    const rows = categoryId
      ? this.db.prepare('SELECT * FROM documents WHERE category = ? ORDER BY rowid').all(categoryId)
      : this.db.prepare('SELECT * FROM documents ORDER BY rowid').all();
    return (rows as DocumentRow[]).map(rowToDocument);
  }

  getDocument(id: string): Document | undefined {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
    return row ? rowToDocument(row) : undefined;
  }

  findDocumentByHash(hash: string): Document | undefined {
    const row = this.db.prepare('SELECT * FROM documents WHERE content_hash = ? ORDER BY rowid LIMIT 1').get(hash) as
      | DocumentRow
      | undefined;
    return row ? rowToDocument(row) : undefined;
  }

  addDocument(doc: Document): void {
    this.db
      .prepare(`
        INSERT INTO documents (
          id, filename, original_name, storage_path, file_type, file_size,
          category, subcategory, tags, summary, date_extracted, amount, vendor,
          confidence_score, status, notes, extracted_text, content_hash, created_at, updated_at
        ) VALUES (
          @id, @filename, @originalName, @storagePath, @fileType, @fileSize,
          @category, @subcategory, @tags, @summary, @dateExtracted, @amount, @vendor,
          @confidenceScore, @status, @notes, @extractedText, @contentHash, @createdAt, @updatedAt
        )
      `)
      .run({
        ...doc,
        subcategory: doc.subcategory ?? null,
        tags: JSON.stringify(doc.tags),
        dateExtracted: doc.dateExtracted ?? null,
        amount: doc.amount ?? null,
        vendor: doc.vendor ?? null,
        notes: doc.notes ?? null,
        extractedText: doc.extractedText ?? null,
        contentHash: doc.contentHash ?? null,
      });
  }

  updateDocument(
    id: string,
    updates: Partial<
      Pick<
        Document,
        'category' | 'tags' | 'notes' | 'status' | 'updatedAt' | 'extractedText' | 'contentHash' | 'originalName'
      >
    >,
  ): Document | undefined {
    const existing = this.getDocument(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    this.db
      .prepare(`
        UPDATE documents SET
          category = ?, tags = ?, notes = ?, status = ?,
          extracted_text = ?, content_hash = ?, original_name = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        merged.category,
        JSON.stringify(merged.tags),
        merged.notes ?? null,
        merged.status,
        merged.extractedText ?? null,
        merged.contentHash ?? null,
        merged.originalName,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  removeDocument(id: string): boolean {
    return this.db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
  }

  // ── Categories ──────────────────────────────────────────────────────────

  getCategories(): Category[] {
    const rows = this.db.prepare('SELECT * FROM categories ORDER BY rowid').all() as CategoryRow[];
    return rows.map(rowToCategory);
  }

  getCategory(id: string): Category | undefined {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
    return row ? rowToCategory(row) : undefined;
  }

  getCategoryCounts(): Record<string, number> {
    const rows = this.db.prepare('SELECT category, COUNT(*) AS n FROM documents GROUP BY category').all() as {
      category: string;
      n: number;
    }[];
    return Object.fromEntries(rows.map(r => [r.category, r.n]));
  }

  addCategory(category: Category): void {
    this.db
      .prepare('INSERT OR IGNORE INTO categories (id, name, color, icon, is_custom) VALUES (?, ?, ?, ?, ?)')
      .run(category.id, category.name, category.color, category.icon, category.isCustom ? 1 : 0);
  }

  updateCategory(id: string, updates: Partial<Pick<Category, 'name' | 'icon' | 'color'>>): Category | undefined {
    const existing = this.getCategory(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    this.db
      .prepare('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?')
      .run(merged.name, merged.icon, merged.color, id);
    return merged;
  }

  removeCategory(id: string): boolean {
    return this.db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes > 0;
  }

  // ── Search ──────────────────────────────────────────────────────────────

  /**
   * FTS5 search across name, summary, tags, vendor, category, notes and the
   * extracted body text. Terms are word-prefix matched and ANDed. The snippet
   * is only attached when the body text itself matched — other fields are
   * already visible on the result card.
   */
  searchDocuments(query: string, categoryId?: CategoryId): SearchHit[] {
    const match = buildMatchQuery(query);
    if (!match) return this.getDocuments(categoryId);

    const sql = `
      SELECT d.*, snippet(documents_fts, 6, ?, ?, '…', 24) AS snip
      FROM documents_fts
      JOIN documents d ON d.rowid = documents_fts.rowid
      WHERE documents_fts MATCH ?${categoryId ? ' AND d.category = ?' : ''}
      ORDER BY rank
    `;
    const params: unknown[] = [SNIP_OPEN, SNIP_CLOSE, match];
    if (categoryId) params.push(categoryId);

    const rows = this.db.prepare(sql).all(...params) as (DocumentRow & { snip: string | null })[];
    return rows.map(row => {
      const doc = rowToDocument(row) as SearchHit;
      if (row.snip?.includes(SNIP_OPEN)) {
        doc.snippet = row.snip.replaceAll(SNIP_OPEN, '').replaceAll(SNIP_CLOSE, '').trim();
      }
      return doc;
    });
  }
}
