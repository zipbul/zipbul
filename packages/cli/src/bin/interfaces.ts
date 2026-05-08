import type { ClassMetadata } from '../compiler/analyzer';
import type { Diagnostic } from '../diagnostics';

export interface CollectedClass {
  metadata: ClassMetadata;
  filePath: string;
}

export interface CommandOptions {
  verbose?: boolean;
  lib?: boolean;
}

export interface PathEntry {
  label: string;
  value: string;
}

export interface SpinnerHandle {
  stop: (message?: string) => void;
}

export interface OutputFileEntry {
  name: string;
  size: number;
  gzipSize?: number;
}

export interface CliRendererLike {
  intro: (title: string) => void;
  outro: (message: string) => void;
  cancelled: (message: string) => void;
  step: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  startSpinner: (message: string) => SpinnerHandle;
  outputPaths: (title: string, entries: readonly PathEntry[]) => void;
  outputFiles: (title: string, entries: readonly OutputFileEntry[]) => void;
  diagnostic: (diagnostic: Diagnostic) => void;
  separator: () => void;
}
