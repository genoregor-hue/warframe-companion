// LZMA-JS ships its decoder as a plain script that assigns to `this`, and its
// index.js loads it by a runtime path that bundlers cannot follow. Embedding the
// script text keeps the decoder inside the standalone build.
import lzmaSource from 'lzma/src/lzma_worker.js?raw';
import { fetchBytes, fetchText, parseJsonLenient } from './http';

const ORIGIN = 'https://content.warframe.com/PublicExport';
const LZMA_HEADER_PROPS = 5;
const LZMA_SIZE_BYTES = 8;

interface LzmaDecoder {
  decompress(data: Uint8Array | number[]): string | number[];
}

function loadLzma(): LzmaDecoder {
  const scope: { LZMA_WORKER?: LzmaDecoder } = {};
  new Function(lzmaSource).call(scope);
  if (!scope.LZMA_WORKER) throw new Error('Не удалось загрузить LZMA-декодер');
  return scope.LZMA_WORKER;
}

const lzma = loadLzma();

export type ExportLang = 'en' | 'ru';

/**
 * The index is LZMA "alone" format; its declared size is sometimes wrong,
 * so it is replaced with "unknown" (all 0xFF) before decoding.
 */
export function decodeLzma(bytes: Uint8Array): string {
  const patched = Uint8Array.from(bytes);
  patched.fill(0xff, LZMA_HEADER_PROPS, LZMA_HEADER_PROPS + LZMA_SIZE_BYTES);
  const result: unknown = lzma.decompress(patched);
  if (typeof result === 'string') return result;
  return new TextDecoder().decode(Uint8Array.from(result as number[]));
}

/** Maps "ExportWeapons_ru.json" to its hashed manifest entry. */
export function parseIndex(text: string): ReadonlyMap<string, string> {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('!'))
    .map((line) => [line.slice(0, line.indexOf('!')), line] as const);
  return new Map(entries);
}

export function createPublicExportClient() {
  const indexes = new Map<ExportLang, Promise<ReadonlyMap<string, string>>>();

  function loadIndex(lang: ExportLang): Promise<ReadonlyMap<string, string>> {
    const cached = indexes.get(lang);
    if (cached) return cached;
    const pending = fetchBytes(`${ORIGIN}/index_${lang}.txt.lzma`).then((bytes) => parseIndex(decodeLzma(bytes)));
    pending.catch(() => indexes.delete(lang));
    indexes.set(lang, pending);
    return pending;
  }

  async function fetchExport<T>(name: string, lang: ExportLang): Promise<T> {
    return fetchExportFile<T>(`${name}_${lang}.json`, lang);
  }

  /** Files without a language suffix, e.g. ExportManifest.json (listed in every index). */
  async function fetchExportFile<T>(fileName: string, lang: ExportLang = 'en'): Promise<T> {
    const index = await loadIndex(lang);
    const entry = index.get(fileName);
    if (!entry) throw new Error(`В индексе Public Export нет файла ${fileName}`);
    const url = `${ORIGIN}/Manifest/${entry}`;
    return parseJsonLenient<T>(await fetchText(url), url);
  }

  /** Forget cached indexes so the next fetch picks up new manifest hashes. */
  function reset(): void {
    indexes.clear();
  }

  return { fetchExport, fetchExportFile, reset };
}

export type PublicExportClient = ReturnType<typeof createPublicExportClient>;
