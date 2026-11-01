import { defineConfig } from 'vitest/config';
import { companionApi } from './server/plugin.ts';

export default defineConfig({
  plugins: [companionApi()],
  server: { port: 5178, host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'server/**/*.ts'],
      // Views and bootstrap are DOM glue; logic lives in tested pure modules.
      exclude: ['src/**/*.test.ts', 'src/**/view*.ts', 'src/main.ts', 'src/core/shell.ts', 'src/core/dom.ts', 'src/modules/*/index.ts', 'server/plugin.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
