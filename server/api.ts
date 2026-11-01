/** HTTP handler for /api, shared by the dev server and the standalone app. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SourceHub } from './sources.ts';

const MAX_BODY_BYTES = 64 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) fail(new Error('Слишком большой запрос'));
      else chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

/** `path` is the request path without the /api prefix. */
export async function handleApi(hub: SourceHub, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(path, 'http://local');
  const sourceMatch = /^\/source\/([\w:.%-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1]);
    if (!hub.has(id)) return sendJson(res, 404, { error: `Неизвестный источник ${id}` });
    return sendJson(res, 200, await hub.get(id, { refresh: url.searchParams.get('refresh') === '1' }));
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    await readBody(req);
    return sendJson(res, 200, { sources: await hub.refreshAll() });
  }
  if (req.method === 'GET' && url.pathname === '/status') return sendJson(res, 200, { sources: await hub.status() });
  sendJson(res, 404, { error: 'Нет такого API' });
}
