import type { ClassMetadata } from '../compiler/analyzer';

export interface CollectedClass {
  metadata: ClassMetadata;
  filePath: string;
}

export interface CommandOptions {
  verbose?: boolean;
}
