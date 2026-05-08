import type { Subprocess } from 'bun';

import type { CliRendererLike } from '../interfaces';

import type { AdapterDefinitionResolver, AstParser, FileAnalysis } from '../../compiler/analyzer';
import type { ModuleGraph } from '../../compiler/analyzer/graph/module-graph';
import type { ResolvedConfig } from '../../config';
import type { ConfigSource } from '../../config/interfaces';
import type { EntryGenerator, ManifestGenerator } from '../../compiler/generator';
import type { GildashOptions } from '@zipbul/gildash';
import type { Gildash } from '@zipbul/gildash';
import type { Glob } from 'bun';

export interface DevCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedConfig; source: ConfigSource }>;
  createParser: () => AstParser;
  createAdapterDefinitionResolver: () => AdapterDefinitionResolver;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
  spawnProcess?: (command: string[], cwd: string) => Subprocess;
  renderer: CliRendererLike;
}

export interface RebuildResult {
  graph: ModuleGraph;
  handlerIndex: readonly { id: string }[];
}

export interface RebuildOptions {
  skipCycleCheck?: boolean;
}

export interface RebuildContext {
  parser: AstParser;
  adapterDefinitionResolver: AdapterDefinitionResolver;
  manifestGen: ManifestGenerator;
  entryGen: EntryGenerator;
  fileCache: Map<string, FileAnalysis>;
  fingerprintCache: Map<string, string>;
  previousSignatures: Map<string, string> | undefined;
  renderer: CliRendererLike;
  moduleFileName: string;
  srcDir: string;
  outDir: string;
  projectRoot: string;
  config: ResolvedConfig;
  configSource: ConfigSource;
  semanticAvailable: boolean;
  ledger: Gildash;
}
