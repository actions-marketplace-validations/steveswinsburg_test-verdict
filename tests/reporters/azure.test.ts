import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAzureAuthHeader,
  emitAzureAnnotations,
  emitAzureOutputs,
  escapeVsoValue,
  getAzureTaskInput,
  resolveAzureContext,
  resolveAzureTargetBranch,
  resolveAzureToken,
  resolveAzureWorkingDirectory,
  setAzureTaskResult,
  upsertAzurePrComment,
  writeAzureBuildSummary,
} from '../../src/reporters/azure.js';
import { buildStickyMarker } from '../../src/reporters/markdown.js';
import type { VerdictResult } from '../../src/types/evaluation.js';

function makeResult(passed = true, enforce = true): VerdictResult {
  return {
    title: 'Test Verdict',
    reportId: 'unit/suite',
    enforce,
    passed,
    overall: {
      name: 'Overall',
      matchedFiles: ['coverage/lcov.info'],
      formats: ['lcov'],
      summary: {
        lines: { covered: 18, total: 20, pct: 90 },
        branches: { covered: 6, total: 10, pct: 60 },
        functions: { covered: 4, total: 5, pct: 80 },
      },
      diffCoverage: {
        files: [],
        coverableLines: 4,
        coveredLines: 3,
        pct: 75,
        branchCovered: 0,
        branchTotal: 0,
        branchPct: null,
      },
      files: new Map(),
      passed,
      violations: passed
        ? []
        : [{ group: 'Overall', metric: 'line', actual: 50, expected: 80, message: 'Overall: line coverage 50% < 80%' }],
      warnings: [{ group: 'Overall', code: 'EMPTY_REPORTS', message: 'Warn; 50% [test]\nline2' }],
    },
    groups: [],
    violations: passed
      ? []
      : [{ group: 'Overall', metric: 'line', actual: 50, expected: 80, message: 'Overall: line coverage 50% < 80%' }],
    warnings: [{ group: 'Overall', code: 'EMPTY_REPORTS', message: 'Warn; 50% [test]\nline2' }],
  };
}

describe('Azure Pipelines reporter', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds Bearer header for OAuth JWT and Basic header for PAT', () => {
    expect(buildAzureAuthHeader('eyJhbGciOiJSUzI1NiJ9.payload.sig')).toBe(
      'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig',
    );
    expect(buildAzureAuthHeader('my-pat-token')).toBe(
      `Basic ${Buffer.from(':my-pat-token', 'utf8').toString('base64')}`,
    );
  });

  it('resolves Azure PR context, token precedence, and target branch from env', () => {
    expect(
      resolveAzureContext({
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/myorg/',
        SYSTEM_TEAMPROJECT: 'My Project',
        BUILD_REPOSITORY_ID: 'repo-guid',
        SYSTEM_PULLREQUEST_PULLREQUESTID: '123',
      }),
    ).toEqual({
      collectionUri: 'https://dev.azure.com/myorg',
      project: 'My Project',
      repositoryId: 'repo-guid',
      pullRequestId: 123,
    });

    expect(
      resolveAzureContext({
        SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: 'https://dev.azure.com/myorg',
        SYSTEM_TEAMPROJECT: 'My Project',
        BUILD_REPOSITORY_ID: 'repo-guid',
        SYSTEM_PULLREQUEST_PULLREQUESTID: 'abc',
      }),
    ).toBeUndefined();

    expect(resolveAzureContext({})).toBeUndefined();

    expect(
      resolveAzureToken(' cli-token ', {
        ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN: 'vss-param-token',
        ENDPOINT_AUTH_SYSTEMVSSCONNECTION: JSON.stringify({ parameters: { AccessToken: 'vss-json-token' } }),
        SYSTEM_ACCESSTOKEN: 'sys-token',
        AZURE_DEVOPS_TOKEN: 'pat-token',
      }),
    ).toBe('cli-token');
    expect(
      resolveAzureToken(undefined, {
        ENDPOINT_AUTH_PARAMETER_SYSTEMVSSCONNECTION_ACCESSTOKEN: 'vss-param-token',
        ENDPOINT_AUTH_SYSTEMVSSCONNECTION: JSON.stringify({ parameters: { AccessToken: 'vss-json-token' } }),
        SYSTEM_ACCESSTOKEN: 'sys-token',
      }),
    ).toBe('vss-param-token');
    expect(
      resolveAzureToken(undefined, {
        ENDPOINT_AUTH_SYSTEMVSSCONNECTION: JSON.stringify({ parameters: { AccessToken: 'vss-json-token' } }),
        SYSTEM_ACCESSTOKEN: 'sys-token',
      }),
    ).toBe('vss-json-token');
    expect(
      resolveAzureToken(undefined, {
        ENDPOINT_AUTH_SYSTEMVSSCONNECTION: '{not-valid-json',
        SYSTEM_ACCESSTOKEN: 'sys-token',
        AZURE_DEVOPS_TOKEN: 'pat-token',
      }),
    ).toBe('sys-token');
    expect(resolveAzureToken(undefined, { AZURE_DEVOPS_TOKEN: 'pat-token' })).toBe('pat-token');
    expect(resolveAzureToken(undefined, {})).toBeUndefined();

    expect(
      getAzureTaskInput('minDiffLine', { INPUT_MINDIFFLINE: ' 85 ', INPUT_OTHER: 'x' }),
    ).toBe('85');
    expect(getAzureTaskInput('missing', {})).toBe('');

    expect(resolveAzureWorkingDirectory(' packages/api ', { BUILD_SOURCESDIRECTORY: '/agent/s' })).toBe('packages/api');
    expect(resolveAzureWorkingDirectory('', { BUILD_SOURCESDIRECTORY: ' /agent/s ' })).toBe('/agent/s');
    expect(resolveAzureWorkingDirectory('', {})).toBe('.');

    expect(resolveAzureTargetBranch({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' })).toBe('main');
    expect(resolveAzureTargetBranch({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/release/1.0' })).toBe('release/1.0');
    expect(resolveAzureTargetBranch({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'main' })).toBe('main');
    expect(resolveAzureTargetBranch({})).toBeUndefined();
  });

  it('creates a new sticky PR thread when none exists', async () => {
    const pr = {
      collectionUri: 'https://dev.azure.com/myorg/',
      project: 'My Project',
      repositoryId: 'repo-1',
      pullRequestId: 42,
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 700, comments: [{ id: 1 }] }), { status: 200 }),
      );

    const res = await upsertAzurePrComment(pr, 'pat-123', 'default', 'body text', {
      status: 'closed',
      fetchFn: fetchMock,
    });

    expect(res).toEqual({ ok: true, threadId: 700, commentId: 1, action: 'created' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [getUrl, getInit] = fetchMock.mock.calls[0]!;
    expect(getUrl).toBe(
      'https://dev.azure.com/myorg/My%20Project/_apis/git/repositories/repo-1/pullRequests/42/threads?api-version=7.1',
    );
    expect((getInit?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    const [postUrl, postInit] = fetchMock.mock.calls[1]!;
    expect(postUrl).toBe(
      'https://dev.azure.com/myorg/My%20Project/_apis/git/repositories/repo-1/pullRequests/42/threads?api-version=7.1',
    );
    expect(postInit?.method).toBe('POST');
    expect(JSON.parse(String(postInit?.body))).toEqual({
      comments: [{ parentCommentId: 0, content: 'body text', commentType: 1 }],
      status: 'closed',
    });
  });

  it('updates an existing sticky PR comment and ignores deleted threads/comments', async () => {
    const pr = {
      collectionUri: 'https://dev.azure.com/myorg',
      project: 'App',
      repositoryId: 'repo-1',
      pullRequestId: 9,
    };
    const marker = buildStickyMarker('backend');

    const threadsPayload = {
      value: [
        { id: 1, isDeleted: true, comments: [{ id: 1, content: marker }] },
        { id: 2, isDeleted: false, comments: [{ id: 10, isDeleted: true, content: marker }] },
        { id: 3, isDeleted: false, comments: [{ id: 22, isDeleted: false, content: `${marker}\nold` }] },
      ],
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(threadsPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 22 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 3 }), { status: 200 }));

    const res = await upsertAzurePrComment(pr, 'eyJ0eXAiOiJKV1QifQ.abc.def', 'backend', 'new body', {
      status: 'active',
      fetchFn: fetchMock,
    });

    expect(res).toEqual({ ok: true, threadId: 3, commentId: 22, action: 'updated' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [patchCommentUrl, patchCommentInit] = fetchMock.mock.calls[1]!;
    expect(patchCommentUrl).toBe(
      'https://dev.azure.com/myorg/App/_apis/git/repositories/repo-1/pullRequests/9/threads/3/comments/22?api-version=7.1',
    );
    expect(patchCommentInit?.method).toBe('PATCH');
    expect((patchCommentInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer eyJ0eXAiOiJKV1QifQ.abc.def',
    );
    expect(JSON.parse(String(patchCommentInit?.body))).toEqual({ content: 'new body' });

    const [patchThreadUrl, patchThreadInit] = fetchMock.mock.calls[2]!;
    expect(patchThreadUrl).toBe(
      'https://dev.azure.com/myorg/App/_apis/git/repositories/repo-1/pullRequests/9/threads/3?api-version=7.1',
    );
    expect(JSON.parse(String(patchThreadInit?.body))).toEqual({ status: 'active' });
  });

  it('handles 401/403 permissions gracefully and throws on unexpected 500 errors', async () => {
    const pr = {
      collectionUri: 'https://dev.azure.com/myorg',
      project: 'App',
      repositoryId: 'repo-1',
      pullRequestId: 9,
    };

    const fetch401 = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const res401 = await upsertAzurePrComment(pr, 'pat', 'default', 'body', { fetchFn: fetch401 });
    expect(res401.ok).toBe(false);
    expect(res401.warning).toContain('Contribute to pull requests');

    const fetch403 = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    const res403 = await upsertAzurePrComment(pr, 'pat', 'default', 'body', { fetchFn: fetch403 });
    expect(res403.ok).toBe(false);
    expect(res403.warning).toContain('`token` input');

    const fetch500 = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    await expect(upsertAzurePrComment(pr, 'pat', 'default', 'body', { fetchFn: fetch500 })).rejects.toThrow(
      /status 500/,
    );
  });

  it('writes Build Summary markdown to a sanitized file path and emits uploadsummary command', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tv-az-'));
    tempDirs.push(tempDir);

    const lines: string[] = [];
    const summaryPath = writeAzureBuildSummary('# Report', 'unit/suite:1', {
      tempDir,
      writeStdout: (l) => lines.push(l),
    });

    expect(path.basename(summaryPath)).toBe('test-verdict-unit_suite_1.md');
    expect(readFileSync(summaryPath, 'utf8')).toBe('# Report');
    expect(lines).toEqual([`##vso[task.uploadsummary]${summaryPath}`]);
  });

  it('escapes logging commands and emits Azure output variables and annotations', () => {
    expect(escapeVsoValue('a%b\rc\nd]e;f')).toBe('a%AZP25b%0Dc%0Ad%5De%3Bf');

    const failedResult = makeResult(false, true);
    const outLines: string[] = [];
    emitAzureOutputs(failedResult, { passed: false, note: '50%; [ok]' }, (l) => outLines.push(l));

    expect(outLines).toEqual([
      '##vso[task.setvariable variable=lineCoverage;isOutput=true]90',
      '##vso[task.setvariable variable=branchCoverage;isOutput=true]60',
      '##vso[task.setvariable variable=functionCoverage;isOutput=true]80',
      '##vso[task.setvariable variable=diffCoverage;isOutput=true]75',
      '##vso[task.setvariable variable=passed;isOutput=true]false',
      '##vso[task.setvariable variable=summaryJson;isOutput=true]{"passed":false,"note":"50%AZP25%3B [ok%5D"}',
    ]);

    const nullMetricsResult = makeResult(true, true);
    nullMetricsResult.overall.summary = { lines: null, branches: null, functions: null };
    nullMetricsResult.overall.diffCoverage = null;
    const emptyOutLines: string[] = [];
    emitAzureOutputs(nullMetricsResult, { passed: true }, (l) => emptyOutLines.push(l));
    expect(emptyOutLines.slice(0, 5)).toEqual([
      '##vso[task.setvariable variable=lineCoverage;isOutput=true]',
      '##vso[task.setvariable variable=branchCoverage;isOutput=true]',
      '##vso[task.setvariable variable=functionCoverage;isOutput=true]',
      '##vso[task.setvariable variable=diffCoverage;isOutput=true]',
      '##vso[task.setvariable variable=passed;isOutput=true]true',
    ]);

    const enforcedAnnotations: string[] = [];
    emitAzureAnnotations(failedResult, ['Extra; warn'], (l) => enforcedAnnotations.push(l));
    expect(enforcedAnnotations).toEqual([
      '##vso[task.logissue type=warning]Warn%3B 50%AZP25 [test%5D%0Aline2',
      '##vso[task.logissue type=warning]Extra%3B warn',
      '##vso[task.logissue type=error]Overall: line coverage 50%AZP25 < 80%AZP25',
    ]);

    const warnOnlyResult = makeResult(false, false);
    const warnAnnotations: string[] = [];
    emitAzureAnnotations(warnOnlyResult, [], (l) => warnAnnotations.push(l));
    expect(warnAnnotations).toEqual([
      '##vso[task.logissue type=warning]Warn%3B 50%AZP25 [test%5D%0Aline2',
      '##vso[task.logissue type=warning]Overall: line coverage 50%AZP25 < 80%AZP25',
    ]);

    const taskResults: string[] = [];
    setAzureTaskResult('Failed', 'Threshold [fail]; 50%', (l) => taskResults.push(l));
    setAzureTaskResult('Succeeded', undefined, (l) => taskResults.push(l));
    expect(taskResults).toEqual([
      '##vso[task.complete result=Failed;]Threshold [fail%5D%3B 50%AZP25',
      '##vso[task.complete result=Succeeded;]',
    ]);
  });
});
