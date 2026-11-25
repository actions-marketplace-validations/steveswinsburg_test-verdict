# Test Verdict

Universal test & code coverage PR decorator and merge gate for GitHub Actions and local CI.

`test-verdict` auto-detects and aggregates coverage reports across languages, normalises paths to your repository, evaluates overall and PR diff thresholds, updates a single sticky PR comment, and writes a full GitHub Job Step Summary.

## Supported Formats (v1)

| Format | Ecosystems / Tools |
| :--- | :--- |
| **LCOV** (`.info`) | JS/TS (Vitest, Jest, c8, Istanbul), Rust (`llvm-cov`, `tarpaulin`), Flutter/Dart, C/C++, Ruby, PHP |
| **Cobertura XML** | Python (`pytest-cov`, `coverage.py`), .NET (`coverlet`), Go (`gocover-cobertura`), Ruby, PHP |
| **JaCoCo XML** | Java, Kotlin, Scala, Groovy (Maven & Gradle) |
| **Istanbul / Jest JSON** | JS/TS (`coverage-final.json`, `coverage-summary.json`) |
| **Go `coverprofile`** | Go (`go test -coverprofile=coverage.out`) |
| **OpenCover XML** | .NET (`OpenCover`, `AltCover`) |

*(v2 roadmap: test execution results via JUnit XML & .NET TRX, plus base-branch delta tracking.)*

## Quickstart (GitHub Actions)

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

### Enforcing Merge Gates
Set `enforce: true` (the default) and mark the workflow job as a **required status check** in your repository's Branch Protection / Rulesets. Any threshold violation fails the check and blocks the PR merge.

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
| `files` | — | Newline or comma-separated coverage report globs |
| `format` | `auto` | `auto` \| `lcov` \| `cobertura` \| `jacoco` \| `istanbul` \| `gocover` \| `opencover` |
| `config` | `.test-verdict.yml` | Path to optional YAML config file |
| `exclude` | — | Newline or comma-separated source path exclusion globs |
| `report-id` | `default` | Identifier for sticky PR comments across multiple steps |
| `title` | `Test Verdict` | Heading for PR comments and step summaries |
| `min-line` | — | Minimum overall line coverage % (0–100) |
| `min-branch` | — | Minimum overall branch coverage % (0–100) |
| `min-function` | — | Minimum overall function coverage % (0–100) |
| `min-diff-line` | — | Minimum PR changed-lines coverage % (0–100) |
| `min-diff-branch` | — | Minimum PR changed-lines branch coverage % (0–100) |
| `enforce` | `true` | Fail the check when thresholds are breached |
| `fail-on-empty` | `true` | Fail if no coverage files match `files` |
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

## Local CLI Usage

```bash
npx test-verdict --files coverage/lcov.info --min-line 80 --diff-base origin/main --markdown
```

## Contributing a New Format Parser

1. Implement `CoverageParser` in `src/parsers/<format>.ts` (`id`, `canParse(filePath, snippet)`, `parse(content, sourceFile)`).
2. Register the parser in `createDefaultParserRegistry()` inside `src/parsers/registry.ts`.
3. Add realistic fixture files under `tests/fixtures/` and unit tests under `tests/parsers/`.
