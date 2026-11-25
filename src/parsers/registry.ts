import type { FormatId, NormalizedCoverageReport } from '../types/coverage.js';
import { coberturaParser } from './cobertura.js';
import { gocoverParser } from './gocover.js';
import { istanbulParser } from './istanbul.js';
import { jacocoParser } from './jacoco.js';
import { lcovParser } from './lcov.js';
import { opencoverParser } from './opencover.js';
import type { CoverageParser } from './parser.js';

/** Registry of built-in coverage format modules with format auto-detection. */
export class ParserRegistry {
  private readonly parsers = new Map<FormatId, CoverageParser>();

  constructor(initialParsers: CoverageParser[] = []) {
    for (const parser of initialParsers) {
      this.register(parser);
    }
  }

  register(parser: CoverageParser): void {
    this.parsers.set(parser.id, parser);
  }

  get(id: FormatId): CoverageParser | undefined {
    return this.parsers.get(id);
  }

  listFormats(): FormatId[] {
    return Array.from(this.parsers.keys());
  }

  detect(filePath: string, content: string): CoverageParser | undefined {
    const snippet = content.slice(0, 4096);
    for (const parser of this.parsers.values()) {
      if (parser.canParse(filePath, snippet)) {
        return parser;
      }
    }
    return undefined;
  }

  parse(content: string, filePath: string, formatOverride: FormatId | 'auto' = 'auto'): NormalizedCoverageReport {
    if (formatOverride !== 'auto') {
      const explicit = this.parsers.get(formatOverride);
      if (!explicit) {
        throw new Error(`Unsupported coverage format: ${formatOverride}`);
      }
      return explicit.parse(content, filePath);
    }

    const detected = this.detect(filePath, content);
    if (!detected) {
      throw new Error(
        `Could not auto-detect coverage format for "${filePath}". Supported formats: ${this.listFormats().join(', ')}`,
      );
    }
    return detected.parse(content, filePath);
  }
}

/** Create a registry preloaded with all 6 v1 coverage parsers. */
export function createDefaultParserRegistry(): ParserRegistry {
  return new ParserRegistry([
    jacocoParser,
    coberturaParser,
    opencoverParser,
    lcovParser,
    istanbulParser,
    gocoverParser,
  ]);
}
