export type ZipbulConfigSourceFormat = 'json' | 'jsonc';

export interface ZipbulConfigSource {
  path: string;
  format: ZipbulConfigSourceFormat;
}

export interface ResolvedZipbulConfigModule {
  fileName: string;
}

export interface ResolvedZipbulConfigCard {
  relations: string[];
}

export interface ResolvedZipbulConfigMcp {
  card: ResolvedZipbulConfigCard;
  exclude: string[];
}

export interface ResolvedZipbulConfig {
  module: ResolvedZipbulConfigModule;
  sourceDir: string;
  entry: string;
  mcp: ResolvedZipbulConfigMcp;
}

export interface ConfigLoadResult {
  config: ResolvedZipbulConfig;
  source: ZipbulConfigSource;
}

export type JsonPrimitive = string | number | boolean | null;

export interface JsonRecord {
  [key: string]: JsonValue;
}

export interface JsonArray extends Array<JsonValue> {}

export type JsonValue = JsonPrimitive | JsonRecord | JsonArray;
