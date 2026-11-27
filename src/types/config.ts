import type { FormatId } from './coverage.js';

/** Minimum percentage thresholds (0-100) for overall and PR diff coverage. */
export interface ThresholdConfig {
  minLine?: number;
  minBranch?: number;
  minFunction?: number;
  minDiffLine?: number;
  minDiffBranch?: number;
}

/** Named coverage group (e.g. a monorepo package or test suite) in .test-verdict.yml. */
export interface GroupConfig {
  name: string;
  files: string[];
  include?: string[];
  exclude?: string[];
  format?: FormatId | 'auto';
  thresholds?: ThresholdConfig;
}

/** Structure of the optional .test-verdict.yml configuration file. */
export interface VerdictFileConfig {
  title?: string;
  reportId?: string;
  files?: string[];
  include?: string[];
  exclude?: string[];
  format?: FormatId | 'auto';
  thresholds?: ThresholdConfig;
  enforce?: boolean;
  failOnEmpty?: boolean;
  groups?: GroupConfig[];
}

/** Resolved options passed into the core runner by the Action or CLI. */
export interface RunOptions {
  workingDirectory: string;
  configPath?: string | false;
  files?: string[];
  include?: string[];
  exclude?: string[];
  format?: FormatId | 'auto';
  reportId?: string;
  title?: string;
  thresholds?: ThresholdConfig;
  enforce?: boolean;
  failOnEmpty?: boolean;
  changedLines?: Map<string, Set<number>>;
  diffFetchError?: string;
  repoFiles?: string[];
}
