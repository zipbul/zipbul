import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { diag } from './diag';

export interface AdapterPackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: unknown;
  readonly files?: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly zipbul?: { readonly kind?: string };
}

export async function readPackageJson(packageRoot: string): Promise<AdapterPackageJson> {
  const pkgPath = join(packageRoot, 'package.json');

  try {
    const text = await readFile(pkgPath, 'utf8');
    return JSON.parse(text) as AdapterPackageJson;
  } catch (cause) {
    throw diag('IO', {
      reason: `Failed to read ${pkgPath}: ${(cause as Error).message ?? String(cause)}`,
      file: pkgPath,
    });
  }
}

export function validateAdapterKind(pkg: AdapterPackageJson, packageRoot: string): void {
  if (pkg.zipbul?.kind !== 'adapter') {
    throw diag('CONTRACT', {
      reason: `package.json at ${packageRoot} must declare "zipbul": { "kind": "adapter" }. Found: ${JSON.stringify(pkg.zipbul ?? null)}.`,
      file: join(packageRoot, 'package.json'),
      how: 'Add `"zipbul": { "kind": "adapter" }` to package.json. For middleware libraries use `zb build --lib` instead.',
    });
  }
}

/**
 * Validates that the published entry points are coherent and that peer
 * dependencies are listed (not bundled).
 *
 * - `main` / `module` / `types` / `exports['.']` must converge: when both a
 *   `module` and an `exports['.']` import condition exist, they must match.
 *   `types` must point at a `.d.ts`.
 * - `files` must include `dist` (or `dist/**`) so the published tarball
 *   carries the compiler output.
 * - `peerDependencies` SHOULD list `@zipbul/core` and `@zipbul/common` (the
 *   runtime contract). Missing → CONTRACT diagnostic.
 */
export function validatePackageFields(pkg: AdapterPackageJson, packageRoot: string): void {
  const pkgPath = join(packageRoot, 'package.json');
  const errors: string[] = [];

  if (typeof pkg.types === 'string' && !pkg.types.endsWith('.d.ts')) {
    errors.push(`package.json \`types\` must point at a \`.d.ts\` file. Got: ${pkg.types}.`);
  }

  const moduleEntry = typeof pkg.module === 'string' ? normalizeRelative(pkg.module) : null;
  const exportsImport = readExportsDefault(pkg.exports);
  const exportsImportNormalized = exportsImport !== null ? normalizeRelative(exportsImport) : null;

  if (moduleEntry !== null && exportsImportNormalized !== null && exportsImportNormalized !== moduleEntry) {
    errors.push(`package.json \`module\` (${pkg.module}) and \`exports['.']\` default (${exportsImport}) must resolve to the same path.`);
  }

  if (Array.isArray(pkg.files)) {
    const includesDist = pkg.files.some(entry =>
      entry === 'dist' || entry === 'dist/' || entry.startsWith('dist/'),
    );

    if (!includesDist) {
      errors.push(`package.json \`files\` must include \`dist\` so the compiled output ships in the published tarball. Got: ${JSON.stringify(pkg.files)}.`);
    }
  }

  // Framework runtime declarations. Skip when the package declares no deps
  // at all (minimal/test packages); enforce only when the package has any
  // dependency or peerDependency, signaling intent to publish.
  const peerDeps = pkg.peerDependencies ?? {};
  const directDeps = pkg.dependencies ?? {};
  const declaresAnyDeps = Object.keys(peerDeps).length > 0 || Object.keys(directDeps).length > 0;

  if (declaresAnyDeps) {
    const requiredFrameworkPeers = ['@zipbul/core', '@zipbul/common'];

    for (const peer of requiredFrameworkPeers) {
      const peerRange = peerDeps[peer];
      const directRange = directDeps[peer];

      if (peerRange === undefined && directRange === undefined) {
        errors.push(`package.json must declare \`${peer}\` in \`peerDependencies\` (preferred — shared with user app) or \`dependencies\`.`);
        continue;
      }

      const range = peerRange ?? directRange;
      if (typeof range !== 'string' || range.trim().length === 0) {
        errors.push(`package.json \`${peerRange !== undefined ? 'peerDependencies' : 'dependencies'}."${peer}"\` must declare a non-empty semver range. Got: ${JSON.stringify(range)}.`);
      }
    }
  }

  if (errors.length === 1) {
    throw diag('CONTRACT', { reason: errors[0]!, file: pkgPath });
  }
  if (errors.length > 1) {
    throw diag('CONTRACT', {
      reason: `${errors.length} package.json issues:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      file: pkgPath,
    });
  }
}

function normalizeRelative(p: string): string {
  return p.startsWith('./') ? p.slice(2) : p;
}

function readExportsDefault(exportsField: unknown): string | null {
  if (typeof exportsField === 'string') return exportsField;
  if (exportsField === null || typeof exportsField !== 'object') return null;

  const dotEntry = (exportsField as Record<string, unknown>)['.'];
  if (typeof dotEntry === 'string') return dotEntry;
  if (dotEntry === null || typeof dotEntry !== 'object') return null;

  const cond = dotEntry as Record<string, unknown>;
  for (const key of ['import', 'default', 'require']) {
    const value = cond[key];
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object') {
      const nested = (value as Record<string, unknown>)['default'];
      if (typeof nested === 'string') return nested;
    }
  }

  return null;
}
