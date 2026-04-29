/**
 * Options accepted by `buildAdapter`.
 *
 * @public
 */
export interface BuildAdapterOptions {
  /** Adapter package root. Defaults to `process.cwd()`. */
  readonly packageRoot?: string;
  /** Override output directory. Defaults to `<packageRoot>/dist`. */
  readonly outDir?: string;
  /** When `true`, skip writing files; useful for verification (Item 100 — `--dry-run`). */
  readonly dryRun?: boolean;
}

/**
 * Result of a successful adapter build.
 *
 * @public
 */
export interface BuildAdapterResult {
  /** Resolved adapter class identifier (the `adapter` field of `defineAdapter()`). */
  readonly adapterId: string;
  /** Absolute path to the manifest file that was written (or would have been, in dry-run). */
  readonly manifestPath: string;
}

/**
 * Top-level manifest emitted at `dist/adapter.manifest.json`.
 *
 * Schema fields are stable and machine-consumed by the user-app build. The
 * `$schemaName` field self-identifies the format (Item 71). `producedBy`
 * carries the tool version so the user app can perform compatibility checks
 * (Item 116). `manifests` indexes the other JSON files emitted alongside
 * (Item 64) so consumers can locate them by logical name.
 *
 * @public
 */
export interface AdapterManifest {
  readonly $schemaName: 'adapter.manifest';
  readonly adapterId: string;
  readonly producedBy: string;
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
