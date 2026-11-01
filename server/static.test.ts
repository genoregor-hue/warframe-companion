import { describe, expect, it } from 'vitest';
import { appDataDir, assetKey, contentType } from './static';

describe('assetKey', () => {
  it('maps the root and unknown routes to index.html', () => {
    expect(assetKey('/')).toBe('index.html');
    expect(assetKey('/builds')).toBe('index.html');
  });

  it('keeps asset paths and drops the query string', () => {
    expect(assetKey('/assets/index-abc.js?v=1')).toBe('assets/index-abc.js');
  });

  it('decodes percent-encoding', () => {
    expect(assetKey('/assets/a%20b.css')).toBe('assets/a b.css');
  });

  it('rejects path traversal and backslashes', () => {
    expect(assetKey('/../secret.txt')).toBeNull();
    expect(assetKey('/assets/%2e%2e/%2e%2e/x.js')).toBeNull();
    expect(assetKey(String.raw`/assets\..\x.js`)).toBeNull();
  });

  it('rejects malformed encoding', () => {
    expect(assetKey('/%E0%A4%A')).toBeNull();
  });
});

describe('contentType', () => {
  it('knows the web types the app ships', () => {
    expect(contentType('index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('assets/x.js')).toBe('text/javascript; charset=utf-8');
    expect(contentType('assets/x.css')).toBe('text/css; charset=utf-8');
    expect(contentType('assets/x.wasm')).toBe('application/wasm');
  });

  it('falls back to binary', () => {
    expect(contentType('blob.bin')).toBe('application/octet-stream');
  });
});

describe('appDataDir', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    expect(appDataDir({ LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local` }, 'win32', String.raw`C:\Users\u`)).toMatch(/AppData[\\/]Local[\\/]WarframeCompanion$/);
  });

  it('uses a dot folder in home elsewhere', () => {
    expect(appDataDir({}, 'linux', '/home/u')).toMatch(/[\\/]home[\\/]u[\\/]\.warframe-companion$/);
  });

  it('falls back to home on Windows without LOCALAPPDATA', () => {
    expect(appDataDir({}, 'win32', String.raw`C:\Users\u`)).toMatch(/WarframeCompanion$/);
  });
});
