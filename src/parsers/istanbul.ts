import type { BranchEntry, FileCoverage, FunctionEntry, MetricSummary, NormalizedCoverageReport } from '../types/coverage.js';
import type { CoverageParser } from './parser.js';

interface IstanbulStatementLoc {
  start?: { line?: number };
}

interface IstanbulBranchLoc {
  line?: number;
  loc?: { start?: { line?: number } };
}

interface IstanbulFnLoc {
  name?: string;
  line?: number;
  decl?: { start?: { line?: number } };
}

interface IstanbulFinalEntry {
  path?: string;
  statementMap?: Record<string, IstanbulStatementLoc>;
  s?: Record<string, number>;
  branchMap?: Record<string, IstanbulBranchLoc>;
  b?: Record<string, number[]>;
  fnMap?: Record<string, IstanbulFnLoc>;
  f?: Record<string, number>;
}

interface IstanbulSummaryMetric {
  total?: number;
  covered?: number;
  pct?: number | 'Unknown';
}

interface IstanbulSummaryEntry {
  lines?: IstanbulSummaryMetric;
  branches?: IstanbulSummaryMetric;
  functions?: IstanbulSummaryMetric;
}

function isFinalEntry(value: unknown): value is IstanbulFinalEntry {
  return Boolean(value && typeof value === 'object' && 'statementMap' in value && 's' in value);
}

function isSummaryEntry(value: unknown): value is IstanbulSummaryEntry {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'lines' in value &&
      typeof (value as IstanbulSummaryEntry).lines?.total === 'number',
  );
}

function toMetricSummary(metric: IstanbulSummaryMetric | undefined): MetricSummary {
  if (!metric || typeof metric.total !== 'number' || typeof metric.covered !== 'number') {
    return null;
  }
  const pct =
    typeof metric.pct === 'number'
      ? metric.pct
      : metric.total === 0
        ? 100
        : Number(((metric.covered / metric.total) * 100).toFixed(2));
  return { covered: metric.covered, total: metric.total, pct };
}

/** Parser for Istanbul / Jest / Vitest JSON reports (coverage-final.json and coverage-summary.json). */
export const istanbulParser: CoverageParser = {
  id: 'istanbul',

  canParse(filePath: string, snippet: string): boolean {
    const trimmed = snippet.trimStart();
    if (!trimmed.startsWith('{')) return false;
    if (/"statementMap"\s*:/.test(snippet) && /"s"\s*:/.test(snippet)) return true;
    if (/"total"\s*:/.test(snippet) && /"lines"\s*:/.test(snippet) && /"pct"\s*:/.test(snippet)) return true;
    return filePath.toLowerCase().endsWith('.json') && /"(statementMap|lines)"\s*:/.test(snippet);
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Istanbul JSON root must be an object');
    }

    const record = parsed as Record<string, unknown>;
    const files = new Map<string, FileCoverage>();

    for (const [key, entry] of Object.entries(record)) {
      if (isFinalEntry(entry)) {
        const filePath = entry.path ?? key;
        const lines = new Map<number, number>();
        const statementMap = entry.statementMap ?? {};
        const s = entry.s ?? {};

        for (const [stmtId, loc] of Object.entries(statementMap)) {
          const lineNo = loc.start?.line;
          if (typeof lineNo === 'number' && lineNo > 0) {
            const hits = s[stmtId] ?? 0;
            lines.set(lineNo, Math.max(lines.get(lineNo) ?? 0, hits));
          }
        }

        const branchMap = entry.branchMap ?? {};
        const b = entry.b ?? {};
        const branchesByLine = new Map<number, BranchEntry>();
        for (const [branchId, loc] of Object.entries(branchMap)) {
          const lineNo = loc.line ?? loc.loc?.start?.line ?? 0;
          const counts = b[branchId] ?? [];
          if (lineNo > 0 && counts.length > 0) {
            const prev = branchesByLine.get(lineNo) ?? { line: lineNo, covered: 0, total: 0 };
            prev.total += counts.length;
            prev.covered += counts.filter((c) => c > 0).length;
            branchesByLine.set(lineNo, prev);
          }
        }

        const fnMap = entry.fnMap ?? {};
        const f = entry.f ?? {};
        const functions: FunctionEntry[] = [];
        for (const [fnId, fnLoc] of Object.entries(fnMap)) {
          functions.push({
            name: fnLoc.name || `fn_${fnId}`,
            line: fnLoc.line ?? fnLoc.decl?.start?.line,
            hits: f[fnId] ?? 0,
          });
        }

        files.set(filePath, {
          path: filePath,
          lines,
          branches: branchesByLine.size > 0 ? Array.from(branchesByLine.values()).sort((a, b) => a.line - b.line) : null,
          functions: functions.length > 0 ? functions : null,
        });
      } else if (key !== 'total' && isSummaryEntry(entry)) {
        files.set(key, {
          path: key,
          lines: new Map<number, number>(),
          branches: null,
          functions: null,
          summaryOverride: {
            lines: toMetricSummary(entry.lines),
            branches: toMetricSummary(entry.branches),
            functions: toMetricSummary(entry.functions),
          },
        });
      }
    }

    return {
      format: 'istanbul',
      sourceFile,
      files,
    };
  },
};
