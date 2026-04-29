/**
 * Adapter package compiler — `zb build adapter`.
 *
 * Compiles an adapter package (a package whose `package.json` declares
 * `zipbul.kind === "adapter"`) into a `dist/` tree of resolved JS, type
 * declarations, and JSON manifests that the user-app build consumes
 * directly without re-analyzing the adapter source.
 *
 * Current scope (Step 10 Slice 1): emit only `dist/adapter.manifest.json`
 * with the adapter class identifier and the producing tool version. The
 * rest of Section A~L (pipeline schema, decorator schema, peer contract,
 * codegen, etc.) is delivered in subsequent slices. The thin slice exists
 * to wire CLI routing + atomic emit + the package-level contract end-to-end
 * before fanning out to specialized extractors.
 *
 * @public
 */
export { buildAdapter } from './adapter-build.command';
export { watchAdapter } from './watch';
export { readAdapterManifest, detectMultiAdapterConflicts } from './manifest-reader';
export type { BuildAdapterOptions, BuildAdapterResult } from './interfaces';
export type { WatchAdapterOptions, WatchHandle } from './watch';
export type { ReadAdapterManifestOptions, ReadAdapterManifestResult, AdapterConflict } from './manifest-reader';
