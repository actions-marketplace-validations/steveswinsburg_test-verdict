import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const commonOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...commonOptions,
    target: 'node24',
    entryPoints: ['src/action/main.ts'],
    outfile: 'dist/index.cjs',
  }),
  build({
    ...commonOptions,
    target: 'node20',
    entryPoints: ['src/cli/main.ts'],
    outfile: 'dist/cli.cjs',
    define: {
      __TEST_VERDICT_VERSION__: JSON.stringify(version),
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
  }),
]);

chmodSync('dist/cli.cjs', 0o755);
