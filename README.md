<p align="center">
  <img src="test-verdict.png" alt="Test Verdict" width="420">
</p>

# Test Verdict

Universal test & code coverage PR decorator and merge gate - available as a **GitHub Action**, an **Azure Pipelines task**, and a **standalone CLI tool**.

`test-verdict` auto-detects and aggregates coverage reports across many languages, evaluates test coverage thresholds, comments on your PR and can enforce merge gates, blocking PRs until coverage thresholds are met. Use it directly in GitHub Actions workflows, in Azure Pipelines via the native `TestVerdict` task, or standalone via `npx test-verdict`.

[![CI](https://github.com/steveswinsburg/test-verdict/actions/workflows/ci.yml/badge.svg)](https://github.com/steveswinsburg/test-verdict/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/test-verdict.svg)](https://www.npmjs.com/package/test-verdict)
[![license](https://img.shields.io/github/license/steveswinsburg/test-verdict.svg)](LICENSE)

## Features

- **Format-agnostic auto-detection** - parses and merges multiple reports across languages in a single pass.
- **Overall & PR diff coverage** - gates both total coverage and changed lines in the pull request.
- **Sticky PR comment & Job Step Summary** - updates a single PR comment in place, with a full breakdown in the workflow summary.
- **Branch-protection ready** - fails the check on threshold breaches when `enforce: true` so PRs cannot merge until passing.
- **Fork-PR safe** - gracefully degrades to Job Step Summary + exit-code gating if Github token permissions don't allow commenting.
- **Azure Pipelines task** - native `TestVerdict` extension task with sticky Azure DevOps PR comments, Build Summary upload, and output variables.
- **Standalone CLI tool** - zero-dependency CLI you can run locally, in pre-push hooks, or in any CI provider via `npx test-verdict`.

### Example PR Comment

> ## Test Verdict - ✅ Passed
>
> | Suite | Lines | Branches | Functions | PR Diff | Status |
> | :--- | ---: | ---: | ---: | ---: | :---: |
> | Overall | 91.1% (1552/1703) | 70.4% (386/548) | 96.2% (75/78) | 94.4% (34/36) | ✅ Pass |

By default, GitHub attributes PR comments posted with `GITHUB_TOKEN` to `github-actions` Bot. See [CUSTOM_BOT.md](CUSTOM_BOT.md) if you want comments posted under a custom bot name and avatar (such as `test-verdict` Bot).

## Supported Formats

| Format | Ecosystems / Tools |
| :--- | :--- |
| **LCOV** (`.info`) | JS/TS (Vitest, Jest, c8, Istanbul), Rust (`llvm-cov`, `tarpaulin`), Flutter/Dart, C/C++, Ruby, PHP |
| **Cobertura XML** | Python (`pytest-cov`, `coverage.py`), .NET (`coverlet`), Go (`gocover-cobertura`), Ruby, PHP |
| **JaCoCo XML** | Java, Kotlin, Scala, Groovy (Maven & Gradle) |
| **Istanbul / Jest JSON** | JS/TS (`coverage-final.json`, `coverage-summary.json`) |
| **Go `coverprofile`** | Go (`go test -coverprofile=coverage.out`) |
| **OpenCover XML** | .NET (`OpenCover`, `AltCover`) |

See [EXAMPLES.md](EXAMPLES.md) for full recipes covering every report format, GitHub Actions, Azure Pipelines, parameter combinations, and standalone CLI usage.

## Quickstart

### GitHub Actions

```yaml
name: Coverage Gate

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test -- --coverage

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: |
            **/jacocoTestReport.xml
            coverage/lcov.info
            coverage.xml
          min-line: 80
          min-diff-line: 90
```

#### Enforcing Merge Gates

Set `enforce: true` (the default) and mark the workflow job as a **required status check** in your repository's Branch Protection / Rulesets. Any threshold violation fails the check and blocks the PR merge.

### Azure Pipelines

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

  - script: npm ci && npm test -- --coverage
    displayName: Run tests with coverage

  - task: TestVerdict@0
    inputs:
      files: coverage/lcov.info
      minLine: '80'
      minDiffLine: '90'
```

See [AZURE_PIPELINES.md](AZURE_PIPELINES.md) for all task inputs, output variables, Build Service permissions, Branch Policy setup, and `.vsix` packaging.

### Standalone CLI

```bash
npx test-verdict \
  --files coverage/lcov.info \
  --files "**/jacocoTestReport.xml" \
  --min-line 80 \
  --min-diff-line 90 \
  --diff-base origin/main
```

See [Standalone CLI](#standalone-cli) below for installation and all CLI flags, or [EXAMPLES.md](EXAMPLES.md) for format-specific commands.

### Security Hardening

For locked-down organization or reusable workflows:

- **Avoid persisted credentials on disk**: Pass `persist-credentials: false` to `actions/checkout` (or evaluate coverage in a separate job that only downloads the coverage artifact) if earlier steps use minted GitHub App tokens or PATs.
- **Ignore repo-committed config**: Pass `config: none` so a pull request cannot commit `.test-verdict.yml` to exclude files or override workflow thresholds.
- **Count brand-new untested files in PR diff**: Pass `include:` globs (for example `src/**/*.ts`) and/or enable `coverage.all: true` in your test runner so newly added files absent from the report count as `0%` diff coverage instead of `0/0`.
- **Pin by commit SHA**: Pin `steveswinsburg/test-verdict@<full-commit-sha>` in high-security pipelines.

## Monorepo Coverage Groups

Create an optional `.test-verdict.yml` at the repository root to evaluate multiple suites or packages with independent thresholds in one step:

```yaml
title: Monorepo Coverage
exclude:
  - "**/*.generated.*"
  - "**/__tests__/**"
thresholds:
  min-line: 80
  min-diff-line: 85
groups:
  - name: backend-java
    files:
      - "services/api/**/jacocoTestReport.xml"
    thresholds:
      min-line: 85
      min-branch: 75
  - name: frontend-web
    files:
      - "apps/web/coverage/lcov.info"
    thresholds:
      min-line: 80
```

## Action Inputs

| Input | Default | Description |
| :--- | :--- | :--- |
| `files` | - | Newline or comma-separated coverage report globs |
| `format` | `auto` | `auto` \| `lcov` \| `cobertura` \| `jacoco` \| `istanbul` \| `gocover` \| `opencover` |
| `config` | `.test-verdict.yml` | Path to optional YAML config file, or `none` / `false` to disable |
| `include` | - | Newline or comma-separated source path inclusion globs (missing diff files count as 0%) |
| `exclude` | - | Newline or comma-separated source path exclusion globs |
| `report-id` | `default` | Identifier for sticky PR comments across multiple steps |
| `title` | `Test Verdict` | Heading for PR comments and step summaries |
| `min-line` | - | Minimum overall line coverage % (0–100) |
| `min-branch` | - | Minimum overall branch coverage % (0–100) |
| `min-function` | - | Minimum overall function coverage % (0–100) |
| `min-diff-line` | - | Minimum PR changed-lines coverage % (0–100) |
| `min-diff-branch` | - | Minimum PR changed-lines branch coverage % (0–100) |
| `enforce` | `true` | Fail the check when thresholds are breached |
| `fail-on-empty` | `true` | Fail if no coverage files match or parsed reports contain no measured files |
| `comment` | `true` | Post or update sticky PR comment |
| `step-summary` | `true` | Write Job Step Summary |
| `github-token` | `${{ github.token }}` | Token used for PR diff and comments |
| `working-directory` | `.` | Working directory |

## Action Outputs

| Output | Description |
| :--- | :--- |
| `line-coverage` | Overall line coverage percentage |
| `branch-coverage` | Overall branch coverage percentage |
| `function-coverage` | Overall function coverage percentage |
| `diff-coverage` | PR diff line coverage percentage |
| `passed` | `"true"` or `"false"` |
| `summary-json` | JSON payload summarizing all groups, metrics, violations, and warnings |

## Standalone CLI

Global install:

```bash
npm install -g test-verdict
```

Or run without installing via `npx`:

```bash
npx test-verdict --files coverage/lcov.info --min-line 80
npx test-verdict --files coverage/lcov.info --min-line 80 --diff-base origin/main --markdown
```

| Option | Description |
| :--- | :--- |
| `-f, --files <glob>` | Coverage report glob pattern (repeatable) |
| `--format <fmt>` | `auto` \| `lcov` \| `cobertura` \| `jacoco` \| `istanbul` \| `gocover` \| `opencover` |
| `-c, --config <path>` | Path to `.test-verdict.yml` (or `none` / `false` to disable) |
| `--no-config` | Disable auto-loading `.test-verdict.yml` |
| `--include <glob>` | Source file glob to include (repeatable; missing diff files count as 0%) |
| `-e, --exclude <glob>` | Source file glob to exclude (repeatable) |
| `--report-id <id>` | Sticky comment report ID (default: `"default"`) |
| `--title <text>` | Report title (default: `"Test Verdict"`) |
| `--min-line <pct>` | Minimum overall line coverage % (0–100) |
| `--min-branch <pct>` | Minimum overall branch coverage % (0–100) |
| `--min-function <pct>` | Minimum overall function coverage % (0–100) |
| `--min-diff-line <pct>` | Minimum PR/git diff line coverage % (0–100) |
| `--min-diff-branch <pct>` | Minimum PR/git diff branch coverage % (0–100) |
| `--diff-base <ref>` | Git ref to diff against (e.g. `origin/main`, `HEAD~1`) |
| `--working-dir <dir>` | Working directory (default: `.`) |
| `--enforce` / `--no-enforce` | Exit non-zero on threshold breach (default: `true`) |
| `--fail-on-empty` / `--no-fail-on-empty` | Fail when no reports match or contain no measured files (default: `true`) |
| `--markdown` | Print Markdown report to stdout |
| `--json` | Print JSON summary to stdout |
| `-h, --help` | Show help message |
| `-v, --version` | Show version |

## Development

```bash
npm ci
npm run typecheck
npm run test:coverage
npm run build
npm run package:azure   # package Azure Pipelines .vsix into dist/
```

### Releasing a New Version

```bash
npm version patch --no-git-tag-version   # or minor / major
npm run build
git add package.json package-lock.json dist/ azure-pipelines/vss-extension.json azure-pipelines/task/task.json
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git push origin main
```

On push to `main`, `.github/workflows/ci.yml` automatically:

1. Runs typecheck, tests, coverage, and `dist/` + Azure extension manifest verification.
2. Publishes the new version to npmjs via Trusted Publishing (OIDC) if not already published.
3. Creates the `v<version>` GitHub Release with auto-generated release notes.
4. Updates the floating major tag (e.g. `v1` for `v1.x.x`) for GitHub Action consumers.
5. Packages the Azure Pipelines `.vsix`, attaches it to the GitHub Release, and publishes it to the Visual Studio Marketplace when `AZURE_MARKETPLACE_PAT` is set.

> To list a release on GitHub Actions Marketplace, edit the created GitHub Release and check **Publish this Action to the GitHub Marketplace**.

### Contributing a New Format Parser

1. Implement `CoverageParser` in `src/parsers/<format>.ts` (`id`, `canParse(filePath, snippet)`, `parse(content, sourceFile)`).
2. Register the parser in `createDefaultParserRegistry()` inside `src/parsers/registry.ts`.
3. Add realistic fixture files under `tests/fixtures/` and unit tests under `tests/parsers/`.

---

Made with ❤️ for better code everywhere.
