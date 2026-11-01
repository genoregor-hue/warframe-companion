/** Serving the built client: safe asset paths, content types, per-user data folder. */
import { posix, win32 } from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const BACKSLASH = String.fromCharCode(92);
const INDEX = 'index.html';

export function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

/**
 * Turns a request path into a key of the built client. Routes without a file
 * extension fall back to index.html; anything leaving the build folder is null.
 */
export function assetKey(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes(BACKSLASH) || decoded.includes('\0')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s === '.')) return null;
  const key = segments.join('/');
  if (key === '' || !segments[segments.length - 1].includes('.')) return INDEX;
  return key;
}

/** Where the app keeps its cache, so the .exe can live in any folder. */
export function appDataDir(env: Readonly<Record<string, string | undefined>>, platform: string, home: string): string {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'WarframeCompanion');
  return posix.join(home, '.warframe-companion');
}
