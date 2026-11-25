import { describe, expect, it } from 'vitest';
import { computeDiffCoverage, parseGitHubFilePatch, parseUnifiedDiff } from '../../src/core/diff.js';
import { evaluateGroup } from '../../src/core/evaluator.js';
import type { FileCoverage } from '../../src/types/coverage.js';

describe('diff coverage and threshold evaluator', () => {
  it('parses unified diff and GitHub file patches into added/modified line sets', () => {
    const unified = [
      'diff --git a/src/math.ts b/src/math.ts',
      'index 111..222 100644',
      '--- a/src/math.ts',
      '+++ b/src/math.ts',
      '@@ -1,2 +1,3 @@',
      ' export function add(a: number, b: number) {',
      '+  const sum = a + b;',
      '-  return a + b;',
      '+  return sum;',
      ' }',
      '@@ -10,0 +11,2 @@',
      '+export const extra = 1;',
      '+export const unused = 2;',
    ].join('\n');

    const changed = parseUnifiedDiff(unified);
    expect(Array.from(changed.get('src/math.ts') ?? [])).toEqual([2, 3, 11, 12]);

    const patchOnly = [
      '@@ -5,1 +5,2 @@',
      ' keep()',
      '+added()',
    ].join('\n');
    expect(Array.from(parseGitHubFilePatch(patchOnly))).toEqual([6]);
  });

  it('computes PR diff coverage and uncovered changed lines accurately', () => {
    const files = new Map<string, FileCoverage>([
      [
        'src/math.ts',
        {
          path: 'src/math.ts',
          lines: new Map([
            [1, 3],
            [2, 3],
            [3, 0],
            [11, 1],
          ]),
          branches: [{ line: 2, covered: 1, total: 2 }],
          functions: null,
        },
      ],
    ]);

    const changed = new Map([['src/math.ts', new Set([2, 3, 11, 99])]]);
    const diff = computeDiffCoverage(files, changed);

    expect(diff.coverableLines).toBe(3);
    expect(diff.coveredLines).toBe(2);
    expect(diff.pct).toBe(66.67);
    expect(diff.branchPct).toBe(50);
    expect(diff.files[0]?.uncoveredLines).toEqual([3]);
  });

  it('warns and skips unavailable metrics without falsely failing at 0%', () => {
    const files = new Map<string, FileCoverage>([
      [
        'pkg/calc.go',
        {
          path: 'pkg/calc.go',
          lines: new Map([
            [10, 1],
            [11, 1],
          ]),
          branches: null,
          functions: null,
        },
      ],
    ]);

    const verdict = evaluateGroup({
      name: 'go-service',
      matchedFiles: ['coverage.out'],
      formats: ['gocover'],
      files,
      diffCoverage: null,
      thresholds: {
        minLine: 80,
        minBranch: 80,
        minFunction: 70,
      },
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.violations).toHaveLength(0);
    expect(verdict.warnings).toHaveLength(2);
    expect(verdict.warnings.every((w) => w.code === 'METRIC_UNAVAILABLE')).toBe(true);
  });

  it('records violations when line or diff-line thresholds are breached', () => {
    const files = new Map<string, FileCoverage>([
      [
        'src/app.ts',
        {
          path: 'src/app.ts',
          lines: new Map([
            [1, 1],
            [2, 0],
          ]),
          branches: [{ line: 2, covered: 0, total: 2 }],
          functions: [{ name: 'run', hits: 1 }],
        },
      ],
    ]);

    const diff = computeDiffCoverage(files, new Map([['src/app.ts', new Set([2])]]));
    const verdict = evaluateGroup({
      name: 'Overall',
      matchedFiles: ['lcov.info'],
      formats: ['lcov'],
      files,
      diffCoverage: diff,
      thresholds: {
        minLine: 80,
        minBranch: 50,
        minDiffLine: 90,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.violations.map((v) => v.metric)).toEqual(['line', 'branch', 'diff-line']);
  });
});
