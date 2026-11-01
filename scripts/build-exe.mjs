/**
 * Builds release/WarframeCompanion.exe: a Node.js single executable that
 * contains the server bundle and the built client as embedded assets.
 *   npm run build:exe
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const clientDir = join(root, 'dist');
const workDir = join(root, 'build');
const releaseDir = join(root, 'release');
const serverBundle = join(workDir, 'server', 'standalone.cjs');
const blob = join(workDir, 'sea-prep.blob');
const exeName = process.platform === 'win32' ? 'WarframeCompanion.exe' : 'warframe-companion';
// Fixed marker that Node.js looks for when it starts as a single executable.
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

function step(message) {
  console.log(`\n> ${message}`);
}

step('Сборка интерфейса (dist/)');
await build({ root, logLevel: 'warn' });

step('Сборка сервера в один файл');
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'server/standalone.ts',
    outDir: join(workDir, 'server'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'standalone.cjs', codeSplitting: false } },
  },
});

step('Подготовка Single Executable Application');
const assets = Object.fromEntries(filesIn(clientDir).map((file) => [relative(clientDir, file).split(sep).join('/'), file]));
const seaConfig = join(workDir, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({ main: serverBundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

step(`Упаковка в release/${exeName}`);
mkdirSync(releaseDir, { recursive: true });
const exe = join(releaseDir, exeName);
copyFileSync(process.execPath, exe);
const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SEA_FUSE, ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });

const sizeMb = (statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\nГотово: ${exe} (${sizeMb} МБ, ресурсов интерфейса: ${Object.keys(assets).length})`);
