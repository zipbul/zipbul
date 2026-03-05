import type { ClassMetadata, ImportEntry } from '../interfaces';
import type { CreateApplicationCall, DefineModuleCall, InjectCall, ModuleDefinition, ReExport } from '../parser-models';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';

export interface ProviderRef {
  token: string;
  metadata?: AnalyzerValue | ClassMetadata;
  visibility: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
  scope?: 'singleton' | 'request' | 'transient';
  filePath?: string;
}

export interface FileAnalysis {
  filePath: string;
  classes: ClassMetadata[];
  reExports: ReExport[];
  exports: string[];
  imports?: Record<string, string>;
  importEntries?: ImportEntry[];
  exportedValues?: AnalyzerValueRecord;
  localValues?: AnalyzerValueRecord;
  moduleDefinition?: ModuleDefinition;
  createApplicationCalls?: CreateApplicationCall[];
  defineModuleCalls?: DefineModuleCall[];
  injectCalls?: InjectCall[];
}

export interface AdapterResolveParams {
  fileMap: Map<string, FileAnalysis>;
  projectRoot: string;
}

export interface CyclePath {
  path: string[];
  suggestedFix?: string;
}
