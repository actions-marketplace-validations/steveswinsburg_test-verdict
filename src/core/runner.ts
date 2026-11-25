import { readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import picomatch from 'picomatch';
import { createDefaultParserRegistry, type ParserRegistry } from '../parsers/registry.js';
import type { GroupConfig, RunOptions, ThresholdConfig } from '../types/config.js';
import type { FileCoverage, FormatId, NormalizedCoverageReport } from '../types/coverage.js';
import type { ChangedFileLines } from '../types/diff.js';
import type { EvaluationWarning, GroupVerdict, VerdictResult } from '../types/evaluation.js';
import { loadConfigFile } from './config-loader.js';
import { computeDiffCoverage } from './diff.js';
import { evaluateGroup } from './evaluator.js';
import { mergeFileMaps, mergeReports } from './merger.js';
import { createPathNormalizer, getRepoFiles } from './path-normalizer.js';

function mergeThresholds(base?: ThresholdConfig, override?: ThresholdConfig): ThresholdConfig {
  return {
    minLine: override?.minLine ?? base?.minLine,
    minBranch: override?.minBranch ?? base?.minBranch,
    minFunction: override?.minFunction ?? base?.minFunction,
    minDiffLine: override?.minDiffLine ?? base?.minDiffLine,
    minDiffBranch: override?.minDiffBranch ?? base?.minDiffBranch,
  };
}

function filterExcludedFiles(files: Map<string, FileCoverage>, excludePatterns: string[]): Map<string, FileCoverage> {
  if (excludePatterns.length === 0) return files;
  const isExcluded = picomatch(excludePatterns, { dot: true });
  const filtered = new Map<string, FileCoverage>();
  for (const [filePath, fileCov] of files.entries()) {
    if (!isExcluded(filePath)) {
      filtered.set(filePath, fileCov);
    }
  }
  return filtered;
}

function normalizeChangedLines(
  changedLines: ChangedFileLines | undefined,
  normalizePath: (p: string) => string,
): ChangedFileLines | undefined {
  if (!changedLines) return undefined;
  const normalized: ChangedFileLines = new Map();
  for (const [rawPath, lineSet] of changedLines.entries()) {
    const norm = normalizePath(rawPath);
    const existing = normalized.get(norm);
    if (existing) {
      for (const ln of lineSet) existing.add(ln);
    } else {
      normalized.set(norm, new Set(lineSet));
    }
  }
  return normalized;
}

async function processGroup(
  group: GroupConfig,
  workingDir: string,
  normalizePath: (p: string) => string,
  changedLines: ChangedFileLines | undefined,
  registry: ParserRegistry,
  enforce: boolean,
  failOnEmpty: boolean,
): Promise<GroupVerdict> {
  const matchedFiles = await fg(group.files, {
    cwd: workingDir,
    onlyFiles: true,
    unique: true,
    dot: true,
  });
  matchedFiles.sort();

  const warnings: EvaluationWarning[] = [];
  if (matchedFiles.length === 0) {
    const msg = `No coverage report files matched pattern(s) [${group.files.join(', ')}] for "${group.name}".`;
    if (failOnEmpty && enforce) {
      throw new Error(msg);
    }
    warnings.push({
      group: group.name,
      code: 'EMPTY_REPORTS',
      message: msg,
    });
  }

  const reports: NormalizedCoverageReport[] = [];
  const formatSet = new Set<FormatId>();

  for (const relReportPath of matchedFiles) {
    const absPath = path.resolve(workingDir, relReportPath);
    const content = readFileSync(absPath, 'utf8');
    const report = registry.parse(content, relReportPath, group.format ?? 'auto');
    reports.push(report);
    formatSet.add(report.format);
  }

  const merged = mergeReports(reports, normalizePath);
  const filteredFiles = filterExcludedFiles(merged, group.exclude ?? []);
  const diffCoverage = changedLines ? computeDiffCoverage(filteredFiles, changedLines) : null;

  const verdict = evaluateGroup({
    name: group.name,
    matchedFiles,
    formats: Array.from(formatSet),
    files: filteredFiles,
    diffCoverage,
    thresholds: group.thresholds ?? {},
  });

  verdict.warnings = [...warnings, ...verdict.warnings];
  return verdict;
}

/** Run the complete coverage parsing, normalization, merging, diffing, and threshold evaluation pipeline. */
export async function runVerdict(
  options: RunOptions,
  registry: ParserRegistry = createDefaultParserRegistry(),
): Promise<VerdictResult> {
  const workingDir = path.resolve(options.workingDirectory || '.');
  const isExplicitConfig = options.configPath !== undefined && options.configPath !== '.test-verdict.yml';
  const fileConfig = loadConfigFile(workingDir, options.configPath ?? '.test-verdict.yml', isExplicitConfig);

  const title = options.title ?? fileConfig.title ?? 'Test Verdict';
  const reportId = options.reportId ?? fileConfig.reportId ?? 'default';
  const enforce = options.enforce ?? fileConfig.enforce ?? true;
  const failOnEmpty = options.failOnEmpty ?? fileConfig.failOnEmpty ?? true;
  const globalFormat = options.format ?? fileConfig.format ?? 'auto';
  const globalExclude = options.exclude?.length ? options.exclude : (fileConfig.exclude ?? []);
  const globalThresholds = mergeThresholds(fileConfig.thresholds, options.thresholds);

  const repoFiles = options.repoFiles ?? getRepoFiles(workingDir);
  const normalizePath = createPathNormalizer(repoFiles, workingDir);
  const normalizedChanged = normalizeChangedLines(options.changedLines, normalizePath);

  if (fileConfig.groups && fileConfig.groups.length > 0) {
    const groupVerdicts: GroupVerdict[] = [];
    for (const grp of fileConfig.groups) {
      const resolvedGroup: GroupConfig = {
        name: grp.name,
        files: grp.files,
        exclude: [...globalExclude, ...(grp.exclude ?? [])],
        format: grp.format ?? globalFormat,
        thresholds: mergeThresholds(globalThresholds, grp.thresholds),
      };
      groupVerdicts.push(
        await processGroup(resolvedGroup, workingDir, normalizePath, normalizedChanged, registry, enforce, failOnEmpty),
      );
    }

    const allFiles = mergeFileMaps(groupVerdicts.map((g) => g.files));
    const allMatched = Array.from(new Set(groupVerdicts.flatMap((g) => g.matchedFiles))).sort();
    const allFormats = Array.from(new Set(groupVerdicts.flatMap((g) => g.formats)));
    const overallDiff = normalizedChanged ? computeDiffCoverage(allFiles, normalizedChanged) : null;

    const overall = evaluateGroup({
      name: 'Overall',
      matchedFiles: allMatched,
      formats: allFormats,
      files: allFiles,
      diffCoverage: overallDiff,
      thresholds: globalThresholds,
    });

    const allViolations = [
      ...groupVerdicts.flatMap((g) => g.violations),
      ...overall.violations,
    ];
    const allWarnings = [
      ...groupVerdicts.flatMap((g) => g.warnings),
      ...overall.warnings,
    ];
    const passed = groupVerdicts.every((g) => g.passed) && overall.passed;
    overall.passed = passed;

    return {
      title,
      reportId,
      enforce,
      passed,
      overall,
      groups: groupVerdicts,
      violations: allViolations,
      warnings: allWarnings,
    };
  }

  const files = options.files?.length ? options.files : (fileConfig.files ?? []);
  if (files.length === 0) {
    throw new Error('No coverage file patterns provided. Pass `files` input/flag or configure `.test-verdict.yml`.');
  }

  const singleVerdict = await processGroup(
    {
      name: 'Overall',
      files,
      exclude: globalExclude,
      format: globalFormat,
      thresholds: globalThresholds,
    },
    workingDir,
    normalizePath,
    normalizedChanged,
    registry,
    enforce,
    failOnEmpty,
  );

  return {
    title,
    reportId,
    enforce,
    passed: singleVerdict.passed,
    overall: singleVerdict,
    groups: [],
    violations: singleVerdict.violations,
    warnings: singleVerdict.warnings,
  };
}
