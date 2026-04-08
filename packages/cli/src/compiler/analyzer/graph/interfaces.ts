import type { ClassMetadata, ImportEntry } from '../interfaces';
import type { CreateApplicationCall, DefineModuleCall, InjectCall, ModuleDefinition, ReExport } from '../parser-models';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { ModuleGraph } from './module-graph';

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
  /** Enum declarations: enumName → Map<memberName, memberValue> */
  enums?: Map<string, Map<string, string>>;
}

export interface AdapterResolveParams {
  fileMap: Map<string, FileAnalysis>;
  projectRoot: string;
  graph?: ModuleGraph;
}

export interface CyclePath {
  path: string[];
  suggestedFix?: string;
}

/**
 * Parsed visibility setting from @Injectable decorator.
 * @internal
 */
export interface VisibilityResolution {
  kind: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
}

/**
 * Parsed @Injectable decorator options.
 * @internal
 */
export interface InjectableOptions {
  visibility: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
  scope: 'singleton' | 'request' | 'transient';
}

/**
 * Class definition with its declaring file path.
 * @internal
 */
export interface ClassDefinition {
  metadata: ClassMetadata;
  filePath: string;
}

/** Union of all values that can appear as a provider token. @internal */
export type ProviderTokenValue = AnalyzerValue | ClassMetadata | CallableFunction | symbol;
