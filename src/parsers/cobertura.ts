import type { BranchEntry, FileCoverage, FunctionEntry, NormalizedCoverageReport } from '../types/coverage.js';
import { type CoverageParser, parseXml, toArray, toInt } from './parser.js';

function joinSourceAndFilename(sources: string[], filename: string): string {
  const cleanFile = filename.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^([a-zA-Z]:\/|\/)/.test(cleanFile) || sources.length === 0) {
    return cleanFile;
  }
  const source = sources[0]?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '';
  if (!source || source === '.') {
    return cleanFile;
  }
  return `${source}/${cleanFile}`;
}

function parseConditionCoverage(raw: unknown): { covered: number; total: number } | null {
  if (typeof raw !== 'string') return null;
  const match = /\((\d+)\s*\/\s*(\d+)\)/.exec(raw);
  if (!match) return null;
  const covered = Number.parseInt(match[1] ?? '0', 10);
  const total = Number.parseInt(match[2] ?? '0', 10);
  if (!Number.isFinite(covered) || !Number.isFinite(total) || total <= 0) return null;
  return { covered, total };
}

/** Parser for Cobertura XML reports (Python coverage.py, .NET coverlet, Go, JS, Ruby). */
export const coberturaParser: CoverageParser = {
  id: 'cobertura',

  canParse(_filePath: string, snippet: string): boolean {
    return /<coverage\b/i.test(snippet) && (/<packages\b/i.test(snippet) || /line-rate=/i.test(snippet) || /cobertura/i.test(snippet));
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const doc = parseXml(content);
    const coverage = doc.coverage as Record<string, unknown> | undefined;
    if (!coverage) {
      throw new Error('Cobertura XML missing <coverage> root element');
    }

    const sourcesNode = coverage.sources as Record<string, unknown> | undefined;
    const sources = toArray(sourcesNode?.source as string | string[] | undefined)
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);

    const files = new Map<string, FileCoverage>();
    const packagesNode = coverage.packages as Record<string, unknown> | undefined;
    const packages = toArray(packagesNode?.package as Record<string, unknown> | Record<string, unknown>[] | undefined);

    for (const pkg of packages) {
      const classesNode = pkg.classes as Record<string, unknown> | undefined;
      const classes = toArray(classesNode?.class as Record<string, unknown> | Record<string, unknown>[] | undefined);

      for (const cls of classes) {
        const filename = String(cls['@_filename'] ?? '').trim();
        if (!filename) continue;

        const filePath = joinSourceAndFilename(sources, filename);
        const existing = files.get(filePath) ?? {
          path: filePath,
          lines: new Map<number, number>(),
          branches: null as BranchEntry[] | null,
          functions: null as FunctionEntry[] | null,
        };

        const branchMap = new Map<number, BranchEntry>();
        for (const b of existing.branches ?? []) {
          branchMap.set(b.line, b);
        }

        const collectLines = (linesContainer: unknown): number[] => {
          const hitsList: number[] = [];
          const container = linesContainer as Record<string, unknown> | undefined;
          const lineNodes = toArray(container?.line as Record<string, unknown> | Record<string, unknown>[] | undefined);
          for (const lineNode of lineNodes) {
            const lineNo = toInt(lineNode['@_number'], -1);
            if (lineNo <= 0) continue;
            const hits = toInt(lineNode['@_hits'], 0);
            hitsList.push(hits);
            existing.lines.set(lineNo, Math.max(existing.lines.get(lineNo) ?? 0, hits));

            const isBranch = String(lineNode['@_branch'] ?? '').toLowerCase() === 'true';
            if (isBranch) {
              const cond = parseConditionCoverage(lineNode['@_condition-coverage']);
              if (cond) {
                branchMap.set(lineNo, { line: lineNo, covered: cond.covered, total: cond.total });
              }
            }
          }
          return hitsList;
        };

        collectLines(cls.lines);

        const methodsNode = cls.methods as Record<string, unknown> | undefined;
        const methods = toArray(methodsNode?.method as Record<string, unknown> | Record<string, unknown>[] | undefined);
        if (methods.length > 0) {
          const fnList = existing.functions ?? [];
          for (const m of methods) {
            const name = String(m['@_name'] ?? 'anonymous');
            const methodLineHits = collectLines(m.lines);
            const explicitHits = m['@_hits'] !== undefined ? toInt(m['@_hits'], 0) : undefined;
            const lineRate = m['@_line-rate'] !== undefined ? Number.parseFloat(String(m['@_line-rate'])) : undefined;
            let hits = explicitHits ?? 0;
            if (explicitHits === undefined) {
              if (methodLineHits.length > 0) {
                hits = Math.max(...methodLineHits);
              } else if (lineRate !== undefined && Number.isFinite(lineRate)) {
                hits = lineRate > 0 ? 1 : 0;
              }
            }
            fnList.push({ name, hits });
          }
          existing.functions = fnList;
        }

        if (branchMap.size > 0) {
          existing.branches = Array.from(branchMap.values()).sort((a, b) => a.line - b.line);
        }

        files.set(filePath, existing);
      }
    }

    return {
      format: 'cobertura',
      sourceFile,
      files,
    };
  },
};
