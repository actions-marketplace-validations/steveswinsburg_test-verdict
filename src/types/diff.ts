/** Map of repo-relative file path -> set of added/modified 1-based line numbers. */
export type ChangedFileLines = Map<string, Set<number>>;

/** PR diff coverage breakdown for a single changed file. */
export interface FileDiffCoverage {
  path: string;
  changedLines: number;
  coverableLines: number;
  coveredLines: number;
  uncoveredLines: number[];
  pct: number | null;
  branchCovered: number;
  branchTotal: number;
  branchPct: number | null;
  unmeasured?: boolean;
}

/** Aggregate PR diff coverage across all changed files. */
export interface DiffCoverageResult {
  files: FileDiffCoverage[];
  coverableLines: number;
  coveredLines: number;
  pct: number | null;
  branchCovered: number;
  branchTotal: number;
  branchPct: number | null;
}
