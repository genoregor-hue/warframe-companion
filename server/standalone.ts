/**
 * Entry point of the standalone app (and of WarframeCompanion.exe): serves the
 * built client and the /api data layer from one process, then opens the browser.
 */
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { handleApi, sendJson } from './api';
import { createAppHub } from './app';
import type { SourceDef } from './sources';
import { appDataDir, assetKey, contentType } from './static';

const HOST = '127.0.0.1';
const FIRST_PORT = 5178;
const PORT_ATTEMPTS = 20;
const API_PREFIX = '/api';

/** Module data sources are collected at build time from src/modules/<id>/server.ts. */
const moduleFiles = import.meta.glob<{ sources?: SourceDef[] }>('../src/modules/*/server.ts', { eager: true });
const moduleSources = Object.values(moduleFiles).flatMap((m) => m.sources ?? []);

const dataDir = appDataDir(process.env, process.platform, homedir());
const hub = createAppHub(moduleSources, join(dataDir, 'cache'));
const clientDir = join(process.cwd(), 'dist');

function readAsset(key: string): Buffer | undefined {
  try {
    if (isSea()) return Buffer.from(getAsset(key));
  } catch {
    return undefined;
  }
  const file = join(clientDir, key);
  return existsSync(file) ? readFileSync(file) : undefined;
}

function serveClient(req: IncomingMessage, res: ServerResponse): void {
  const key = assetKey(req.url ?? '/');
  const body = key ? readAsset(key) : undefined;
  if (!key || !body) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentType(key));
  res.setHeader('cache-control', key === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  res.end(body);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)) {
    handleApi(hub, url.slice(API_PREFIX.length) || '/', req, res).catch((error: Error) => {
      console.error('[api]', error.message);
      sendJson(res, 502, { error: error.message });
    });
    return;
  }
  serveClient(req, res);
});

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`Откройте в браузере: ${url}`);
  });
}

function announce(port: number): void {
  const url = `http://${HOST}:${port}`;
  console.log(`Warframe Companion запущен: ${url}`);
  console.log(`Данные хранятся в ${dataDir}`);
  console.log('Не закрывайте это окно, пока пользуетесь приложением.');
  // WFC_NO_BROWSER=1 starts the server without opening a browser tab (scripts, checks).
  if (!process.env.WFC_NO_BROWSER) openBrowser(url);
}

/** Tries ports one by one; each attempt has its own handlers so only the winner is announced. */
function listen(port: number, attemptsLeft: number): void {
  const onListening = () => {
    server.off('error', onError);
    announce(port);
  };
  const onError = (error: NodeJS.ErrnoException) => {
    server.off('listening', onListening);
    if (error.code === 'EADDRINUSE' && attemptsLeft > 1) return listen(port + 1, attemptsLeft - 1);
    console.error(`Не удалось запустить сервер: ${error.message}`);
    process.exitCode = 1;
  };
  server.once('listening', onListening);
  server.once('error', onError);
  server.listen(port, HOST);
}

listen(FIRST_PORT, PORT_ATTEMPTS);
