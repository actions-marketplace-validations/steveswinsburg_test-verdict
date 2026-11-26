import * as core from '@actions/core';
import * as github from '@actions/github';
import { runVerdict } from '../core/runner.js';
import { getPrChangedLines, upsertPrComment, writeStepSummary } from '../reporters/github.js';
import { buildSummaryJson, DEFAULT_MAX_COMMENT_LENGTH, renderVerdictMarkdown } from '../reporters/markdown.js';
import type { FormatId } from '../types/coverage.js';
import type { ChangedFileLines } from '../types/diff.js';

function parseListInput(raw: string): string[] {
  return raw
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOptionalNumber(name: string): number | undefined {
  const raw = core.getInput(name).trim();
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`Input "${name}" must be a number between 0 and 100, got "${raw}"`);
  }
  return num;
}

function parseBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name).trim();
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

export async function runAction(): Promise<void> {
  const workingDirectory = core.getInput('working-directory') || '.';
  const filesInput = parseListInput(core.getInput('files'));
  const excludeInput = parseListInput(core.getInput('exclude'));
  const formatRaw = (core.getInput('format') || 'auto').trim().toLowerCase() as FormatId | 'auto';
  const configInput = core.getInput('config').trim() || '.test-verdict.yml';
  const reportId = core.getInput('report-id').trim() || undefined;
  const title = core.getInput('title').trim() || undefined;
  const enforce = parseBooleanInput('enforce', true);
  const failOnEmpty = parseBooleanInput('fail-on-empty', true);
  const enableComment = parseBooleanInput('comment', true);
  const enableStepSummary = parseBooleanInput('step-summary', true);
  const token = core.getInput('github-token');

  const thresholds = {
    minLine: parseOptionalNumber('min-line'),
    minBranch: parseOptionalNumber('min-branch'),
    minFunction: parseOptionalNumber('min-function'),
    minDiffLine: parseOptionalNumber('min-diff-line'),
    minDiffBranch: parseOptionalNumber('min-diff-branch'),
  };

  let changedLines: ChangedFileLines | undefined;
  const prNumber = github.context.payload.pull_request?.number;
  const octokit = token ? github.getOctokit(token) : undefined;
  const prInfo =
    prNumber !== undefined
      ? {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pullNumber: prNumber,
        }
      : undefined;

  if (octokit && prInfo) {
    try {
      changedLines = await getPrChangedLines(octokit, prInfo);
    } catch (error) {
      core.warning(`Failed to fetch PR changed lines from GitHub API: ${String(error)}`);
    }
  }

  const result = await runVerdict({
    workingDirectory,
    configPath: configInput,
    files: filesInput.length > 0 ? filesInput : undefined,
    exclude: excludeInput.length > 0 ? excludeInput : undefined,
    format: formatRaw,
    reportId,
    title,
    thresholds,
    enforce,
    failOnEmpty,
    changedLines,
  });

  for (const w of result.warnings) {
    core.warning(w.message);
  }

  const summaryJson = buildSummaryJson(result);
  core.setOutput('line-coverage', result.overall.summary.lines ? String(result.overall.summary.lines.pct) : '');
  core.setOutput('branch-coverage', result.overall.summary.branches ? String(result.overall.summary.branches.pct) : '');
  core.setOutput(
    'function-coverage',
    result.overall.summary.functions ? String(result.overall.summary.functions.pct) : '',
  );
  core.setOutput(
    'diff-coverage',
    result.overall.diffCoverage?.pct !== null && result.overall.diffCoverage?.pct !== undefined
      ? String(result.overall.diffCoverage.pct)
      : '',
  );
  core.setOutput('passed', String(result.passed));
  core.setOutput('summary-json', JSON.stringify(summaryJson));

  if (enableStepSummary) {
    const fullMarkdown = renderVerdictMarkdown(result, { maxLength: Number.POSITIVE_INFINITY });
    await writeStepSummary(fullMarkdown);
  }

  if (enableComment && octokit && prInfo) {
    const commentMarkdown = renderVerdictMarkdown(result, { maxLength: DEFAULT_MAX_COMMENT_LENGTH });
    const commentResult = await upsertPrComment(octokit, prInfo, result.reportId, commentMarkdown);
    if (!commentResult.ok && commentResult.warning) {
      core.warning(commentResult.warning);
    }
  }

  if (!result.passed) {
    const msg = result.violations.map((v) => v.message).join('; ') || 'Coverage thresholds not met.';
    if (result.enforce) {
      core.setFailed(msg);
    } else {
      core.warning(`Thresholds not met (enforce=false): ${msg}`);
    }
  }
}

runAction().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
