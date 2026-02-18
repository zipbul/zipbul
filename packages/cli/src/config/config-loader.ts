import { basename, join, relative, resolve, sep } from 'path';

import type { ConfigLoadResult, JsonRecord, JsonValue, ResolvedBunnerConfig, ResolvedBunnerConfigMcp } from './interfaces';

import { ConfigLoadError } from './errors';

export const CARD_RELATION_TYPES = ['depends-on', 'references', 'related', 'extends', 'conflicts'] as const;
export type CardRelationType = (typeof CARD_RELATION_TYPES)[number];

const CARD_RELATION_TYPE_SET: ReadonlySet<string> = new Set(CARD_RELATION_TYPES);

function isCardRelationType(value: string): value is CardRelationType {
  return CARD_RELATION_TYPE_SET.has(value);
}

export class ConfigLoader {
  static async load(cwd: string = process.cwd()): Promise<ConfigLoadResult> {
    const jsonPath = join(cwd, 'bunner.json');
    const jsoncPath = join(cwd, 'bunner.jsonc');
    const jsonExists = await Bun.file(jsonPath).exists();
    const jsoncExists = await Bun.file(jsoncPath).exists();

    if (jsonExists && jsoncExists) {
      throw new ConfigLoadError('Invalid bunner config: bunner.json and bunner.jsonc cannot both exist.', '.');
    }

    if (!jsonExists && !jsoncExists) {
      throw new ConfigLoadError('Missing bunner config: bunner.json or bunner.jsonc is required.', '.');
    }

    const candidate = jsonExists
      ? { path: jsonPath, format: 'json' as const }
      : { path: jsoncPath, format: 'jsonc' as const };

    try {
      console.error(`🔧 Loading config from ${candidate.path}`);

      const resolved = await ConfigLoader.loadJsonConfig(candidate.path, cwd, candidate.format);
      const moduleConfig = resolved.module;
      const fileName = moduleConfig?.fileName;

      if (moduleConfig === undefined || moduleConfig === null || Array.isArray(moduleConfig)) {
        throw new ConfigLoadError('Invalid bunner config: module is required.', relative(cwd, candidate.path));
      }

      if (typeof fileName !== 'string' || fileName.length === 0) {
        throw new ConfigLoadError('Invalid bunner config: module.fileName is required.', relative(cwd, candidate.path));
      }

      if (basename(fileName) !== fileName || fileName.includes('/') || fileName.includes('\\')) {
        throw new ConfigLoadError(
          'Invalid bunner config: module.fileName must be a single filename.',
          relative(cwd, candidate.path),
        );
      }

      return {
        config: resolved,
        source: {
          path: relative(cwd, candidate.path),
          format: candidate.format,
        },
      };
    } catch (error) {
      if (error instanceof ConfigLoadError) {
        throw error;
      }

      throw new ConfigLoadError('Failed to load bunner config.', relative(cwd, candidate.path));
    }
  }

  private static isRecord(value: JsonValue | undefined): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static isNonEmptyString(value: JsonValue | undefined): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private static isNonEmptyStringArray(value: JsonValue | undefined): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
  }

  private static normalizeRelationTypes(value: string[], sourcePath: string): string[] {
    const out: string[] = [];
    for (const raw of value) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        throw new ConfigLoadError('Invalid bunner config: mcp.card.relations must be a non-empty string array.', sourcePath);
      }
      if (!isCardRelationType(trimmed)) {
        throw new ConfigLoadError(`Invalid bunner config: mcp.card.relations contains unknown relation type: ${trimmed}`, sourcePath);
      }
      out.push(trimmed);
    }
    return out;
  }

  private static toResolvedConfig(value: JsonValue, sourcePath: string, projectRoot: string): ResolvedBunnerConfig {
    if (!this.isRecord(value)) {
      throw new ConfigLoadError('Invalid bunner config: must be an object.', sourcePath);
    }

    const moduleValue = value.module;

    if (!this.isRecord(moduleValue)) {
      throw new ConfigLoadError('Invalid bunner config: module is required.', sourcePath);
    }

    const fileName = moduleValue.fileName;

    if (!this.isNonEmptyString(fileName)) {
      throw new ConfigLoadError('Invalid bunner config: module.fileName is required.', sourcePath);
    }

    const sourceDir = value.sourceDir;

    if (!this.isNonEmptyString(sourceDir)) {
      throw new ConfigLoadError('Invalid bunner config: sourceDir is required.', sourcePath);
    }

    const entry = value.entry;

    if (!this.isNonEmptyString(entry)) {
      throw new ConfigLoadError('Invalid bunner config: entry is required.', sourcePath);
    }

    const resolvedSourceDir = resolve(projectRoot, sourceDir);
    const resolvedEntry = resolve(projectRoot, entry);
    const entryRelative = relative(resolvedSourceDir, resolvedEntry);

    if (entryRelative === '' || entryRelative.startsWith('..') || entryRelative.includes(`..${sep}`)) {
      throw new ConfigLoadError('Invalid bunner config: entry must be within sourceDir.', sourcePath);
    }

    const mcp = this.toResolvedMcpConfig(value.mcp, sourcePath);

    const config: ResolvedBunnerConfig = {
      module: { fileName },
      sourceDir,
      entry,
      mcp,
    };

    return config;
  }

  private static toResolvedMcpConfig(value: JsonValue | undefined, sourcePath: string): ResolvedBunnerConfigMcp {
    if (value === undefined || value === null) {
      return {
        card: {
          relations: [...CARD_RELATION_TYPES],
        },
        exclude: [],
      };
    }

    if (!this.isRecord(value)) {
      throw new ConfigLoadError('Invalid bunner config: mcp must be an object.', sourcePath);
    }

    const cardValue = value.card;
    let relations: string[] = [...CARD_RELATION_TYPES];

    if (cardValue !== undefined && cardValue !== null) {
      if (!this.isRecord(cardValue)) {
        throw new ConfigLoadError('Invalid bunner config: mcp.card must be an object.', sourcePath);
      }

      if (cardValue.types !== undefined) {
        throw new ConfigLoadError('Invalid bunner config: mcp.card.types is removed.', sourcePath);
      }

      if (cardValue.relations !== undefined) {
        if (!this.isNonEmptyStringArray(cardValue.relations)) {
          throw new ConfigLoadError('Invalid bunner config: mcp.card.relations must be a non-empty string array.', sourcePath);
        }

        relations = this.normalizeRelationTypes(cardValue.relations, sourcePath);
      }
    }

    let exclude: string[] = [];

    if (value.exclude !== undefined) {
      if (!Array.isArray(value.exclude) || !value.exclude.every((item) => typeof item === 'string')) {
        throw new ConfigLoadError('Invalid bunner config: mcp.exclude must be a string array.', sourcePath);
      }

      exclude = value.exclude as string[];
    }

    return {
      card: { relations },
      exclude,
    };
  }

  private static async loadJsonConfig(
    path: string,
    cwd: string,
    format: 'json' | 'jsonc',
  ): Promise<ResolvedBunnerConfig> {
    const sourcePath = relative(cwd, path);
    const rawText = await Bun.file(path).text();
    let parsed: JsonValue;

    try {
      parsed = (format === 'jsonc' ? Bun.JSONC.parse(rawText) : JSON.parse(rawText)) as JsonValue;
    } catch (_error) {
      throw new ConfigLoadError('Invalid bunner config: failed to parse json/jsonc.', sourcePath);
    }

    return this.toResolvedConfig(parsed, sourcePath, cwd);
  }
}
