import { build } from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...commonOptions,
    entryPoints: ['src/action/main.ts'],
    outfile: 'dist/index.cjs',
  }),
  build({
    ...commonOptions,
    entryPoints: ['src/cli/main.ts'],
    outfile: 'dist/cli.cjs',
    banner: {
      js: '#!/usr/bin/env node',
    },
  }),
]);

chmodSync('dist/cli.cjs', 0o755);
