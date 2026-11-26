import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RUNNER_PREFIX_PATTERNS = [
  /^\/home\/runner\/work\/[^/]+\/[^/]+\//,
  /^\/home\/vsts\/work\/[^/]+\/s\//,
  /^\/Users\/runner\/work\/[^/]+\/[^/]+\//,
  /^\/github\/workspace\//,
  /^\/__w\/[^/]+\/[^/]+\//,
  /^\/workspace\//,
  /^\/app\//,
  /^[a-zA-Z]:\/a\/[^/]+\/[^/]+\//,
];

/** Normalize slashes and strip leading `./`. */
export function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

/** Strip CI runner prefixes or workingDirectory prefix from a file path. */
export function stripKnownPrefixes(rawPath: string, workingDirectory?: string): string {
  let cleaned = normalizePathSeparators(rawPath.trim());

  if (workingDirectory) {
    const normWd = normalizePathSeparators(path.resolve(workingDirectory)).replace(/\/+$/, '');
    if (cleaned.startsWith(`${normWd}/`)) {
      cleaned = cleaned.slice(normWd.length + 1);
    }
  }

  for (const pattern of RUNNER_PREFIX_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '');
      break;
    }
  }

  return cleaned.replace(/^\.\//, '');
}

/** Collect tracked repository file paths via `git ls-files`. */
export function getRepoFiles(workingDirectory: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: workingDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\r?\n/)
      .map((line) => normalizePathSeparators(line.trim()))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create a path normalizer that maps raw report paths (including JaCoCo package paths,
 * Docker `/app/...`, runner `/home/runner/work/...`, and Windows `\`) to repo-relative paths.
 */
export function createPathNormalizer(
  repoFiles: string[],
  workingDirectory?: string,
): (rawPath: string) => string {
  const normalizedRepoFiles = repoFiles.map(normalizePathSeparators);
  const repoSet = new Set(normalizedRepoFiles);

  return (rawPath: string): string => {
    const cleaned = stripKnownPrefixes(rawPath, workingDirectory);
    if (repoSet.has(cleaned)) {
      return cleaned;
    }

    const withoutLeadingSlash = cleaned.replace(/^\/+/, '');
    if (repoSet.has(withoutLeadingSlash)) {
      return withoutLeadingSlash;
    }

    // Suffix match (e.g. JaCoCo "com/acme/App.java" -> "src/main/java/com/acme/App.java")
    const suffix = `/${withoutLeadingSlash}`;
    const suffixMatches = normalizedRepoFiles.filter(
      (candidate) => candidate === withoutLeadingSlash || candidate.endsWith(suffix),
    );
    if (suffixMatches.length === 1) {
      return suffixMatches[0]!;
    }

    // Progressive tail-segment fallback for deeply prefixed paths not matching runner regexes
    const segments = withoutLeadingSlash.split('/').filter(Boolean);
    for (let i = 1; i < segments.length; i += 1) {
      const candidatePath = segments.slice(i).join('/');
      if (repoSet.has(candidatePath)) {
        return candidatePath;
      }
    }

    return withoutLeadingSlash;
  };
}
