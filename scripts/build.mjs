import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('azure-pipelines/task', { recursive: true });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

function syncJsonFile(filePath, updateFn) {
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (updateFn(data)) {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}

const [majorStr, minorStr, patchStr] = String(version).split('-')[0].split('.');
const major = Number.parseInt(majorStr, 10) || 0;
const minor = Number.parseInt(minorStr, 10) || 0;
const patch = Number.parseInt(patchStr, 10) || 0;

syncJsonFile('azure-pipelines/vss-extension.json', (ext) => {
  if (ext.version === version) return false;
  ext.version = version;
  return true;
});

syncJsonFile('azure-pipelines/task/task.json', (task) => {
  const v = task.version ?? {};
  if (v.Major === major && v.Minor === minor && v.Patch === patch) return false;
  task.version = { Major: major, Minor: minor, Patch: patch };
  return true;
});

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
    entryPoints: ['src/github/main.ts'],
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
  build({
    ...commonOptions,
    target: 'node20',
    entryPoints: ['src/azure/main.ts'],
    outfile: 'azure-pipelines/task/index.cjs',
  }),
]);

chmodSync('dist/cli.cjs', 0o755);
