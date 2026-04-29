/**
 * User-app build side — read pre-compiled adapter manifests from
 * `node_modules/<adapter>/dist/`. Step 11 of ADAPTER_COMPILER.md
 * (Section M, Items 114·115·116).
 *
 * Step 10 (`zb build adapter`) emits a tree of canonical JSON manifests
 * inside the adapter package's `dist/`. The user app's build (`zb build`)
 * loads those manifests directly instead of re-running static analysis on
 * the adapter's `.ts` source. This module is the read-side contract — pure
 * JSON parsing + light validation, no AST work.
 *
 * @public
 */
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type {
  AdapterManifest,
  PipelineSchema,
  DecoratorSchema,
  PeerContract,
  ContextNamespacesSchema,
  AdapterConstructorSchema,
  BuiltinsManifest,
} from './interfaces';

/**
 * Result of `readAdapterManifest()` — every emitted manifest joined with the
 * top-level index. Optional fields are absent when the corresponding manifest
 * file is missing (older `zb build adapter` output that didn't emit the
 * particular schema yet).
 *
 * @public
 */
export interface ReadAdapterManifestResult {
  readonly adapter: AdapterManifest;
  readonly pipeline: PipelineSchema | null;
  readonly decorators: DecoratorSchema | null;
  readonly peerContract: PeerContract | null;
  readonly contextNamespaces: ContextNamespacesSchema | null;
  readonly constructorSchema: AdapterConstructorSchema | null;
  readonly builtins: BuiltinsManifest | null;
}

export interface ReadAdapterManifestOptions {
  /**
   * `zb` version of the user-app build. When set, `producedBy` of the
   * manifest must declare a compatible producer (currently: same major).
   * Mismatch → `DiagnosticError` (Item 116).
   */
  readonly userAppCliVersion?: string;
  /**
   * When `true` and the adapter package does not ship a manifest tree, fall
   * back to `null` (Item 115 — caller may then run static analysis).
   * Default: `false` — manifest absence is fatal.
   */
  readonly allowMissing?: boolean;
}

/**
 * Reads the adapter's manifest tree from `<adapterPackageDist>/`.
 *
 * @param adapterPackageDist - Absolute path to the adapter package's `dist/`.
 * Typically `node_modules/<name>/dist/`.
 *
 * @public
 */
export async function readAdapterManifest(
  adapterPackageDist: string,
  options: ReadAdapterManifestOptions = {},
): Promise<ReadAdapterManifestResult | null> {
  const distPath = resolve(adapterPackageDist);
  const topPath = join(distPath, 'adapter.manifest.json');

  if (!(await pathExists(topPath))) {
    if (options.allowMissing === true) return null;
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Adapter manifest missing at ${topPath}. Run \`zb build adapter\` in the adapter package first, or pass \`allowMissing: true\` to fall back.`,
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

  if (typeof options.userAppCliVersion === 'string') {
    assertProducerCompatible(adapter.producedBy, options.userAppCliVersion, topPath);
  }

  const indexed = adapter.manifests ?? {};

  const pipeline = await loadOptional<PipelineSchema>(distPath, indexed['pipeline-schema']);
  const decorators = await loadOptional<DecoratorSchema>(distPath, indexed['decorator-schema']);
  const peerContract = await loadOptional<PeerContract>(distPath, indexed['peer-contract']);
  const contextNamespaces = await loadOptional<ContextNamespacesSchema>(distPath, indexed['context-namespaces']);
  const constructorSchema = await loadOptional<AdapterConstructorSchema>(distPath, indexed['adapter-constructor-schema']);
  const builtins = await loadOptional<BuiltinsManifest>(distPath, indexed['builtins']);

  return { adapter, pipeline, decorators, peerContract, contextNamespaces, constructorSchema, builtins };
}

async function loadJson<T>(absPath: string): Promise<T> {
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

async function loadOptional<T>(distPath: string, relPath: string | undefined): Promise<T | null> {
  if (relPath === undefined) return null;
  const full = join(distPath, relPath);
  if (!(await pathExists(full))) return null;
  return loadJson<T>(full);
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
 * Item 116 — basic compatibility check between the manifest's `producedBy`
 * and the user app's `zb` version. Same major considered compatible; minor
 * differences logged informationally; major mismatch is fatal.
 *
 * Producer string format: `@zipbul/cli@<semver>` (Slice 1 convention).
 */
function assertProducerCompatible(producedBy: string, userAppVersion: string, manifestPath: string): void {
  const producerVersion = parseProducerVersion(producedBy);
  if (producerVersion === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Manifest \`producedBy\` (${producedBy}) does not match \`@zipbul/cli@<semver>\` shape; cannot verify compatibility.`,
      file: manifestPath,
    }));
  }

  const producerMajor = producerVersion.split('.')[0]!;
  const userMajor = userAppVersion.split('.')[0]!;

  if (producerMajor !== userMajor) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Adapter manifest at ${manifestPath} was produced by ${producedBy}, but the user-app build runs @zipbul/cli@${userAppVersion}. Major versions must match (re-run \`zb build adapter\` in the adapter package).`,
      file: manifestPath,
    }));
  }
}

function parseProducerVersion(producedBy: string): string | null {
  const match = /^@zipbul\/cli@(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(producedBy);
  return match === null ? null : match[1] ?? null;
}
