# Test Verdict Examples

Copy-pasteable workflows and CLI commands covering every supported coverage report format, parameter combination, and monorepo configuration.

## Contents

- [By Coverage Format](#by-coverage-format)
  - [1. LCOV (`.info`) - TypeScript / Vitest](#1-lcov-info---typescript--vitest)
  - [2. Cobertura XML - Python (`pytest-cov`) and .NET (`coverlet`)](#2-cobertura-xml---python-pytest-cov-and-net-coverlet)
  - [3. JaCoCo XML - Java / Kotlin (Gradle & Maven)](#3-jacoco-xml---java--kotlin-gradle--maven)
  - [4. Istanbul / Jest JSON - JavaScript / TypeScript](#4-istanbul--jest-json---javascript--typescript)
  - [5. Go `coverprofile` - Go](#5-go-coverprofile---go)
  - [6. OpenCover XML - .NET (`AltCover` / `OpenCover`)](#6-opencover-xml---net-altcover--opencover)
- [Workflow & Parameter Recipes](#workflow--parameter-recipes)
  - [7. Warn-Only Mode (Non-Blocking Rollout)](#7-warn-only-mode-non-blocking-rollout)
  - [8. Multiple Suites with Separate Sticky Comments](#8-multiple-suites-with-separate-sticky-comments)
  - [9. Merging Unit + Integration Reports](#9-merging-unit--integration-reports)
  - [10. Job Step Summary Only (No PR Comments)](#10-job-step-summary-only-no-pr-comments)
  - [11. Polyglot Monorepo with `.test-verdict.yml` and `working-directory`](#11-polyglot-monorepo-with-test-verdictyml-and-working-directory)
  - [12. Using Action Outputs in Downstream Steps](#12-using-action-outputs-in-downstream-steps)
- [Standalone CLI Recipes](#standalone-cli-recipes)

---

## By Coverage Format

### 1. LCOV (`.info`) - TypeScript / Vitest

Auto-detects `coverage/lcov.info`, excludes generated/test files, and enforces overall line, branch, function, and PR diff line thresholds.

```yaml
name: Coverage (LCOV)

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
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx vitest run --coverage --coverage.reporter=lcov

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/lcov.info
          exclude: |
            **/*.generated.ts
            **/__tests__/**
          min-line: 85
          min-branch: 75
          min-function: 85
          min-diff-line: 90
```

CLI equivalent:

```bash
npx test-verdict \
  --files coverage/lcov.info \
  --exclude "**/*.generated.ts" \
  --exclude "**/__tests__/**" \
  --min-line 85 \
  --min-branch 75 \
  --min-function 85 \
  --min-diff-line 90 \
  --diff-base origin/main
```

### 2. Cobertura XML - Python (`pytest-cov`) and .NET (`coverlet`)

Cobertura XML is the standard format for Python (`pytest-cov`, `coverage.py`) and .NET (`coverlet`). This example checks both overall line coverage and PR diff line + branch coverage.

```yaml
name: Coverage (Cobertura)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt pytest pytest-cov
      - run: pytest --cov=src --cov-branch --cov-report=xml:coverage.xml

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage.xml
          format: cobertura
          min-line: 80
          min-diff-line: 90
          min-diff-branch: 80
```

For .NET with `coverlet`:

```yaml
      - run: dotnet test --collect:"XPlat Code Coverage" --results-directory TestResults
      - uses: steveswinsburg/test-verdict@v1
        with:
          files: TestResults/**/coverage.cobertura.xml
          min-line: 80
          min-diff-line: 90
          min-diff-branch: 80
```

CLI equivalent:

```bash
npx test-verdict -f coverage.xml --format cobertura --min-line 80 --min-diff-line 90 --min-diff-branch 80 --diff-base origin/main
```

### 3. JaCoCo XML - Java / Kotlin (Gradle & Maven)

JaCoCo XML reports often contain relative package paths (`com/acme/OrderService.java`). `test-verdict` automatically resolves them against your repository tree (e.g. `services/api/src/main/java/com/acme/OrderService.java`).

```yaml
name: Coverage (JaCoCo)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  java-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
      - run: ./gradlew test jacocoTestReport

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: "**/build/reports/jacoco/test/jacocoTestReport.xml"
          format: jacoco
          exclude: |
            **/generated/**
            **/*Application.java
          min-line: 85
          min-branch: 75
```

For Maven multi-module builds, point `files:` at `**/target/site/jacoco/jacoco.xml`.

CLI equivalent:

```bash
npx test-verdict -f "**/target/site/jacoco/jacoco.xml" --format jacoco --exclude "**/generated/**" --min-line 85 --min-branch 75
```

### 4. Istanbul / Jest JSON - JavaScript / TypeScript

Supports both Jest/Istanbul `coverage-final.json` (line, branch, function, and PR diff coverage) and `coverage-summary.json`.

```yaml
name: Coverage (Istanbul JSON)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  jest-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx jest --coverage --coverageReporters=json

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/coverage-final.json
          format: istanbul
          min-line: 80
          min-function: 85
          min-diff-line: 90
```

CLI equivalent:

```bash
npx test-verdict -f coverage/coverage-final.json --format istanbul --min-line 80 --min-function 85 --min-diff-line 90 --diff-base origin/main
```

### 5. Go `coverprofile` - Go

Parses native `go test -coverprofile=coverage.out ./...` output and strips Go module import prefixes (e.g. `github.com/org/repo/pkg/math.go` -> `pkg/math.go`).

> **Note on missing metrics:** Go `coverprofile` only tracks statement/line coverage and does not emit branch or function counts. If `min-branch` or `min-function` is configured, `test-verdict` emits a warning and skips that check rather than falsely failing at `0%`.

```yaml
name: Coverage (Go)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  go-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - run: go test -covermode=count -coverprofile=coverage.out ./...

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage.out
          format: gocover
          exclude: "**/*_mock.go"
          min-line: 80
          min-diff-line: 90
```

CLI equivalent:

```bash
npx test-verdict -f coverage.out --format gocover --exclude "**/*_mock.go" --min-line 80 --min-diff-line 90 --diff-base origin/main
```

### 6. OpenCover XML - .NET (`AltCover` / `OpenCover`)

Parses OpenCover XML reports produced by `AltCover` or `OpenCover` and normalizes Windows paths (`\` -> `/`).

```yaml
name: Coverage (OpenCover)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  dotnet-tests:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'
      - run: dotnet test /p:AltCover=true /p:AltCoverXmlReport=coverage.opencover.xml

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: "**/coverage.opencover.xml"
          format: opencover
          exclude: "**/*.Designer.cs"
          min-line: 80
          min-branch: 70
```

CLI equivalent:

```bash
npx test-verdict -f "**/coverage.opencover.xml" --format opencover --exclude "**/*.Designer.cs" --min-line 80 --min-branch 70
```

---

## Workflow & Parameter Recipes

### 7. Warn-Only Mode (Non-Blocking Rollout)

Useful when rolling out coverage tracking on an existing codebase: posts the PR comment and warnings without failing the workflow check (`enforce: false`), and ignores missing reports (`fail-on-empty: false`).

```yaml
      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/lcov.info
          min-line: 80
          min-diff-line: 90
          enforce: false
          fail-on-empty: false
```

### 8. Multiple Suites with Separate Sticky Comments

Use distinct `report-id` and `title` values when running `test-verdict` in multiple jobs or steps so each suite maintains its own sticky PR comment without overwriting the others.

```yaml
      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/unit/lcov.info
          report-id: unit-tests
          title: Unit Test Coverage
          min-line: 85

      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/e2e/lcov.info
          report-id: e2e-tests
          title: E2E Coverage
          min-line: 60
          enforce: false
```

### 9. Merging Unit + Integration Reports

Pass multiple globs (or mixed formats) to `files:` in a single step to merge overlapping line hit counts into one combined verdict.

```yaml
      - uses: steveswinsburg/test-verdict@v1
        with:
          files: |
            reports/unit/lcov.info
            reports/integration/jacoco.xml
          title: Combined Test Coverage
          min-line: 85
          min-diff-line: 90
```

### 10. Job Step Summary Only (No PR Comments)

Keep PR conversation threads completely clean while still publishing the full breakdown in the GitHub Actions Step Summary and enforcing branch-protection checks.

```yaml
      - uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/lcov.info
          min-line: 80
          comment: false
          step-summary: true
```

### 11. Polyglot Monorepo with `.test-verdict.yml` and `working-directory`

Place a config file (default `.test-verdict.yml`, or specify a custom path via `config:`) to define global defaults alongside independent per-service groups in a single PR comment.

`packages/.test-verdict.yml`:

```yaml
title: Monorepo Coverage
report-id: monorepo
exclude:
  - "**/*.generated.*"
  - "**/__tests__/**"
thresholds:
  min-line: 80
  min-diff-line: 85
enforce: true
fail-on-empty: true
groups:
  - name: backend-java
    files:
      - "services/api/**/jacocoTestReport.xml"
    format: jacoco
    thresholds:
      min-line: 85
      min-branch: 75
  - name: worker-python
    files:
      - "services/worker/coverage.xml"
    format: cobertura
    exclude:
      - "**/migrations/**"
    thresholds:
      min-line: 80
  - name: frontend-web
    files:
      - "apps/web/coverage/lcov.info"
    format: lcov
    thresholds:
      min-line: 80
      min-diff-line: 90
```

Workflow step using `config` and `working-directory`:

```yaml
      - uses: steveswinsburg/test-verdict@v1
        with:
          working-directory: packages
          config: .test-verdict.yml
```

### 12. Using Action Outputs in Downstream Steps

Capture the step outputs (`line-coverage`, `branch-coverage`, `function-coverage`, `diff-coverage`, `passed`, `summary-json`) for custom Slack notifications, badges, or conditional steps. Use `if: always()` so downstream steps still run even when `enforce: true` fails the check.

```yaml
      - name: Evaluate coverage
        id: verdict
        uses: steveswinsburg/test-verdict@v1
        with:
          files: coverage/lcov.info
          min-line: 80
          min-diff-line: 90

      - name: Inspect verdict outputs
        if: always()
        run: |
          echo "Passed: ${{ steps.verdict.outputs.passed }}"
          echo "Line coverage: ${{ steps.verdict.outputs.line-coverage }}%"
          echo "Branch coverage: ${{ steps.verdict.outputs.branch-coverage }}%"
          echo "Function coverage: ${{ steps.verdict.outputs.function-coverage }}%"
          echo "Diff coverage: ${{ steps.verdict.outputs.diff-coverage }}%"
          echo '${{ steps.verdict.outputs.summary-json }}' | jq '.overall.summary'
```

---

## Standalone CLI Recipes

Run `test-verdict` locally, in pre-push hooks, or in non-GitHub CI systems (GitLab CI, Buildkite, CircleCI, Jenkins):

```bash
# 1. Basic overall coverage gate
npx test-verdict --files coverage/lcov.info --min-line 80

# 2. Check PR/branch diff coverage against origin/main and output Markdown
npx test-verdict \
  -f coverage/lcov.info \
  --min-line 80 \
  --min-diff-line 90 \
  --diff-base origin/main \
  --markdown

# 3. Merge multiple reports and exclude generated code
npx test-verdict \
  -f coverage/unit.info \
  -f coverage/integration.xml \
  -e "**/*.generated.*" \
  -e "**/mocks/**" \
  --title "Backend Coverage" \
  --report-id backend \
  --min-line 85

# 4. Run from a subdirectory with a custom config file
npx test-verdict --working-dir packages/api -c .coverage-gate.yml

# 5. Warn-only mode (always exits 0 even if thresholds fail or globs are empty)
npx test-verdict -f coverage/lcov.info --min-line 95 --no-enforce --no-fail-on-empty

# 6. Emit machine-readable JSON for downstream CI scripts
npx test-verdict -f coverage/lcov.info --json > verdict-summary.json
```
