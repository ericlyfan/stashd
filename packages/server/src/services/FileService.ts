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
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
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
