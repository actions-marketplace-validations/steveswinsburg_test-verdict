/**
 * v2 readiness interfaces for test execution result parsers (e.g. JUnit XML, .NET TRX).
 * Not wired into v1 coverage execution; kept stable so test-result modules plug in cleanly in v2.
 */

export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface TestCaseResult {
  name: string;
  suite: string;
  status: TestCaseStatus;
  durationMs?: number;
  filePath?: string;
  line?: number;
  failureMessage?: string;
  stackTrace?: string;
}

export interface TestSuiteResult {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  durationMs?: number;
  cases: TestCaseResult[];
}

export interface NormalizedTestReport {
  format: 'junit' | 'trx';
  sourceFile?: string;
  suites: TestSuiteResult[];
}

export interface TestResultsParser {
  readonly id: 'junit' | 'trx';
  canParse(filePath: string, snippet: string): boolean;
  parse(content: string, sourceFile?: string): NormalizedTestReport;
}
