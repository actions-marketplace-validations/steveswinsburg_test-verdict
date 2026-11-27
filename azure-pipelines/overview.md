# Test Verdict for Azure Pipelines

Universal test & code coverage PR decorator and merge gate for every major coverage report format.

## Features

- **Format-agnostic auto-detection**: Parses and merges LCOV, Cobertura XML, JaCoCo XML, Istanbul/Jest JSON, Go `coverprofile`, and OpenCover XML reports in a single pass.
- **Overall and PR diff coverage**: Gates both total repository coverage and changed lines in the pull request.
- **Sticky PR comment threads**: Creates or updates a single PR comment thread per `reportId`, setting thread status to `active` on failure and `closed` once passing.
- **Build Summary tab**: Uploads the full file-by-file breakdown directly to the Azure Pipelines Build Summary.
- **Monorepo coverage groups**: Configure per-service suites and independent thresholds in `.test-verdict.yml`.

## Quickstart

```yaml
steps:
  - checkout: self
    fetchDepth: 0

  - script: npm ci && npm test -- --coverage
    displayName: Run tests

  - task: TestVerdict@0
    inputs:
      files: coverage/lcov.info
      minLine: 80
      minDiffLine: 90
```

See the full documentation and permission setup guide in the [GitHub repository](https://github.com/steveswinsburg/test-verdict/blob/main/AZURE_PIPELINES.md).
