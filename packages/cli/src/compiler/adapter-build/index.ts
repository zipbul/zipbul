/**
 * Adapter package compiler — `zb build adapter`.
 *
 * Compiles an adapter package (a package whose `package.json` declares
 * `zipbul.kind === "adapter"`) into a `dist/` tree of resolved JS, type
 * declarations, and JSON manifests describing the adapter's contract.
 *
 * @public
 */
export { buildAdapter } from './adapter-build.command';
export type { BuildAdapterOptions, BuildAdapterResult } from './interfaces';
export {
  readAdapterManifest,
  detectMultiAdapterConflicts,
} from './manifest-reader';
export type {
  ReadAdapterManifestResult,
  AdapterConflict,
} from './manifest-reader';
