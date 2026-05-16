import type { Glob } from 'bun';

import type { GildashOptions, Gildash } from '@zipbul/gildash';
import type { AstParser, AdapterDefinitionResolver } from '../../compiler/analyzer';
import type { ResolvedConfig } from '../../config';
import type { ConfigSource } from '../../config/interfaces';
import type { EntryGenerator, ManifestGenerator } from '../../compiler/generator';

export interface BuildCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedConfig; source: ConfigSource }>;
  createParser: () => AstParser;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  createAdapterDefinitionResolver: () => AdapterDefinitionResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  resolveImport: (specifier: string, fromDir: string) => string;
  buildBundle: typeof Bun.build;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
}
