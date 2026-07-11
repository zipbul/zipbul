import { existsSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';

import { renderMiddlewareFiles, toCamelName } from './templates';

import type { TemplateVersions } from './templates';

/**
 * Thrown for user-correctable failures (bad name, existing target). The `zb`
 * entry point catches this and reports it without a stack trace.
 */
class CreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateError';
  }
}

interface CreateMiddlewareDeps {
  /** Directory the new package is created under. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

interface CreateMiddlewareResult {
  readonly name: string;
  /** camelCase factory prefix (e.g. `my-thing` → `myThing`), for the next-step hint. */
  readonly camelName: string;
  readonly targetDir: string;
  readonly files: readonly string[];
}

// kebab-case: lowercase alphanumerics in one-or-more hyphen-separated segments.
// Rejects uppercase, leading/trailing/double hyphens, empty, and path separators.
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Fallbacks used when a dependency is not installed in the consumer's project.
// Best-effort resolution from node_modules overrides these when available.
const FALLBACK_VERSIONS: TemplateVersions = {
  baker: '^5.2.0',
  result: '^1.0.0',
  common: '^0.3.0',
  httpAdapter: '^1.1.1',
};

function assertValidName(name: string): void {
  if (name.length === 0) {
    throw new CreateError('middleware name is required: zb create middleware <name>');
  }

  if (!KEBAB_CASE.test(name)) {
    throw new CreateError(`invalid name "${name}" — use kebab-case (e.g. "my-thing", lowercase, hyphen-separated)`);
  }
}

/**
 * Resolves an installed package's version to a caret range by walking up from
 * `cwd` looking for `node_modules/<pkg>/package.json`. Returns `undefined` when
 * the package is not installed, so the caller can fall back.
 */
async function resolveInstalledVersion(pkg: string, cwd: string): Promise<string | undefined> {
  let dir = cwd;

  while (true) {
    const manifest = join(dir, 'node_modules', pkg, 'package.json');
    if (existsSync(manifest)) {
      try {
        const raw = (await Bun.file(manifest).json()) as { version?: unknown };
        if (typeof raw.version === 'string' && raw.version.length > 0) {
          return `^${raw.version}`;
        }
      } catch {
        // Unreadable/malformed manifest — treat as not resolvable.
      }
      return undefined;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

async function resolveVersions(cwd: string): Promise<TemplateVersions> {
  const [baker, result, common, httpAdapter] = await Promise.all([
    resolveInstalledVersion('@zipbul/baker', cwd),
    resolveInstalledVersion('@zipbul/result', cwd),
    resolveInstalledVersion('@zipbul/common', cwd),
    resolveInstalledVersion('@zipbul/http-adapter', cwd),
  ]);

  return {
    baker: baker ?? FALLBACK_VERSIONS.baker,
    result: result ?? FALLBACK_VERSIONS.result,
    common: common ?? FALLBACK_VERSIONS.common,
    httpAdapter: httpAdapter ?? FALLBACK_VERSIONS.httpAdapter,
  };
}

/**
 * Scaffolds a consumer-facing middleware package named `name` under `cwd`.
 * Writes exactly five files (package.json, index.ts, options.ts, `<name>.ts`,
 * `<name>.spec.ts`) and returns the target directory and file list. Throws
 * {@link CreateError} for a bad name or an already-existing target.
 */
async function createMiddleware(name: string, deps: CreateMiddlewareDeps = {}): Promise<CreateMiddlewareResult> {
  assertValidName(name);

  const cwd = deps.cwd ?? process.cwd();
  const targetDir = isAbsolute(name) ? name : join(cwd, name);

  if (existsSync(targetDir)) {
    throw new CreateError(`target already exists: ${targetDir}`);
  }

  const versions = await resolveVersions(cwd);
  const files = renderMiddlewareFiles(name, versions);

  const written: string[] = [];
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(targetDir, relativePath);
    // Bun.write creates intermediate directories.
    await Bun.write(absolutePath, contents);
    written.push(relativePath);
  }

  return { name, camelName: toCamelName(name), targetDir, files: written };
}

export { CreateError, createMiddleware };
export type { CreateMiddlewareDeps, CreateMiddlewareResult };
