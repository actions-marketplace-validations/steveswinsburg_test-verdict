import { describe, expect, it, vi } from 'vitest';
import { getPrChangedLines, upsertPrComment } from '../../src/reporters/github.js';
import { buildStickyMarker, buildSummaryJson, renderVerdictMarkdown } from '../../src/reporters/markdown.js';
import type { FileCoverage } from '../../src/types/coverage.js';
import type { VerdictResult } from '../../src/types/evaluation.js';

function makeResult(fileCount = 2, passed = true): VerdictResult {
  const files = new Map<string, FileCoverage>();
  for (let i = 0; i < fileCount; i += 1) {
    const p = `src/module-${String(i).padStart(4, '0')}/very-long-component-name-for-testing.ts`;
    files.set(p, {
      path: p,
      lines: new Map([
        [1, 1],
        [2, 0],
      ]),
      branches: [{ line: 2, covered: 1, total: 2 }],
      functions: [{ name: 'fn', hits: 1 }],
    });
  }

  return {
    title: 'Test Verdict',
    reportId: 'unit-suite',
    enforce: true,
    passed,
    overall: {
      name: 'Overall',
      matchedFiles: ['coverage/lcov.info'],
      formats: ['lcov'],
      summary: {
        lines: { covered: 10, total: 20, pct: 50 },
        branches: { covered: 5, total: 10, pct: 50 },
        functions: { covered: 4, total: 4, pct: 100 },
      },
      diffCoverage: {
        files: [
          {
            path: 'src/changed.ts',
            changedLines: 3,
            coverableLines: 3,
            coveredLines: 2,
            uncoveredLines: [14],
            pct: 66.67,
            branchCovered: 0,
            branchTotal: 0,
            branchPct: null,
          },
        ],
        coverableLines: 3,
        coveredLines: 2,
        pct: 66.67,
        branchCovered: 0,
        branchTotal: 0,
        branchPct: null,
      },
      files,
      passed,
      violations: passed
        ? []
        : [{ group: 'Overall', metric: 'line', actual: 50, expected: 80, message: 'Overall: line coverage 50% < 80%' }],
      warnings: [],
    },
    groups: [],
    violations: passed
      ? []
      : [{ group: 'Overall', metric: 'line', actual: 50, expected: 80, message: 'Overall: line coverage 50% < 80%' }],
    warnings: [],
  };
}

describe('markdown and GitHub reporters', () => {
  it('renders sticky marker, summary table, PR changed files, and JSON summary', () => {
    const result = makeResult(2, false);
    const md = renderVerdictMarkdown(result);

    expect(md).toContain(buildStickyMarker('unit-suite'));
    expect(md).toContain('## Test Verdict - ❌ Failed');
    expect(md).toContain('❌ Failed');
    expect(md).toContain('`src/changed.ts`');
    expect(md).toContain('Overall: line coverage 50% < 80%');
    expect(md).not.toContain('—');

    const minimalResult: VerdictResult = {
      ...result,
      passed: true,
      violations: [],
      overall: {
        ...result.overall,
        passed: true,
        violations: [],
        summary: { lines: null, branches: null, functions: null },
        diffCoverage: null,
        files: new Map([
          [
            'src/empty.ts',
            {
              path: 'src/empty.ts',
              lines: new Map(),
              branches: null,
              functions: null,
            },
          ],
        ]),
      },
    };
    const minimalMd = renderVerdictMarkdown(minimalResult);
    expect(minimalMd).toContain('| Overall | - | - | - | - | ✅ Pass |');
    expect(minimalMd).toContain('| `src/empty.ts` | - | - | - |');
    expect(minimalMd).not.toContain('—');

    const json = buildSummaryJson(result);
    expect(json.passed).toBe(false);
    expect(json.summary.lines?.pct).toBe(50);
    expect(json.diffCoverage?.pct).toBe(66.67);
  });

  it('truncates oversized all-files tables safely below maxLength', () => {
    const huge = makeResult(1200, true);
    const md = renderVerdictMarkdown(huge, { maxLength: 8000 });
    expect(md.length).toBeLessThanOrEqual(8000);
    expect(md).toContain(buildStickyMarker('unit-suite'));
    expect(md).toContain('more files (see Job Step Summary)');
  });

  it('creates and updates sticky PR comments and handles fork 403 permissions gracefully', async () => {
    const pr = { owner: 'acme', repo: 'app', pullNumber: 42 };
    const createComment = vi.fn().mockResolvedValue({ data: { id: 101 } });
    const updateComment = vi.fn().mockResolvedValue({ data: { id: 99 } });

    const octokitCreate = {
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        issues: { listComments: vi.fn(), createComment, updateComment },
        pulls: { listFiles: vi.fn() },
      },
    } as never;

    const created = await upsertPrComment(octokitCreate, pr, 'default', 'hello');
    expect(created).toEqual({ ok: true, commentId: 101, action: 'created' });
    expect(createComment).toHaveBeenCalledTimes(1);

    const octokitUpdate = {
      paginate: vi.fn().mockResolvedValue([{ id: 99, body: `${buildStickyMarker('default')}\nold` }]),
      rest: {
        issues: { listComments: vi.fn(), createComment, updateComment },
        pulls: { listFiles: vi.fn() },
      },
    } as never;

    const updated = await upsertPrComment(octokitUpdate, pr, 'default', 'new');
    expect(updated).toEqual({ ok: true, commentId: 99, action: 'updated' });
    expect(updateComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      comment_id: 99,
      body: 'new',
    });

    const octokitForbidden = {
      paginate: vi.fn().mockRejectedValue(Object.assign(new Error('Resource not accessible by integration'), { status: 403 })),
      rest: {
        issues: { listComments: vi.fn(), createComment, updateComment },
        pulls: { listFiles: vi.fn() },
      },
    } as never;

    const forkRes = await upsertPrComment(octokitForbidden, pr, 'default', 'body');
    expect(forkRes.ok).toBe(false);
    expect(forkRes.warning).toContain('fork pull requests');
  });

  it('fetches PR changed lines from GitHub pulls.listFiles', async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { filename: 'src/a.ts', status: 'modified', patch: '@@ -1,1 +1,2 @@\n line1\n+line2' },
        { filename: 'src/deleted.ts', status: 'removed', patch: '@@ -1,1 +0,0 @@\n-old' },
      ]),
      rest: {
        pulls: { listFiles: vi.fn() },
      },
    } as never;

    const changed = await getPrChangedLines(octokit, { owner: 'acme', repo: 'app', pullNumber: 7 });
    expect(Array.from(changed.get('src/a.ts') ?? [])).toEqual([2]);
    expect(changed.has('src/deleted.ts')).toBe(false);
  });
});
