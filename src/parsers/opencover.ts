import type { BranchEntry, FileCoverage, FunctionEntry, NormalizedCoverageReport } from '../types/coverage.js';
import { type CoverageParser, parseXml, toArray, toInt } from './parser.js';

/** Parser for OpenCover XML reports (.NET / AltCover / OpenCover). */
export const opencoverParser: CoverageParser = {
  id: 'opencover',

  canParse(_filePath: string, snippet: string): boolean {
    return /<CoverageSession\b/i.test(snippet);
  },

  parse(content: string, sourceFile?: string): NormalizedCoverageReport {
    const doc = parseXml(content);
    const session = doc.CoverageSession as Record<string, unknown> | undefined;
    if (!session) {
      throw new Error('OpenCover XML missing <CoverageSession> root element');
    }

    const files = new Map<string, FileCoverage>();
    const modulesNode = session.Modules as Record<string, unknown> | undefined;
    const modules = toArray(modulesNode?.Module as Record<string, unknown> | Record<string, unknown>[] | undefined);

    for (const mod of modules) {
      const uidToPath = new Map<string, string>();
      const filesNode = mod.Files as Record<string, unknown> | undefined;
      for (const f of toArray(filesNode?.File as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
        const uid = String(f['@_uid'] ?? '');
        const fullPath = String(f['@_fullPath'] ?? '').trim();
        if (uid && fullPath) {
          uidToPath.set(uid, fullPath);
        }
      }

      const ensureFile = (fileId: string): FileCoverage | null => {
        const resolved = uidToPath.get(fileId);
        if (!resolved) return null;
        let entry = files.get(resolved);
        if (!entry) {
          entry = {
            path: resolved,
            lines: new Map<number, number>(),
            branches: null,
            functions: null,
          };
          files.set(resolved, entry);
        }
        return entry;
      };

      const classesNode = mod.Classes as Record<string, unknown> | undefined;
      const classes = toArray(classesNode?.Class as Record<string, unknown> | Record<string, unknown>[] | undefined);

      for (const cls of classes) {
        const methodsNode = cls.Methods as Record<string, unknown> | undefined;
        const methods = toArray(methodsNode?.Method as Record<string, unknown> | Record<string, unknown>[] | undefined);

        for (const method of methods) {
          const methodNameNode = method.Name;
          const methodName =
            typeof methodNameNode === 'string'
              ? methodNameNode
              : String((methodNameNode as Record<string, unknown> | undefined)?.['#text'] ?? 'Method');
          const fileRef = method.FileRef as Record<string, unknown> | undefined;
          const defaultFileId = fileRef ? String(fileRef['@_uid'] ?? '') : '';

          const visited = String(method['@_visited'] ?? '').toLowerCase() === 'true';
          const seqContainer = method.SequencePoints as Record<string, unknown> | undefined;
          const seqPoints = toArray(
            seqContainer?.SequencePoint as Record<string, unknown> | Record<string, unknown>[] | undefined,
          );

          let methodHits = visited ? 1 : 0;
          let firstLine: number | undefined;

          for (const sp of seqPoints) {
            const lineNo = toInt(sp['@_sl'], -1);
            const vc = toInt(sp['@_vc'], 0);
            const fid = String(sp['@_fileid'] ?? defaultFileId);
            const target = ensureFile(fid);
            if (target && lineNo > 0) {
              target.lines.set(lineNo, Math.max(target.lines.get(lineNo) ?? 0, vc));
              if (firstLine === undefined) firstLine = lineNo;
              methodHits = Math.max(methodHits, vc);
            }
          }

          if (defaultFileId) {
            const target = ensureFile(defaultFileId);
            if (target) {
              target.functions = target.functions ?? [];
              target.functions.push({
                name: methodName,
                line: firstLine,
                hits: methodHits,
              });
            }
          }

          const branchContainer = method.BranchPoints as Record<string, unknown> | undefined;
          const branchPoints = toArray(
            branchContainer?.BranchPoint as Record<string, unknown> | Record<string, unknown>[] | undefined,
          );

          const branchesByFileAndLine = new Map<string, Map<number, BranchEntry>>();
          for (const bp of branchPoints) {
            const lineNo = toInt(bp['@_sl'], -1);
            const vc = toInt(bp['@_vc'], 0);
            const fid = String(bp['@_fileid'] ?? defaultFileId);
            if (lineNo <= 0 || !fid) continue;

            let lineMap = branchesByFileAndLine.get(fid);
            if (!lineMap) {
              lineMap = new Map<number, BranchEntry>();
              branchesByFileAndLine.set(fid, lineMap);
            }
            const prev = lineMap.get(lineNo) ?? { line: lineNo, covered: 0, total: 0 };
            prev.total += 1;
            if (vc > 0) prev.covered += 1;
            lineMap.set(lineNo, prev);
          }

          for (const [fid, lineMap] of branchesByFileAndLine.entries()) {
            const target = ensureFile(fid);
            if (!target) continue;
            const merged = new Map<number, BranchEntry>();
            for (const b of target.branches ?? []) merged.set(b.line, { ...b });
            for (const [ln, b] of lineMap.entries()) {
              const prev = merged.get(ln);
              if (prev) {
                prev.covered += b.covered;
                prev.total += b.total;
              } else {
                merged.set(ln, b);
              }
            }
            target.branches = Array.from(merged.values()).sort((a, b) => a.line - b.line);
          }
        }
      }
    }

    return {
      format: 'opencover',
      sourceFile,
      files,
    };
  },
};
