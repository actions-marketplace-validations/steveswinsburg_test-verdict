import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import pkg from '../../package.json' with { type: 'json' };
import { parseUnifiedDiff } from '../core/diff.js';
import { runVerdict } from '../core/runner.js';
import { buildSummaryJson, renderVerdictMarkdown } from '../reporters/markdown.js';
import type { FormatId } from '../types/coverage.js';
import type { ChangedFileLines } from '../types/diff.js';
import type { VerdictResult } from '../types/evaluation.js';

const VERSION = pkg.version;

function printHelp(): void {
  console.log(`test-verdict v${VERSION} — Universal coverage report aggregator and PR gate

Usage:
  test-verdict [options]

Options:
  -f, --files <glob>          Coverage report glob pattern (repeatable)
      --format <fmt>          auto | lcov | cobertura | jacoco | istanbul | gocover | opencover
  -c, --config <path>         Path to .test-verdict.yml
  -e, --exclude <glob>        Source file glob to exclude (repeatable)
      --report-id <id>        Sticky comment report ID (default: "default")
      --title <text>          Report title (default: "Test Verdict")
      --min-line <pct>        Minimum overall line coverage (0-100)
      --min-branch <pct>      Minimum overall branch coverage (0-100)
      --min-function <pct>    Minimum overall function coverage (0-100)
      --min-diff-line <pct>   Minimum PR/git diff line coverage (0-100)
      --min-diff-branch <pct> Minimum PR/git diff branch coverage (0-100)
      --diff-base <ref>       Git ref to diff against (e.g. origin/main, HEAD~1)
      --working-dir <dir>     Working directory (default: ".")
      --enforce               Exit non-zero on threshold breach (default: true; use --no-enforce to warn only)
      --fail-on-empty         Fail when no reports match (default: true; use --no-fail-on-empty)
      --markdown              Print Markdown report to stdout
      --json                  Print JSON summary to stdout
  -h, --help                  Show this help message
  -v, --version               Show version
`);
}

function parseOptionalPct(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`Invalid value for ${flag}: "${raw}" (expected 0-100)`);
  }
  return num;
}

function getGitDiffChangedLines(workingDir: string, diffBase: string): ChangedFileLines {
  const diffOutput = execFileSync('git', ['diff', diffBase, '--unified=0'], {
    cwd: workingDir,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return parseUnifiedDiff(diffOutput);
}

function printTextSummary(result: VerdictResult): void {
  const status = result.passed ? 'PASSED' : result.enforce ? 'FAILED' : 'WARN';
  console.log(`${result.title}: ${status}`);
  const { lines, branches, functions } = result.overall.summary;
  console.log(`  Lines:     ${lines ? `${lines.pct.toFixed(2)}% (${lines.covered}/${lines.total})` : 'n/a'}`);
  console.log(`  Branches:  ${branches ? `${branches.pct.toFixed(2)}% (${branches.covered}/${branches.total})` : 'n/a'}`);
  console.log(`  Functions: ${functions ? `${functions.pct.toFixed(2)}% (${functions.covered}/${functions.total})` : 'n/a'}`);
  if (result.overall.diffCoverage) {
    const d = result.overall.diffCoverage;
    console.log(`  Diff:      ${d.pct !== null ? `${d.pct.toFixed(2)}% (${d.coveredLines}/${d.coverableLines})` : 'n/a'}`);
  }
  for (const w of result.warnings) {
    console.warn(`  [warn] ${w.message}`);
  }
  for (const v of result.violations) {
    console.error(`  [fail] ${v.message}`);
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowNegative: true,
    options: {
      files: { type: 'string', short: 'f', multiple: true },
      format: { type: 'string' },
      config: { type: 'string', short: 'c' },
      exclude: { type: 'string', short: 'e', multiple: true },
      'report-id': { type: 'string' },
      title: { type: 'string' },
      'min-line': { type: 'string' },
      'min-branch': { type: 'string' },
      'min-function': { type: 'string' },
      'min-diff-line': { type: 'string' },
      'min-diff-branch': { type: 'string' },
      'diff-base': { type: 'string' },
      'working-dir': { type: 'string' },
      enforce: { type: 'boolean' },
      'fail-on-empty': { type: 'boolean' },
      markdown: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }
  if (values.version) {
    console.log(VERSION);
    return 0;
  }

  const workingDir = values['working-dir'] ?? '.';
  const changedLines = values['diff-base'] ? getGitDiffChangedLines(workingDir, values['diff-base']) : undefined;

  const result = await runVerdict({
    workingDirectory: workingDir,
    configPath: values.config,
    files: values.files,
    exclude: values.exclude,
    format: values.format as FormatId | 'auto' | undefined,
    reportId: values['report-id'],
    title: values.title,
    thresholds: {
      minLine: parseOptionalPct(values['min-line'], '--min-line'),
      minBranch: parseOptionalPct(values['min-branch'], '--min-branch'),
      minFunction: parseOptionalPct(values['min-function'], '--min-function'),
      minDiffLine: parseOptionalPct(values['min-diff-line'], '--min-diff-line'),
      minDiffBranch: parseOptionalPct(values['min-diff-branch'], '--min-diff-branch'),
    },
    enforce: values.enforce,
    failOnEmpty: values['fail-on-empty'],
    changedLines,
  });

  if (values.json) {
    console.log(JSON.stringify(buildSummaryJson(result), null, 2));
  } else if (values.markdown) {
    console.log(renderVerdictMarkdown(result, { maxLength: Number.POSITIVE_INFINITY }));
  } else {
    printTextSummary(result);
  }

  return !result.passed && result.enforce ? 1 : 0;
}

runCli()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
