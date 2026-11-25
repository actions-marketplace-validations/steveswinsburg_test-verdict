import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeFile } from '../../src/core/metrics.js';
import { createDefaultParserRegistry } from '../../src/parsers/registry.js';

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');
const readFixture = (name: string): string => readFileSync(path.join(fixturesDir, name), 'utf8');

describe('format parsers & registry', () => {
  const registry = createDefaultParserRegistry();

  it('auto-detects and parses LCOV with lines, branches, and functions', () => {
    const report = registry.parse(readFixture('sample.lcov.info'), 'sample.lcov.info');
    expect(report.format).toBe('lcov');
    expect(report.files.size).toBe(2);

    const math = report.files.get('src/math.ts')!;
    const summary = summarizeFile(math);
    expect(summary.lines).toEqual({ covered: 4, total: 5, pct: 80 });
    expect(summary.branches).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(summary.functions).toEqual({ covered: 1, total: 2, pct: 50 });

    const strings = report.files.get('src/strings.ts')!;
    const stringsSummary = summarizeFile(strings);
    expect(stringsSummary.branches).toBeNull();
    expect(stringsSummary.functions).toBeNull();
  });

  it('auto-detects and parses Cobertura XML including single-element nodes', () => {
    const report = registry.parse(readFixture('sample.cobertura.xml'), 'cobertura.xml');
    expect(report.format).toBe('cobertura');
    const calc = report.files.get('src/calculator.py')!;
    const summary = summarizeFile(calc);
    expect(summary.lines).toEqual({ covered: 3, total: 4, pct: 75 });
    expect(summary.branches).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(summary.functions).toEqual({ covered: 2, total: 2, pct: 100 });
  });

  it('auto-detects and parses JaCoCo XML including method counters fallback', () => {
    const report = registry.parse(readFixture('sample.jacoco.xml'), 'jacocoTestReport.xml');
    expect(report.format).toBe('jacoco');
    const orderService = report.files.get('com/acme/service/OrderService.java')!;
    const summary = summarizeFile(orderService);
    expect(summary.lines).toEqual({ covered: 2, total: 3, pct: 66.67 });
    expect(summary.branches).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(summary.functions).toEqual({ covered: 1, total: 2, pct: 50 });
  });

  it('parses JaCoCo sourcefile counter fallback when class nodes are absent', () => {
    const xml = `<report name="x"><package name="p"><sourcefile name="Foo.java"><line nr="1" mi="0" ci="2" mb="0" cb="0"/><counter type="METHOD" missed="1" covered="3"/></sourcefile></package></report>`;
    const report = registry.parse(xml, 'jacoco.xml');
    const foo = report.files.get('p/Foo.java')!;
    expect(summarizeFile(foo).functions).toEqual({ covered: 3, total: 4, pct: 75 });
  });

  it('auto-detects and parses Istanbul coverage-final.json and coverage-summary.json', () => {
    const finalReport = registry.parse(readFixture('sample.istanbul-final.json'), 'coverage-final.json');
    expect(finalReport.format).toBe('istanbul');
    const file = finalReport.files.get('/home/runner/work/app/app/src/index.ts')!;
    expect(summarizeFile(file)).toEqual({
      lines: { covered: 2, total: 3, pct: 66.67 },
      branches: { covered: 1, total: 2, pct: 50 },
      functions: { covered: 1, total: 2, pct: 50 },
    });

    const summaryReport = registry.parse(readFixture('sample.istanbul-summary.json'), 'coverage-summary.json');
    expect(summaryReport.format).toBe('istanbul');
    expect(summaryReport.files.has('total')).toBe(false);
    const sumFile = summaryReport.files.get('src/summary-only.ts')!;
    expect(summarizeFile(sumFile)).toEqual({
      lines: { covered: 8, total: 10, pct: 80 },
      branches: { covered: 1, total: 2, pct: 50 },
      functions: { covered: 3, total: 4, pct: 75 },
    });
  });

  it('auto-detects and parses Go coverprofile with null branches and functions', () => {
    const report = registry.parse(readFixture('sample.gocover.out'), 'coverage.out');
    expect(report.format).toBe('gocover');
    const calc = report.files.get('github.com/acme/repo/pkg/calc.go')!;
    expect(summarizeFile(calc)).toEqual({
      lines: { covered: 3, total: 5, pct: 60 },
      branches: null,
      functions: null,
    });
  });

  it('auto-detects and parses OpenCover XML', () => {
    const report = registry.parse(readFixture('sample.opencover.xml'), 'opencover.xml');
    expect(report.format).toBe('opencover');
    const calc = report.files.get('C:\\repo\\src\\Calc.cs')!;
    expect(summarizeFile(calc)).toEqual({
      lines: { covered: 2, total: 3, pct: 66.67 },
      branches: { covered: 1, total: 2, pct: 50 },
      functions: { covered: 1, total: 2, pct: 50 },
    });
  });

  it('supports explicit format override and throws on unknown formats', () => {
    const report = registry.parse(readFixture('sample.lcov.info'), 'custom.txt', 'lcov');
    expect(report.format).toBe('lcov');
    expect(() => registry.parse('not a coverage file', 'unknown.txt')).toThrow(/Could not auto-detect/);
    expect(() => registry.parse('{}', 'bad.json', 'invalid' as never)).toThrow(/Unsupported coverage format/);
  });
});
