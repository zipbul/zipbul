import type {
  CompiledMiddlewareBindingEntry,
  CompiledOptionEntry,
  CompiledPipelineBindingEntry,
  CompiledPipelineScope,
  CompiledValidationEntry,
} from '@zipbul/common';
import type { AnalyzerValue } from './types';
import type { ContextUsage } from './parser/handler-context-usage-extractor';
import type { ContextOperation } from './parser/context-operation-extractor';

export type CompiledPhaseMiddlewareKeys = Readonly<Record<string, readonly string[]>>;
export type { CompiledPipelineScope };

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
  /** Context member-access chains extracted from the handler body (e.g. `ctx.request.getBody(Dto)`). */
  contextUsages?: readonly ContextUsage[];
  /**
   * Producer/consumer ops extracted from the handler body —
   * `ctx.set(KEY, ...)`, `ctx.use(KEY)`, `ctx.get(KEY)` and equivalents on
   * `ctx.to(<Type>)` bindings. Used by the AOT dependency validator to
   * verify that required keys are produced by registered middleware.
   */
  contextOps?: readonly ContextOperation[];
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
  /** Declarative pipeline step sequence. AOT compiler uses this to generate optimized per-handler pipelines. */
  pipeline?: readonly string[];
  /** Auto-derived from context class properties. Maps namespace getter name → interface type name. */
  contextNamespaces?: ContextNamespaceMap;
}

/**
 * Auto-derived mapping from context class property/getter names to their type information.
 * Used by the AOT compiler to generate declaration merging for middleware augments.
 *
 * Example for HttpContext:
 * ```
 * {
 *   contextType: 'HttpContext',
 *   module: '@zipbul/http-adapter',
 *   namespaces: { request: 'HttpRequest', response: 'HttpResponse' }
 * }
 * ```
 */
export interface ContextNamespaceMap {
  /** Context class name (e.g. 'HttpContext'). */
  readonly contextType: string;
  /** Package module specifier (e.g. '@zipbul/http-adapter'). */
  readonly module: string;
  /** Getter/property name → return type name. */
  readonly namespaces: Readonly<Record<string, string>>;
}

export interface AdapterExtraction {
  adapterId: string;
  staticSchema: AdapterStaticSchema;
}

export interface HandlerIndexEntry {
  id: string;
  adapterId: string;
  className: string;
  ownerModuleName?: string;
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
  /** Validation entries extracted from handler accessor calls (e.g. `getBody`, `getParams`). */
  validations?: readonly CompiledValidationEntry[];
  /** Build-time merged, phase-keyed middleware keys for the generic pipeline runtime. */
  mergedPhaseMiddlewareKeys?: CompiledPhaseMiddlewareKeys;
  /** Build-time merged guard keys for the generic pipeline runtime. */
  mergedGuardKeys?: readonly string[];
  /** Build-time merged exception filter keys for the generic pipeline runtime. */
  mergedExceptionFilterKeys?: readonly string[];
  /** Lossless middleware bindings collected during AOT. */
  middlewareBindings?: readonly CompiledMiddlewareBindingEntry[];
  /** Lossless guard bindings collected during AOT. */
  guardBindings?: readonly CompiledPipelineBindingEntry[];
  /** Lossless exception filter bindings collected during AOT. */
  exceptionFilterBindings?: readonly CompiledPipelineBindingEntry[];
  /** Pipeline steps before the handler step (adapter-specific). */
  compiledPre?: readonly string[];
  /** Pipeline steps after the handler step (adapter-specific). */
  compiledPost?: readonly string[];
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
  /** Per-handler context usages for build-time augment validation. Keyed by handler ID. */
  handlerContextUsages: Map<string, readonly ContextUsage[]>;
  /**
   * Per-handler context producer/consumer ops (`ctx.set/use/get`).
   * Used by the AOT producer-consumer dependency validator.
   */
  handlerContextOps: Map<string, readonly ContextOperation[]>;
}
