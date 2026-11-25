import type { BranchEntry, FileCoverage, FunctionEntry, NormalizedCoverageReport } from '../types/coverage.js';

function cloneFileCoverage(file: FileCoverage, targetPath = file.path): FileCoverage {
  return {
    path: targetPath,
    lines: new Map(file.lines),
    branches: file.branches ? file.branches.map((b) => ({ ...b })) : null,
    functions: file.functions ? file.functions.map((f) => ({ ...f })) : null,
    summaryOverride: file.summaryOverride
      ? {
          lines: file.summaryOverride.lines ? { ...file.summaryOverride.lines } : undefined,
          branches: file.summaryOverride.branches ? { ...file.summaryOverride.branches } : undefined,
          functions: file.summaryOverride.functions ? { ...file.summaryOverride.functions } : undefined,
        }
      : undefined,
  };
}

/** Merge incoming FileCoverage into target FileCoverage in place. */
export function mergeFileCoverage(target: FileCoverage, incoming: FileCoverage): FileCoverage {
  for (const [lineNo, hits] of incoming.lines.entries()) {
    target.lines.set(lineNo, (target.lines.get(lineNo) ?? 0) + hits);
  }

  if (incoming.branches) {
    const byLine = new Map<number, BranchEntry>();
    for (const b of target.branches ?? []) {
      byLine.set(b.line, { ...b });
    }
    for (const b of incoming.branches) {
      const prev = byLine.get(b.line);
      if (prev) {
        prev.covered = Math.max(prev.covered, b.covered);
        prev.total = Math.max(prev.total, b.total);
      } else {
        byLine.set(b.line, { ...b });
      }
    }
    target.branches = Array.from(byLine.values()).sort((a, b) => a.line - b.line);
  }

  if (incoming.functions) {
    const byKey = new Map<string, FunctionEntry>();
    for (const f of target.functions ?? []) {
      byKey.set(`${f.name}:${f.line ?? ''}`, { ...f });
    }
    for (const f of incoming.functions) {
      const key = `${f.name}:${f.line ?? ''}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.hits += f.hits;
      } else {
        byKey.set(key, { ...f });
      }
    }
    target.functions = Array.from(byKey.values());
  }

  if (incoming.summaryOverride) {
    target.summaryOverride = {
      lines: target.summaryOverride?.lines ?? incoming.summaryOverride.lines,
      branches: target.summaryOverride?.branches ?? incoming.summaryOverride.branches,
      functions: target.summaryOverride?.functions ?? incoming.summaryOverride.functions,
    };
  }

  return target;
}

/** Merge multiple normalized reports into a single file map, normalizing paths if provided. */
export function mergeReports(
  reports: NormalizedCoverageReport[],
  normalizePath: (rawPath: string) => string = (p) => p,
): Map<string, FileCoverage> {
  const merged = new Map<string, FileCoverage>();

  for (const report of reports) {
    for (const file of report.files.values()) {
      const normPath = normalizePath(file.path);
      const existing = merged.get(normPath);
      if (existing) {
        mergeFileCoverage(existing, { ...file, path: normPath });
      } else {
        merged.set(normPath, cloneFileCoverage(file, normPath));
      }
    }
  }

  return merged;
}

/** Merge multiple already-normalized file coverage maps into one. */
export function mergeFileMaps(maps: Iterable<Map<string, FileCoverage>>): Map<string, FileCoverage> {
  const merged = new Map<string, FileCoverage>();
  for (const fileMap of maps) {
    for (const [filePath, file] of fileMap.entries()) {
      const existing = merged.get(filePath);
      if (existing) {
        mergeFileCoverage(existing, file);
      } else {
        merged.set(filePath, cloneFileCoverage(file, filePath));
      }
    }
  }
  return merged;
}
