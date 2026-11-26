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

  it('fails when matched reports contain 0 measured files, 0 coverable lines, or all files are excluded', async () => {
    const ws = makeWorkspace();

    // 1. 0-byte lcov report (auto and explicit format)
    writeFileSync(path.join(ws, 'empty.lcov.info'), '');
    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['empty.lcov.info'],
        thresholds: { minLine: 80 },
      }),
    ).rejects.toThrow(/contained 0 measured source files/);
    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['empty.lcov.info'],
        format: 'lcov',
        thresholds: { minLine: 80 },
      }),
    ).rejects.toThrow(/contained 0 measured source files/);

    // 2. LCOV with TN/end_of_record and no SF records
    writeFileSync(path.join(ws, 'no-sf.lcov.info'), 'TN:\nend_of_record\n');
    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['no-sf.lcov.info'],
        format: 'lcov',
        thresholds: { minLine: 80 },
      }),
    ).rejects.toThrow(/contained 0 measured source files/);

    // 3. Valid report where exclude filters out every file
    cpSync(path.join(fixturesDir, 'sample.lcov.info'), path.join(ws, 'valid.lcov.info'));
    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['valid.lcov.info'],
        exclude: ['**'],
        thresholds: { minLine: 80 },
      }),
    ).rejects.toThrow(/were filtered out by include\/exclude patterns/);

    // 4. Report with SF record but 0 DA/branch/function records
    writeFileSync(path.join(ws, 'zero-lines.lcov.info'), 'SF:src/empty.ts\nend_of_record\n');
    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['zero-lines.lcov.info'],
        thresholds: { minLine: 80 },
      }),
    ).rejects.toThrow(/contained 0 coverable lines or metrics/);

    // Degrades cleanly to EMPTY_REPORTS warning when failOnEmpty=false or enforce=false
    const warnedNoFail = await runVerdict({
      workingDirectory: ws,
      files: ['no-sf.lcov.info'],
      format: 'lcov',
      thresholds: { minLine: 80 },
      failOnEmpty: false,
    });
    expect(warnedNoFail.passed).toBe(true);
    expect(warnedNoFail.warnings.some((w) => w.code === 'EMPTY_REPORTS')).toBe(true);

    const warnedNoEnforce = await runVerdict({
      workingDirectory: ws,
      files: ['empty.lcov.info'],
      thresholds: { minLine: 80 },
      enforce: false,
      failOnEmpty: true,
    });
    expect(warnedNoEnforce.passed).toBe(true);
    expect(warnedNoEnforce.warnings.some((w) => w.code === 'EMPTY_REPORTS')).toBe(true);
  });

  it('supports disabling config via false/none and prevents implicit config from weakening caller gates', async () => {
    const ws = makeWorkspace();
    cpSync(path.join(fixturesDir, 'sample.lcov.info'), path.join(ws, 'coverage.lcov.info'));
    writeFileSync(
      path.join(ws, 'dummy.lcov.info'),
      'SF:src/dummy.ts\nDA:1,1\nend_of_record\n',
    );
    writeFileSync(
      path.join(ws, '.test-verdict.yml'),
      `
exclude:
  - "**"
groups:
  - name: weakened
    files:
      - "dummy.lcov.info"
    thresholds:
      min-line: 10
`,
    );

    // Disabling config via false, "none", or "false" ignores .test-verdict.yml completely
    for (const disabledVal of [false, 'none', 'false'] as const) {
      const res = await runVerdict({
        workingDirectory: ws,
        configPath: disabledVal,
        files: ['coverage.lcov.info'],
        repoFiles: ['src/math.ts', 'src/strings.ts'],
        thresholds: { minLine: 70 },
      });
      expect(res.passed).toBe(true);
      expect(res.groups).toHaveLength(0);
      expect(res.overall.files.size).toBe(2);
    }

    // Implicit .test-verdict.yml groups do NOT hijack explicit caller `files`
    const implicitWithFiles = await runVerdict({
      workingDirectory: ws,
      files: ['coverage.lcov.info'],
      repoFiles: ['src/math.ts', 'src/strings.ts'],
      exclude: ['**/strings.ts'],
      thresholds: { minLine: 75 },
    });
    expect(implicitWithFiles.groups).toHaveLength(0);
    expect(implicitWithFiles.overall.matchedFiles).toEqual(['coverage.lcov.info']);

    // Explicit config file runs groups, but caller thresholds act as a strict floor
    writeFileSync(
      path.join(ws, 'custom.yml'),
      `
groups:
  - name: weakened
    files:
      - "coverage.lcov.info"
    thresholds:
      min-line: 10
  - name: raised
    files:
      - "dummy.lcov.info"
    thresholds:
      min-line: 95
`,
    );
    const explicitConfig = await runVerdict({
      workingDirectory: ws,
      configPath: 'custom.yml',
      repoFiles: ['src/math.ts', 'src/strings.ts', 'src/dummy.ts'],
      thresholds: { minLine: 90 },
      enforce: false,
    });
    expect(explicitConfig.groups).toHaveLength(2);
    // "weakened" tried to set min-line: 10, but caller floor 90 still fails (sample.lcov.info is 75%)
    expect(explicitConfig.groups[0]?.passed).toBe(false);
    expect(explicitConfig.groups[0]?.violations[0]?.expected).toBe(90);
    // "raised" kept its stricter 95% threshold (dummy.lcov.info is 100%)
    expect(explicitConfig.groups[1]?.passed).toBe(true);
  });

  it('fails closed on diffFetchError when diff thresholds are enforced, and warns otherwise', async () => {
    const ws = makeWorkspace();
    cpSync(path.join(fixturesDir, 'sample.lcov.info'), path.join(ws, 'coverage.lcov.info'));

    await expect(
      runVerdict({
        workingDirectory: ws,
        files: ['coverage.lcov.info'],
        repoFiles: ['src/math.ts', 'src/strings.ts'],
        thresholds: { minDiffLine: 90 },
        enforce: true,
        diffFetchError: 'GitHub API 500 error',
      }),
    ).rejects.toThrow(/GitHub API 500 error/);

    const warnedNoEnforce = await runVerdict({
      workingDirectory: ws,
      files: ['coverage.lcov.info'],
      repoFiles: ['src/math.ts', 'src/strings.ts'],
      thresholds: { minDiffLine: 90 },
      enforce: false,
      diffFetchError: 'GitHub API 500 error',
    });
    expect(warnedNoEnforce.passed).toBe(true);
    expect(warnedNoEnforce.warnings.some((w) => w.code === 'DIFF_UNAVAILABLE')).toBe(true);

    const warnedNoDiffThreshold = await runVerdict({
      workingDirectory: ws,
      files: ['coverage.lcov.info'],
      repoFiles: ['src/math.ts', 'src/strings.ts'],
      thresholds: { minLine: 50 },
      enforce: true,
      diffFetchError: 'GitHub API 500 error',
    });
    expect(warnedNoDiffThreshold.passed).toBe(true);
    expect(warnedNoDiffThreshold.warnings.some((w) => w.code === 'DIFF_UNAVAILABLE')).toBe(true);
  });

  it('counts unmeasured changed source files matching include globs as 0% diff coverage', async () => {
    const ws = makeWorkspace();
    cpSync(path.join(fixturesDir, 'sample.lcov.info'), path.join(ws, 'coverage.lcov.info'));

    const res = await runVerdict({
      workingDirectory: ws,
      files: ['coverage.lcov.info'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      repoFiles: ['src/math.ts', 'src/strings.ts', 'src/untested.ts', 'src/untested.test.ts', 'README.md'],
      changedLines: new Map([
        ['src/math.ts', new Set([5])],
        ['src/untested.ts', new Set([1, 2, 3, 4])],
        ['src/untested.test.ts', new Set([1, 2])],
        ['README.md', new Set([10])],
      ]),
      thresholds: { minDiffLine: 80 },
      enforce: false,
    });

    expect(res.passed).toBe(false);
    expect(res.overall.diffCoverage?.coverableLines).toBe(5);
    expect(res.overall.diffCoverage?.coveredLines).toBe(1);
    expect(res.overall.diffCoverage?.pct).toBe(20);
    const unmeasured = res.overall.diffCoverage?.files.find((f) => f.path === 'src/untested.ts');
    expect(unmeasured?.unmeasured).toBe(true);
    expect(unmeasured?.pct).toBe(0);
    expect(unmeasured?.uncoveredLines).toEqual([1, 2, 3, 4]);
    expect(res.overall.diffCoverage?.files.some((f) => f.path === 'README.md')).toBe(false);
    expect(res.overall.diffCoverage?.files.some((f) => f.path === 'src/untested.test.ts')).toBe(false);
  });
});
