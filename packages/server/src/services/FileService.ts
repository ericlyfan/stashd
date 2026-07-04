import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'path';

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
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  // Sidecar holding text extracted at classify time, so it survives a server
  // restart until the job is filed. Lives beside (not inside) the job dir so
  // getTempFilePath never mistakes it for the uploaded document.
  private jobTextPath(jobId: string): string {
    return join(this.dataDir, 'temp', `${jobId}.extracted.txt`);
  }

  async saveJobText(jobId: string, text: string): Promise<void> {
    await writeFile(this.jobTextPath(jobId), text, 'utf-8');
  }

  async readJobText(jobId: string): Promise<string | undefined> {
    try {
      return await readFile(this.jobTextPath(jobId), 'utf-8');
    } catch {
      return undefined;
    }
  }

  async deleteJobText(jobId: string): Promise<void> {
    await unlink(this.jobTextPath(jobId)).catch(() => {});
  }

  // Discard an in-flight upload: the temp dir and any extracted-text sidecar.
  // Tolerant of both already being gone. The recursive delete is the most
  // dangerous filesystem call in the app, so beyond the route-level jobId
  // validation, refuse any target that doesn't resolve strictly inside temp/.
  async removeTempDir(jobId: string): Promise<void> {
    const tempRoot = resolve(this.dataDir, 'temp');
    const target = resolve(this.tempDir(jobId));
    if (!target.startsWith(tempRoot + sep) || target === tempRoot) {
      throw new Error(`Refusing to delete outside temp dir: ${jobId}`);
    }
    await rm(target, { recursive: true, force: true });
    await this.deleteJobText(jobId);
  }

  async moveToDocuments(
    jobId: string,
    categorySlug: string,
    docId: string,
    originalName: string,
  ): Promise<string> {
    const storagePath = this.documentStoragePath(categorySlug, docId, originalName);
    await this.moveJobFileToStorage(jobId, storagePath);
    return storagePath;
  }

  documentStoragePath(categorySlug: string, docId: string, originalName: string): string {
    return join('documents', categorySlug, `${docId}${extname(originalName)}`);
  }

  async moveJobFileToStorage(jobId: string, storagePath: string): Promise<void> {
    const tempPath = await this.getTempFilePath(jobId);
    if (!tempPath) throw new Error(`No temp file for jobId: ${jobId}`);

    const dest = this.absolutePath(storagePath);
    const documentsRoot = resolve(this.dataDir, 'documents');
    const target = resolve(dest);
    if (!target.startsWith(documentsRoot + sep)) {
      throw new Error(`Refusing to move outside documents dir: ${storagePath}`);
    }

    const destDir = dirname(dest);
    await mkdir(destDir, { recursive: true });

    await rename(tempPath, dest);
    await rmdir(this.tempDir(jobId)).catch(() => {});
  }

  async deleteDocument(storagePath: string): Promise<void> {
    await unlink(join(this.dataDir, storagePath));
  }

  async documentExists(storagePath: string): Promise<boolean> {
    try {
      await stat(this.absolutePath(storagePath));
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async listDocumentFiles(): Promise<string[]> {
    const root = join(this.dataDir, 'documents');
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          out.push(join('documents', relative(root, full)));
        }
      }
    };
    await walk(root);
    return out;
  }

  async getFileSize(absolutePath: string): Promise<number> {
    const s = await stat(absolutePath);
    return s.size;
  }

  absolutePath(storagePath: string): string {
    return join(this.dataDir, storagePath);
  }
}
