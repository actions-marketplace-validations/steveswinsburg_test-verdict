import * as core from '@actions/core';
import type * as github from '@actions/github';
import { parseGitHubFilePatch } from '../core/diff.js';
import type { ChangedFileLines } from '../types/diff.js';
import { buildStickyMarker } from './markdown.js';

type OctokitClient = ReturnType<typeof github.getOctokit>;

export interface PrContextInfo {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface CommentUpsertResult {
  ok: boolean;
  commentId?: number;
  action?: 'created' | 'updated';
  warning?: string;
}

/** Fetch PR changed file line numbers using GitHub Pull Requests API. */
export async function getPrChangedLines(
  octokit: OctokitClient,
  pr: PrContextInfo,
): Promise<ChangedFileLines> {
  const changed: ChangedFileLines = new Map();

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pullNumber,
    per_page: 100,
  });

  for (const file of files) {
    if (file.status === 'removed' || !file.patch) continue;
    const lines = parseGitHubFilePatch(file.patch);
    if (lines.size > 0) {
      changed.set(file.filename, lines);
    }
  }

  return changed;
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { status?: number; message?: string };
  if (err.status === 403 || err.status === 404) return true;
  const msg = String(err.message ?? '').toLowerCase();
  return msg.includes('resource not accessible by integration') || msg.includes('forbidden');
}

/** Create or update a sticky PR comment identified by `<!-- test-verdict:<reportId> -->`. */
export async function upsertPrComment(
  octokit: OctokitClient,
  pr: PrContextInfo,
  reportId: string,
  body: string,
): Promise<CommentUpsertResult> {
  const marker = buildStickyMarker(reportId);

  try {
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.pullNumber,
      per_page: 100,
    });

    const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: pr.owner,
        repo: pr.repo,
        comment_id: existing.id,
        body,
      });
      return { ok: true, commentId: existing.id, action: 'updated' };
    }

    const created = await octokit.rest.issues.createComment({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.pullNumber,
      body,
    });
    return { ok: true, commentId: created.data.id, action: 'created' };
  } catch (error) {
    if (isPermissionError(error)) {
      return {
        ok: false,
        warning:
          'Unable to post PR comment due to token permissions (common on fork pull requests). Check Job Step Summary for details.',
      };
    }
    throw error;
  }
}

/** Write rendered Markdown report to the GitHub Actions Job Step Summary. */
export async function writeStepSummary(markdown: string): Promise<void> {
  await core.summary.addRaw(markdown, true).write();
}
