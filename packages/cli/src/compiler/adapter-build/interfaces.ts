/**
 * Options accepted by `buildAdapter`.
 *
 * @public
 */
export interface BuildAdapterOptions {
  /** Adapter package root. Defaults to `process.cwd()`. */
  readonly packageRoot?: string;
  /** Optional renderer for cancellation/log output. Defaults to a fresh `CliRenderer`. */
  readonly renderer?: import('../../bin/interfaces').CliRendererLike;
}

/**
 * Result of a successful adapter build.
 *
 * @public
 */
export interface BuildAdapterResult {
  /** Resolved adapter class identifier (the `adapter` field of `defineAdapter()`). */
  readonly adapterId: string;
  /** Absolute path to the manifest file that was written. */
  readonly manifestPath: string;
}

/**
 * Top-level manifest emitted at `dist/adapter.manifest.json`. `$schemaName`
 * self-identifies the format. `manifests` indexes the sibling JSON files by
 * logical name.
 *
 * @public
 */
export interface AdapterManifest {
  readonly $schemaName: 'adapter.manifest';
  readonly adapterId: string;
  readonly manifests: { readonly [logicalName: string]: string };
}

/**
 * Reference to a pipeline element — either a phase value (`HttpPhase.OnRequest`)
 * or a step value (`HttpStep.ResolveRoute` / `CoreStep.Handler`). The
 * `qualifier` is the enum identifier as written in source; resolution to
 * concrete values is the user-app build's job.
 *
 * @public
 */
export interface PipelineRef {
  readonly qualifier: string;
  readonly name: string;
}

/**
 * `dist/pipeline-schema.json` — the adapter's pipeline declaration extracted
 * from `defineAdapter({ pipeline, phase, step })`. The user-app build joins
 * this with the imported phase/step enums to produce the runtime pipeline.
 *
 * @public
 */
export interface PipelineSchema {
  readonly $schemaName: 'adapter.pipeline-schema';
  /** Identifier name passed as `phase` field of `defineAdapter()`. */
  readonly phaseEnum: string;
  /** Identifier name passed as `step` field of `defineAdapter()`. */
  readonly stepEnum: string;
  /**
   * Phase enum members in source declaration order. Empty when the phase enum
   * is declared outside the adapter package (e.g. `CoreStep` from `@zipbul/core`).
   * Used by the user-app build to populate `AdapterStaticSchema.validPhases`.
   */
  readonly phaseMembers: readonly string[];
  /** Step enum members in source declaration order. Empty for external enums. */
  readonly stepMembers: readonly string[];
  /** Ordered pipeline entries in source order. */
  readonly pipeline: readonly PipelineRef[];
}

/**
 * `dist/decorator-schema.json` — the adapter's `AdapterEntryDecorators`
 * (controller / handlers / options) extracted from the adapter class's
 * `decorators` instance property. Each entry is an identifier name as
 * written in source — resolution to actual decorator imports is the
 * user-app build's job (cross-checked against `controllerImports`).
 *
 * @public
 */
export interface DecoratorSchema {
  readonly $schemaName: 'adapter.decorator-schema';
  /** Single class-level controller decorator (Item 41 — exactly 1). */
  readonly controller: string;
  /** 1+ method-level handler decorators. */
  readonly handlers: readonly string[];
  /** 0+ optional method/class option decorators. */
  readonly options: readonly string[];
}

/**
 * `dist/context-namespaces.json` — the Context class identifier and its
 * public method signatures (Item 12·18). The full namespace property map
 * (Item 16) is delivered in a later slice once middleware-augment integration
 * lands; this slice records only the Context class structural surface.
 *
 * @public
 */
export interface ContextNamespacesSchema {
  readonly $schemaName: 'adapter.context-namespaces';
  /** Identifier name passed as `context` field of `defineAdapter()`. */
  readonly contextType: string;
  /** Public methods on the Context class with raw type-annotation text. */
  readonly methods: readonly ContextMethodSignature[];
  /**
   * Public namespace properties on the Context class (Item 16). Each entry
   * is a public, non-method property whose declared type is preserved as
   * raw source text. Middleware augments later refine these to concrete
   * types — this manifest captures only the structural surface the Context
   * class itself declares.
   */
  readonly namespaces: readonly ContextNamespaceProperty[];
}

export interface ContextNamespaceProperty {
  readonly name: string;
  readonly type: string | null;
}

export interface ContextMethodSignature {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: string | null }[];
  readonly returnType: string | null;
}

/**
 * `dist/adapter-constructor-schema.json` — the adapter class constructor's
 * options-parameter type (Item 44·54c·71b). User-app build uses this to
 * compile-time check `new AdapterClass(options)` calls.
 *
 * @public
 */
export interface AdapterConstructorSchema {
  readonly $schemaName: 'adapter.constructor-schema';
  /** The constructor's options parameter name and raw type-annotation text. */
  readonly optionsParam: { readonly name: string; readonly type: string | null } | null;
  /** `true` when the options parameter has a `?` modifier or a default value. */
  readonly optional: boolean;
}

/**
 * `dist/peer-contract.json` — the adapter's contract with the framework runtime
 * and the user-app build (Item 69).
 *
 * - `clusterStrategy`: `Shared` (default) or `Exclusive`. Item 48b — drives
 *   cluster mode dispatch in `application.ts:294`.
 * - `provides`: `ContextKey` identifier names declared in
 *   `defineAdapter({ provides: [...] })` (Item 54b). Input to multi-adapter
 *   ContextKey conflict detection (Item 119) at user-app build time.
 * - `peerSymbols`: imported names per `@zipbul/core` / `@zipbul/common`.
 *   Used by user-app build to verify the adapter doesn't pull in stale
 *   peer APIs.
 *
 * @public
 */
export interface PeerContract {
  readonly $schemaName: 'adapter.peer-contract';
  readonly clusterStrategy: 'Shared' | 'Exclusive';
  readonly provides: readonly string[];
  readonly peerSymbols: { readonly [packageName: string]: readonly string[] };
}
