import picomatch from 'picomatch';
import type { FileCoverage } from '../types/coverage.js';
import type { ChangedFileLines, DiffCoverageResult, FileDiffCoverage } from '../types/diff.js';
import { computePct } from './metrics.js';

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Parse a single file's git patch (from Octokit pulls.listFiles) into added/modified line numbers. */
export function parseGitHubFilePatch(patch: string): Set<number> {
  const changed = new Set<number>();
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split(/\r?\n/)) {
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      newLine = Number.parseInt(hunkMatch[1]!, 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      changed.add(newLine);
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Deleted line does not advance new file line number
    } else if (!line.startsWith('\\')) {
      newLine += 1;
    }
  }

  return changed;
}

/** Parse a multi-file unified diff (`git diff --unified=0`) into changed lines per file. */
export function parseUnifiedDiff(diffText: string): ChangedFileLines {
  const result: ChangedFileLines = new Map();
  let currentFile: string | null = null;
  let newLine = 0;
  let inHunk = false;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      currentFile = null;
      inHunk = false;
      continue;
    }

    if (line.startsWith('+++ ')) {
      const rawTarget = line.slice(4).trim();
      if (rawTarget === '/dev/null') {
        currentFile = null;
      } else {
        currentFile = rawTarget.startsWith('b/') ? rawTarget.slice(2) : rawTarget;
        if (!result.has(currentFile)) {
          result.set(currentFile, new Set<number>());
        }
      }
      inHunk = false;
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch && currentFile) {
      newLine = Number.parseInt(hunkMatch[1]!, 10);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      result.get(currentFile)!.add(newLine);
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Deletion in old file
    } else if (!line.startsWith('\\')) {
      newLine += 1;
    }
  }

  return result;
}

export interface ComputeDiffCoverageOptions {
  include?: string[];
  exclude?: string[];
}

/** Compute coverage for PR changed lines and branches on changed lines. */
export function computeDiffCoverage(
  files: Map<string, FileCoverage>,
  changedLinesMap: ChangedFileLines,
  options?: ComputeDiffCoverageOptions,
): DiffCoverageResult {
  const isIncluded = options?.include?.length ? picomatch(options.include, { dot: true }) : null;
  const isExcluded = options?.exclude?.length ? picomatch(options.exclude, { dot: true }) : null;
  const fileResults: FileDiffCoverage[] = [];
  let totalCoverable = 0;
  let totalCovered = 0;
  let totalBranchCovered = 0;
  let totalBranchCount = 0;

  const sortedChangedPaths = Array.from(changedLinesMap.keys()).sort();

  for (const filePath of sortedChangedPaths) {
    if (isExcluded?.(filePath)) continue;
    if (isIncluded && !isIncluded(filePath)) continue;

    const changedSet = changedLinesMap.get(filePath);
    if (!changedSet || changedSet.size === 0) continue;

    const coverage = files.get(filePath);
    let coverableLines = 0;
    let coveredLines = 0;
    const uncoveredLines: number[] = [];
    let branchCovered = 0;
    let branchTotal = 0;
    let unmeasured = false;

    if (coverage) {
      const sortedLines = Array.from(changedSet).sort((a, b) => a - b);
      for (const ln of sortedLines) {
        const hits = coverage.lines.get(ln);
        if (hits === undefined) continue;
        coverableLines += 1;
        if (hits > 0) {
          coveredLines += 1;
        } else {
          uncoveredLines.push(ln);
        }
      }

      if (coverage.branches) {
        for (const b of coverage.branches) {
          if (changedSet.has(b.line)) {
            branchCovered += b.covered;
            branchTotal += b.total;
          }
        }
      }
    } else {
      unmeasured = true;
      if (isIncluded) {
        coverableLines = changedSet.size;
        uncoveredLines.push(...Array.from(changedSet).sort((a, b) => a - b));
      }
    }

    totalCoverable += coverableLines;
    totalCovered += coveredLines;
    totalBranchCovered += branchCovered;
    totalBranchCount += branchTotal;

    fileResults.push({
      path: filePath,
      changedLines: changedSet.size,
      coverableLines,
      coveredLines,
      uncoveredLines,
      pct: coverableLines > 0 ? computePct(coveredLines, coverableLines) : null,
      branchCovered,
      branchTotal,
      branchPct: branchTotal > 0 ? computePct(branchCovered, branchTotal) : null,
      ...(unmeasured ? { unmeasured: true } : {}),
    });
  }

  return {
    files: fileResults,
    coverableLines: totalCoverable,
    coveredLines: totalCovered,
    pct: totalCoverable > 0 ? computePct(totalCovered, totalCoverable) : null,
    branchCovered: totalBranchCovered,
    branchTotal: totalBranchCount,
    branchPct: totalBranchCount > 0 ? computePct(totalBranchCovered, totalBranchCount) : null,
  };
}
