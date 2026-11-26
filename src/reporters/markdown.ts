import { formatLineRanges } from '../core/metrics.js';
import type { CoverageSummary, FileCoverage, MetricSummary } from '../types/coverage.js';
import type { GroupVerdict, VerdictResult } from '../types/evaluation.js';

export const STICKY_MARKER_PREFIX = '<!-- test-verdict:';
export const DEFAULT_MAX_COMMENT_LENGTH = 60_000;

export function buildStickyMarker(reportId: string): string {
  return `${STICKY_MARKER_PREFIX}${reportId} -->`;
}

function fmtMetric(metric: MetricSummary): string {
  if (metric === null) return '—';
  return `${metric.pct.toFixed(1)}% (${metric.covered}/${metric.total})`;
}

function fmtDiffMetric(verdict: GroupVerdict): string {
  if (!verdict.diffCoverage || verdict.diffCoverage.pct === null) return '—';
  return `${verdict.diffCoverage.pct.toFixed(1)}% (${verdict.diffCoverage.coveredLines}/${verdict.diffCoverage.coverableLines})`;
}

function fmtGroupStatus(verdict: GroupVerdict, enforce: boolean): string {
  if (verdict.passed) return '✅ Pass';
  return enforce ? '❌ Fail' : '⚠️ Warn';
}

function renderSummaryRow(label: string, verdict: GroupVerdict, enforce: boolean, bold = false): string {
  const wrap = (text: string): string => (bold ? `**${text}**` : text);
  return `| ${wrap(label)} | ${wrap(fmtMetric(verdict.summary.lines))} | ${wrap(fmtMetric(verdict.summary.branches))} | ${wrap(fmtMetric(verdict.summary.functions))} | ${wrap(fmtDiffMetric(verdict))} | ${fmtGroupStatus(verdict, enforce)} |`;
}

function summarizeSingleFileRow(file: FileCoverage): {
  lines: string;
  branches: string;
  functions: string;
} {
  let lineText = '—';
  if (file.lines.size > 0) {
    let covered = 0;
    for (const hits of file.lines.values()) {
      if (hits > 0) covered += 1;
    }
    const pct = ((covered / file.lines.size) * 100).toFixed(1);
    lineText = `${pct}% (${covered}/${file.lines.size})`;
  } else if (file.summaryOverride?.lines) {
    lineText = fmtMetric(file.summaryOverride.lines);
  }

  let branchText = '—';
  if (file.branches !== null) {
    const covered = file.branches.reduce((acc, b) => acc + b.covered, 0);
    const total = file.branches.reduce((acc, b) => acc + b.total, 0);
    const pct = total === 0 ? '100.0' : ((covered / total) * 100).toFixed(1);
    branchText = `${pct}% (${covered}/${total})`;
  } else if (file.summaryOverride?.branches) {
    branchText = fmtMetric(file.summaryOverride.branches);
  }

  let fnText = '—';
  if (file.functions !== null) {
    const covered = file.functions.filter((f) => f.hits > 0).length;
    const total = file.functions.length;
    const pct = total === 0 ? '100.0' : ((covered / total) * 100).toFixed(1);
    fnText = `${pct}% (${covered}/${total})`;
  } else if (file.summaryOverride?.functions) {
    fnText = fmtMetric(file.summaryOverride.functions);
  }

  return { lines: lineText, branches: branchText, functions: fnText };
}

function buildSection(header: string, tableHeader: string[], rows: string[]): string {
  return [header, '', ...tableHeader, ...rows].join('\n');
}

export interface RenderMarkdownOptions {
  maxLength?: number;
}

/** Render a VerdictResult as GitHub-flavored Markdown with sticky marker and optional length cap. */
export function renderVerdictMarkdown(result: VerdictResult, options: RenderMarkdownOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_COMMENT_LENGTH;
  const marker = buildStickyMarker(result.reportId);
  const statusBadge = result.passed
    ? '✅ Passed'
    : result.enforce
      ? '❌ Failed'
      : '⚠️ Thresholds not met (warn only)';

  const headerParts: string[] = [
    marker,
    `## ${result.title} — ${statusBadge}`,
    '',
    '| Suite | Lines | Branches | Functions | PR Diff | Status |',
    '| :--- | ---: | ---: | ---: | ---: | :---: |',
  ];

  if (result.groups.length > 0) {
    for (const grp of result.groups) {
      headerParts.push(renderSummaryRow(grp.name, grp, result.enforce));
    }
    headerParts.push(renderSummaryRow('Overall', result.overall, result.enforce, true));
  } else {
    headerParts.push(renderSummaryRow('Overall', result.overall, result.enforce));
  }

  if (result.violations.length > 0) {
    headerParts.push('', '### Threshold Violations');
    for (const v of result.violations) {
      headerParts.push(`- ${v.message}`);
    }
  }

  if (result.warnings.length > 0) {
    headerParts.push('', '### Warnings');
    for (const w of result.warnings) {
      headerParts.push(`- ${w.message}`);
    }
  }

  const baseHeader = headerParts.join('\n');

  const diffFiles = result.overall.diffCoverage?.files.filter((f) => f.coverableLines > 0) ?? [];
  const diffRows = diffFiles.map((f) => {
    const pctCell =
      f.pct !== null
        ? `${f.pct.toFixed(1)}% (${f.coveredLines}/${f.coverableLines})${f.unmeasured ? ' (not in report)' : ''}`
        : '—';
    return `| \`${f.path}\` | ${f.changedLines} | ${pctCell} | ${formatLineRanges(f.uncoveredLines)} |`;
  });

  const allFiles = Array.from(result.overall.files.values()).sort((a, b) => a.path.localeCompare(b.path));
  const allFileRows = allFiles.map((f) => {
    const row = summarizeSingleFileRow(f);
    return `| \`${f.path}\` | ${row.lines} | ${row.branches} | ${row.functions} |`;
  });

  const assemble = (shownDiffRows: string[], omittedDiff: number, shownAllRows: string[], omittedAll: number): string => {
    const sections = [baseHeader];

    if (diffRows.length > 0) {
      const diffSection = buildSection(
        '### PR Changed Files',
        ['| File | Changed Lines | Diff Coverage | Uncovered Lines |', '| :--- | ---: | ---: | :--- |'],
        shownDiffRows,
      );
      sections.push('', diffSection);
      if (omittedDiff > 0) {
        sections.push(`\n_...and ${omittedDiff} more changed files (see Job Step Summary)._`);
      }
    }

    if (allFileRows.length > 0 && (shownAllRows.length > 0 || omittedAll > 0)) {
      const table = [
        `<details>`,
        `<summary>All Files (${allFileRows.length})</summary>`,
        '',
        '| File | Lines | Branches | Functions |',
        '| :--- | ---: | ---: | ---: |',
        ...shownAllRows,
        omittedAll > 0 ? `\n_...and ${omittedAll} more files (see Job Step Summary)._` : '',
        '</details>',
      ]
        .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
        .join('\n');
      sections.push('', table);
    }

    return sections.join('\n');
  };

  let doc = assemble(diffRows, 0, allFileRows, 0);
  if (doc.length <= maxLength) {
    return doc;
  }

  // First progressively trim the collapsible All Files table
  let keptAll = allFileRows.length;
  while (keptAll > 0 && doc.length > maxLength) {
    keptAll = Math.floor(keptAll / 2);
    doc = assemble(diffRows, 0, allFileRows.slice(0, keptAll), allFileRows.length - keptAll);
  }
  if (doc.length <= maxLength) {
    return doc;
  }

  // Next trim PR changed files if still above maxLength
  let keptDiff = diffRows.length;
  while (keptDiff > 0 && doc.length > maxLength) {
    keptDiff = Math.floor(keptDiff / 2);
    doc = assemble(diffRows.slice(0, keptDiff), diffRows.length - keptDiff, [], allFileRows.length);
  }
  if (doc.length <= maxLength) {
    return doc;
  }

  // Last resort hard cap preserving marker and summary
  const suffix = '\n\n_Output truncated to fit GitHub comment size limit._';
  return doc.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
}

/** Build a JSON-serializable summary payload for Action outputs and CLI `--json`. */
export function buildSummaryJson(result: VerdictResult): {
  title: string;
  reportId: string;
  passed: boolean;
  enforce: boolean;
  summary: CoverageSummary;
  diffCoverage: {
    coverableLines: number;
    coveredLines: number;
    pct: number | null;
    branchCovered: number;
    branchTotal: number;
    branchPct: number | null;
  } | null;
  groups: Array<{
    name: string;
    passed: boolean;
    summary: CoverageSummary;
    diffPct: number | null;
    matchedFiles: string[];
    formats: string[];
  }>;
  violations: VerdictResult['violations'];
  warnings: VerdictResult['warnings'];
} {
  return {
    title: result.title,
    reportId: result.reportId,
    passed: result.passed,
    enforce: result.enforce,
    summary: result.overall.summary,
    diffCoverage: result.overall.diffCoverage
      ? {
          coverableLines: result.overall.diffCoverage.coverableLines,
          coveredLines: result.overall.diffCoverage.coveredLines,
          pct: result.overall.diffCoverage.pct,
          branchCovered: result.overall.diffCoverage.branchCovered,
          branchTotal: result.overall.diffCoverage.branchTotal,
          branchPct: result.overall.diffCoverage.branchPct,
        }
      : null,
    groups: result.groups.map((g) => ({
      name: g.name,
      passed: g.passed,
      summary: g.summary,
      diffPct: g.diffCoverage?.pct ?? null,
      matchedFiles: g.matchedFiles,
      formats: g.formats,
    })),
    violations: result.violations,
    warnings: result.warnings,
  };
}
