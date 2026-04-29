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
