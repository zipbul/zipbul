/**
 * User-app build side — read pre-compiled adapter manifests from
 * `node_modules/<adapter>/dist/` (Section M, Items 114·115·119).
 *
 * `zb build adapter` emits a tree of canonical JSON manifests inside the
 * adapter package's `dist/`. The user app's build (`zb build`) loads those
 * manifests directly instead of re-running static analysis on the adapter's
 * `.ts` source. This module is the read-side contract — pure JSON parsing,
 * no AST work.
 *
 * @public
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { compareCodePoint } from '../../common';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type {
  AdapterManifest,
  PipelineSchema,
  DecoratorSchema,
  PeerContract,
  ContextNamespacesSchema,
  AdapterConstructorSchema,
} from './interfaces';

interface SiblingSchemaSpec<T> {
  readonly logicalName: string;
  readonly schemaName: T;
}

const SIBLING_SCHEMAS = {
  pipeline: { logicalName: 'pipeline-schema', schemaName: 'adapter.pipeline-schema' } as const,
  decorators: { logicalName: 'decorator-schema', schemaName: 'adapter.decorator-schema' } as const,
  peerContract: { logicalName: 'peer-contract', schemaName: 'adapter.peer-contract' } as const,
  contextNamespaces: { logicalName: 'context-namespaces', schemaName: 'adapter.context-namespaces' } as const,
  constructorSchema: { logicalName: 'adapter-constructor-schema', schemaName: 'adapter.constructor-schema' } as const,
} satisfies Record<string, SiblingSchemaSpec<string>>;

/**
 * Result of `readAdapterManifest()` — every emitted manifest joined with the
 * top-level index. Optional fields are absent when the corresponding manifest
 * file is missing (older `zb build adapter` output that didn't emit the
 * particular schema yet).
 *
 * @public
 */
export interface ReadAdapterManifestResult {
  /**
   * Adapter package's `name` field from `<dist>/../package.json`. Used as the
   * `declare module '<packageName>'` specifier when the user-app build emits
   * declaration merging for context augments (`context.d.ts`).
   */
  readonly packageName: string;
  readonly adapter: AdapterManifest;
  readonly pipeline: PipelineSchema | null;
  readonly decorators: DecoratorSchema | null;
  readonly peerContract: PeerContract | null;
  readonly contextNamespaces: ContextNamespacesSchema | null;
  readonly constructorSchema: AdapterConstructorSchema | null;
}

/**
 * Reads the adapter's manifest tree from `<adapterPackageDist>/`. Throws
 * `DiagnosticError` (E1: hard error) when the manifest is missing — the user
 * app must run `zb build adapter` in the adapter package first.
 *
 * @param adapterPackageDist - Absolute path to the adapter package's `dist/`.
 * Typically `node_modules/<name>/dist/`.
 *
 * @public
 */
export async function readAdapterManifest(
  adapterPackageDist: string,
): Promise<ReadAdapterManifestResult> {
  const distPath = resolve(adapterPackageDist);
  const topPath = join(distPath, 'adapter.manifest.json');

  if (!(await pathExists(topPath))) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Adapter manifest missing at ${topPath}. Run \`zb build adapter\` in the adapter package first.`,
      file: topPath,
    }));
  }

  const adapter = await loadJson<AdapterManifest>(topPath);

  if (adapter.$schemaName !== 'adapter.manifest') {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${topPath} \`$schemaName\` is \`${String(adapter.$schemaName)}\`, expected \`adapter.manifest\`.`,
      file: topPath,
    }));
  }

  const indexed = adapter.manifests;

  const pipeline = await loadSibling<PipelineSchema>(distPath, indexed, SIBLING_SCHEMAS.pipeline);
  const decorators = await loadSibling<DecoratorSchema>(distPath, indexed, SIBLING_SCHEMAS.decorators);
  const peerContract = await loadSibling<PeerContract>(distPath, indexed, SIBLING_SCHEMAS.peerContract);
  const contextNamespaces = await loadSibling<ContextNamespacesSchema>(distPath, indexed, SIBLING_SCHEMAS.contextNamespaces);
  const constructorSchema = await loadSibling<AdapterConstructorSchema>(distPath, indexed, SIBLING_SCHEMAS.constructorSchema);

  const packageName = await loadPackageName(distPath);

  return { packageName, adapter, pipeline, decorators, peerContract, contextNamespaces, constructorSchema };
}

async function loadPackageName(distPath: string): Promise<string> {
  const pkgPath = join(dirname(distPath), 'package.json');

  if (!(await pathExists(pkgPath))) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Adapter package.json missing at ${pkgPath}. Adapter manifest cannot be consumed without its package metadata.`,
      file: pkgPath,
    }));
  }

  const raw = await loadJson<unknown>(pkgPath);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${pkgPath} must be a JSON object.`,
      file: pkgPath,
    }));
  }

  const name = (raw as { name?: unknown }).name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${pkgPath} has no \`name\` field — adapter package must declare its npm specifier.`,
      file: pkgPath,
    }));
  }

  return name;
}

/** Hard cap on manifest file size — adapter manifests are tiny in practice
 * (well under 100KB). 5MB is a generous DoS guard against malformed packages
 * shipping multi-gigabyte JSON that would exhaust memory on parse. */
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

async function loadJson<T>(absPath: string): Promise<T> {
  const stats = await stat(absPath);
  if (stats.size > MAX_MANIFEST_BYTES) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${absPath} exceeds the manifest size limit (${String(stats.size)} > ${String(MAX_MANIFEST_BYTES)} bytes). Manifest files must be small canonical JSON.`,
      file: absPath,
    }));
  }
  const text = await readFile(absPath, 'utf8');
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[SYNTAX] ${absPath} is not valid JSON: ${(cause as Error).message ?? String(cause)}`,
      file: absPath,
    }));
  }
}

async function loadSibling<T extends { readonly $schemaName: string }>(
  distPath: string,
  indexed: AdapterManifest['manifests'],
  spec: SiblingSchemaSpec<T['$schemaName']>,
): Promise<T | null> {
  const relPath = indexed[spec.logicalName];
  if (relPath === undefined) return null;

  // Type narrowing — `manifests` is typed as `Record<string, string>` but a
  // malformed manifest can carry a number/bool/object/null. `path.join` and
  // `String.split` would throw uncaught TypeError; surface a clean
  // DiagnosticError instead.
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Manifest index entry \`${spec.logicalName}\` must be a non-empty string, got ${describeJsonShape(relPath)}.`,
    }));
  }

  if (isAbsolute(relPath) || relPath.split('/').some(seg => seg === '..')) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Manifest index entry \`${spec.logicalName}\` points outside dist (${relPath}).`,
    }));
  }

  const full = join(distPath, relPath);
  if (!(await pathExists(full))) return null;

  // Symlink defense — reject any path whose `realpath()` escapes the dist
  // root. A malicious adapter package shipping a symlink could otherwise
  // silently leak arbitrary host files into the consumer's build manifest.
  const resolvedDist = await realpath(distPath);
  let resolvedFull: string;
  try {
    resolvedFull = await realpath(full);
  } catch {
    return null;
  }
  if (!isInsideDir(resolvedFull, resolvedDist)) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Manifest index entry \`${spec.logicalName}\` resolves (via symlink) outside the adapter dist root (${resolvedFull} ⊄ ${resolvedDist}).`,
    }));
  }

  const raw = await loadJson<unknown>(full);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${full} must be a JSON object, got ${describeJsonShape(raw)}.`,
      file: full,
    }));
  }

  const value = raw as T & { readonly $schemaName: unknown };
  if (value.$schemaName !== spec.schemaName) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] ${full} \`$schemaName\` is \`${String(value.$schemaName)}\`, expected \`${spec.schemaName}\`.`,
      file: full,
    }));
  }
  return value;
}

function describeJsonShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when `child` (already realpath-resolved) is `parent` itself
 * or a descendant of it. Uses path-segment comparison rather than string
 * `startsWith` so `/a/bc` is not considered inside `/a/b`.
 */
function isInsideDir(child: string, parent: string): boolean {
  if (child === parent) return true;
  const sep = parent.endsWith('/') ? '' : '/';
  return child.startsWith(parent + sep);
}

/**
 * Detected conflict when the user app installs multiple adapter packages
 * whose extracted contract overlaps in a way the runtime cannot resolve.
 *
 * @public
 */
export interface AdapterConflict {
  readonly kind: 'decorator-name' | 'context-key';
  readonly name: string;
  readonly adapters: readonly string[];
}

/**
 * Item 119 — detect cross-adapter conflicts when multiple adapter packages
 * are loaded together. Returns the empty array on a clean install.
 *
 * Two flavors of conflict:
 * 1. **decorator-name** — two adapters declare a decorator with the same
 *    name across `controller` / `handlers` / `options`. User code referring
 *    to that name becomes ambiguous.
 * 2. **context-key** — two adapters declare the same `ContextKey` identifier
 *    in `defineAdapter({ provides })`. The runtime cannot decide which
 *    adapter's value to surface.
 *
 * Each adapter is identified by `manifest.adapter.adapterId` for diagnostic
 * purposes.
 *
 * @public
 */
export function detectMultiAdapterConflicts(manifests: readonly ReadAdapterManifestResult[]): readonly AdapterConflict[] {
  const decoratorOwners = new Map<string, Set<string>>();
  const contextKeyOwners = new Map<string, Set<string>>();

  for (const m of manifests) {
    const adapterId = m.adapter.adapterId;

    if (m.decorators !== null) {
      const all = [
        m.decorators.controller,
        ...m.decorators.handlers,
        ...m.decorators.options,
      ];
      for (const name of all) {
        let owners = decoratorOwners.get(name);
        if (owners === undefined) {
          owners = new Set();
          decoratorOwners.set(name, owners);
        }
        owners.add(adapterId);
      }
    }

    if (m.peerContract !== null) {
      for (const key of m.peerContract.provides) {
        let owners = contextKeyOwners.get(key);
        if (owners === undefined) {
          owners = new Set();
          contextKeyOwners.set(key, owners);
        }
        owners.add(adapterId);
      }
    }
  }

  const conflicts: AdapterConflict[] = [];

  for (const [name, owners] of decoratorOwners) {
    if (owners.size > 1) {
      conflicts.push({ kind: 'decorator-name', name, adapters: [...owners].sort(compareCodePoint) });
    }
  }

  for (const [name, owners] of contextKeyOwners) {
    if (owners.size > 1) {
      conflicts.push({ kind: 'context-key', name, adapters: [...owners].sort(compareCodePoint) });
    }
  }

  conflicts.sort((a, b) => {
    const kindDiff = compareCodePoint(a.kind, b.kind);
    return kindDiff !== 0 ? kindDiff : compareCodePoint(a.name, b.name);
  });

  return conflicts;
}
