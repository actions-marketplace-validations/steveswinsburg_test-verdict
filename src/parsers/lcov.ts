import type { BranchEntry, FileCoverage, FunctionEntry, NormalizedCoverageReport } from '../types/coverage.js';
import type { CoverageParser } from './parser.js';

interface LcovRecord {
  path: string;
  lines: Map<number, number>;
  branchesByLine: Map<number, { covered: number; total: number }>;
  hasBranchRecords: boolean;
  functionsByName: Map<string, FunctionEntry>;
  hasFunctionRecords: boolean;
}

function createEmptyRecord(filePath: string): LcovRecord {
  return {
    path: filePath,
    lines: new Map<number, number>(),
    branchesByLine: new Map<number, { covered: number; total: number }>(),
    hasBranchRecords: false,
    functionsByName: new Map<string, FunctionEntry>(),
    hasFunctionRecords: false,
  };
}

/** Parser for LCOV `.info` files (JS/TS c8/Istanbul, Rust, Dart/Flutter, C/C++, Ruby, PHP). */
export const lcovParser: CoverageParser = {
  id: 'lcov',

  canParse(filePath: string, snippet: string): boolean {
    const trimmed = snippet.trimStart();
    if (/^(TN:|SF:)/m.test(trimmed) && /^(DA:|LF:|end_of_record)/m.test(trimmed)) {
      return true;
    }
    return filePath.toLowerCase().endsWith('.info') && /^SF:/m.test(trimmed);
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const files = new Map<string, FileCoverage>();
    let current: LcovRecord | null = null;

    const flushRecord = (): void => {
      if (!current || !current.path) return;
      const branches: BranchEntry[] | null = current.hasBranchRecords
        ? Array.from(current.branchesByLine.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([line, b]) => ({ line, covered: b.covered, total: b.total }))
        : null;

      const functions: FunctionEntry[] | null = current.hasFunctionRecords
        ? Array.from(current.functionsByName.values())
        : null;

      files.set(current.path, {
        path: current.path,
        lines: current.lines,
        branches,
        functions,
      });
      current = null;
    };

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('SF:')) {
        if (current) flushRecord();
        current = createEmptyRecord(line.slice(3).trim());
        continue;
      }

      if (!current) continue;

      if (line === 'end_of_record') {
        flushRecord();
        continue;
      }

      if (line.startsWith('DA:')) {
        const parts = line.slice(3).split(',');
        const lineNo = Number.parseInt(parts[0] ?? '', 10);
        const hits = Number.parseInt(parts[1] ?? '', 10);
        if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
          current.lines.set(lineNo, (current.lines.get(lineNo) ?? 0) + hits);
        }
      } else if (line.startsWith('BRDA:')) {
        current.hasBranchRecords = true;
        const parts = line.slice(5).split(',');
        const lineNo = Number.parseInt(parts[0] ?? '', 10);
        const takenRaw = parts[3] ?? '-';
        if (Number.isFinite(lineNo)) {
          const entry = current.branchesByLine.get(lineNo) ?? { covered: 0, total: 0 };
          entry.total += 1;
          const taken = takenRaw === '-' ? 0 : Number.parseInt(takenRaw, 10);
          if (Number.isFinite(taken) && taken > 0) {
            entry.covered += 1;
          }
          current.branchesByLine.set(lineNo, entry);
        }
      } else if (line.startsWith('BRF:')) {
        const brf = Number.parseInt(line.slice(4), 10);
        if (Number.isFinite(brf) && brf > 0) {
          current.hasBranchRecords = true;
        }
      } else if (line.startsWith('FN:')) {
        current.hasFunctionRecords = true;
        const rest = line.slice(3);
        const commaIdx = rest.indexOf(',');
        if (commaIdx !== -1) {
          const fnLine = Number.parseInt(rest.slice(0, commaIdx), 10);
          const name = rest.slice(commaIdx + 1);
          const existing = current.functionsByName.get(name);
          current.functionsByName.set(name, {
            name,
            line: Number.isFinite(fnLine) ? fnLine : existing?.line,
            hits: existing?.hits ?? 0,
          });
        }
      } else if (line.startsWith('FNDA:')) {
        current.hasFunctionRecords = true;
        const rest = line.slice(5);
        const commaIdx = rest.indexOf(',');
        if (commaIdx !== -1) {
          const hits = Number.parseInt(rest.slice(0, commaIdx), 10);
          const name = rest.slice(commaIdx + 1);
          const existing = current.functionsByName.get(name);
          current.functionsByName.set(name, {
            name,
            line: existing?.line,
            hits: (existing?.hits ?? 0) + (Number.isFinite(hits) ? hits : 0),
          });
        }
      }
    }

    flushRecord();

    return {
      format: 'lcov',
      sourceFile,
      files,
    };
  },
};
