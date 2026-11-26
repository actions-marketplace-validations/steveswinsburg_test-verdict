# Test Verdict for Azure Pipelines

Test Verdict is available as a native Azure Pipelines Task (`TestVerdict@0`) packaged under [azure-pipelines/](azure-pipelines/). Once installed in your Azure DevOps organization, add it to `azure-pipelines.yml` just like the GitHub Action.

> **Version note:** The task major version tracks `package.json` (`TestVerdict@0` during `0.x`, and `TestVerdict@1` once `1.0.0` is released).

When run in an Azure Pipelines pull request build, the `TestVerdict` task:

1. Auto-detects the PR target branch from `System.PullRequest.TargetBranch` and computes PR diff coverage against it.
2. Posts or updates a sticky PR comment thread on the Azure DevOps pull request (setting thread status to `active` when failing and `closed` when passing or warn-only).
3. Uploads the full coverage breakdown to the Azure Pipelines Build **Summary** tab (`##vso[task.uploadsummary]`).
4. Emits task output variables (`lineCoverage`, `branchCoverage`, `functionCoverage`, `diffCoverage`, `passed`, `summaryJson`) and warning/error annotations.
5. Fails the task when enforced thresholds are violated.

## Quickstart (`TestVerdict@0`)

```yaml
trigger:
  - main

pr:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self
    fetchDepth: 0

  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci && npx vitest run --coverage --coverage.reporter=lcov
    displayName: Run tests with coverage

  - task: TestVerdict@0
    inputs:
      files: coverage/lcov.info
      minLine: '80'
      minDiffLine: '90'
```

> **Note on `fetchDepth: 0`:** Azure Pipelines defaults to shallow clones (`fetchDepth: 1`). Setting `fetchDepth: 0` ensures git history is available so the task can compute PR diff coverage against `origin/<targetBranch>...HEAD`.

## Task Inputs

| Input | Default | Description |
| :--- | :--- | :--- |
| `files` | - | Newline or comma-separated coverage report globs |
| `format` | `auto` | `auto` \| `lcov` \| `cobertura` \| `jacoco` \| `istanbul` \| `gocover` \| `opencover` |
| `config` | `.test-verdict.yml` | Path to optional YAML config file |
| `exclude` | - | Newline or comma-separated source path exclusion globs |
| `minLine` | - | Minimum overall line coverage % (0-100) |
| `minBranch` | - | Minimum overall branch coverage % (0-100) |
| `minFunction` | - | Minimum overall function coverage % (0-100) |
| `minDiffLine` | - | Minimum PR changed-lines coverage % (0-100) |
| `minDiffBranch` | - | Minimum PR changed-lines branch coverage % (0-100) |
| `diffBase` | - | Optional git ref to diff against (defaults to `System.PullRequest.TargetBranch`) |
| `enforce` | `true` | Fail the task when thresholds are breached |
| `failOnEmpty` | `true` | Fail if no coverage files match `files` |
| `comment` | `true` | Post or update sticky PR comment thread |
| `summary` | `true` | Upload full breakdown to the Build Summary tab |
| `title` | `Test Verdict` | Heading for PR comments and Build Summaries |
| `reportId` | `default` | Identifier for sticky PR comments across multiple steps |
| `token` | - | Optional PAT/OAuth token override (defaults to `SystemVssConnection`) |
| `workingDirectory` | `$(Build.SourcesDirectory)` | Working directory containing the repository and coverage reports |

## Task Output Variables

Name the task step (for example `name: testVerdict`) to reference its outputs in downstream steps:

```yaml
  - task: TestVerdict@0
    name: testVerdict
    inputs:
      files: coverage/lcov.info
      minLine: '80'

  - script: |
      echo "Passed: $(testVerdict.passed)"
      echo "Line coverage: $(testVerdict.lineCoverage)%"
      echo "Branch coverage: $(testVerdict.branchCoverage)%"
      echo "Function coverage: $(testVerdict.functionCoverage)%"
      echo "Diff coverage: $(testVerdict.diffCoverage)%"
    condition: succeededOrFailed()
    displayName: Inspect Test Verdict outputs
```

| Output Variable | Description |
| :--- | :--- |
| `lineCoverage` | Overall line coverage percentage (empty if unavailable) |
| `branchCoverage` | Overall branch coverage percentage (empty if unavailable) |
| `functionCoverage` | Overall function coverage percentage (empty if unavailable) |
| `diffCoverage` | PR diff line coverage percentage (empty if unavailable) |
| `passed` | `"true"` or `"false"` |
| `summaryJson` | Escaped JSON summary payload |

## Required Azure DevOps Permissions

The task reads the pipeline's built-in `SystemVssConnection` OAuth token automatically (no manual `SYSTEM_ACCESSTOKEN` mapping required). To allow it to post and update PR comment threads:

1. Open **Project Settings** -> **Repositories** -> select your repository (or **All Repositories**) -> **Security**.
2. Select the Build Service account (`<Project Name> Build Service (<Organization>)` or `Project Collection Build Service (<Organization>)`).
3. Set **Contribute to pull requests** to **Allow**.

If the Build Service does not have permission, the task emits a warning, still uploads the Build Summary, and still enforces coverage thresholds.

### Custom Comment Author (Optional)

By default, PR comments appear under the Build Service identity. To post comments under a dedicated service account instead, create a Personal Access Token (PAT) with **Code (Read & Write)** or **Pull Request Threads (Read & Write)** scope, store it as a secret variable (for example `TEST_VERDICT_ADO_PAT`), and pass `token: $(TEST_VERDICT_ADO_PAT)`.

## Branch Policy Integration

In **Repos** -> **Branches** -> **Branch Policies** for your protected branch (such as `main`):

- **Build Validation**: Add your pipeline as a required build check. Any threshold violation with `enforce: true` fails the task and blocks PR completion.
- **Check for comment resolution** (optional): When a run fails, Test Verdict leaves its sticky PR comment thread in `active` status. Once subsequent commits pass the coverage gate, it updates the same thread and sets its status to `closed` automatically.

## Packaging and Publishing the `.vsix` Extension

Build the task bundle and package the Visual Studio Marketplace `.vsix` locally:

```bash
npm ci
npm run package:azure
```

This builds `azure-pipelines/task/index.cjs` (keeping version numbers in [azure-pipelines/vss-extension.json](azure-pipelines/vss-extension.json) and [azure-pipelines/task/task.json](azure-pipelines/task/task.json) synced with `package.json`) and creates `dist/steveswinsburg.test-verdict-<version>.vsix`.

To publish or share via the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage):

```bash
# Publish to the Marketplace using a PAT with Marketplace (Manage) scope
npx tfx-cli extension publish \
  --vsix dist/steveswinsburg.test-verdict-$(node -p "require('./package.json').version").vsix \
  --token "$AZURE_MARKETPLACE_PAT"
```

You can also upload the `.vsix` directly in Visual Studio Marketplace as a private extension and share it with specific Azure DevOps organizations before making it public.
