import type { FileCoverage, NormalizedCoverageReport } from '../types/coverage.js';
import type { CoverageParser } from './parser.js';

const MODE_LINE_RE = /^mode:\s*(set|count|atomic)\b/;
const BLOCK_LINE_RE = /^(.+):(\d+)\.\d+,(\d+)\.\d+\s+(\d+)\s+(\d+)$/;

/** Parser for Go native `coverprofile` output (`go test -coverprofile=coverage.out`). */
export const gocoverParser: CoverageParser = {
  id: 'gocover',

  canParse(_filePath: string, snippet: string): boolean {
    const firstLine = snippet.trimStart().split(/\r?\n/, 1)[0] ?? '';
    return MODE_LINE_RE.test(firstLine.trim());
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const files = new Map<string, FileCoverage>();
    const rawLines = content.split(/\r?\n/);

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line || MODE_LINE_RE.test(line)) continue;

      const match = BLOCK_LINE_RE.exec(line);
      if (!match) continue;

      const filePath = match[1]!;
      const startLine = Number.parseInt(match[2]!, 10);
      const endLine = Number.parseInt(match[3]!, 10);
      const numStmt = Number.parseInt(match[4]!, 10);
      const count = Number.parseInt(match[5]!, 10);

      if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || numStmt <= 0) {
        continue;
      }

      const fileEntry = files.get(filePath) ?? {
        path: filePath,
        lines: new Map<number, number>(),
        branches: null,
        functions: null,
      };

      const from = Math.min(startLine, endLine);
      const to = Math.max(startLine, endLine);
      for (let ln = from; ln <= to; ln += 1) {
        const prev = fileEntry.lines.get(ln) ?? 0;
        fileEntry.lines.set(ln, Math.max(prev, count));
      }

      files.set(filePath, fileEntry);
    }

    return {
      format: 'gocover',
      sourceFile,
      files,
    };
  },
};
