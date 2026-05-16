import type { ClassMetadata } from '../interfaces';
import type { ModuleDefinition } from '../parser-models';
import type { AnalyzerValue } from '../types';
import type { ProviderRef } from './interfaces';

export class ModuleNode {
  name: string;
  metadata: ClassMetadata;
  filePath: string;
  moduleDefinition?: ModuleDefinition;
  imports: Set<ModuleNode> = new Set();
  dynamicImports: Set<AnalyzerValue> = new Set();
  providers: Map<string, ProviderRef> = new Map();
  exports: Set<string> = new Set();
  controllers: Set<string> = new Set();

  visiting: boolean = false;
  visited: boolean = false;

  constructor(metadata: ClassMetadata) {
    this.name = metadata.className;
    this.metadata = metadata;
    this.filePath = '';
  }
}
