import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, renameSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  Document,
  Category,
  CategoryId,
  SearchHit,
  Conversation,
  ConversationDetail,
  ChatAttachment,
  ChatMessage,
  Project,
  ProjectStatus,
  ProjectSummary,
  ProjectDetail,
  ProjectTotals,
  LineItem,
  LineItemInput,
  DocumentLink,
  Holding,
  HoldingInput,
  HoldingLot,
  HoldingLotInput,
  WatchlistItem,
  ApplicationStage,
  ApplicationStageInput,
  ApplicationContact,
  ApplicationContactInput,
  ApplicationEvent,
  JobApplication,
  JobApplicationInput,
  StageKind,
  WorkMode,
} from '@stashd/shared';
import {
  hammingHex,
  SIMHASH_MAX_DISTANCE,
  PHASH_MAX_DISTANCE,
} from './nearDuplicate';

// Markers FTS5 snippet() wraps matches in; stripped before the snippet is
// sent to the client, and used to tell "real match in body text" apart from
// "snippet of a column that didn't match".
const SNIP_OPEN = '\u0002';
const SNIP_CLOSE = '\u0003';

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'other', name: 'Other', icon: 'folder', color: '#a8a29e', isCustom: false, pinned: false, position: 0 },
];

// Seed pipeline for the job-applications tracker (only inserted into an empty
// application_stages table). All of it is user-editable afterwards; the fixed
// slug ids just make a fresh database predictable. Colors from COLOR_PALETTE.
const DEFAULT_APPLICATION_STAGES: ApplicationStage[] = [
  { id: 'applied', name: 'Applied', position: 1, color: '#64748b', kind: 'applied', isTerminal: false },
  { id: 'interviewing', name: 'Interviewing', position: 2, color: '#6366f1', kind: 'interview', isTerminal: false },
  { id: 'offer', name: 'Offer', position: 3, color: '#f59e0b', kind: 'offer', isTerminal: false },
  { id: 'accepted', name: 'Accepted', position: 4, color: '#10b981', kind: 'offer', isTerminal: true },
  { id: 'rejected', name: 'Rejected', position: 5, color: '#ef4444', kind: 'rejected', isTerminal: true },
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
  sim_hash: string | null;
  perceptual_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_custom: number;
  pinned: number;
  position: number;
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
    simHash: row.sim_hash ?? undefined,
    perceptualHash: row.perceptual_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    isCustom: row.is_custom === 1,
    pinned: row.pinned === 1,
    position: row.position ?? 0,
  };
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface LineItemRow {
  id: string;
  project_id: string;
  category: string | null;
  vendor: string | null;
  description: string;
  quantity: number | null;
  date_paid: string | null;
  invoice_number: string | null;
  amount_requested: number | null;
  amount_paid: number | null;
  tax_amount: number | null;
  total_paid: number | null;
  status: string | null;
  notes: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as ProjectStatus,
    isDefault: !!row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLineItem(row: LineItemRow): LineItem {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category ?? undefined,
    vendor: row.vendor ?? undefined,
    description: row.description,
    quantity: row.quantity ?? undefined,
    datePaid: row.date_paid ?? undefined,
    invoiceNumber: row.invoice_number ?? undefined,
    amountRequested: row.amount_requested ?? undefined,
    amountPaid: row.amount_paid ?? undefined,
    taxAmount: row.tax_amount ?? undefined,
    totalPaid: row.total_paid ?? undefined,
    status: row.status ?? undefined,
    notes: row.notes ?? undefined,
    documentId: row.document_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface HoldingRow {
  id: string;
  symbol: string;
  name: string | null;
  shares: number;
  buy_price: number;
  manual_price: number | null;
  currency: string | null;
  document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name ?? undefined,
    shares: row.shares,
    buyPrice: row.buy_price,
    manualPrice: row.manual_price ?? undefined,
    currency: row.currency ?? undefined,
    documentId: row.document_id ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface HoldingLotRow {
  id: string;
  holding_id: string;
  type: string;
  trade_date: string;
  shares: number;
  price: number;
  fee: number | null;
  notes: string | null;
  created_at: string;
}

function rowToLot(row: HoldingLotRow): HoldingLot {
  return {
    id: row.id,
    holdingId: row.holding_id,
    type: row.type as HoldingLot['type'],
    date: row.trade_date,
    shares: row.shares,
    price: row.price,
    fee: row.fee ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

interface WatchlistRow {
  id: string;
  symbol: string;
  name: string | null;
  notes: string | null;
  folder: string | null;
  created_at: string;
}

function rowToWatchlistItem(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name ?? undefined,
    notes: row.notes ?? undefined,
    folder: row.folder ?? undefined,
    createdAt: row.created_at,
  };
}

interface ApplicationStageRow {
  id: string;
  name: string;
  position: number;
  color: string;
  kind: string;
  is_terminal: number;
}

function rowToApplicationStage(row: ApplicationStageRow): ApplicationStage {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    color: row.color,
    kind: row.kind as StageKind,
    isTerminal: !!row.is_terminal,
  };
}

interface JobApplicationRow {
  id: string;
  company: string;
  role: string;
  url: string | null;
  location: string | null;
  work_mode: string | null;
  description: string | null;
  source: string | null;
  compensation: string | null;
  stage_id: string;
  applied_date: string | null;
  document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJobApplication(row: JobApplicationRow): JobApplication {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    url: row.url ?? undefined,
    location: row.location ?? undefined,
    workMode: (row.work_mode as WorkMode | null) ?? undefined,
    description: row.description ?? undefined,
    source: row.source ?? undefined,
    compensation: row.compensation ?? undefined,
    stageId: row.stage_id,
    appliedDate: row.applied_date ?? undefined,
    documentId: row.document_id ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ApplicationEventRow {
  id: string;
  application_id: string;
  stage_id: string | null;
  stage_name: string;
  occurred_at: string;
  note: string | null;
}

function rowToApplicationEvent(row: ApplicationEventRow): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.application_id,
    stageId: row.stage_id ?? undefined,
    stageName: row.stage_name,
    occurredAt: row.occurred_at,
    note: row.note ?? undefined,
  };
}

interface ApplicationContactRow {
  id: string;
  application_id: string;
  name: string;
  title: string | null;
  email: string | null;
  url: string | null;
  notes: string | null;
  created_at: string;
}

function rowToApplicationContact(row: ApplicationContactRow): ApplicationContact {
  return {
    id: row.id,
    applicationId: row.application_id,
    name: row.name,
    title: row.title ?? undefined,
    email: row.email ?? undefined,
    url: row.url ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

function sumTotals(items: LineItem[]): ProjectTotals {
  return items.reduce<ProjectTotals>(
    (acc, it) => ({
      itemCount: acc.itemCount + 1,
      requested: acc.requested + (it.amountRequested ?? 0),
      paid: acc.paid + (it.amountPaid ?? 0),
      tax: acc.tax + (it.taxAmount ?? 0),
      total: acc.total + (it.totalPaid ?? 0),
    }),
    { itemCount: 0, requested: 0, paid: 0, tax: 0, total: 0 },
  );
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
    sqliteVec.load(this.db);
    this.createSchema();
    this.migrateCategoryColumns();
    this.migrateProjectColumns();
    this.migrateDocumentColumns();
    this.migrateWatchlistColumns();
    this.migrateFromManifest();
    if ((this.db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n === 0) {
      for (const cat of DEFAULT_CATEGORIES) this.addCategory(cat);
    }
    if ((this.db.prepare('SELECT COUNT(*) AS n FROM application_stages').get() as { n: number }).n === 0) {
      for (const stage of DEFAULT_APPLICATION_STAGES) this.addApplicationStage(stage);
    }
  }

  // Adds the pinned/position columns to category tables created before sidebar
  // ordering existed. ALTER ADD COLUMN is a no-op-safe pattern guarded by a
  // table_info lookup so it never throws on an already-migrated database.
  private migrateCategoryColumns(): void {
    const cols = (this.db.prepare('PRAGMA table_info(categories)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('pinned')) {
      this.db.exec('ALTER TABLE categories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('position')) {
      this.db.exec('ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    }
  }

  // Adds the folder column to watchlists created before grouped watchlists
  // (folders + thesis notes). Same guarded ALTER pattern as above.
  private migrateWatchlistColumns(): void {
    const cols = (this.db.prepare('PRAGMA table_info(watchlist)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('folder')) {
      this.db.exec('ALTER TABLE watchlist ADD COLUMN folder TEXT');
    }
  }

  // Adds the near-duplicate signature columns (SimHash over text, dHash over
  // images) to databases created before fuzzy dup detection. Same guarded
  // ALTER pattern; backfilled for existing docs by backfillDerivedFields.
  private migrateDocumentColumns(): void {
    const cols = (this.db.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('sim_hash')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN sim_hash TEXT');
    }
    if (!cols.includes('perceptual_hash')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN perceptual_hash TEXT');
    }
  }

  // Adds the "current project" flag to databases created before the feature.
  private migrateProjectColumns(): void {
    const cols = (this.db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('is_default')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 1,
        pinned INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
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
        sim_hash TEXT,
        perceptual_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
      CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);

      -- Durable file-deletion queue. Document metadata/vector rows are removed
      -- in SQLite first, then the filesystem unlink is attempted. If unlink
      -- fails or the process crashes before it runs, this row keeps the orphaned
      -- path visible and retryable on startup.
      CREATE TABLE IF NOT EXISTS pending_document_deletions (
        storage_path TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS doc_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);

      -- Records which embedding model/dimension built the vector index, so a
      -- model swap triggers a full re-embed instead of mixing vector spaces.
      CREATE TABLE IF NOT EXISTS rag_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Databases created while the classic/agentic chat toggle existed also
      -- carry a legacy "mode" column (NOT NULL DEFAULT 'classic'). It is
      -- deliberately ignored rather than migrated away: dropping a column
      -- means rebuilding the table for no behavioral gain, and inserts still
      -- satisfy it via its default.
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

      CREATE TABLE IF NOT EXISTS conversation_pins (
        conversation_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        PRIMARY KEY (conversation_id, doc_id)
      );

      -- Files dropped straight into a conversation as throwaway context: text
      -- is extracted and read by the model, but nothing is filed in the stash.
      CREATE TABLE IF NOT EXISTS chat_attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation ON chat_attachments(conversation_id);

      -- Ledgers: cost-tracking projects and their line items. Largely
      -- independent of documents; document_id is a nullable, advisory link.
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS line_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        category TEXT,
        vendor TEXT,
        description TEXT NOT NULL DEFAULT '',
        quantity REAL,
        date_paid TEXT,
        invoice_number TEXT,
        amount_requested REAL,
        amount_paid REAL,
        tax_amount REAL,
        total_paid REAL,
        status TEXT,
        notes TEXT,
        document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_line_items_project ON line_items(project_id);
      CREATE INDEX IF NOT EXISTS idx_line_items_document ON line_items(document_id);

      -- Portfolio: tracked stock holdings. Independent of documents;
      -- document_id is a nullable, advisory link to a supporting doc (e.g. a
      -- brokerage statement). Current price is never stored — it's fetched
      -- live per request; manual_price is an optional per-share override.
      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT,
        shares REAL NOT NULL DEFAULT 0,
        buy_price REAL NOT NULL DEFAULT 0,
        manual_price REAL,
        currency TEXT,
        document_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_holdings_document ON holdings(document_id);

      -- Dated buy/sell transactions ("lots") for a holding. When a holding has
      -- lots they are the source of truth for its position + cost basis
      -- (average-cost accounting); with none, the holding's stored shares/
      -- buy_price act as a single undated opening lot. Deleted with the holding.
      CREATE TABLE IF NOT EXISTS holding_lots (
        id TEXT PRIMARY KEY,
        holding_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'buy',
        trade_date TEXT NOT NULL,
        shares REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        fee REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_holding_lots_holding ON holding_lots(holding_id);

      -- Watchlist: stocks the user is following but doesn't (necessarily) own.
      -- Priced live like holdings; no positions/cost basis.
      CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);

      -- Job applications: a pipeline tracker. Stages are user-customizable;
      -- 'kind' is the semantic bucket the KPI math reads (so renames never
      -- break the stats) and terminal stages don't count as active.
      CREATE TABLE IF NOT EXISTS application_stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'screen',
        is_terminal INTEGER NOT NULL DEFAULT 0
      );

      -- The applications themselves. stage_id is the denormalized head of the
      -- event history; document_id is a nullable, advisory link to a supporting
      -- stash document (resume, JD, offer letter).
      CREATE TABLE IF NOT EXISTS job_applications (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        url TEXT,
        location TEXT,
        work_mode TEXT,
        description TEXT,
        source TEXT,
        compensation TEXT,
        stage_id TEXT NOT NULL,
        applied_date TEXT,
        document_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_applications_stage ON job_applications(stage_id);
      CREATE INDEX IF NOT EXISTS idx_job_applications_document ON job_applications(document_id);

      -- Timestamped status history: one row per stage entry. stage_name is a
      -- snapshot so history survives stage renames/deletes (stage_id may
      -- dangle). Deleted with the application.
      CREATE TABLE IF NOT EXISTS application_events (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        stage_id TEXT,
        stage_name TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_application_events_application ON application_events(application_id);

      -- Recruiters / hiring managers / referrers tied to one application.
      -- Deleted with the application.
      CREATE TABLE IF NOT EXISTS application_contacts (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT,
        email TEXT,
        url TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_application_contacts_application ON application_contacts(application_id);
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

  // Advisory near-duplicate lookup: the closest already-filed document whose
  // near-dup signature is within threshold of the given one. Prefers the image
  // dHash when a perceptualHash is supplied, else the text SimHash. Linear scan
  // (a personal stash is small enough that no index is warranted). Returns the
  // match plus a 0..1 similarity (1 - distance/64); undefined if nothing is
  // close enough.
  findNearDuplicate(sig: {
    simHash?: string;
    perceptualHash?: string;
    excludeId?: string;
  }): { doc: Document; similarity: number } | undefined {
    const useImage = !!sig.perceptualHash;
    const column = useImage ? 'perceptual_hash' : 'sim_hash';
    const target = useImage ? sig.perceptualHash! : sig.simHash;
    const maxDistance = useImage ? PHASH_MAX_DISTANCE : SIMHASH_MAX_DISTANCE;
    if (!target) return undefined;

    const rows = this.db
      .prepare(`SELECT * FROM documents WHERE ${column} IS NOT NULL`)
      .all() as DocumentRow[];

    let best: { doc: Document; distance: number } | undefined;
    for (const row of rows) {
      if (sig.excludeId && row.id === sig.excludeId) continue;
      const candidate = useImage ? row.perceptual_hash : row.sim_hash;
      const distance = hammingHex(target, candidate);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { doc: rowToDocument(row), distance };
      }
    }
    return best ? { doc: best.doc, similarity: 1 - best.distance / 64 } : undefined;
  }

  addDocument(doc: Document): void {
    this.db
      .prepare(`
        INSERT INTO documents (
          id, filename, original_name, storage_path, file_type, file_size,
          category, subcategory, tags, summary, date_extracted, amount, vendor,
          confidence_score, status, notes, extracted_text, content_hash,
          sim_hash, perceptual_hash, created_at, updated_at
        ) VALUES (
          @id, @filename, @originalName, @storagePath, @fileType, @fileSize,
          @category, @subcategory, @tags, @summary, @dateExtracted, @amount, @vendor,
          @confidenceScore, @status, @notes, @extractedText, @contentHash,
          @simHash, @perceptualHash, @createdAt, @updatedAt
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
        simHash: doc.simHash ?? null,
        perceptualHash: doc.perceptualHash ?? null,
      });
  }

  updateDocument(
    id: string,
    updates: Partial<
      Pick<
        Document,
        | 'category'
        | 'tags'
        | 'notes'
        | 'status'
        | 'updatedAt'
        | 'extractedText'
        | 'contentHash'
        | 'simHash'
        | 'perceptualHash'
        | 'originalName'
      >
    >,
  ): Document | undefined {
    const existing = this.getDocument(id);
    if (!existing) return undefined;
    const merged = {
      ...existing,
      ...updates,
      category: updates.category !== undefined && this.getCategory(updates.category) ? updates.category : existing.category,
      tags: updates.tags !== undefined && Array.isArray(updates.tags) ? updates.tags : existing.tags,
    };
    this.db
      .prepare(`
        UPDATE documents SET
          category = ?, tags = ?, notes = ?, status = ?,
          extracted_text = ?, content_hash = ?, sim_hash = ?, perceptual_hash = ?,
          original_name = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        merged.category,
        JSON.stringify(merged.tags),
        merged.notes ?? null,
        merged.status,
        merged.extractedText ?? null,
        merged.contentHash ?? null,
        merged.simHash ?? null,
        merged.perceptualHash ?? null,
        merged.originalName,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  removeDocument(id: string): boolean {
    const run = this.db.transaction(() => {
      // Drop any ledger line-item, portfolio-holding and job-application links
      // so they dangle harmlessly rather than pointing at a deleted document.
      this.db.prepare('UPDATE line_items SET document_id = NULL WHERE document_id = ?').run(id);
      this.db.prepare('UPDATE holdings SET document_id = NULL WHERE document_id = ?').run(id);
      this.db.prepare('UPDATE job_applications SET document_id = NULL WHERE document_id = ?').run(id);
      this.deleteChunksUnsafe(id);
      return this.db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
    });
    return run();
  }

  removeDocumentAndQueueFileDeletion(id: string, storagePath: string): boolean {
    const run = this.db.transaction(() => {
      // Drop any ledger line-item, portfolio-holding and job-application links
      // so they dangle harmlessly rather than pointing at a deleted document.
      this.db.prepare('UPDATE line_items SET document_id = NULL WHERE document_id = ?').run(id);
      this.db.prepare('UPDATE holdings SET document_id = NULL WHERE document_id = ?').run(id);
      this.db.prepare('UPDATE job_applications SET document_id = NULL WHERE document_id = ?').run(id);
      this.deleteChunksUnsafe(id);
      const deleted = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
      if (deleted) this.queueDocumentFileDeletionUnsafe(storagePath);
      return deleted;
    });
    return run();
  }

  queueDocumentFileDeletion(storagePath: string): void {
    const run = this.db.transaction(() => this.queueDocumentFileDeletionUnsafe(storagePath));
    run();
  }

  listPendingDocumentDeletions(): string[] {
    const rows = this.db
      .prepare('SELECT storage_path FROM pending_document_deletions ORDER BY created_at')
      .all() as { storage_path: string }[];
    return rows.map(r => r.storage_path);
  }

  completeDocumentFileDeletion(storagePath: string): void {
    this.db.prepare('DELETE FROM pending_document_deletions WHERE storage_path = ?').run(storagePath);
  }

  private queueDocumentFileDeletionUnsafe(storagePath: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO pending_document_deletions (storage_path, created_at) VALUES (?, ?)')
      .run(storagePath, new Date().toISOString());
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
      .prepare(
        'INSERT OR IGNORE INTO categories (id, name, color, icon, is_custom, pinned, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        category.id,
        category.name,
        category.color,
        category.icon,
        category.isCustom ? 1 : 0,
        category.pinned ? 1 : 0,
        category.position ?? 0,
      );
  }

  updateCategory(
    id: string,
    updates: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'pinned' | 'position'>>,
  ): Category | undefined {
    const existing = this.getCategory(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    this.db
      .prepare('UPDATE categories SET name = ?, icon = ?, color = ?, pinned = ?, position = ? WHERE id = ?')
      .run(merged.name, merged.icon, merged.color, merged.pinned ? 1 : 0, merged.position, id);
    return merged;
  }

  // Persists a manual drawer order by stamping 1-based positions onto the given
  // ids in array order. Ids not present keep their existing position.
  reorderCategories(orderedIds: string[]): void {
    const stmt = this.db.prepare('UPDATE categories SET position = ? WHERE id = ?');
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i + 1, id));
    });
    tx(orderedIds);
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

  // ── Vector index (RAG) ──────────────────────────────────────────────────

  /**
   * Creates the vec0 table for the given embedding model. The table dimension
   * is fixed at creation, so switching models (or dims) drops the whole index
   * — callers re-embed everything afterwards. Returns true if the index was
   * (re)created empty.
   */
  ensureVecIndex(model: string, dim: number): boolean {
    const current = this.db.prepare("SELECT value FROM rag_meta WHERE key = 'embedding'").get() as
      | { value: string }
      | undefined;
    const wanted = `${model}/${dim}`;
    const tableExists = !!this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'doc_chunks_vec'")
      .get();
    if (current?.value === wanted && tableExists) return false;

    const rebuild = this.db.transaction(() => {
      if (tableExists) this.db.exec('DROP TABLE doc_chunks_vec');
      this.db.exec('DELETE FROM doc_chunks');
      this.db.exec(`CREATE VIRTUAL TABLE doc_chunks_vec USING vec0(embedding float[${dim}])`);
      this.db
        .prepare("INSERT INTO rag_meta (key, value) VALUES ('embedding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(wanted);
    });
    rebuild();
    return true;
  }

  /** Doc ids that have indexable text but no chunks yet (boot backfill). */
  getDocIdsNeedingIndex(): string[] {
    const rows = this.db
      .prepare(`
        SELECT id FROM documents
        WHERE id NOT IN (SELECT DISTINCT doc_id FROM doc_chunks)
        ORDER BY rowid
      `)
      .all() as { id: string }[];
    return rows.map(r => r.id);
  }

  replaceDocChunks(docId: string, chunks: { text: string; embedding: Float32Array }[]): boolean {
    const insertChunk = this.db.prepare('INSERT INTO doc_chunks (doc_id, seq, text) VALUES (?, ?, ?)');
    const insertVec = this.db.prepare('INSERT INTO doc_chunks_vec (rowid, embedding) VALUES (?, ?)');
    const run = this.db.transaction(() => {
      const exists = this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(docId);
      if (!exists) return false;
      this.deleteChunksUnsafe(docId);
      chunks.forEach((chunk, seq) => {
        const rowid = insertChunk.run(docId, seq, chunk.text).lastInsertRowid;
        // vec0 insists the rowid arrives as a true SQLite integer; a JS
        // number binds as a float and gets rejected.
        insertVec.run(BigInt(rowid), Buffer.from(chunk.embedding.buffer, chunk.embedding.byteOffset, chunk.embedding.byteLength));
      });
      return true;
    });
    return run();
  }

  deleteDocChunks(docId: string): void {
    const run = this.db.transaction(() => this.deleteChunksUnsafe(docId));
    run();
  }

  private deleteChunksUnsafe(docId: string): void {
    const ids = this.db.prepare('SELECT id FROM doc_chunks WHERE doc_id = ?').all(docId) as { id: number }[];
    if (ids.length === 0) return;
    const delVec = this.db.prepare('DELETE FROM doc_chunks_vec WHERE rowid = ?');
    for (const { id } of ids) delVec.run(BigInt(id));
    this.db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?').run(docId);
  }

  /** KNN over chunk embeddings; joins back to the owning document. */
  searchChunks(
    embedding: Float32Array,
    k: number,
  ): { docId: string; docName: string; category: string; seq: number; text: string; distance: number }[] {
    const rows = this.db
      .prepare(`
        SELECT c.doc_id AS docId, d.original_name AS docName, d.category AS category,
               c.seq AS seq, c.text AS text, v.distance AS distance
        FROM (
          SELECT rowid, distance FROM doc_chunks_vec
          WHERE embedding MATCH ? AND k = ?
        ) v
        JOIN doc_chunks c ON c.id = v.rowid
        JOIN documents d ON d.id = c.doc_id
        ORDER BY v.distance
      `)
      .all(Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), k) as {
      docId: string;
      docName: string;
      category: string;
      seq: number;
      text: string;
      distance: number;
    }[];
    return rows;
  }

  // ── Conversations & messages ────────────────────────────────────────────
  // Note: reads/writes never touch the legacy per-conversation "mode" column
  // (see the schema comment) — it is dead data on pre-unification databases.

  listConversations(): Conversation[] {
    const rows = this.db
      .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
      .all() as { id: string; title: string; created_at: string; updated_at: string }[];
    return rows.map(r => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  addConversation(conv: Conversation): void {
    this.db
      .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conv.id, conv.title, conv.createdAt, conv.updatedAt);
  }

  getConversation(id: string): ConversationDetail | undefined {
    const row = this.db
      .prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?')
      .get(id) as { id: string; title: string; created_at: string; updated_at: string } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: this.getMessages(id),
      pinnedDocIds: this.getPins(id),
      attachments: this.getChatAttachments(id),
    };
  }

  touchConversation(id: string, updates: { title?: string; updatedAt: string }): void {
    if (updates.title !== undefined) {
      this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(updates.title, updates.updatedAt, id);
    } else {
      this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updates.updatedAt, id);
    }
  }

  removeConversation(id: string): boolean {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM conversation_pins WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM chat_attachments WHERE conversation_id = ?').run(id);
      return this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
    });
    return run();
  }

  // Conversation-scoped chat attachments (throwaway context, never filed).
  getChatAttachments(conversationId: string): ChatAttachment[] {
    const rows = this.db
      .prepare('SELECT id, conversation_id, name, mime, text, created_at FROM chat_attachments WHERE conversation_id = ? ORDER BY rowid')
      .all(conversationId) as { id: string; conversation_id: string; name: string; mime: string; text: string; created_at: string }[];
    return rows.map(r => ({
      id: r.id,
      conversationId: r.conversation_id,
      name: r.name,
      mime: r.mime,
      text: r.text,
      createdAt: r.created_at,
    }));
  }

  addChatAttachment(att: ChatAttachment): void {
    this.db
      .prepare('INSERT INTO chat_attachments (id, conversation_id, name, mime, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(att.id, att.conversationId, att.name, att.mime, att.text, att.createdAt);
  }

  removeChatAttachment(conversationId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM chat_attachments WHERE conversation_id = ? AND id = ?').run(conversationId, id).changes > 0;
  }

  getMessages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid')
      .all(conversationId) as { id: string; conversation_id: string; role: string; content: string; meta: string | null; created_at: string }[];
    return rows.map(r => {
      const meta = r.meta ? (JSON.parse(r.meta) as Pick<ChatMessage, 'citations' | 'toolCalls'>) : {};
      return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role as ChatMessage['role'],
        content: r.content,
        citations: meta.citations,
        toolCalls: meta.toolCalls,
        createdAt: r.created_at,
      };
    });
  }

  addMessage(msg: ChatMessage): void {
    const meta =
      msg.citations?.length || msg.toolCalls?.length
        ? JSON.stringify({ citations: msg.citations, toolCalls: msg.toolCalls })
        : null;
    this.db
      .prepare('INSERT INTO messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.conversationId, msg.role, msg.content, meta, msg.createdAt);
  }

  getPins(conversationId: string): string[] {
    const rows = this.db
      .prepare('SELECT doc_id FROM conversation_pins WHERE conversation_id = ? ORDER BY rowid')
      .all(conversationId) as { doc_id: string }[];
    return rows.map(r => r.doc_id);
  }

  setPins(conversationId: string, docIds: string[]): void {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_pins WHERE conversation_id = ?').run(conversationId);
      const insert = this.db.prepare('INSERT OR IGNORE INTO conversation_pins (conversation_id, doc_id) VALUES (?, ?)');
      for (const docId of docIds) insert.run(conversationId, docId);
    });
    run();
  }

  // ── Projects & line items (ledgers) ───────────────────────────────────────

  listProjects(): ProjectSummary[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[];
    return rows.map(row => {
      const project = rowToProject(row);
      return { ...project, totals: sumTotals(this.getLineItems(project.id)) };
    });
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  getProjectDetail(id: string): ProjectDetail | undefined {
    const project = this.getProject(id);
    if (!project) return undefined;
    const items = this.getLineItems(id);
    return { ...project, items, totals: sumTotals(items) };
  }

  addProject(project: Project): void {
    this.db
      .prepare(`
        INSERT INTO projects (id, name, description, status, is_default, created_at, updated_at)
        VALUES (@id, @name, @description, @status, @isDefault, @createdAt, @updatedAt)
      `)
      .run({ ...project, description: project.description ?? null, isDefault: project.isDefault ? 1 : 0 });
  }

  updateProject(
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'isDefault' | 'updatedAt'>>,
  ): Project | undefined {
    const existing = this.getProject(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    this.db
      .prepare('UPDATE projects SET name = ?, description = ?, status = ?, is_default = ?, updated_at = ? WHERE id = ?')
      .run(merged.name, merged.description ?? null, merged.status, merged.isDefault ? 1 : 0, merged.updatedAt, id);
    return merged;
  }

  removeProject(id: string): boolean {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM line_items WHERE project_id = ?').run(id);
      return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
    });
    return run();
  }

  getLineItems(projectId: string): LineItem[] {
    const rows = this.db
      .prepare('SELECT * FROM line_items WHERE project_id = ? ORDER BY rowid')
      .all(projectId) as LineItemRow[];
    return rows.map(rowToLineItem);
  }

  getLineItem(id: string): LineItem | undefined {
    const row = this.db.prepare('SELECT * FROM line_items WHERE id = ?').get(id) as LineItemRow | undefined;
    return row ? rowToLineItem(row) : undefined;
  }

  addLineItem(item: LineItem): void {
    this.db
      .prepare(`
        INSERT INTO line_items (
          id, project_id, category, vendor, description, quantity, date_paid,
          invoice_number, amount_requested, amount_paid, tax_amount, total_paid,
          status, notes, document_id, created_at, updated_at
        ) VALUES (
          @id, @projectId, @category, @vendor, @description, @quantity, @datePaid,
          @invoiceNumber, @amountRequested, @amountPaid, @taxAmount, @totalPaid,
          @status, @notes, @documentId, @createdAt, @updatedAt
        )
      `)
      .run({
        ...item,
        category: item.category ?? null,
        vendor: item.vendor ?? null,
        quantity: item.quantity ?? null,
        datePaid: item.datePaid ?? null,
        invoiceNumber: item.invoiceNumber ?? null,
        amountRequested: item.amountRequested ?? null,
        amountPaid: item.amountPaid ?? null,
        taxAmount: item.taxAmount ?? null,
        totalPaid: item.totalPaid ?? null,
        status: item.status ?? null,
        notes: item.notes ?? null,
        documentId: item.documentId ?? null,
      });
  }

  // Patches only the fields present in `updates`; `documentId: null` clears the
  // link. projectId and timestamps are caller-controlled.
  updateLineItem(id: string, updates: LineItemInput & { updatedAt: string }): LineItem | undefined {
    const existing = this.getLineItem(id);
    if (!existing) return undefined;
    const has = (k: keyof LineItemInput) => Object.prototype.hasOwnProperty.call(updates, k);
    const merged: LineItem = {
      ...existing,
      ...(has('category') && { category: updates.category }),
      ...(has('vendor') && { vendor: updates.vendor }),
      ...(has('description') && { description: updates.description ?? '' }),
      ...(has('quantity') && { quantity: updates.quantity }),
      ...(has('datePaid') && { datePaid: updates.datePaid }),
      ...(has('invoiceNumber') && { invoiceNumber: updates.invoiceNumber }),
      ...(has('amountRequested') && { amountRequested: updates.amountRequested }),
      ...(has('amountPaid') && { amountPaid: updates.amountPaid }),
      ...(has('taxAmount') && { taxAmount: updates.taxAmount }),
      ...(has('totalPaid') && { totalPaid: updates.totalPaid }),
      ...(has('status') && { status: updates.status }),
      ...(has('notes') && { notes: updates.notes }),
      ...(has('documentId') && { documentId: updates.documentId ?? undefined }),
      updatedAt: updates.updatedAt,
    };
    this.db
      .prepare(`
        UPDATE line_items SET
          category = ?, vendor = ?, description = ?, quantity = ?, date_paid = ?,
          invoice_number = ?, amount_requested = ?, amount_paid = ?, tax_amount = ?,
          total_paid = ?, status = ?, notes = ?, document_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        merged.category ?? null,
        merged.vendor ?? null,
        merged.description,
        merged.quantity ?? null,
        merged.datePaid ?? null,
        merged.invoiceNumber ?? null,
        merged.amountRequested ?? null,
        merged.amountPaid ?? null,
        merged.taxAmount ?? null,
        merged.totalPaid ?? null,
        merged.status ?? null,
        merged.notes ?? null,
        merged.documentId ?? null,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  removeLineItem(id: string): boolean {
    return this.db.prepare('DELETE FROM line_items WHERE id = ?').run(id).changes > 0;
  }

  // The document → ledger direction: every line item referencing this document.
  getDocumentLinks(docId: string): DocumentLink[] {
    const rows = this.db
      .prepare(`
        SELECT li.id AS itemId, li.description AS description, p.id AS projectId, p.name AS projectName
        FROM line_items li
        JOIN projects p ON p.id = li.project_id
        WHERE li.document_id = ?
        ORDER BY p.name, li.rowid
      `)
      .all(docId) as { itemId: string; description: string; projectId: string; projectName: string }[];
    return rows.map(r => ({
      projectId: r.projectId,
      projectName: r.projectName,
      itemId: r.itemId,
      description: r.description,
    }));
  }

  // ── Portfolio (stock holdings) ────────────────────────────────────────────

  listHoldings(): Holding[] {
    const rows = this.db
      .prepare('SELECT * FROM holdings ORDER BY symbol')
      .all() as HoldingRow[];
    return rows.map(rowToHolding);
  }

  getHolding(id: string): Holding | undefined {
    const row = this.db.prepare('SELECT * FROM holdings WHERE id = ?').get(id) as HoldingRow | undefined;
    return row ? rowToHolding(row) : undefined;
  }

  addHolding(holding: Holding): void {
    this.db
      .prepare(`
        INSERT INTO holdings (
          id, symbol, name, shares, buy_price, manual_price, currency, document_id, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        holding.id,
        holding.symbol,
        holding.name ?? null,
        holding.shares,
        holding.buyPrice,
        holding.manualPrice ?? null,
        holding.currency ?? null,
        holding.documentId ?? null,
        holding.notes ?? null,
        holding.createdAt,
        holding.updatedAt,
      );
  }

  // Partial update: only keys present on `updates` are written; `documentId:
  // null` clears the link, mirroring the line-item convention.
  updateHolding(id: string, updates: HoldingInput & { updatedAt: string }): Holding | undefined {
    const existing = this.getHolding(id);
    if (!existing) return undefined;
    const has = (k: keyof HoldingInput) => Object.prototype.hasOwnProperty.call(updates, k);
    const merged: Holding = {
      ...existing,
      symbol: has('symbol') ? updates.symbol ?? existing.symbol : existing.symbol,
      name: has('name') ? updates.name : existing.name,
      shares: has('shares') ? updates.shares ?? existing.shares : existing.shares,
      buyPrice: has('buyPrice') ? updates.buyPrice ?? existing.buyPrice : existing.buyPrice,
      manualPrice: has('manualPrice') ? updates.manualPrice : existing.manualPrice,
      currency: has('currency') ? updates.currency : existing.currency,
      documentId: has('documentId') ? updates.documentId ?? undefined : existing.documentId,
      notes: has('notes') ? updates.notes : existing.notes,
      updatedAt: updates.updatedAt,
    };
    this.db
      .prepare(`
        UPDATE holdings SET
          symbol = ?, name = ?, shares = ?, buy_price = ?, manual_price = ?,
          currency = ?, document_id = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        merged.symbol,
        merged.name ?? null,
        merged.shares,
        merged.buyPrice,
        merged.manualPrice ?? null,
        merged.currency ?? null,
        merged.documentId ?? null,
        merged.notes ?? null,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  removeHolding(id: string): boolean {
    const run = this.db.transaction(() => {
      const deleted = this.db.prepare('DELETE FROM holdings WHERE id = ?').run(id).changes > 0;
      if (deleted) this.db.prepare('DELETE FROM holding_lots WHERE holding_id = ?').run(id);
      return deleted;
    });
    return run();
  }

  // ── Portfolio lots (dated buy/sell transactions) ──────────────────────────

  listLots(holdingId: string): HoldingLot[] {
    const rows = this.db
      .prepare('SELECT * FROM holding_lots WHERE holding_id = ? ORDER BY trade_date, created_at')
      .all(holdingId) as HoldingLotRow[];
    return rows.map(rowToLot);
  }

  // Every lot, grouped by holding id — for the snapshot / performance builders
  // so they issue one query instead of one per holding.
  listAllLots(): Map<string, HoldingLot[]> {
    const rows = this.db
      .prepare('SELECT * FROM holding_lots ORDER BY trade_date, created_at')
      .all() as HoldingLotRow[];
    const byHolding = new Map<string, HoldingLot[]>();
    for (const row of rows) {
      const lot = rowToLot(row);
      const list = byHolding.get(lot.holdingId);
      if (list) list.push(lot);
      else byHolding.set(lot.holdingId, [lot]);
    }
    return byHolding;
  }

  getLot(id: string): HoldingLot | undefined {
    const row = this.db.prepare('SELECT * FROM holding_lots WHERE id = ?').get(id) as HoldingLotRow | undefined;
    return row ? rowToLot(row) : undefined;
  }

  addLot(lot: HoldingLot): void {
    this.db
      .prepare(`
        INSERT INTO holding_lots (id, holding_id, type, trade_date, shares, price, fee, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        lot.id,
        lot.holdingId,
        lot.type,
        lot.date,
        lot.shares,
        lot.price,
        lot.fee ?? null,
        lot.notes ?? null,
        lot.createdAt,
      );
  }

  updateLot(id: string, updates: HoldingLotInput): HoldingLot | undefined {
    const existing = this.getLot(id);
    if (!existing) return undefined;
    const has = (k: keyof HoldingLotInput) => Object.prototype.hasOwnProperty.call(updates, k);
    const merged: HoldingLot = {
      ...existing,
      type: has('type') ? updates.type ?? existing.type : existing.type,
      date: has('date') ? updates.date ?? existing.date : existing.date,
      shares: has('shares') ? updates.shares ?? existing.shares : existing.shares,
      price: has('price') ? updates.price ?? existing.price : existing.price,
      fee: has('fee') ? updates.fee : existing.fee,
      notes: has('notes') ? updates.notes : existing.notes,
    };
    this.db
      .prepare(`
        UPDATE holding_lots SET type = ?, trade_date = ?, shares = ?, price = ?, fee = ?, notes = ?
        WHERE id = ?
      `)
      .run(merged.type, merged.date, merged.shares, merged.price, merged.fee ?? null, merged.notes ?? null, id);
    return merged;
  }

  removeLot(id: string): boolean {
    return this.db.prepare('DELETE FROM holding_lots WHERE id = ?').run(id).changes > 0;
  }

  // ── Watchlist ─────────────────────────────────────────────────────────────

  listWatchlist(): WatchlistItem[] {
    const rows = this.db.prepare('SELECT * FROM watchlist ORDER BY symbol').all() as WatchlistRow[];
    return rows.map(rowToWatchlistItem);
  }

  getWatchlistItem(id: string): WatchlistItem | undefined {
    const row = this.db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id) as WatchlistRow | undefined;
    return row ? rowToWatchlistItem(row) : undefined;
  }

  findWatchlistBySymbol(symbol: string): WatchlistItem | undefined {
    const row = this.db
      .prepare('SELECT * FROM watchlist WHERE UPPER(symbol) = ? LIMIT 1')
      .get(symbol.toUpperCase()) as WatchlistRow | undefined;
    return row ? rowToWatchlistItem(row) : undefined;
  }

  addWatchlistItem(item: WatchlistItem): void {
    this.db
      .prepare('INSERT INTO watchlist (id, symbol, name, notes, folder, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.symbol, item.name ?? null, item.notes ?? null, item.folder ?? null, item.createdAt);
  }

  // Partial update of the editable watchlist fields (name / thesis notes /
  // folder). Explicit empty strings clear a field.
  updateWatchlistItem(id: string, input: { name?: string; notes?: string; folder?: string }): WatchlistItem | undefined {
    const existing = this.getWatchlistItem(id);
    if (!existing) return undefined;
    const next: WatchlistItem = {
      ...existing,
      name: input.name !== undefined ? input.name || undefined : existing.name,
      notes: input.notes !== undefined ? input.notes || undefined : existing.notes,
      folder: input.folder !== undefined ? input.folder || undefined : existing.folder,
    };
    this.db
      .prepare('UPDATE watchlist SET name = ?, notes = ?, folder = ? WHERE id = ?')
      .run(next.name ?? null, next.notes ?? null, next.folder ?? null, id);
    return next;
  }

  removeWatchlistItem(id: string): boolean {
    return this.db.prepare('DELETE FROM watchlist WHERE id = ?').run(id).changes > 0;
  }

  // ── Job applications: stages ──────────────────────────────────────────────

  listApplicationStages(): ApplicationStage[] {
    const rows = this.db
      .prepare('SELECT * FROM application_stages ORDER BY position, rowid')
      .all() as ApplicationStageRow[];
    return rows.map(rowToApplicationStage);
  }

  getApplicationStage(id: string): ApplicationStage | undefined {
    const row = this.db.prepare('SELECT * FROM application_stages WHERE id = ?').get(id) as
      | ApplicationStageRow
      | undefined;
    return row ? rowToApplicationStage(row) : undefined;
  }

  addApplicationStage(stage: ApplicationStage): void {
    this.db
      .prepare('INSERT INTO application_stages (id, name, position, color, kind, is_terminal) VALUES (?, ?, ?, ?, ?, ?)')
      .run(stage.id, stage.name, stage.position, stage.color, stage.kind, stage.isTerminal ? 1 : 0);
  }

  updateApplicationStage(id: string, updates: ApplicationStageInput): ApplicationStage | undefined {
    const existing = this.getApplicationStage(id);
    if (!existing) return undefined;
    const has = (k: keyof ApplicationStageInput) => Object.prototype.hasOwnProperty.call(updates, k);
    const merged: ApplicationStage = {
      ...existing,
      name: has('name') ? updates.name ?? existing.name : existing.name,
      color: has('color') ? updates.color ?? existing.color : existing.color,
      kind: has('kind') ? updates.kind ?? existing.kind : existing.kind,
      isTerminal: has('isTerminal') ? updates.isTerminal ?? existing.isTerminal : existing.isTerminal,
    };
    this.db
      .prepare('UPDATE application_stages SET name = ?, color = ?, kind = ?, is_terminal = ? WHERE id = ?')
      .run(merged.name, merged.color, merged.kind, merged.isTerminal ? 1 : 0, id);
    return merged;
  }

  // Persists a manual pipeline order by stamping 1-based positions onto the
  // given ids in array order (the reorderCategories pattern).
  reorderApplicationStages(orderedIds: string[]): void {
    const stmt = this.db.prepare('UPDATE application_stages SET position = ? WHERE id = ?');
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i + 1, id));
    });
    tx(orderedIds);
  }

  removeApplicationStage(id: string): boolean {
    return this.db.prepare('DELETE FROM application_stages WHERE id = ?').run(id).changes > 0;
  }

  countApplicationsInStage(stageId: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM job_applications WHERE stage_id = ?').get(stageId) as { n: number }
    ).n;
  }

  // ── Job applications ──────────────────────────────────────────────────────

  listJobApplications(): JobApplication[] {
    const rows = this.db
      .prepare('SELECT * FROM job_applications ORDER BY created_at DESC')
      .all() as JobApplicationRow[];
    return rows.map(rowToJobApplication);
  }

  getJobApplication(id: string): JobApplication | undefined {
    const row = this.db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id) as
      | JobApplicationRow
      | undefined;
    return row ? rowToJobApplication(row) : undefined;
  }

  addJobApplication(app: JobApplication): void {
    this.db
      .prepare(`
        INSERT INTO job_applications (
          id, company, role, url, location, work_mode, description, source, compensation,
          stage_id, applied_date, document_id, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        app.id,
        app.company,
        app.role,
        app.url ?? null,
        app.location ?? null,
        app.workMode ?? null,
        app.description ?? null,
        app.source ?? null,
        app.compensation ?? null,
        app.stageId,
        app.appliedDate ?? null,
        app.documentId ?? null,
        app.notes ?? null,
        app.createdAt,
        app.updatedAt,
      );
  }

  // Partial update of the editable fields. The stage is deliberately NOT
  // settable here — stage changes go through the events methods so the status
  // history stays truthful. `documentId: null` clears the link.
  updateJobApplication(
    id: string,
    updates: Omit<JobApplicationInput, 'stageId'> & { updatedAt: string },
  ): JobApplication | undefined {
    const existing = this.getJobApplication(id);
    if (!existing) return undefined;
    const has = (k: keyof JobApplicationInput) => Object.prototype.hasOwnProperty.call(updates, k);
    const merged: JobApplication = {
      ...existing,
      company: has('company') ? updates.company ?? existing.company : existing.company,
      role: has('role') ? updates.role ?? existing.role : existing.role,
      url: has('url') ? updates.url : existing.url,
      location: has('location') ? updates.location : existing.location,
      workMode: has('workMode') ? updates.workMode ?? undefined : existing.workMode,
      description: has('description') ? updates.description : existing.description,
      source: has('source') ? updates.source : existing.source,
      compensation: has('compensation') ? updates.compensation : existing.compensation,
      appliedDate: has('appliedDate') ? updates.appliedDate : existing.appliedDate,
      documentId: has('documentId') ? updates.documentId ?? undefined : existing.documentId,
      notes: has('notes') ? updates.notes : existing.notes,
      updatedAt: updates.updatedAt,
    };
    this.db
      .prepare(`
        UPDATE job_applications SET
          company = ?, role = ?, url = ?, location = ?, work_mode = ?, description = ?,
          source = ?, compensation = ?, applied_date = ?, document_id = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        merged.company,
        merged.role,
        merged.url ?? null,
        merged.location ?? null,
        merged.workMode ?? null,
        merged.description ?? null,
        merged.source ?? null,
        merged.compensation ?? null,
        merged.appliedDate ?? null,
        merged.documentId ?? null,
        merged.notes ?? null,
        merged.updatedAt,
        id,
      );
    return merged;
  }

  // Moves an application to a stage (the denormalized head of its history);
  // callers append the matching event in the same breath.
  setJobApplicationStage(id: string, stageId: string, updatedAt: string): void {
    this.db.prepare('UPDATE job_applications SET stage_id = ?, updated_at = ? WHERE id = ?').run(stageId, updatedAt, id);
  }

  removeJobApplication(id: string): boolean {
    const run = this.db.transaction(() => {
      const deleted = this.db.prepare('DELETE FROM job_applications WHERE id = ?').run(id).changes > 0;
      if (deleted) {
        this.db.prepare('DELETE FROM application_events WHERE application_id = ?').run(id);
        this.db.prepare('DELETE FROM application_contacts WHERE application_id = ?').run(id);
      }
      return deleted;
    });
    return run();
  }

  // ── Job applications: status events ───────────────────────────────────────

  // Newest first, matching ApplicationDetail.events.
  listApplicationEvents(applicationId: string): ApplicationEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY occurred_at DESC, rowid DESC')
      .all(applicationId) as ApplicationEventRow[];
    return rows.map(rowToApplicationEvent);
  }

  // Every event, grouped by application id (newest first) — one query for the
  // snapshot/stats builder instead of one per application (the listAllLots
  // pattern).
  listAllApplicationEvents(): Map<string, ApplicationEvent[]> {
    const rows = this.db
      .prepare('SELECT * FROM application_events ORDER BY occurred_at DESC, rowid DESC')
      .all() as ApplicationEventRow[];
    const byApplication = new Map<string, ApplicationEvent[]>();
    for (const row of rows) {
      const event = rowToApplicationEvent(row);
      const list = byApplication.get(event.applicationId);
      if (list) list.push(event);
      else byApplication.set(event.applicationId, [event]);
    }
    return byApplication;
  }

  getApplicationEvent(id: string): ApplicationEvent | undefined {
    const row = this.db.prepare('SELECT * FROM application_events WHERE id = ?').get(id) as
      | ApplicationEventRow
      | undefined;
    return row ? rowToApplicationEvent(row) : undefined;
  }

  addApplicationEvent(event: ApplicationEvent): void {
    this.db
      .prepare('INSERT INTO application_events (id, application_id, stage_id, stage_name, occurred_at, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.id, event.applicationId, event.stageId ?? null, event.stageName, event.occurredAt, event.note ?? null);
  }

  updateApplicationEvent(id: string, input: { occurredAt?: string; note?: string }): ApplicationEvent | undefined {
    const existing = this.getApplicationEvent(id);
    if (!existing) return undefined;
    const merged: ApplicationEvent = {
      ...existing,
      occurredAt: input.occurredAt ?? existing.occurredAt,
      note: input.note !== undefined ? input.note || undefined : existing.note,
    };
    this.db
      .prepare('UPDATE application_events SET occurred_at = ?, note = ? WHERE id = ?')
      .run(merged.occurredAt, merged.note ?? null, id);
    return merged;
  }

  removeApplicationEvent(id: string): boolean {
    return this.db.prepare('DELETE FROM application_events WHERE id = ?').run(id).changes > 0;
  }

  // ── Job applications: contacts ────────────────────────────────────────────

  listApplicationContacts(applicationId: string): ApplicationContact[] {
    const rows = this.db
      .prepare('SELECT * FROM application_contacts WHERE application_id = ? ORDER BY created_at, rowid')
      .all(applicationId) as ApplicationContactRow[];
    return rows.map(rowToApplicationContact);
  }

  // Contact counts per application, one query (for the snapshot's rows).
  applicationContactCounts(): Map<string, number> {
    const rows = this.db
      .prepare('SELECT application_id, COUNT(*) AS n FROM application_contacts GROUP BY application_id')
      .all() as { application_id: string; n: number }[];
    return new Map(rows.map(r => [r.application_id, r.n]));
  }

  getApplicationContact(id: string): ApplicationContact | undefined {
    const row = this.db.prepare('SELECT * FROM application_contacts WHERE id = ?').get(id) as
      | ApplicationContactRow
      | undefined;
    return row ? rowToApplicationContact(row) : undefined;
  }

  addApplicationContact(contact: ApplicationContact): void {
    this.db
      .prepare('INSERT INTO application_contacts (id, application_id, name, title, email, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        contact.id,
        contact.applicationId,
        contact.name,
        contact.title ?? null,
        contact.email ?? null,
        contact.url ?? null,
        contact.notes ?? null,
        contact.createdAt,
      );
  }

  updateApplicationContact(id: string, input: ApplicationContactInput): ApplicationContact | undefined {
    const existing = this.getApplicationContact(id);
    if (!existing) return undefined;
    const has = (k: keyof ApplicationContactInput) => Object.prototype.hasOwnProperty.call(input, k);
    const merged: ApplicationContact = {
      ...existing,
      name: has('name') ? input.name ?? existing.name : existing.name,
      title: has('title') ? input.title : existing.title,
      email: has('email') ? input.email : existing.email,
      url: has('url') ? input.url : existing.url,
      notes: has('notes') ? input.notes : existing.notes,
    };
    this.db
      .prepare('UPDATE application_contacts SET name = ?, title = ?, email = ?, url = ?, notes = ? WHERE id = ?')
      .run(merged.name, merged.title ?? null, merged.email ?? null, merged.url ?? null, merged.notes ?? null, id);
    return merged;
  }

  removeApplicationContact(id: string): boolean {
    return this.db.prepare('DELETE FROM application_contacts WHERE id = ?').run(id).changes > 0;
  }
}
