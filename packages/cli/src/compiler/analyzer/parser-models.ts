import type { ClassMetadata, ImportEntry } from './interfaces';
import type { AnalyzerValue, AnalyzerValueArray, AnalyzerValueRecord, ReExportName } from './types';

export interface ReExport {
  module: string;
  exportAll: boolean;
  names?: ReExportName[] | undefined;
}

export interface ModuleDefinition {
  name?: string | undefined;
  nameDeclared?: boolean | undefined;
  providers: AnalyzerValueArray;
  adapters?: AnalyzerValue | undefined;
  imports: Record<string, string>;
}

export interface CreateApplicationCall {
  callee: string;
  importSource?: string | undefined;
  args: AnalyzerValueArray;
  start?: number | undefined;
  end?: number | undefined;
}

export interface DefineModuleCall {
  callee: string;
  importSource?: string | undefined;
  args: AnalyzerValueArray;
  start?: number | undefined;
  end?: number | undefined;
  localName?: string | undefined;
  exportedName?: string | undefined;
}

export interface InjectCall {
  tokenKind: 'token' | 'thunk' | 'invalid';
  token: AnalyzerValue | null;
  callee?: string | undefined;
  importSource?: string | undefined;
  start?: number | undefined;
  end?: number | undefined;
  filePath?: string | undefined;
}

export interface ParseResult {
  classes: ClassMetadata[];
  reExports: ReExport[];
  exports: string[];
  imports?: Record<string, string> | undefined;
  importEntries?: ImportEntry[] | undefined;
  exportedValues?: AnalyzerValueRecord | undefined;
  localValues?: AnalyzerValueRecord | undefined;
  moduleDefinition?: ModuleDefinition | undefined;
  createApplicationCalls?: CreateApplicationCall[] | undefined;
  defineModuleCalls?: DefineModuleCall[] | undefined;
  injectCalls?: InjectCall[] | undefined;
  /** Enum declarations: enumName → Map<memberName, memberValue> */
  enums?: Map<string, Map<string, string>> | undefined;
}
