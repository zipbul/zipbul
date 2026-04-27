import type { AdapterResolveParams } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterResolution,
} from '../interfaces';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { err, isErr } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_CALL,
  FRAMEWORK_DEFINE_ADAPTER,
} from '@zipbul/common';
import { buildDiagnostic } from '../../../diagnostics';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import {
  collectPackageEntryFiles,
  resolveAdapterDefinitionExport,
  extractFromConfigObject,
} from './config-extractor';
import {
  buildHandlerIndex,
  buildAdapterStaticSchemaSet,
  buildControllerAdapterMap,
} from './handler-index-builder';
import { validateMiddlewarePhaseInputs } from './phase-id-validator';

/**
 * Resolves adapter definitions from the project file map,
 * building handler indexes and static schema sets.
 *
 * Orchestrates the full adapter resolution pipeline:
 * 1. Collect package entry files
 * 2. Resolve adapter definition exports
 * 3. Extract adapter configurations
 * 4. Build controller-adapter mappings
 * 5. Validate middleware phases
 * 6. Build handler index
 *
 * @public
 */
export class AdapterDefinitionResolver {
  private parser = new AstParser();

  /**
   * Resolves all adapter definitions from the given project parameters.
   *
   * @param params - The adapter resolve parameters including file map, project root, and optional graph.
   * @returns The full adapter resolution containing schemas, handler index, and route registrations.
   * @public
   */
  async resolve(params: AdapterResolveParams): Promise<Result<AdapterResolution, Diagnostic>> {
    const { fileMap, projectRoot, graph } = params;
    const entryFiles = collectPackageEntryFiles(fileMap);
    const adapterExtractions: AdapterExtraction[] = [];

    for (const entryFile of entryFiles) {
      const resolvedExport = await resolveAdapterDefinitionExport(entryFile, fileMap, new Set(), this.parser);

      if (resolvedExport === null) {
        continue;
      }

      const defineCall = toRecord(resolvedExport.value);

      if (defineCall?.[ZIPBUL_CALL] !== FRAMEWORK_DEFINE_ADAPTER) {
        return err(buildDiagnostic({
          reason: `Adapter definition must use defineAdapter(ClassRef) in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const args = isAnalyzerValueArray(defineCall.args) ? defineCall.args : [];

      if (args.length !== 1) {
        return err(buildDiagnostic({
          reason: `defineAdapter requires exactly one argument in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const arg = toRecord(args[0]);

      if (arg === null) {
        return err(buildDiagnostic({
          reason: `defineAdapter argument must be a config object in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const adapterField = toRecord(arg.adapter);
      if (adapterField === null || typeof adapterField[ZIPBUL_REF] !== 'string') {
        return err(buildDiagnostic({
          reason: `defineAdapter argument must be a config object with an 'adapter' class reference in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const configResult = await extractFromConfigObject(arg, resolvedExport.sourceFile, fileMap, this.parser);
      if (isErr(configResult)) return configResult;

      adapterExtractions.push(configResult);
    }

    if (adapterExtractions.length === 0) {
      return err(buildDiagnostic({
        reason: 'No adapter definition found. Export an adapterDefinition from your adapter package entry file.',
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
