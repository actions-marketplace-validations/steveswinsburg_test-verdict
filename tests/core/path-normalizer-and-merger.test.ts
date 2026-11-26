import { describe, expect, it } from 'vitest';
import { mergeReports } from '../../src/core/merger.js';
import { formatLineRanges, summarizeFiles } from '../../src/core/metrics.js';
import { createPathNormalizer, normalizePathSeparators, stripTrailingSlashes, trimSlashes } from '../../src/core/path-normalizer.js';
import type { NormalizedCoverageReport } from '../../src/types/coverage.js';

describe('path normalizer, merger, and metrics', () => {
  it('normalizes CI runner prefixes, Windows slashes, and JaCoCo package suffixes', () => {
    const repoFiles = [
      'services/api/src/main/java/com/acme/OrderService.java',
      'apps/web/src/index.ts',
      'src/Calc.cs',
      'pkg/calc.go',
    ];
    const normalize = createPathNormalizer(repoFiles, '/workspace/my-repo');

    expect(normalizePathSeparators('.\\src\\Calc.cs')).toBe('src/Calc.cs');
    expect(normalize('/home/runner/work/org/repo/apps/web/src/index.ts')).toBe('apps/web/src/index.ts');
    expect(normalize('/home/vsts/work/1/s/apps/web/src/index.ts')).toBe('apps/web/src/index.ts');
    expect(normalize('/Users/runner/work/1/s/apps/web/src/index.ts')).toBe('apps/web/src/index.ts');
    expect(normalize('/app/apps/web/src/index.ts')).toBe('apps/web/src/index.ts');
    expect(normalize('com/acme/OrderService.java')).toBe('services/api/src/main/java/com/acme/OrderService.java');
    expect(normalize('C:\\repo\\src\\Calc.cs')).toBe('src/Calc.cs');
    expect(normalize('D:\\a\\1\\s\\src\\Calc.cs')).toBe('src/Calc.cs');
    expect(normalize('github.com/acme/repo/pkg/calc.go')).toBe('pkg/calc.go');
    expect(normalize('unmatched/file.ts')).toBe('unmatched/file.ts');
  });

  it('merges overlapping suites by summing line/function hits and taking max branch coverage', () => {
    const unit: NormalizedCoverageReport = {
      format: 'lcov',
      files: new Map([
        [
          '/home/runner/work/a/b/src/app.ts',
          {
            path: '/home/runner/work/a/b/src/app.ts',
            lines: new Map([
              [1, 1],
              [2, 0],
              [3, 1],
            ]),
            branches: [{ line: 2, covered: 1, total: 2 }],
            functions: [
              { name: 'init', line: 1, hits: 1 },
              { name: 'handle', line: 2, hits: 0 },
            ],
          },
        ],
      ]),
    };

    const integration: NormalizedCoverageReport = {
      format: 'lcov',
      files: new Map([
        [
          'src/app.ts',
          {
            path: 'src/app.ts',
            lines: new Map([
              [1, 2],
              [2, 1],
              [4, 0],
            ]),
            branches: [{ line: 2, covered: 2, total: 2 }],
            functions: [{ name: 'handle', line: 2, hits: 1 }],
          },
        ],
      ]),
    };

    const normalize = createPathNormalizer(['src/app.ts']);
    const merged = mergeReports([unit, integration], normalize);
    expect(merged.size).toBe(1);

    const app = merged.get('src/app.ts')!;
    expect(app.lines.get(1)).toBe(3);
    expect(app.lines.get(2)).toBe(1);
    expect(app.lines.get(4)).toBe(0);

    const summary = summarizeFiles(merged.values());
    expect(summary.lines).toEqual({ covered: 3, total: 4, pct: 75 });
    expect(summary.branches).toEqual({ covered: 2, total: 2, pct: 100 });
    expect(summary.functions).toEqual({ covered: 2, total: 2, pct: 100 });
  });

  it('formats consecutive line numbers into compact ranges', () => {
    expect(formatLineRanges([])).toBe('-');
    expect(formatLineRanges([12, 3, 4, 5, 9, 11, 5])).toBe('3-5, 9, 11-12');
  });

  it('strips trailing and surrounding slashes in linear time without regex backtracking', () => {
    expect(stripTrailingSlashes('')).toBe('');
    expect(stripTrailingSlashes('///')).toBe('');
    expect(stripTrailingSlashes('https://dev.azure.com/org///')).toBe('https://dev.azure.com/org');
    expect(stripTrailingSlashes(`https://dev.azure.com/org${'/'.repeat(50_000)}`)).toBe('https://dev.azure.com/org');

    expect(trimSlashes('')).toBe('');
    expect(trimSlashes('///')).toBe('');
    expect(trimSlashes('//com/acme/pkg//')).toBe('com/acme/pkg');
    expect(trimSlashes(`${'/'.repeat(50_000)}a${'/'.repeat(50_000)}`)).toBe('a');
  });
});
