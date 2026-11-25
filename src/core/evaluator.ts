import type { ThresholdConfig } from '../types/config.js';
import type { FileCoverage, FormatId, MetricSummary } from '../types/coverage.js';
import type { DiffCoverageResult } from '../types/diff.js';
import type { EvaluationWarning, GroupVerdict, ThresholdViolation } from '../types/evaluation.js';
import { summarizeFiles } from './metrics.js';

export interface EvaluateGroupInput {
  name: string;
  matchedFiles: string[];
  formats: FormatId[];
  files: Map<string, FileCoverage>;
  diffCoverage: DiffCoverageResult | null;
  thresholds: ThresholdConfig;
}

function checkMetricThreshold(
  group: string,
  metric: ThresholdViolation['metric'],
  label: string,
  actual: MetricSummary,
  expected: number | undefined,
  violations: ThresholdViolation[],
  warnings: EvaluationWarning[],
): void {
  if (expected === undefined) return;
  if (actual === null) {
    warnings.push({
      group,
      code: 'METRIC_UNAVAILABLE',
      message: `Skipped ${label} threshold (${expected}%) for "${group}": parsed report format(s) did not provide ${label} coverage.`,
    });
    return;
  }
  if (actual.pct < expected) {
    violations.push({
      group,
      metric,
      actual: actual.pct,
      expected,
      message: `${group}: ${label} coverage ${actual.pct}% is below threshold ${expected}%`,
    });
  }
}

/** Evaluate overall and diff coverage thresholds for a single group. */
export function evaluateGroup(input: EvaluateGroupInput): GroupVerdict {
  const { name, matchedFiles, formats, files, diffCoverage, thresholds } = input;
  const summary = summarizeFiles(files.values());
  const violations: ThresholdViolation[] = [];
  const warnings: EvaluationWarning[] = [];

  checkMetricThreshold(name, 'line', 'line', summary.lines, thresholds.minLine, violations, warnings);
  checkMetricThreshold(name, 'branch', 'branch', summary.branches, thresholds.minBranch, violations, warnings);
  checkMetricThreshold(name, 'function', 'function', summary.functions, thresholds.minFunction, violations, warnings);

  if (diffCoverage !== null && diffCoverage.coverableLines > 0) {
    if (thresholds.minDiffLine !== undefined && diffCoverage.pct !== null && diffCoverage.pct < thresholds.minDiffLine) {
      violations.push({
        group: name,
        metric: 'diff-line',
        actual: diffCoverage.pct,
        expected: thresholds.minDiffLine,
        message: `${name}: PR diff line coverage ${diffCoverage.pct}% is below threshold ${thresholds.minDiffLine}%`,
      });
    }

    if (thresholds.minDiffBranch !== undefined) {
      if (diffCoverage.branchPct === null) {
        warnings.push({
          group: name,
          code: 'METRIC_UNAVAILABLE',
          message: `Skipped PR diff branch threshold (${thresholds.minDiffBranch}%) for "${name}": no branch data on changed lines.`,
        });
      } else if (diffCoverage.branchPct < thresholds.minDiffBranch) {
        violations.push({
          group: name,
          metric: 'diff-branch',
          actual: diffCoverage.branchPct,
          expected: thresholds.minDiffBranch,
          message: `${name}: PR diff branch coverage ${diffCoverage.branchPct}% is below threshold ${thresholds.minDiffBranch}%`,
        });
      }
    }
  }

  return {
    name,
    matchedFiles,
    formats,
    summary,
    diffCoverage,
    files,
    passed: violations.length === 0,
    violations,
    warnings,
  };
}
