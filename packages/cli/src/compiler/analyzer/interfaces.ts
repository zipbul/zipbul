import type { CompiledOptionEntry, CompiledValidationEntry } from '@zipbul/common';
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

export interface ExceptionFilterUsage {
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

/** A member-access call with type arguments found in a method body (e.g. `ctx.getBody<UserDto>()`). */
export interface TypedCallMetadata {
  /** Called method name (e.g. `'getBody'`). */
  readonly methodName: string;
  /** Resolved type argument names (e.g. `['UserDto']`). */
  readonly typeArgs: readonly string[];
}

export interface MethodMetadata {
  name: string;
  decorators: DecoratorMetadata[];
  parameters: MethodParameterMetadata[];
  /** Typed member-access calls found in the method body. */
  typedCalls?: readonly TypedCallMetadata[];
  isStatic?: boolean | undefined;
  isComputed?: boolean | undefined;
  isPrivateName?: boolean | undefined;
}

export interface PropertyMetadata {
  name: string;
  type: AnalyzerValue;
  typeArgs?: string[] | undefined;
  decorators: DecoratorMetadata[];
  initializer?: AnalyzerValue | undefined;
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
  exceptionFilters?: ExceptionFilterUsage[] | undefined;
}

export interface ImportEntry {
  source: string;
  resolvedSource: string;
  isRelative: boolean;
}

export interface AdapterEntryDecoratorsSchema {
  controller: string;
  handlers: string[];
  options?: string[];
}

export interface AdapterStaticSchema {
  entryDecorators: AdapterEntryDecoratorsSchema;
  validPhases?: Set<string>;
  /** Maps context accessor method names to validation kinds (e.g. `getBody → 'body'`). */
  validatedAccessors?: Record<string, string>;
  /** Declarative pipeline step sequence. AOT compiler uses this to generate optimized per-handler pipelines. */
  pipeline?: readonly string[];
}

export interface AdapterExtraction {
  adapterId: string;
  staticSchema: AdapterStaticSchema;
}

export interface AdapterExportResolution {
  value: AnalyzerValue;
  sourceFile: string;
}

export interface AdapterStaticSchemaResult {
  adapterId: string;
  staticSchema: AdapterStaticSchema;
}

export interface HandlerIndexEntry {
  id: string;
  adapterId: string;
  className: string;
  controllerKey?: string;
  methodName: string;
  handlerDecorator: string;
  handlerDecoratorArgs: readonly unknown[];
  params: readonly HandlerParamEntry[];
  middlewareKeys?: readonly string[];
  exceptionFilterKeys?: readonly string[];
  guardKeys?: readonly string[];
  /** Option decorators found on the class and/or method. */
  options?: readonly CompiledOptionEntry[];
  /** Validated accessor calls extracted from the handler body. */
  validations?: readonly CompiledValidationEntry[];
  /** AOT-compiled pipeline — only steps with registered handlers are included. */
  compiledPipeline?: readonly string[];
}

export interface HandlerParamEntry {
  name: string;
  decoratorName?: string;
  decoratorArgs?: readonly unknown[];
  metatypeKey?: string;
}

/**
 * Maps a deterministic container key to the original AST value reference
 * for route-level middleware/filter/guard registrations.
 *
 * All registrations use the same code pattern:
 * `container.set(key, () => value)` — direct reference.
 */
export interface RouteRegistration {
  readonly key: string;
  readonly value: AnalyzerValue;
  readonly kind: 'ref';
}

export interface AdapterResolution {
  adapterStaticSchemas: Record<string, AdapterStaticSchema>;
  handlerIndex: HandlerIndexEntry[];
  routeRegistrations: RouteRegistration[];
}
