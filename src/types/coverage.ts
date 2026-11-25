/** Supported v1 coverage report format identifiers. */
export type FormatId =
  | 'lcov'
  | 'cobertura'
  | 'jacoco'
  | 'istanbul'
  | 'gocover'
  | 'opencover';

/** Summary counts and percentage for a single coverage metric, or null if unsupported. */
export type MetricSummary = {
  covered: number;
  total: number;
  pct: number;
} | null;

/** Branch coverage data anchored to a source line. */
export interface BranchEntry {
  line: number;
  covered: number;
  total: number;
}

/** Function or method execution coverage entry. */
export interface FunctionEntry {
  name: string;
  line?: number;
  hits: number;
}

/** Pre-aggregated summary values for formats without per-line detail (e.g. coverage-summary.json). */
export interface SummaryOverride {
  lines?: MetricSummary;
  branches?: MetricSummary;
  functions?: MetricSummary;
}

/** Canonical per-file coverage representation. */
export interface FileCoverage {
  path: string;
  lines: Map<number, number>;
  branches: BranchEntry[] | null;
  functions: FunctionEntry[] | null;
  summaryOverride?: SummaryOverride;
}

/** Canonical output produced by every format parser module. */
export interface NormalizedCoverageReport {
  format: FormatId;
  sourceFile?: string;
  files: Map<string, FileCoverage>;
}

/** Aggregate coverage metrics across one or more files. */
export interface CoverageSummary {
  lines: MetricSummary;
  branches: MetricSummary;
  functions: MetricSummary;
}
