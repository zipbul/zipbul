import type { AnalyzerValue } from './types';

/**
 * Serializable metadata about a type extracted by the CLI analyzer.
 */
export interface TypeMetadataProperty {
  name: string;
  type: string;
  optional: boolean;
}

export interface TypeMetadata {
  name: string;
  properties: TypeMetadataProperty[];
}

export interface MiddlewareUsage {
  name: string;
  lifecycle?: string;
  index: number;
}

export interface ErrorFilterUsage {
  name: string;
  index: number;
}

export interface DecoratorMetadata {
  name: string;
  arguments: AnalyzerValue[];
}

export interface HeritageMetadata {
  clause: 'extends' | 'implements';
  typeName: string;
  typeArgs?: string[] | undefined;
}

export interface ConstructorParamMetadata {
  name: string;
  type: AnalyzerValue;
  typeArgs?: string[] | undefined;
  decorators: DecoratorMetadata[];
}

export interface MethodParameterMetadata {
  name: string;
  type: AnalyzerValue;
  typeArgs?: string[] | undefined;
  decorators: DecoratorMetadata[];
  index: number;
}

export interface MethodMetadata {
  name: string;
  decorators: DecoratorMetadata[];
  parameters: MethodParameterMetadata[];
  isStatic?: boolean | undefined;
  isComputed?: boolean | undefined;
  isPrivateName?: boolean | undefined;
}

export interface PropertyMetadata {
  name: string;
  type: AnalyzerValue;
  typeArgs?: string[] | undefined;
  decorators: DecoratorMetadata[];
  items?: AnalyzerValue | undefined;
  isOptional?: boolean | undefined;
  isArray?: boolean | undefined;
  isEnum?: boolean | undefined;
  literals?: (string | number | boolean)[] | undefined;
}

export interface ClassMetadata {
  className: string;
  heritage?: HeritageMetadata | undefined;
  decorators: DecoratorMetadata[];
  constructorParams: ConstructorParamMetadata[];
  methods: MethodMetadata[];
  properties: PropertyMetadata[];
  imports: Record<string, string>;
  middlewares?: MiddlewareUsage[] | undefined;
  errorFilters?: ErrorFilterUsage[] | undefined;
}

export interface ImportEntry {
  source: string;
  resolvedSource: string;
  isRelative: boolean;
}

export interface AdapterEntryDecoratorsSpec {
  controller: string;
  handler: string[];
}

export interface AdapterStaticSpec {
  pipeline: string[];
  entryDecorators: AdapterEntryDecoratorsSpec;
}

export interface AdapterSpecExtraction {
  adapterId: string;
  staticSpec: AdapterStaticSpec;
}

export interface AdapterSpecExportResolution {
  value: AnalyzerValue;
  sourceFile: string;
}

export interface AdapterStaticSpecResult {
  adapterId: string;
  staticSpec: AdapterStaticSpec;
}

export interface HandlerIndexEntry {
  id: string;
}

export interface AdapterSpecResolution {
  adapterStaticSpecs: Record<string, AdapterStaticSpec>;
  handlerIndex: HandlerIndexEntry[];
}
