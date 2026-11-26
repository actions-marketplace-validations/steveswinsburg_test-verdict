import { trimSlashes } from '../core/path-normalizer.js';
import type { BranchEntry, FileCoverage, FunctionEntry, NormalizedCoverageReport } from '../types/coverage.js';
import { type CoverageParser, parseXml, toArray, toInt } from './parser.js';

/** Parser for JaCoCo XML reports (Java, Kotlin, Scala, Groovy via Maven or Gradle). */
export const jacocoParser: CoverageParser = {
  id: 'jacoco',

  canParse(_filePath: string, snippet: string): boolean {
    return /<report\b/i.test(snippet) && (/<package\b/i.test(snippet) || /<counter\b/i.test(snippet) || /JACOCO/i.test(snippet));
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const doc = parseXml(content);
    const report = doc.report as Record<string, unknown> | undefined;
    if (!report) {
      throw new Error('JaCoCo XML missing <report> root element');
    }

    const files = new Map<string, FileCoverage>();

    const collectPackages = (container: Record<string, unknown>): Record<string, unknown>[] => {
      const direct = toArray(container.package as Record<string, unknown> | Record<string, unknown>[] | undefined);
      const groups = toArray(container.group as Record<string, unknown> | Record<string, unknown>[] | undefined);
      const nested = groups.flatMap((g) => collectPackages(g));
      return [...direct, ...nested];
    };

    for (const pkg of collectPackages(report)) {
      const pkgName = trimSlashes(String(pkg['@_name'] ?? '').replace(/\\/g, '/'));

      // Collect method-level functions grouped by sourcefilename when <class> nodes exist
      const functionsBySource = new Map<string, FunctionEntry[]>();
      const classes = toArray(pkg.class as Record<string, unknown> | Record<string, unknown>[] | undefined);
      for (const cls of classes) {
        const sfName = String(cls['@_sourcefilename'] ?? '').trim();
        if (!sfName) continue;
        const methods = toArray(cls.method as Record<string, unknown> | Record<string, unknown>[] | undefined);
        for (const m of methods) {
          const methodName = `${String(cls['@_name'] ?? '')}.${String(m['@_name'] ?? '')}`;
          const line = m['@_line'] !== undefined ? toInt(m['@_line'], -1) : undefined;
          const counters = toArray(m.counter as Record<string, unknown> | Record<string, unknown>[] | undefined);
          const methodCounter = counters.find((c) => c['@_type'] === 'METHOD') ?? counters.find((c) => c['@_type'] === 'LINE');
          const covered = methodCounter ? toInt(methodCounter['@_covered'], 0) : 0;
          const list = functionsBySource.get(sfName) ?? [];
          list.push({
            name: methodName,
            line: line !== undefined && line > 0 ? line : undefined,
            hits: covered > 0 ? covered : 0,
          });
          functionsBySource.set(sfName, list);
        }
      }

      const sourceFiles = toArray(pkg.sourcefile as Record<string, unknown> | Record<string, unknown>[] | undefined);
      for (const sf of sourceFiles) {
        const sfName = String(sf['@_name'] ?? '').trim();
        if (!sfName) continue;

        const filePath = pkgName ? `${pkgName}/${sfName}` : sfName;
        const lines = new Map<number, number>();
        const branches: BranchEntry[] = [];

        const lineNodes = toArray(sf.line as Record<string, unknown> | Record<string, unknown>[] | undefined);
        for (const ln of lineNodes) {
          const lineNo = toInt(ln['@_nr'], -1);
          if (lineNo <= 0) continue;
          const mi = toInt(ln['@_mi'], 0);
          const ci = toInt(ln['@_ci'], 0);
          const mb = toInt(ln['@_mb'], 0);
          const cb = toInt(ln['@_cb'], 0);

          if (ci + mi > 0) {
            lines.set(lineNo, ci > 0 ? ci : 0);
          }
          if (cb + mb > 0) {
            branches.push({
              line: lineNo,
              covered: cb,
              total: cb + mb,
            });
          }
        }

        let functions: FunctionEntry[] | null = functionsBySource.get(sfName) ?? null;
        let summaryOverride: FileCoverage['summaryOverride'];

        if (!functions) {
          const counters = toArray(sf.counter as Record<string, unknown> | Record<string, unknown>[] | undefined);
          const methodCounter = counters.find((c) => c['@_type'] === 'METHOD');
          if (methodCounter) {
            const missed = toInt(methodCounter['@_missed'], 0);
            const covered = toInt(methodCounter['@_covered'], 0);
            const total = missed + covered;
            if (total > 0) {
              summaryOverride = {
                functions: {
                  covered,
                  total,
                  pct: Number(((covered / total) * 100).toFixed(2)),
                },
              };
            }
          }
        }

        files.set(filePath, {
          path: filePath,
          lines,
          branches: branches.length > 0 ? branches : null,
          functions,
          summaryOverride,
        });
      }
    }

    return {
      format: 'jacoco',
      sourceFile,
      files,
    };
  },
};
