/**
 * Pre-pass reader for `dist/context-augments.json` manifests shipped by
 * middleware library packages (`zb build middleware` output).
 *
 * Runs BEFORE adapter definition resolution so the validated-accessor NAMES
 * declared by installed middleware can parameterize handler validation-entry
 * extraction (`buildValidationEntries`), and so downstream passes (augment
 * collection, accessor registry emission) can consume the declared augments
 * without parsing published dist JavaScript.
 *
 * @public
 */
import { join, dirname } from 'node:path';

import type { FileAnalysis } from '../graph/interfaces';

import { pathExists } from '../../../common';
import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import { collectPackageEntryFiles } from './config-extractor';

/** The manifest schema version this reader understands. */
const SUPPORTED_MANIFEST_VERSION = 2;

const FIND_ROOT_MAX_DEPTH = 15;

/**
 * One augment declaration read from a package manifest.
 *
 * @public
 */
export interface ManifestAugmentEntry {
  readonly ns: string;
  readonly prop: string;
  readonly kind: 'validated-accessor';
}

/**
 * One middleware export declared by a package manifest.
 *
 * @public
 */
export interface ManifestMiddlewareEntry {
  /** Owning package name (`package.json#name`). */
  readonly packageName: string;
  readonly exportName: string;
  readonly form: 1 | 2;
  readonly contextType: string | null;
  readonly augments: readonly ManifestAugmentEntry[];
  readonly contextOps: ReadonlyArray<{ readonly kind: 'set' | 'use' | 'get'; readonly keyIdentifier: string | null }>;
}

/**
 * Aggregated index over every readable `dist/context-augments.json` in the
 * dependency closure.
 *
 * @public
 */
export interface AugmentsManifestIndex {
  /** All middleware entries across all packages, sorted by (package, exportName). */
  readonly entries: readonly ManifestMiddlewareEntry[];
  /** Entries grouped by package name. */
  readonly byPackage: ReadonlyMap<string, readonly ManifestMiddlewareEntry[]>;
  /** Union of all `validated-accessor` prop names — feeds `buildValidationEntries`. */
  readonly validationAccessorNames: ReadonlySet<string>;
}

/** An empty index — used when the pre-pass is skipped (e.g. unit fixtures). */
export function emptyAugmentsManifestIndex(): AugmentsManifestIndex {
  return { entries: [], byPackage: new Map(), validationAccessorNames: new Set() };
}

/**
 * Reads every `dist/context-augments.json` reachable from the project's
 * non-relative imports (npm AND workspace packages — both resolve through
 * the same package-entry discovery used by adapter resolution).
 *
 * Unknown manifest versions and malformed manifests are hard errors: a
 * corrupt manifest silently masked would surface later as unexplained
 * validation gaps.
 *
 * @public
 */
export async function readAugmentsManifests(
  fileMap: Map<string, FileAnalysis>,
): Promise<AugmentsManifestIndex> {
  const entryFiles = collectPackageEntryFiles(fileMap);
  const visitedRoots = new Set<string>();
  const entries: ManifestMiddlewareEntry[] = [];

  for (const entryFile of entryFiles) {
    const packageRoot = await findPackageRoot(entryFile);

    if (packageRoot === null || visitedRoots.has(packageRoot)) continue;

    visitedRoots.add(packageRoot);

    const manifestPath = join(packageRoot, 'dist', 'context-augments.json');

    if (!(await pathExists(manifestPath))) continue;

    const packageName = await readPackageName(packageRoot);

    if (packageName === null) continue;

    entries.push(...await readManifestFile(manifestPath, packageName));
  }

  return buildAugmentsManifestIndex(entries);
}

/**
 * Assembles the index from already-read entries. Split out for tests and for
 * callers that source entries elsewhere.
 *
 * @public
 */
export function buildAugmentsManifestIndex(
  entries: readonly ManifestMiddlewareEntry[],
): AugmentsManifestIndex {
  const sorted = [...entries].sort((left, right) => {
    const pkgDiff = left.packageName.localeCompare(right.packageName);

    return pkgDiff !== 0 ? pkgDiff : left.exportName.localeCompare(right.exportName);
  });
  const byPackage = new Map<string, ManifestMiddlewareEntry[]>();
  const validationAccessorNames = new Set<string>();

  for (const entry of sorted) {
    const bucket = byPackage.get(entry.packageName) ?? [];

    bucket.push(entry);
    byPackage.set(entry.packageName, bucket);

    for (const augment of entry.augments) {
      if (augment.kind === 'validated-accessor') {
        validationAccessorNames.add(augment.prop);
      }
    }
  }

  return { entries: sorted, byPackage, validationAccessorNames };
}

/**
 * Parses one manifest file into middleware entries. Hard-errors on unknown
 * versions and structurally invalid documents.
 */
async function readManifestFile(
  manifestPath: string,
  packageName: string,
): Promise<ManifestMiddlewareEntry[]> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await Bun.file(manifestPath).text());
  } catch (cause) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `${manifestPath} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      file: manifestPath,
      how: 'Rebuild the middleware package with `zb build middleware`, or reinstall the dependency.',
    }));
  }

  if (!isRecord(parsed)) {
    return fail(manifestPath, 'manifest root must be an object');
  }

  if (parsed.version !== SUPPORTED_MANIFEST_VERSION) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `${manifestPath} declares unsupported context-augments manifest version ${JSON.stringify(parsed.version)} (supported: ${SUPPORTED_MANIFEST_VERSION}).`,
      file: manifestPath,
      how: 'Upgrade @zipbul/cli (newer manifest versions require a newer compiler), or rebuild the middleware package with a matching CLI version.',
    }));
  }

  if (!Array.isArray(parsed.middlewares)) {
    return fail(manifestPath, '`middlewares` must be an array');
  }

  const entries: ManifestMiddlewareEntry[] = [];

  for (const raw of parsed.middlewares) {
    if (!isRecord(raw)) return fail(manifestPath, 'each middleware entry must be an object');

    const { exportName, form, contextType } = raw;

    if (typeof exportName !== 'string' || exportName.length === 0) {
      return fail(manifestPath, 'middleware `exportName` must be a non-empty string');
    }

    if (form !== 1 && form !== 2) {
      return fail(manifestPath, `middleware \`${exportName}\` has invalid \`form\` (expected 1 or 2)`);
    }

    if (contextType !== null && typeof contextType !== 'string') {
      return fail(manifestPath, `middleware \`${exportName}\` has invalid \`contextType\``);
    }

    entries.push({
      packageName,
      exportName,
      form,
      contextType: contextType ?? null,
      augments: readAugments(raw.augments, manifestPath, exportName),
      contextOps: readContextOps(raw.contextOps, manifestPath, exportName),
    });
  }

  return entries;
}

function readAugments(raw: unknown, manifestPath: string, exportName: string): ManifestAugmentEntry[] {
  if (!Array.isArray(raw)) {
    return fail(manifestPath, `middleware \`${exportName}\` has invalid \`augments\` (expected array)`);
  }

  const augments: ManifestAugmentEntry[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) return fail(manifestPath, `middleware \`${exportName}\` has a non-object augment entry`);

    const { ns, prop, kind } = entry;

    if (typeof ns !== 'string' || ns.length === 0 || typeof prop !== 'string' || prop.length === 0) {
      return fail(manifestPath, `middleware \`${exportName}\` has an augment entry with invalid \`ns\`/\`prop\``);
    }

    if (kind !== 'validated-accessor') {
      return fail(manifestPath, `middleware \`${exportName}\` augment \`${ns}.${prop}\` has invalid \`kind\` (expected 'validated-accessor')`);
    }

    augments.push({ ns, prop, kind });
  }

  return augments;
}

function readContextOps(
  raw: unknown,
  manifestPath: string,
  exportName: string,
): Array<{ kind: 'set' | 'use' | 'get'; keyIdentifier: string | null }> {
  if (!Array.isArray(raw)) {
    return fail(manifestPath, `middleware \`${exportName}\` has invalid \`contextOps\` (expected array — the field is mandatory)`);
  }

  const ops: Array<{ kind: 'set' | 'use' | 'get'; keyIdentifier: string | null }> = [];

  for (const entry of raw) {
    if (!isRecord(entry)) return fail(manifestPath, `middleware \`${exportName}\` has a non-object contextOps entry`);

    const { kind, keyIdentifier } = entry;

    if (kind !== 'set' && kind !== 'use' && kind !== 'get') {
      return fail(manifestPath, `middleware \`${exportName}\` has a contextOps entry with invalid \`kind\``);
    }

    if (keyIdentifier !== null && typeof keyIdentifier !== 'string') {
      return fail(manifestPath, `middleware \`${exportName}\` has a contextOps entry with invalid \`keyIdentifier\``);
    }

    ops.push({ kind, keyIdentifier: keyIdentifier ?? null });
  }

  return ops;
}

function fail(manifestPath: string, detail: string): never {
  throw new DiagnosticError(buildDiagnostic({
    reason: `${manifestPath} is not a valid context-augments manifest: ${detail}.`,
    file: manifestPath,
    how: 'Rebuild the middleware package with `zb build middleware`, or reinstall the dependency.',
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks up from `entryFile` to the nearest `package.json` directory. */
async function findPackageRoot(entryFile: string): Promise<string | null> {
  let current = dirname(entryFile);

  for (let depth = 0; depth < FIND_ROOT_MAX_DEPTH; depth += 1) {
    if (await pathExists(join(current, 'package.json'))) return current;

    const parent = dirname(current);

    if (parent === current) break;

    current = parent;
  }

  return null;
}

async function readPackageName(packageRoot: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await Bun.file(join(packageRoot, 'package.json')).text()) as { name?: unknown };

    return typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}
