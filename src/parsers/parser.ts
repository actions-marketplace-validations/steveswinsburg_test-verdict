import { XMLParser } from 'fast-xml-parser';
import type { FormatId, NormalizedCoverageReport } from '../types/coverage.js';

/** Contract implemented by every coverage report format module. */
export interface CoverageParser {
  readonly id: FormatId;
  canParse(filePath: string, snippet: string): boolean;
  parse(content: string, sourceFile?: string): NormalizedCoverageReport;
}

const sharedXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
});

/** Parse an XML string with consistent attribute handling across XML parsers. */
export function parseXml(content: string): Record<string, unknown> {
  const parsed: unknown = sharedXmlParser.parse(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid XML document');
  }
  return parsed as Record<string, unknown>;
}

/** Normalize single-item or array XML child nodes into an array. */
export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parse a numeric XML attribute safely. */
export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
