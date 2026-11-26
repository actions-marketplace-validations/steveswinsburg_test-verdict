import type { CoverageSummary, FileCoverage, FormatId } from './coverage.js';
import type { DiffCoverageResult } from './diff.js';

/** Single threshold failure recorded during evaluation. */
export interface ThresholdViolation {
  group: string;
  metric: 'line' | 'branch' | 'function' | 'diff-line' | 'diff-branch';
  actual: number;
  expected: number;
  message: string;
}

/** Non-fatal evaluation warning (e.g. threshold metric unavailable in report format). */
export interface EvaluationWarning {
  group: string;
  code: 'METRIC_UNAVAILABLE' | 'EMPTY_REPORTS' | 'DIFF_UNAVAILABLE' | 'FORK_COMMENT_PERMISSION';
  message: string;
}

/** Evaluation verdict for a single group (or the default aggregate group). */
export interface GroupVerdict {
  name: string;
  matchedFiles: string[];
  formats: FormatId[];
  summary: CoverageSummary;
  diffCoverage: DiffCoverageResult | null;
  files: Map<string, FileCoverage>;
  passed: boolean;
  violations: ThresholdViolation[];
  warnings: EvaluationWarning[];
}

/** Complete verdict returned by the core runner. */
export interface VerdictResult {
  title: string;
  reportId: string;
  enforce: boolean;
  passed: boolean;
  overall: GroupVerdict;
  groups: GroupVerdict[];
  violations: ThresholdViolation[];
  warnings: EvaluationWarning[];
}
