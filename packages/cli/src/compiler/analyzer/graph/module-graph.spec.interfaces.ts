import type { AnalyzerValue } from '../types';
import type { ClassMetadata } from '../interfaces';

export interface InjectableClassParams {
  readonly className: string;
  readonly injectedTokens?: readonly string[];
  readonly visibleTo?: AnalyzerValue;
  readonly scope?: string;
}

export interface ModuleFileAnalysisParams {
  readonly filePath: string;
  readonly name: string;
  readonly exportedName?: string;
}

export interface ClassFileAnalysisParams {
  readonly filePath: string;
  readonly classes: ClassMetadata[];
}
