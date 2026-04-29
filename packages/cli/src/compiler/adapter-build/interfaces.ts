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
 * (Item 116).
 *
 * @public
 */
export interface AdapterManifest {
  readonly $schemaName: 'adapter.manifest';
  readonly adapterId: string;
  readonly producedBy: string;
}
