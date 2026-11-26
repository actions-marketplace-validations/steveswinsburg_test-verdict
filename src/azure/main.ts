import { execFileSync } from 'node:child_process';
import { parseUnifiedDiff } from '../core/diff.js';
import { runVerdict } from '../core/runner.js';
import {
  type AzureThreadStatus,
  emitAzureAnnotations,
  emitAzureOutputs,
  getAzureTaskInput,
  resolveAzureContext,
  resolveAzureTargetBranch,
  resolveAzureToken,
  resolveAzureWorkingDirectory,
  setAzureTaskResult,
  upsertAzurePrComment,
  writeAzureBuildSummary,
} from '../reporters/azure.js';
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
  const raw = getAzureTaskInput(name);
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`Input "${name}" must be a number between 0 and 100, got "${raw}"`);
  }
  return num;
}

function parseBooleanInput(name: string, defaultValue: boolean): boolean {
  const raw = getAzureTaskInput(name);
  if (!raw) return defaultValue;
  return raw.toLowerCase() === 'true';
}

function getGitDiffChangedLines(workingDir: string, diffBase: string): ChangedFileLines {
  const diffOutput = execFileSync('git', ['diff', diffBase, '--unified=0'], {
    cwd: workingDir,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return parseUnifiedDiff(diffOutput);
}

function getAzurePrChangedLines(
  workingDir: string,
  targetBranch: string,
): { changedLines?: ChangedFileLines; warning?: string } {
  const candidates = [`origin/${targetBranch}...HEAD`, `${targetBranch}...HEAD`];
  for (const range of candidates) {
    try {
      const diffOutput = execFileSync('git', ['diff', range, '--unified=0'], {
        cwd: workingDir,
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { changedLines: parseUnifiedDiff(diffOutput) };
    } catch {
      // Try next ref candidate
    }
  }
  return {
    warning: `Could not compute PR diff against "${targetBranch}". Ensure checkout uses fetchDepth: 0 or set the diffBase input.`,
  };
}

export async function runAzureTask(): Promise<void> {
  const workingDirectory = resolveAzureWorkingDirectory(getAzureTaskInput('workingDirectory'));
  const filesInput = parseListInput(getAzureTaskInput('files'));
  const excludeInput = parseListInput(getAzureTaskInput('exclude'));
  const formatRaw = (getAzureTaskInput('format') || 'auto').toLowerCase() as FormatId | 'auto';
  const configInput = getAzureTaskInput('config') || '.test-verdict.yml';
  const reportId = getAzureTaskInput('reportId') || undefined;
  const title = getAzureTaskInput('title') || undefined;
  const diffBase = getAzureTaskInput('diffBase');
  const tokenInput = getAzureTaskInput('token') || undefined;
  const enforce = parseBooleanInput('enforce', true);
  const failOnEmpty = parseBooleanInput('failOnEmpty', true);
  const enableComment = parseBooleanInput('comment', true);
  const enableSummary = parseBooleanInput('summary', true);

  const thresholds = {
    minLine: parseOptionalNumber('minLine'),
    minBranch: parseOptionalNumber('minBranch'),
    minFunction: parseOptionalNumber('minFunction'),
    minDiffLine: parseOptionalNumber('minDiffLine'),
    minDiffBranch: parseOptionalNumber('minDiffBranch'),
  };

  const extraWarnings: string[] = [];
  let changedLines: ChangedFileLines | undefined;
  if (diffBase) {
    try {
      changedLines = getGitDiffChangedLines(workingDirectory, diffBase);
    } catch (error) {
      extraWarnings.push(`Failed to compute git diff against "${diffBase}": ${String(error)}`);
    }
  } else {
    const targetBranch = resolveAzureTargetBranch(process.env);
    if (targetBranch) {
      const diffRes = getAzurePrChangedLines(workingDirectory, targetBranch);
      changedLines = diffRes.changedLines;
      if (diffRes.warning) {
        extraWarnings.push(diffRes.warning);
      }
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

  const summaryJson = buildSummaryJson(result);
  emitAzureOutputs(result, summaryJson);

  if (enableSummary) {
    const fullMarkdown = renderVerdictMarkdown(result, { maxLength: Number.POSITIVE_INFINITY });
    writeAzureBuildSummary(fullMarkdown, result.reportId);
  }

  if (enableComment) {
    const pr = resolveAzureContext(process.env);
    if (pr) {
      const token = resolveAzureToken(tokenInput, process.env);
      if (!token) {
        extraWarnings.push(
          'Skipping Azure DevOps PR comment: no access token found. Ensure "Allow scripts to access the OAuth token" is enabled or pass a PAT via the `token` input.',
        );
      } else {
        const commentMarkdown = renderVerdictMarkdown(result, { maxLength: DEFAULT_MAX_COMMENT_LENGTH });
        const threadStatus: AzureThreadStatus = result.passed || !result.enforce ? 'closed' : 'active';
        const commentResult = await upsertAzurePrComment(pr, token, result.reportId, commentMarkdown, {
          status: threadStatus,
        });
        if (!commentResult.ok && commentResult.warning) {
          extraWarnings.push(commentResult.warning);
        }
      }
    }
  }

  emitAzureAnnotations(result, extraWarnings);

  if (!result.passed) {
    const msg = result.violations.map((v) => v.message).join('; ') || 'Coverage thresholds not met.';
    if (result.enforce) {
      setAzureTaskResult('Failed', msg);
      process.exitCode = 1;
    } else {
      setAzureTaskResult('SucceededWithIssues', `Thresholds not met (enforce=false): ${msg}`);
    }
  }
}

runAzureTask().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`##vso[task.logissue type=error]${message.replace(/%/g, '%AZP25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/\]/g, '%5D').replace(/;/g, '%3B')}`);
  setAzureTaskResult('Failed', message);
  process.exitCode = 1;
});
