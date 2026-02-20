import { basename, join, relative, resolve, sep } from 'path';

import type { ConfigLoadResult, JsonRecord, JsonValue, ResolvedZipbulConfig, ResolvedZipbulConfigMcp } from './interfaces';

import { ConfigLoadError } from './errors';

export class ConfigLoader {
  static async load(cwd: string = process.cwd()): Promise<ConfigLoadResult> {
    const jsonPath = join(cwd, 'zipbul.json');
    const jsoncPath = join(cwd, 'zipbul.jsonc');
    const jsonExists = await Bun.file(jsonPath).exists();
    const jsoncExists = await Bun.file(jsoncPath).exists();

    if (jsonExists && jsoncExists) {
      throw new ConfigLoadError('Invalid zipbul config: zipbul.json and zipbul.jsonc cannot both exist.', '.');
    }

    if (!jsonExists && !jsoncExists) {
      throw new ConfigLoadError('Missing zipbul config: zipbul.json or zipbul.jsonc is required.', '.');
    }

    const candidate = jsonExists
      ? { path: jsonPath, format: 'json' as const }
      : { path: jsoncPath, format: 'jsonc' as const };

    try {
      // NOTE: Avoid emitting non-JSON noise to stderr. Some CLI commands (e.g. `zp mcp verify`)
      // print structured diagnostics to stderr that tests parse as JSON.
      if (process.env.ZIPBUL_DEBUG_CONFIG === '1') {
        console.info(`🔧 Loading config from ${candidate.path}`);
      }

      const resolved = await ConfigLoader.loadJsonConfig(candidate.path, cwd, candidate.format);
      const moduleConfig = resolved.module;
      const fileName = moduleConfig?.fileName;

      if (moduleConfig === undefined || moduleConfig === null || Array.isArray(moduleConfig)) {
        throw new ConfigLoadError('Invalid zipbul config: module is required.', relative(cwd, candidate.path));
      }

      if (typeof fileName !== 'string' || fileName.length === 0) {
        throw new ConfigLoadError('Invalid zipbul config: module.fileName is required.', relative(cwd, candidate.path));
      }

      if (basename(fileName) !== fileName || fileName.includes('/') || fileName.includes('\\')) {
        throw new ConfigLoadError(
          'Invalid zipbul config: module.fileName must be a single filename.',
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

      throw new ConfigLoadError('Failed to load zipbul config.', relative(cwd, candidate.path));
    }
  }

  private static isRecord(value: JsonValue | undefined): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static isNonEmptyString(value: JsonValue | undefined): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private static toResolvedConfig(value: JsonValue, sourcePath: string, projectRoot: string): ResolvedZipbulConfig {
    if (!this.isRecord(value)) {
      throw new ConfigLoadError('Invalid zipbul config: must be an object.', sourcePath);
    }

    const moduleValue = value.module;

    if (!this.isRecord(moduleValue)) {
      throw new ConfigLoadError('Invalid zipbul config: module is required.', sourcePath);
    }

    const fileName = moduleValue.fileName;

    if (!this.isNonEmptyString(fileName)) {
      throw new ConfigLoadError('Invalid zipbul config: module.fileName is required.', sourcePath);
    }

    const sourceDir = value.sourceDir;

    if (!this.isNonEmptyString(sourceDir)) {
      throw new ConfigLoadError('Invalid zipbul config: sourceDir is required.', sourcePath);
    }

    const entry = value.entry;

    if (!this.isNonEmptyString(entry)) {
      throw new ConfigLoadError('Invalid zipbul config: entry is required.', sourcePath);
    }

    const resolvedSourceDir = resolve(projectRoot, sourceDir);
    const resolvedEntry = resolve(projectRoot, entry);
    const entryRelative = relative(resolvedSourceDir, resolvedEntry);

    if (entryRelative === '' || entryRelative.startsWith('..') || entryRelative.includes(`..${sep}`)) {
      throw new ConfigLoadError('Invalid zipbul config: entry must be within sourceDir.', sourcePath);
    }

    const mcp = this.toResolvedMcpConfig(value.mcp, sourcePath);

    const config: ResolvedZipbulConfig = {
      module: { fileName },
      sourceDir,
      entry,
      mcp,
    };

    return config;
  }

  private static toResolvedMcpConfig(value: JsonValue | undefined, sourcePath: string): ResolvedZipbulConfigMcp {
    if (value === undefined || value === null) {
      return { exclude: [] };
    }

    if (!this.isRecord(value)) {
      throw new ConfigLoadError('Invalid zipbul config: mcp must be an object.', sourcePath);
    }

    let exclude: string[] = [];

    if (value.exclude !== undefined) {
      if (!Array.isArray(value.exclude) || !value.exclude.every((item) => typeof item === 'string')) {
        throw new ConfigLoadError('Invalid zipbul config: mcp.exclude must be a string array.', sourcePath);
      }

      exclude = value.exclude as string[];
    }

    return { exclude };
  }

  private static async loadJsonConfig(
    path: string,
    cwd: string,
    format: 'json' | 'jsonc',
  ): Promise<ResolvedZipbulConfig> {
    const sourcePath = relative(cwd, path);
    const rawText = await Bun.file(path).text();
    let parsed: JsonValue;

    try {
      parsed = (format === 'jsonc' ? Bun.JSONC.parse(rawText) : JSON.parse(rawText)) as JsonValue;
    } catch (_error) {
      throw new ConfigLoadError('Invalid zipbul config: failed to parse json/jsonc.', sourcePath);
    }

    return this.toResolvedConfig(parsed, sourcePath, cwd);
  }
}
