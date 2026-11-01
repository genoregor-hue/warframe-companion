import { existsSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { SourceDef, SourceHub } from './sources.ts';

const MODULES_DIR = 'src/modules';
const MAX_BODY_BYTES = 64 * 1024;

/** Loads `sources` exported by src/modules/<id>/server.ts, if present. */
async function loadModuleSources(server: ViteDevServer, root: string): Promise<SourceDef[]> {
  const dir = join(root, MODULES_DIR);
  if (!existsSync(dir)) return [];
  const folders = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const loaded = await Promise.all(
    folders
      .filter((folder) => existsSync(join(dir, folder.name, 'server.ts')))
      .map(async (folder) => {
        try {
          const mod = await server.ssrLoadModule(`/${MODULES_DIR}/${folder.name}/server.ts`);
          return Array.isArray(mod.sources) ? (mod.sources as SourceDef[]) : [];
        } catch (error) {
          console.error(`[api] не удалось загрузить ${folder.name}/server.ts:`, (error as Error).message);
          return [];
        }
      }),
  );
  return loaded.flat();
}

type CoreModules = [
  typeof import('./coreSources.ts'),
  typeof import('./sources.ts'),
  typeof import('./cache.ts'),
  typeof import('./publicExport.ts'),
];

/** Server code is loaded through Vite (not bundled into the config) so it can import src/ TypeScript. */
async function createHub(server: ViteDevServer): Promise<SourceHub> {
  const root = server.config.root;
  const files = ['/server/coreSources.ts', '/server/sources.ts', '/server/cache.ts', '/server/publicExport.ts'];
  const [{ createCoreSources }, { createSourceHub }, { createDiskCache }, { createPublicExportClient }] = (await Promise.all(
    files.map((file) => server.ssrLoadModule(file)),
  )) as unknown as CoreModules;
  const client = createPublicExportClient();
  const defs = [...createCoreSources(client), ...(await loadModuleSources(server, root))];
  return createSourceHub(defs, { cache: createDiskCache(resolve(root, 'data/cache')), onRefreshStart: client.reset });
}

function send(res: ServerResponse, status: number, body: unknown): void {
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

async function handle(hub: SourceHub, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const sourceMatch = /^\/source\/([\w:.%-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1]);
    if (!hub.has(id)) return send(res, 404, { error: `Неизвестный источник ${id}` });
    return send(res, 200, await hub.get(id, { refresh: url.searchParams.get('refresh') === '1' }));
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    await readBody(req);
    return send(res, 200, { sources: await hub.refreshAll() });
  }
  if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, { sources: await hub.status() });
  send(res, 404, { error: 'Нет такого API' });
}

export function companionApi(): Plugin {
  return {
    name: 'warframe-companion-api',
    configureServer(server) {
      let hub: Promise<SourceHub> | undefined;
      // Server code and data builders are loaded once; rebuild the hub when they change.
      server.watcher.on('all', (event, file) => {
        if (!['add', 'change', 'unlink'].includes(event)) return;
        if (/[\\/](server|src[\\/]data|src[\\/]modules[\\/][^\\/]+[\\/](server\.ts|logic))/.test(file)) hub = undefined;
      });
      server.middlewares.use('/api', (req, res) => {
        hub ??= createHub(server);
        hub
          .then((ready) => handle(ready, req, res))
          .catch((error: Error) => {
            console.error('[api]', error.message);
            send(res, 502, { error: error.message });
          });
      });
    },
  };
}
