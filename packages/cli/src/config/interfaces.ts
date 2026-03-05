export type ConfigSourceFormat = 'json' | 'jsonc';

export interface ConfigSource {
  path: string;
  format: ConfigSourceFormat;
}

export interface ResolvedConfigModule {
  fileName: string;
}

export interface ResolvedConfig {
  module: ResolvedConfigModule;
  sourceDir: string;
  entry: string;
}

export interface ConfigLoadResult {
  config: ResolvedConfig;
  source: ConfigSource;
}

export type JsonPrimitive = string | number | boolean | null;

export interface JsonRecord {
  [key: string]: JsonValue;
}

export interface JsonArray extends Array<JsonValue> {}

export type JsonValue = JsonPrimitive | JsonRecord | JsonArray;
