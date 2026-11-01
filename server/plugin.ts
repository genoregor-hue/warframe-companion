import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { handleApi, sendJson } from './api.ts';
import type { SourceDef, SourceHub } from './sources.ts';

const MODULES_DIR = 'src/modules';

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

/** Server code is loaded through Vite (not bundled into the config) so it can import src/ TypeScript. */
async function createHub(server: ViteDevServer): Promise<SourceHub> {
  const root = server.config.root;
  const { createAppHub } = (await server.ssrLoadModule('/server/app.ts')) as typeof import('./app.ts');
  return createAppHub(await loadModuleSources(server, root), resolve(root, 'data/cache'));
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
          .then((ready) => handleApi(ready, req.url ?? '/', req, res))
          .catch((error: Error) => {
            console.error('[api]', error.message);
            sendJson(res, 502, { error: error.message });
          });
      });
    },
  };
}
