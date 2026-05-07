import { join, dirname } from 'node:path';
import { stat } from 'node:fs/promises';

import type { AdapterResolveParams } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterResolution,
} from '../interfaces';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { err, isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import {
  readAdapterManifest,
  synthesizeAdapterExtraction,
} from '../../adapter-build';
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

      const kind = await readPackageKind(packageRoot);
      if (kind !== 'adapter') continue;

      const distPath = join(packageRoot, 'dist');
      const manifestPath = join(distPath, 'adapter.manifest.json');
      if (!(await pathExists(manifestPath))) {
        return err(buildDiagnostic({
          reason: `[CONTRACT] Adapter package at ${packageRoot} declares \`zipbul.kind=adapter\` but no compiled manifest exists at ${manifestPath}. Run \`zb build adapter\` in the adapter package first.`,
          file: packageRoot,
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

    if (adapterExtractions.length === 0) {
      return err(buildDiagnostic({
        reason: 'No adapter package found. The user-app build expects at least one imported package whose `package.json#zipbul.kind` is `"adapter"` and which ships a compiled `dist/adapter.manifest.json`.',
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
 * `null` when the manifest is unreadable or `kind` is missing — caller treats
 * `null` the same as "not an adapter".
 */
async function readPackageKind(root: string): Promise<string | null> {
  const pkgPath = join(root, 'package.json');
  try {
    const text = await Bun.file(pkgPath).text();
    const parsed = JSON.parse(text) as { zipbul?: { kind?: unknown } };
    const kind = parsed.zipbul?.kind;
    return typeof kind === 'string' ? kind : null;
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
