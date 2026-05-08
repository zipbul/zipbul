import { join, dirname } from 'node:path';
import { stat, readFile } from 'node:fs/promises';

import type { AdapterResolveParams } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterResolution,
} from '../interfaces';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { err, isErr } from '@zipbul/result';
import { parseSource, extractSymbols, walk, is } from '@zipbul/gildash';
import type { Node, ParsedFile } from '@zipbul/gildash';
import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import {
  readAdapterManifest,
  synthesizeAdapterExtraction,
  compileAdapter,
  type SourceFile,
  type ReadAdapterManifestResult,
} from '../../adapter-build';
import { buildCalleeResolver } from '../../define-call-shape';
import { collectPackageEntryFiles } from './config-extractor';
import {
  buildHandlerIndex,
  buildAdapterStaticSchemaSet,
  buildControllerAdapterMap,
} from './handler-index-builder';
import { validateMiddlewarePhaseInputs } from './phase-id-validator';

const FIND_ROOT_MAX_DEPTH = 15;

/**
 * Resolves adapter definitions exclusively from pre-compiled manifests
 * (`<adapterPackage>/dist/adapter.manifest.json`). The user-app build no longer
 * walks the adapter's `.ts` source tree — that path was removed once the
 * manifest contract (Section M) became the single integration point.
 *
 * Pipeline:
 * 1. Collect non-relative import targets from the user code (= adapter package
 *    entry files).
 * 2. For each unique package root, classify by `package.json#zipbul.kind`.
 * 3. For every adapter package, require the compiled manifest tree;
 *    deserialize via `readAdapterManifest()` and synthesize the analyzer-side
 *    `AdapterExtraction` via `synthesizeAdapterExtraction()`.
 * 4. Run the existing controller-adapter map / phase validation / handler index
 *    builders on the aggregated extractions.
 *
 * @public
 */
export class AdapterDefinitionResolver {
  /**
   * @param params - Adapter resolve parameters: fileMap, project root, optional graph.
   * @returns The full adapter resolution containing schemas, handler index, and route registrations.
   * @public
   */
  async resolve(params: AdapterResolveParams): Promise<Result<AdapterResolution, Diagnostic>> {
    const { fileMap, projectRoot, graph } = params;
    const entryFiles = collectPackageEntryFiles(fileMap);
    const adapterExtractions: AdapterExtraction[] = [];
    const visitedRoots = new Set<string>();

    for (const entryFile of entryFiles) {
      const packageRoot = await findPackageRoot(entryFile);
      if (packageRoot === null) continue;
      if (visitedRoots.has(packageRoot)) continue;
      visitedRoots.add(packageRoot);

      let kind: string | null;
      try {
        kind = await readPackageKind(packageRoot);
      } catch (cause) {
        if (cause instanceof DiagnosticError) return err(cause.diagnostic);
        throw cause;
      }
      if (kind !== 'adapter') continue;

      const distPath = join(packageRoot, 'dist');
      const manifestPath = join(distPath, 'adapter.manifest.json');
      if (!(await pathExists(manifestPath))) {
        return err(buildDiagnostic({
          reason: `[CONTRACT] Adapter package at ${packageRoot} declares \`zipbul.kind=adapter\` but no compiled manifest exists at ${manifestPath}.`,
          file: packageRoot,
          how: `Run \`zb build adapter\` inside ${packageRoot}, or upgrade the dependency to a version that ships a built \`dist/\`.`,
        }));
      }

      let extraction: AdapterExtraction;
      try {
        const result = await readAdapterManifest(distPath);
        extraction = synthesizeAdapterExtraction(result);
      } catch (cause) {
        if (cause instanceof DiagnosticError) return err(cause.diagnostic);
        throw cause;
      }

      adapterExtractions.push(extraction);
    }

    // Inline-adapter scan: always run. User-app source-tree `defineAdapter`
    // calls are compiled in-memory via the same extractor used by
    // `zb build adapter` and appended to whatever external adapter packages
    // contributed. A multi-adapter app can mix external + inline freely
    // (e.g. external HTTP + inline custom transport), since each adapter
    // owns its own decorator + controller scope.
    try {
      const inlineExtractions = await collectInlineAdapterExtractions(fileMap, projectRoot);
      adapterExtractions.push(...inlineExtractions);
    } catch (cause) {
      if (cause instanceof DiagnosticError) return err(cause.diagnostic);
      throw cause;
    }

    if (adapterExtractions.length === 0) {
      return err(buildDiagnostic({
        reason: 'No adapter found.',
        how: 'Either install an adapter package (e.g. `bun add @zipbul/http-adapter`) whose `package.json#zipbul.kind` is `"adapter"` and ships `dist/adapter.manifest.json`, or add a top-level `export const X = defineAdapter(...)` call in your user-app source tree.',
      }));
    }

    const adapterStaticSchemas = buildAdapterStaticSchemaSet(adapterExtractions);
    if (isErr(adapterStaticSchemas)) return adapterStaticSchemas;

    const controllerAdapterMap = buildControllerAdapterMap(adapterExtractions, fileMap);
    if (isErr(controllerAdapterMap)) return controllerAdapterMap;

    if (graph !== undefined) {
      const controllerDecoratorNames = adapterExtractions.map(extraction => extraction.staticSchema.entryDecorators.controller);
      graph.registerControllers(controllerDecoratorNames);
    }

    const middlewareValidation = validateMiddlewarePhaseInputs(adapterExtractions, fileMap, controllerAdapterMap);
    if (isErr(middlewareValidation)) return middlewareValidation;

    const handlerIndexResult = buildHandlerIndex(adapterExtractions, fileMap, projectRoot, controllerAdapterMap, graph);
    if (isErr(handlerIndexResult)) return handlerIndexResult;

    return {
      adapterStaticSchemas,
      handlerIndex: handlerIndexResult.entries,
      routeRegistrations: handlerIndexResult.routeRegistrations,
      handlerContextUsages: handlerIndexResult.handlerContextUsages,
      handlerContextOps: handlerIndexResult.handlerContextOps,
    };
  }
}

/**
 * Walks up from `entryFile` to the nearest `package.json`, returning the
 * directory that contains it. Capped at `FIND_ROOT_MAX_DEPTH` parent traversals
 * to avoid runaway loops on misconfigured filesystems.
 */
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

/**
 * Reads `<root>/package.json` and returns `zipbul.kind` if present. Returns
 * `null` when the file is missing or `kind` is absent — caller treats `null`
 * the same as "not an adapter". Throws `DiagnosticError` on JSON parse
 * failure: a corrupt `package.json` is unambiguous misconfiguration that
 * silently masking would later cause "no adapter found" with no clue.
 */
async function readPackageKind(root: string): Promise<string | null> {
  const pkgPath = join(root, 'package.json');
  if (!(await pathExists(pkgPath))) return null;

  let text: string;
  try {
    text = await Bun.file(pkgPath).text();
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[SYNTAX] ${pkgPath} is not valid JSON: ${(cause as Error).message ?? String(cause)}`,
      file: pkgPath,
    }));
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const zipbul = (parsed as { zipbul?: unknown }).zipbul;
  if (typeof zipbul !== 'object' || zipbul === null) return null;

  const kind = (zipbul as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
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
 * Scans user-app source files (everything inside `projectRoot` not under
 * `node_modules/`) for `defineAdapter(...)` calls and compiles each into an
 * `AdapterExtraction`. Empty array when no inline adapter exists.
 *
 * The inline path skips `validateNoBuiltinMiddleware` because user-app
 * sources legitimately contain factory-wrapped middleware consumers; the
 * adapter purity rule only applies to dedicated adapter packages.
 *
 * @internal
 */
async function collectInlineAdapterExtractions(
  fileMap: Map<string, { /* opaque to us */ }>,
  projectRoot: string,
): Promise<AdapterExtraction[]> {
  const userAppFiles: string[] = [];
  for (const filePath of fileMap.keys()) {
    if (filePath.includes(`${'/node_modules/'}`)) continue;
    if (!filePath.startsWith(projectRoot)) continue;
    if (!filePath.endsWith('.ts')) continue;
    if (filePath.endsWith('.d.ts') || filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) continue;
    userAppFiles.push(filePath);
  }

  const sourceTree: SourceFile[] = [];
  const filesContainingDefineAdapter: SourceFile[] = [];

  for (const filePath of userAppFiles) {
    if (!(await pathExists(filePath))) continue;     // synthetic test fixtures
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSource(filePath, text);
    if (isErr(parsed)) continue;     // syntax errors surfaced elsewhere

    const symbols = extractSymbols(parsed);
    const file: SourceFile = { filePath, parsed: parsed as ParsedFile, symbols };
    sourceTree.push(file);

    if (fileContainsDefineAdapterCall(file)) {
      filesContainingDefineAdapter.push(file);
    }
  }

  if (filesContainingDefineAdapter.length === 0) return [];

  if (filesContainingDefineAdapter.length > 1) {
    const list = filesContainingDefineAdapter.map(f => f.filePath).join('\n  - ');
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Multiple inline \`defineAdapter(...)\` calls in user-app source. Only one inline adapter is allowed per project; for multi-adapter setups use external adapter packages.\n  - ${list}`,
    }));
  }

  const entry = filesContainingDefineAdapter[0]!;
  // `enforceAdapterPurity: false` for inline — rationale: the
  // `validateNoBuiltinMiddleware` purity check exists to keep external
  // adapter PACKAGES single-purpose (no factory-wrapped middleware mixed in
  // with adapter wiring), which matters because consumers depend on a thin
  // protocol surface. User-app source legitimately contains both the
  // inline adapter AND middleware factories that consume it (this is the
  // whole point of inline — single-package monolith). Enforcing purity
  // here would block the documented user-app middleware-factory pattern
  // (see `define-call-shape.ts` regulated-set rationale).
  const compiled = compileAdapter({
    sourceTree,
    entry,
    packageRoot: projectRoot,
    enforceAdapterPurity: false,
  });

  // `packageName` flows into the synthesized `ContextNamespaceMap.module`
  // field which downstream emits as `declare module '<name>' {...}` in
  // `.zipbul/context.d.ts` whenever a middleware defines context augments.
  // For inline adapters we use the user-app's own `package.json#name` —
  // a monolithic app augments its own package, the standard TS pattern.
  // If the user-app has no `package.json#name`, hard-fail with a clear
  // diagnostic: any sentinel fallback would emit syntactically invalid
  // TypeScript (`declare module '<inline>'`) and silently break tsc
  // downstream when augments are present.
  const userAppPackageName = await readUserAppPackageName(projectRoot);
  if (userAppPackageName === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Inline adapter requires the user-app to declare \`name\` in its \`package.json\`. The compiler emits \`declare module '<name>'\` in context.d.ts to wire middleware augments; without a stable name, the generated TypeScript is invalid. Add a \`name\` field to ${join(projectRoot, 'package.json')}.`,
    }));
  }
  const synthetic: ReadAdapterManifestResult = {
    packageName: userAppPackageName,
    adapter: compiled.adapterManifest,
    pipeline: compiled.pipelineSchema,
    decorators: compiled.decoratorSchema,
    peerContract: compiled.peerContract,
    contextNamespaces: compiled.contextNamespaces,
    constructorSchema: compiled.constructorSchema,
  };

  return [synthesizeAdapterExtraction(synthetic)];
}

async function readUserAppPackageName(projectRoot: string): Promise<string | null> {
  const pkgPath = join(projectRoot, 'package.json');
  if (!(await pathExists(pkgPath))) return null;
  try {
    const raw = await readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : null;
  } catch {
    return null;
  }
}

function fileContainsDefineAdapterCall(file: SourceFile): boolean {
  const resolver = buildCalleeResolver(file);
  let found = false;
  walk(file.parsed.program, {
    enter(node: Node) {
      if (found) return;
      if (!is.CallExpression(node)) return;
      const callee = node.callee;
      let calleeText: string | null = null;
      if (is.Identifier(callee)) {
        calleeText = callee.name;
      } else if (
        is.MemberExpression(callee)
        && !callee.computed
        && is.Identifier(callee.property)
        && is.Identifier(callee.object)
      ) {
        calleeText = `${callee.object.name}.${callee.property.name}`;
      }
      if (calleeText === null) return;
      if (resolver.resolveCalleeText(calleeText) === 'defineAdapter') {
        found = true;
      }
    },
  });
  return found;
}
