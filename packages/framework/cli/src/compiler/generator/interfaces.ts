import type { ClassMetadata } from '../analyzer';
import type { ModuleGraph } from '../analyzer/graph/module-graph';
import type { AdapterStaticSchema, HandlerIndexEntry } from '../analyzer/interfaces';
import type { AnalyzerValue } from '../analyzer/types';
import type { ConfigSource, ResolvedConfig } from '../../config/interfaces';

export interface ManifestJsonParams {
  graph: ModuleGraph;
  projectRoot: string;
  source: ConfigSource;
  resolvedConfig: ResolvedConfig;
  adapterStaticSchemas: Record<string, AdapterStaticSchema>;
  handlerIndex: HandlerIndexEntry[];
}

export interface MetadataClassEntry {
  metadata: ClassMetadata;
  filePath: string;
}

export interface ManifestModuleDescriptor {
  id: string;
  name: string;
  rootDir: string;
  file: string;
}

export interface ManifestDiNode {
  id: string;
  token: string;
  deps: string[];
  scope: string;
  provider: ManifestProviderRef;
}

export interface ManifestProviderRef {
  token: string;
}

export interface ManifestResolvedModuleConfig {
  fileName: string;
}

export interface ManifestConfig {
  sourcePath: string;
  sourceFormat: string;
  resolvedModuleConfig: ManifestResolvedModuleConfig;
}

export interface ManifestDiGraph {
  nodes: ManifestDiNode[];
}

export interface ManifestJsonModel {
  config: ManifestConfig;
  modules: ManifestModuleDescriptor[];
  adapterStaticSchemas: Record<string, AdapterStaticSchema>;
  diGraph: ManifestDiGraph;
  handlerIndex: HandlerIndexEntry[];
}

export interface ImportRegistryEntry {
  path: string;
  alias: string;
  originalName: string;
}

export type ManifestTokenFunction = (...args: readonly AnalyzerValue[]) => AnalyzerValue;

export type ManifestProviderToken = AnalyzerValue | ClassMetadata | ManifestTokenFunction | symbol;
