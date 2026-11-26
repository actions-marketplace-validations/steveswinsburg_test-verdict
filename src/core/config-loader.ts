import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { GroupConfig, ThresholdConfig, VerdictFileConfig } from '../types/config.js';
import type { FormatId } from '../types/coverage.js';

const VALID_FORMATS = new Set<string>(['auto', 'lcov', 'cobertura', 'jacoco', 'istanbul', 'gocover', 'opencover']);

function parseFormat(value: unknown): FormatId | 'auto' | undefined {
  if (value === undefined) return undefined;
  const s = String(value).trim().toLowerCase();
  if (!VALID_FORMATS.has(s)) {
    throw new Error(`Invalid format in config: "${s}"`);
  }
  return s as FormatId | 'auto';
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  throw new Error('Expected string or array of strings in config');
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`Threshold must be a number between 0 and 100, received "${String(value)}"`);
  }
  return num;
}

function parseThresholds(raw: unknown): ThresholdConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    minLine: parseNumber(obj.minLine ?? obj['min-line']),
    minBranch: parseNumber(obj.minBranch ?? obj['min-branch']),
    minFunction: parseNumber(obj.minFunction ?? obj['min-function']),
    minDiffLine: parseNumber(obj.minDiffLine ?? obj['min-diff-line']),
    minDiffBranch: parseNumber(obj.minDiffBranch ?? obj['min-diff-branch']),
  };
}

function parseGroups(raw: unknown): GroupConfig[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error('Config "groups" must be an array');
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Config group at index ${idx} must be an object`);
    }
    const obj = item as Record<string, unknown>;
    const name = String(obj.name ?? '').trim();
    if (!name) {
      throw new Error(`Config group at index ${idx} is missing "name"`);
    }
    const files = parseStringArray(obj.files);
    if (!files || files.length === 0) {
      throw new Error(`Config group "${name}" must specify at least one file glob in "files"`);
    }
    return {
      name,
      files,
      include: parseStringArray(obj.include),
      exclude: parseStringArray(obj.exclude),
      format: parseFormat(obj.format),
      thresholds: parseThresholds(obj.thresholds),
    };
  });
}

/** Return true when config auto-loading is explicitly disabled (`false`, `"none"`, or `"false"`). */
export function isConfigDisabled(configPath: string | false | undefined): boolean {
  if (configPath === false) return true;
  if (typeof configPath !== 'string') return false;
  const normalized = configPath.trim().toLowerCase();
  return normalized === 'none' || normalized === 'false';
}

/** Load and validate an optional `.test-verdict.yml` config file. */
export function loadConfigFile(
  workingDirectory: string,
  configPath: string | false = '.test-verdict.yml',
  isExplicit = false,
): VerdictFileConfig {
  if (isConfigDisabled(configPath)) {
    return {};
  }
  const targetPath = typeof configPath === 'string' && configPath.trim() ? configPath : '.test-verdict.yml';
  const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(workingDirectory, targetPath);
  if (!existsSync(resolved)) {
    if (isExplicit) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return {};
  }

  const rawText = readFileSync(resolved, 'utf8');
  const parsed: unknown = parseYaml(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const obj = parsed as Record<string, unknown>;
  return {
    title: obj.title !== undefined ? String(obj.title) : undefined,
    reportId: obj.reportId !== undefined ? String(obj.reportId) : obj['report-id'] !== undefined ? String(obj['report-id']) : undefined,
    files: parseStringArray(obj.files),
    include: parseStringArray(obj.include),
    exclude: parseStringArray(obj.exclude),
    format: parseFormat(obj.format),
    thresholds: parseThresholds(obj.thresholds),
    enforce: obj.enforce !== undefined ? Boolean(obj.enforce) : undefined,
    failOnEmpty:
      obj.failOnEmpty !== undefined
        ? Boolean(obj.failOnEmpty)
        : obj['fail-on-empty'] !== undefined
          ? Boolean(obj['fail-on-empty'])
          : undefined,
    groups: parseGroups(obj.groups),
  };
}
