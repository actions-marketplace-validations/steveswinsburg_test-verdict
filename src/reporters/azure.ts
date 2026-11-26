import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTrailingSlashes } from '../core/path-normalizer.js';
import type { VerdictResult } from '../types/evaluation.js';
import { buildStickyMarker } from './markdown.js';

export interface AzurePrContext {
  collectionUri: string;
  project: string;
  repositoryId: string;
  pullRequestId: number;
}

export interface AzureCommentUpsertResult {
  ok: boolean;
  threadId?: number;
  commentId?: number;
  action?: 'created' | 'updated';
  warning?: string;
}

export type AzureThreadStatus = 'active' | 'closed';

interface AzureApiComment {
  id?: number;
  content?: string;
  isDeleted?: boolean;
}

interface AzureApiThread {
  id?: number;
  isDeleted?: boolean;
  comments?: AzureApiComment[];
}

const PERMISSION_WARNING =
  'Unable to post Azure DevOps PR comment due to token permissions or missing access. Ensure the Build Service has "Contribute to pull requests" permission or pass a PAT via the `token` input.';

class AzurePermissionError extends Error {
  constructor() {
    super(PERMISSION_WARNING);
  }
}

/** Escape special characters in Azure Pipelines logging command values. */
export function escapeVsoValue(value: string): string {
  return value
    .replace(/%/g, '%AZP25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/\]/g, '%5D')
    .replace(/;/g, '%3B');
}

/** Build an Authorization header for an Azure DevOps OAuth JWT or PAT. */
export function buildAzureAuthHeader(token: string): string {
  if (token.split('.').length === 3 && token.startsWith('eyJ')) {
    return `Bearer ${token}`;
  }
  return `Basic ${Buffer.from(`:${token}`, 'utf8').toString('base64')}`;
}

/** Resolve Azure DevOps PR context from Azure Pipelines environment variables. */
export function resolveAzureContext(env: NodeJS.ProcessEnv = process.env): AzurePrContext | undefined {
  const collectionUriRaw = env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI?.trim();
  const project = env.SYSTEM_TEAMPROJECT?.trim();
  const repositoryId = env.BUILD_REPOSITORY_ID?.trim();
  const prIdRaw = env.SYSTEM_PULLREQUEST_PULLREQUESTID?.trim();

  if (!collectionUriRaw || !project || !repositoryId || !prIdRaw) {
    return undefined;
  }

  const pullRequestId = Number.parseInt(prIdRaw, 10);
  if (!Number.isInteger(pullRequestId) || pullRequestId <= 0 || String(pullRequestId) !== prIdRaw) {
    return undefined;
  }

  return {
    collectionUri: stripTrailingSlashes(collectionUriRaw),
    project,
    repositoryId,
    pullRequestId,
  };
}

/** Resolve Azure DevOps authentication token from task input, SystemVssConnection, or environment variables. */
export function resolveAzureToken(explicitToken?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  let systemVssToken: string | undefined;
  const rawAuth = env.ENDPOINT_AUTH_SYSTEMVSSCONNECTION?.trim();
  if (rawAuth) {
    try {
      const parsed = JSON.parse(rawAuth) as { parameters?: { AccessToken?: unknown } };
      if (typeof parsed?.parameters?.AccessToken === 'string') {
        systemVssToken = parsed.parameters.AccessToken;
      }
    } catch {
      // Ignore malformed ENDPOINT_AUTH_SYSTEMVSSCONNECTION JSON
    }
  }

  const candidates = [
    explicitToken,
    env.ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN,
    systemVssToken,
    env.SYSTEM_ACCESSTOKEN,
    env.AZURE_DEVOPS_TOKEN,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Read a trimmed Azure Pipelines task input from `INPUT_<NAME>` environment variable. */
export function getAzureTaskInput(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return (env[key] ?? '').trim();
}

/** Resolve the task working directory from explicit input, `BUILD_SOURCESDIRECTORY`, or `.`. */
export function resolveAzureWorkingDirectory(explicitDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = explicitDir?.trim();
  if (explicit) return explicit;
  const sourcesDir = env.BUILD_SOURCESDIRECTORY?.trim();
  if (sourcesDir) return sourcesDir;
  return '.';
}

/** Resolve target branch name from Azure Pipelines PR environment variable. */
export function resolveAzureTargetBranch(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.SYSTEM_PULLREQUEST_TARGETBRANCH?.trim();
  if (!raw) return undefined;
  const stripped = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw;
  return stripped || undefined;
}

async function azureJsonRequest<T>(
  fetchFn: typeof fetch,
  url: string,
  method: 'GET' | 'POST' | 'PATCH',
  authHeader: string,
  body?: unknown,
): Promise<T> {
  const response = await fetchFn(url, {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new AzurePermissionError();
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Azure DevOps API ${method} failed with status ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

/** Create or update a sticky PR comment thread in Azure DevOps identified by `<!-- test-verdict:<reportId> -->`. */
export async function upsertAzurePrComment(
  pr: AzurePrContext,
  token: string,
  reportId: string,
  body: string,
  options: { status?: AzureThreadStatus; fetchFn?: typeof fetch } = {},
): Promise<AzureCommentUpsertResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const authHeader = buildAzureAuthHeader(token);
  const marker = buildStickyMarker(reportId);
  const baseUrl = `${stripTrailingSlashes(pr.collectionUri)}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${encodeURIComponent(pr.repositoryId)}/pullRequests/${pr.pullRequestId}/threads`;

  try {
    const threadsData = await azureJsonRequest<{ value?: AzureApiThread[] }>(
      fetchFn,
      `${baseUrl}?api-version=7.1`,
      'GET',
      authHeader,
    );

    const threads = threadsData.value ?? [];
    for (const thread of threads) {
      if (thread.isDeleted || thread.id === undefined) continue;
      const match = (thread.comments ?? []).find(
        (c) => !c.isDeleted && c.id !== undefined && typeof c.content === 'string' && c.content.includes(marker),
      );
      if (match && match.id !== undefined) {
        await azureJsonRequest(
          fetchFn,
          `${baseUrl}/${thread.id}/comments/${match.id}?api-version=7.1`,
          'PATCH',
          authHeader,
          { content: body },
        );

        if (options.status) {
          await azureJsonRequest(
            fetchFn,
            `${baseUrl}/${thread.id}?api-version=7.1`,
            'PATCH',
            authHeader,
            { status: options.status },
          );
        }

        return { ok: true, threadId: thread.id, commentId: match.id, action: 'updated' };
      }
    }

    const created = await azureJsonRequest<AzureApiThread>(
      fetchFn,
      `${baseUrl}?api-version=7.1`,
      'POST',
      authHeader,
      {
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: options.status ?? 'active',
      },
    );

    return {
      ok: true,
      threadId: created.id,
      commentId: created.comments?.[0]?.id,
      action: 'created',
    };
  } catch (error) {
    if (error instanceof AzurePermissionError) {
      return { ok: false, warning: PERMISSION_WARNING };
    }
    throw error;
  }
}

/** Write full Markdown report to a temp file and emit an Azure Pipelines `task.uploadsummary` command. */
export function writeAzureBuildSummary(
  markdown: string,
  reportId: string,
  options: { tempDir?: string; writeStdout?: (line: string) => void } = {},
): string {
  const safeId = reportId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
  const dir = options.tempDir || process.env.AGENT_TEMPDIRECTORY || os.tmpdir();
  mkdirSync(dir, { recursive: true });
  const summaryPath = path.join(dir, `test-verdict-${safeId}.md`);
  writeFileSync(summaryPath, markdown, 'utf8');

  const writeStdout = options.writeStdout ?? console.log;
  writeStdout(`##vso[task.uploadsummary]${summaryPath}`);
  return summaryPath;
}

/** Emit Azure Pipelines output variables via `##vso[task.setvariable ...;isOutput=true]`. */
export function emitAzureOutputs(
  result: VerdictResult,
  summaryJson: unknown,
  writeStdout: (line: string) => void = console.log,
): void {
  const linesPct = result.overall.summary.lines ? String(result.overall.summary.lines.pct) : '';
  const branchesPct = result.overall.summary.branches ? String(result.overall.summary.branches.pct) : '';
  const functionsPct = result.overall.summary.functions ? String(result.overall.summary.functions.pct) : '';
  const diffPct =
    result.overall.diffCoverage?.pct !== null && result.overall.diffCoverage?.pct !== undefined
      ? String(result.overall.diffCoverage.pct)
      : '';

  const outputs: Array<[string, string]> = [
    ['lineCoverage', linesPct],
    ['branchCoverage', branchesPct],
    ['functionCoverage', functionsPct],
    ['diffCoverage', diffPct],
    ['passed', String(result.passed)],
    ['summaryJson', escapeVsoValue(JSON.stringify(summaryJson))],
  ];

  for (const [name, value] of outputs) {
    writeStdout(`##vso[task.setvariable variable=${name};isOutput=true]${value}`);
  }
}

/** Emit Azure Pipelines warning and error annotations via `##vso[task.logissue ...]`. */
export function emitAzureAnnotations(
  result: VerdictResult,
  extraWarnings: string[] = [],
  writeStdout: (line: string) => void = console.log,
): void {
  for (const w of result.warnings) {
    writeStdout(`##vso[task.logissue type=warning]${escapeVsoValue(w.message)}`);
  }
  for (const msg of extraWarnings) {
    writeStdout(`##vso[task.logissue type=warning]${escapeVsoValue(msg)}`);
  }

  if (!result.passed) {
    const issueType = result.enforce ? 'error' : 'warning';
    for (const v of result.violations) {
      writeStdout(`##vso[task.logissue type=${issueType}]${escapeVsoValue(v.message)}`);
    }
  }
}

/** Emit an Azure Pipelines task completion command via `##vso[task.complete ...]`. */
export function setAzureTaskResult(
  result: 'Succeeded' | 'SucceededWithIssues' | 'Failed',
  message?: string,
  writeStdout: (line: string) => void = console.log,
): void {
  const escaped = message ? escapeVsoValue(message) : '';
  writeStdout(`##vso[task.complete result=${result};]${escaped}`);
}
