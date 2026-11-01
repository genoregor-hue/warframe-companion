import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CachedValue<T = unknown> {
  readonly id: string;
  readonly fetchedAt: string;
  readonly data: T;
}

const SAFE_ID = /^[\w:.-]+$/;

function fileFor(dir: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Недопустимый id кеша: ${id}`);
  return join(dir, `${id.replace(/:/g, '__')}.json`);
}

export function createDiskCache(dir: string) {
  async function read<T>(id: string): Promise<CachedValue<T> | undefined> {
    try {
      const text = await readFile(fileFor(dir, id), 'utf8');
      return JSON.parse(text) as CachedValue<T>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      console.warn(`[cache] не удалось прочитать ${id}:`, (error as Error).message);
      return undefined;
    }
  }

  async function write<T>(id: string, data: T, now = new Date()): Promise<CachedValue<T>> {
    const value: CachedValue<T> = { id, fetchedAt: now.toISOString(), data };
    const target = fileFor(dir, id);
    const temp = `${target}.tmp`;
    await mkdir(dir, { recursive: true });
    await writeFile(temp, JSON.stringify(value), 'utf8');
    await rename(temp, target);
    return value;
  }

  return { read, write };
}

export type DiskCache = ReturnType<typeof createDiskCache>;
