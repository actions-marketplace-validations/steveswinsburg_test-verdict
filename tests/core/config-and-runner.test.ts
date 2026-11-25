import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVerdict } from '../../src/core/runner.js';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');
const tempDirs: string[] = [];

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-verdict-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config loader and runner end-to-end', () => {
  it('evaluates named monorepo groups from .test-verdict.yml and applies exclusions', async () => {
    const ws = makeWorkspace();
    cpSync(path.join(fixturesDir, 'sample.lcov.info'), path.join(ws, 'web.lcov.info'));
    cpSync(path.join(fixturesDir, 'sample.jacoco.xml'), path.join(ws, 'jacoco.xml'));

    writeFileSync(
      path.join(ws, '.test-verdict.yml'),
      `
title: Polyglot Monorepo
exclude:
  - "**/strings.ts"
groups:
  - name: frontend
    files:
      - "web.lcov.info"
    thresholds:
      min-line: 75
  - name: backend
    files:
      - "jacoco.xml"
    thresholds:
      min-line: 60
`,
    );

    const result = await runVerdict({
      workingDirectory: ws,
      repoFiles: ['src/math.ts', 'src/strings.ts', 'services/api/src/main/java/com/acme/service/OrderService.java'],
      changedLines: new Map([['src/math.ts', new Set([5, 6, 7])]]),
    });

    expect(result.title).toBe('Polyglot Monorepo');
    expect(result.passed).toBe(true);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.summary.lines).toEqual({ covered: 4, total: 5, pct: 80 });
    expect(result.overall.files.has('src/strings.ts')).toBe(false);
    expect(result.overall.files.has('services/api/src/main/java/com/acme/service/OrderService.java')).toBe(true);
    expect(result.overall.diffCoverage?.pct).toBe(66.67);
  });

  it('fails when failOnEmpty=true and enforce=true, and warns when failOnEmpty=false', async () => {
    const ws = makeWorkspace();

    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['**/does-not-exist.xml'],
        enforce: true,
        failOnEmpty: true,
      }),
    ).rejects.toThrow(/No coverage report files matched/);

    const warned = await runVerdict({
      workingDirectory: ws,
      files: ['**/does-not-exist.xml'],
      enforce: true,
      failOnEmpty: false,
    });
    expect(warned.passed).toBe(true);
    expect(warned.warnings.some((w) => w.code === 'EMPTY_REPORTS')).toBe(true);
  });
});
