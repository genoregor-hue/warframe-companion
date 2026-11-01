import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lzma from 'lzma';
import { afterAll, describe, expect, it } from 'vitest';
import { createDiskCache } from './cache';
import { parseJsonLenient } from './http';
import { decodeLzma, parseIndex } from './publicExport';

const INDEX = 'ExportWeapons_ru.json!00_abc\r\nExportManifest.json!00_def\r\n';

describe('decodeLzma', () => {
  it('decodes an LZMA-alone payload even with a wrong size header', () => {
    const packed = Uint8Array.from((lzma as unknown as { compress(s: string, mode: number): number[] }).compress(INDEX, 1).map((b) => b & 0xff));
    packed.fill(0x01, 5, 13);
    expect(decodeLzma(packed)).toBe(INDEX);
  });
});

describe('parseIndex', () => {
  it('maps export file names to hashed manifest entries', () => {
    expect(parseIndex(INDEX)).toEqual(new Map([['ExportWeapons_ru.json', 'ExportWeapons_ru.json!00_abc'], ['ExportManifest.json', 'ExportManifest.json!00_def']]));
  });

  it('skips blank and malformed lines', () => {
    expect(parseIndex('\n\nnot-an-entry\n').size).toBe(0);
  });
});

describe('parseJsonLenient', () => {
  it('parses normal JSON', () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
  });

  it('tolerates raw control characters inside strings', () => {
    expect(parseJsonLenient('{"a":"line1\nline2"}')).toEqual({ a: 'line1 line2' });
  });

  it('reports where broken JSON came from', () => {
    expect(() => parseJsonLenient('{nope', 'https://example')).toThrow(/https:\/\/example/);
  });
});

describe('createDiskCache', () => {
  const dirs: string[] = [];
  afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

  it('writes and reads values with a timestamp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wfc-cache-'));
    dirs.push(dir);
    const cache = createDiskCache(dir);
    const now = new Date('2026-10-30T12:00:00Z');
    await cache.write('export:ExportWeapons:ru', { ok: true }, now);
    expect(await cache.read('export:ExportWeapons:ru')).toEqual({ id: 'export:ExportWeapons:ru', fetchedAt: now.toISOString(), data: { ok: true } });
  });

  it('returns undefined for missing entries and rejects unsafe ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wfc-cache-'));
    dirs.push(dir);
    const cache = createDiskCache(dir);
    expect(await cache.read('missing')).toBeUndefined();
    await expect(cache.write('../escape', 1)).rejects.toThrow(/id/);
  });
});
