export type * from './types/config.js';
export type * from './types/coverage.js';
export type * from './types/diff.js';
export type * from './types/evaluation.js';
export type * from './types/test-results.js';

export { coberturaParser } from './parsers/cobertura.js';
export { gocoverParser } from './parsers/gocover.js';
export { istanbulParser } from './parsers/istanbul.js';
export { jacocoParser } from './parsers/jacoco.js';
export { lcovParser } from './parsers/lcov.js';
export { opencoverParser } from './parsers/opencover.js';
export type { CoverageParser } from './parsers/parser.js';
export { createDefaultParserRegistry, ParserRegistry } from './parsers/registry.js';

export { isConfigDisabled, loadConfigFile } from './core/config-loader.js';
export { computeDiffCoverage, parseGitHubFilePatch, parseUnifiedDiff } from './core/diff.js';
export { evaluateGroup } from './core/evaluator.js';
export { mergeFileCoverage, mergeFileMaps, mergeReports } from './core/merger.js';
export { computePct, formatLineRanges, summarizeFile, summarizeFiles } from './core/metrics.js';
export { createPathNormalizer, getRepoFiles, normalizePathSeparators, stripKnownPrefixes } from './core/path-normalizer.js';
export { runVerdict } from './core/runner.js';

export { buildStickyMarker, buildSummaryJson, DEFAULT_MAX_COMMENT_LENGTH, renderVerdictMarkdown } from './reporters/markdown.js';
