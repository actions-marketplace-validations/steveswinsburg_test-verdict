import type { CoverageSummary, FileCoverage, MetricSummary } from '../types/coverage.js';

/** Compute percentage rounded to 2 decimal places (returns 100 when total is 0). */
export function computePct(covered: number, total: number): number {
  if (total === 0) return 100;
  return Number(((covered / total) * 100).toFixed(2));
}

function buildMetric(covered: number, total: number): NonNullable<MetricSummary> {
  return { covered, total, pct: computePct(covered, total) };
}

/** Compute line, branch, and function summary for a single file. */
export function summarizeFile(file: FileCoverage): CoverageSummary {
  let lines: MetricSummary = null;
  if (file.lines.size > 0) {
    let covered = 0;
    for (const hits of file.lines.values()) {
      if (hits > 0) covered += 1;
    }
    lines = buildMetric(covered, file.lines.size);
  } else if (file.summaryOverride?.lines) {
    lines = file.summaryOverride.lines;
  }

  let branches: MetricSummary = null;
  if (file.branches !== null) {
    let covered = 0;
    let total = 0;
    for (const b of file.branches) {
      covered += b.covered;
      total += b.total;
    }
    branches = buildMetric(covered, total);
  } else if (file.summaryOverride?.branches) {
    branches = file.summaryOverride.branches;
  }

  let functions: MetricSummary = null;
  if (file.functions !== null) {
    let covered = 0;
    for (const f of file.functions) {
      if (f.hits > 0) covered += 1;
    }
    functions = buildMetric(covered, file.functions.length);
  } else if (file.summaryOverride?.functions) {
    functions = file.summaryOverride.functions;
  }

  return { lines, branches, functions };
}

/** Compute aggregate line, branch, and function coverage across multiple files. */
export function summarizeFiles(files: Iterable<FileCoverage>): CoverageSummary {
  let lineCovered = 0;
  let lineTotal = 0;
  let hasLines = false;

  let branchCovered = 0;
  let branchTotal = 0;
  let hasBranches = false;

  let fnCovered = 0;
  let fnTotal = 0;
  let hasFunctions = false;

  for (const file of files) {
    const s = summarizeFile(file);
    if (s.lines !== null) {
      hasLines = true;
      lineCovered += s.lines.covered;
      lineTotal += s.lines.total;
    }
    if (s.branches !== null) {
      hasBranches = true;
      branchCovered += s.branches.covered;
      branchTotal += s.branches.total;
    }
    if (s.functions !== null) {
      hasFunctions = true;
      fnCovered += s.functions.covered;
      fnTotal += s.functions.total;
    }
  }

  return {
    lines: hasLines ? buildMetric(lineCovered, lineTotal) : null,
    branches: hasBranches ? buildMetric(branchCovered, branchTotal) : null,
    functions: hasFunctions ? buildMetric(fnCovered, fnTotal) : null,
  };
}

/** Collapse sorted line numbers into compact ranges (e.g. "3-5, 9, 11-12"). */
export function formatLineRanges(lines: number[]): string {
  if (lines.length === 0) return '-';
  const sorted = Array.from(new Set(lines)).sort((a, b) => a - b);
  const ranges: string[] = [];

  let start = sorted[0]!;
  let prev = start;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    if (current === prev + 1) {
      prev = current;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = current;
      prev = current;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}
