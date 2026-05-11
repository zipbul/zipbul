import type { AdapterResolveParams, FileAnalysis } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterStaticSchema,
  HandlerIndexEntry,
  RouteRegistration,
} from '../interfaces';
import type { ContextUsage } from '../parser/handler-context-usage-extractor';
import type { ContextOperation } from '../parser/context-operation-extractor';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';
import type { CompiledValidationEntry } from '@zipbul/common';

import { err, isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';
import { buildDiagnostic } from '../../../diagnostics';
import { isNonEmptyString } from '../type-guards';
import { normalizeProjectPath } from './phase-id-validator';
import { compilePipeline } from './enum-type-resolver';
import {
  extractMiddlewaresDecoratorRefKeys,
  extractGlobalPipelineBindings,
  combineMiddlewareBindings,
  combineGuardBindings,
  combineExceptionFilterBindings,
  buildMergedPhaseMiddlewareKeys,
  extractMergedBindingKeys,
  extractDecoratorRefKeys,
} from './middleware-pipeline-processor';
import {
  extractAdapterNames,
  extractOptionDecorators,
  extractHandlerParams,
} from './decorator-extractor';

const logger = new Logger('compiler/handler-index');

/**
 * Interns immutable arrays/objects so that structurally identical values
 * share a single reference across all compiled handler entries.
 */
class InternPool {
  private readonly pool = new Map<string, unknown>();

  /**
   * Returns a cached reference if an identical value was already interned,
   * otherwise stores and returns the given value.
   */
  intern<T>(value: T): T {
    const key = JSON.stringify(value);
    const existing = this.pool.get(key);

    if (existing !== undefined) {
      return existing as T;
    }

    this.pool.set(key, value);

    return value;
  }
}

/**
 * Builds the handler index from adapter extractions, mapping each handler method
 * to its compiled metadata including pipeline bindings, options, and validations.
 *
 * @param extractions - Adapter extractions containing static schemas.
 * @param fileMap - Map of file paths to their analysis results.
 * @param projectRoot - The project root path for normalizing file paths.
 * @param controllerAdapterMap - Map of controller class names to adapter IDs.
 * @param graph - Optional module graph for resolving owner modules.
 * @returns Handler index entries and route registrations, or a diagnostic error.
 * @public
 */
export function buildHandlerIndex(
  extractions: AdapterExtraction[],
  fileMap: Map<string, FileAnalysis>,
  projectRoot: string,
  controllerAdapterMap: Map<string, string>,
  graph?: AdapterResolveParams['graph'],
): Result<{ entries: HandlerIndexEntry[]; routeRegistrations: RouteRegistration[]; handlerContextUsages: Map<string, readonly ContextUsage[]>; handlerContextOps: Map<string, readonly ContextOperation[]> }, Diagnostic> {
  const entries: HandlerIndexEntry[] = [];
  const routeRegistrations: RouteRegistration[] = [];
  const handlerContextUsages = new Map<string, readonly ContextUsage[]>();
  const handlerContextOps = new Map<string, readonly ContextOperation[]>();
  const seen = new Set<string>();
  const internPool = new InternPool();

  // E-3: Pre-build set of all known class names for metatypeKey validation
  const knownClassNames = new Set<string>();

  for (const fa of fileMap.values()) {
    for (const cls of fa.classes) {
      knownClassNames.add(cls.className);
    }
  }

  for (const analysis of fileMap.values()) {
    for (const cls of analysis.classes) {
      const controllerAdapterId = controllerAdapterMap.get(cls.className);

      for (const method of cls.methods) {
        for (const extraction of extractions) {
          const handlerDecorators = extraction.staticSchema.entryDecorators.handlers;
          const hasHandlerDecorator = method.decorators.some(dec => handlerDecorators.includes(dec.name));

          if (!hasHandlerDecorator) {
            continue;
          }

          // Handler method constraints (ADAPTER-R-010)
          if (method.isStatic) {
            return err(buildDiagnostic({
              reason: `Handler '${cls.className}.${method.name}' must not be a static method.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          if (method.isComputed) {
            return err(buildDiagnostic({
              reason: `Handler '${cls.className}.${method.name}' must not use a computed property name.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          if (method.isPrivateName) {
            return err(buildDiagnostic({
              reason: `Handler '${cls.className}.${method.name}' must not be a private method.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          if (!isNonEmptyString(controllerAdapterId)) {
            return err(buildDiagnostic({
              reason: `Handler '${cls.className}.${method.name}' must belong to a controller for adapter '${extraction.adapterId}'.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          if (controllerAdapterId !== extraction.adapterId) {
            continue;
          }

          const file = normalizeProjectPath(projectRoot, analysis.filePath);
          const symbol = `${cls.className}.${method.name}`;
          const id = `${extraction.adapterId}:${file}#${symbol}`;

          if (seen.has(id)) {
            return err(buildDiagnostic({
              reason: `Duplicate handler id detected: ${id}`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          const matchingDecorators = method.decorators.filter(dec => handlerDecorators.includes(dec.name));

          if (matchingDecorators.length > 1) {
            return err(buildDiagnostic({
              reason: `Handler '${cls.className}.${method.name}' has multiple route decorators (${matchingDecorators.map(dec => '@' + dec.name).join(', ')}). Only one is allowed.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          const handlerDec = matchingDecorators[0];
          const ownerModule = graph?.classMap.get(cls.className);
          const ownerModuleName = ownerModule?.name;

          // Extract route-level pipeline decorator references
          const middlewareKeyResult = extractMiddlewaresDecoratorRefKeys(
            cls,
            method,
            `__route_mw__:${cls.className}.${method.name}`,
            routeRegistrations,
            0,
          );
          const allMiddlewareKeys = middlewareKeyResult.keys;
          const exceptionFilterKeyResult = extractDecoratorRefKeys(
            cls,
            method,
            'UseExceptionFilters',
            `__route_ef__:${cls.className}.${method.name}`,
            routeRegistrations,
          );
          const exceptionFilterKeys = exceptionFilterKeyResult.keys;
          const guardKeyResult = extractDecoratorRefKeys(
            cls,
            method,
            'UseGuards',
            `__route_gd__:${cls.className}.${method.name}`,
            routeRegistrations,
          );
          const guardKeys = guardKeyResult.keys;
          const globalBindingResult = extractGlobalPipelineBindings(
            fileMap,
            extraction.adapterId,
            routeRegistrations,
          );
          const middlewareBindings = combineMiddlewareBindings(
            middlewareKeyResult.bindings,
            globalBindingResult.middlewareBindings,
          );
          const guardBindings = combineGuardBindings(guardKeyResult.bindings, globalBindingResult.guardBindings);
          const exceptionFilterBindings = combineExceptionFilterBindings(
            exceptionFilterKeyResult.bindings,
            globalBindingResult.exceptionFilterBindings,
          );
          const mergedPhaseMiddlewareKeys = buildMergedPhaseMiddlewareKeys(middlewareBindings);
          const mergedGuardKeys = extractMergedBindingKeys(guardBindings);
          const mergedExceptionFilterKeys = extractMergedBindingKeys(exceptionFilterBindings);
          const globalPhaseMiddlewareIds = new Set(
            globalBindingResult.middlewareBindings
              .map(binding => binding.phase)
              .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0),
          );
          const routePhaseMiddlewareIds = new Set(
            middlewareBindings
              .filter(binding => binding.scope !== 'global')
              .map(binding => binding.phase)
              .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0),
          );
          const hasMergedGuards = mergedGuardKeys.length > 0;

          // Extract option decorators (class-level + method-level)
          const optionDecorators = extraction.staticSchema.entryDecorators.options;
          const handlerOptions = extractOptionDecorators(cls, method, optionDecorators);
          const params = extractHandlerParams(method);

          // Build validations from ctx.request.getBody(Dto) / getParams(Dto) calls
          const validations = buildValidationEntries(method.contextUsages);

          // Compile pipeline -- eliminate steps with no registrations
          const pipelineResult = compilePipeline(
            extraction.staticSchema.pipeline,
            extraction.staticSchema.validPhases,
            hasMergedGuards,
            globalPhaseMiddlewareIds,
            routePhaseMiddlewareIds,
            validations,
          );

          seen.add(id);

          if (method.contextUsages !== undefined && method.contextUsages.length > 0) {
            handlerContextUsages.set(id, method.contextUsages);
          }

          if (method.contextOps !== undefined && method.contextOps.length > 0) {
            handlerContextOps.set(id, method.contextOps);
          }

          entries.push({
            id,
            adapterId: extraction.adapterId,
            className: cls.className,
            ...(ownerModuleName !== undefined ? { ownerModuleName } : {}),
            methodName: method.name,
            handlerDecorator: handlerDec?.name ?? '',
            handlerDecoratorArgs: handlerDec?.arguments ?? [],
            params,
            ...(allMiddlewareKeys.length > 0 ? { middlewareKeys: allMiddlewareKeys } : {}),
            ...(exceptionFilterKeys.length > 0 ? { exceptionFilterKeys } : {}),
            ...(guardKeys.length > 0 ? { guardKeys } : {}),
            ...(Object.keys(mergedPhaseMiddlewareKeys).length > 0 ? { mergedPhaseMiddlewareKeys: internPool.intern(mergedPhaseMiddlewareKeys) } : {}),
            ...(mergedGuardKeys.length > 0 ? { mergedGuardKeys: internPool.intern(mergedGuardKeys) } : {}),
            ...(mergedExceptionFilterKeys.length > 0 ? { mergedExceptionFilterKeys: internPool.intern(mergedExceptionFilterKeys) } : {}),
            ...(middlewareBindings.length > 0 ? { middlewareBindings } : {}),
            ...(guardBindings.length > 0 ? { guardBindings } : {}),
            ...(exceptionFilterBindings.length > 0 ? { exceptionFilterBindings } : {}),
            ...(handlerOptions.length > 0 ? { options: internPool.intern(handlerOptions) } : {}),
            ...(validations.length > 0 ? { validations: internPool.intern(validations) } : {}),
            ...(pipelineResult !== undefined ? {
              compiledPre: internPool.intern(pipelineResult.compiledPre),
              compiledPost: internPool.intern(pipelineResult.compiledPost),
            } : {}),
          });
        }
      }
    }
  }

  // D-4: Warn when a controller has no handler methods registered
  for (const [controllerName, adapterId] of controllerAdapterMap) {
    const hasHandler = entries.some(
      entry => entry.className === controllerName && entry.adapterId === adapterId,
    );

    if (!hasHandler) {
      logger.warn(`Controller '${controllerName}' for adapter '${adapterId}' has no handler methods. Did you forget to add route decorators?`);
    }
  }

  // D-3: Detect duplicate routes (same adapter + same decorator/method + same path)
  const routeConflictCheck = detectRouteConflicts(entries, extractions, fileMap);
  if (isErr(routeConflictCheck)) return routeConflictCheck;

  const sorted = entries.sort((a, b) => a.id.localeCompare(b.id));

  return { entries: sorted, routeRegistrations, handlerContextUsages, handlerContextOps };
}

/**
 * Detects route conflicts where two handlers share the same adapter, HTTP method decorator, and route path.
 * The full route path is composed of the controller prefix (from controller decorator arg) and
 * the handler path (from handler decorator arg).
 *
 * @param entries - All handler index entries.
 * @param extractions - Adapter extractions for looking up controller decorator names.
 * @param fileMap - File analysis map for resolving controller class metadata.
 * @returns void on success, or a diagnostic error if conflicts are found.
 */
function detectRouteConflicts(
  entries: HandlerIndexEntry[],
  extractions: AdapterExtraction[],
  fileMap: Map<string, FileAnalysis>,
): Result<void, Diagnostic> {
  const controllerDecoratorNames = new Set(
    extractions.map(extraction => extraction.staticSchema.entryDecorators.controller),
  );

  // Pre-index: className -> controller decorator prefix
  const controllerPrefixIndex = new Map<string, string>();

  for (const analysis of fileMap.values()) {
    for (const cls of analysis.classes) {
      const decorator = cls.decorators.find(dec => controllerDecoratorNames.has(dec.name));

      if (decorator === undefined) {
        continue;
      }

      const firstArg = decorator.arguments[0];
      const prefix = typeof firstArg === 'string' ? firstArg : '';

      controllerPrefixIndex.set(cls.className, prefix);
    }
  }

  const getControllerPrefix = (className: string): string => {
    return controllerPrefixIndex.get(className) ?? '';
  };

  const routeKeyToEntry = new Map<string, HandlerIndexEntry>();

  for (const entry of entries) {
    const prefix = getControllerPrefix(entry.className);
    const handlerPath = typeof entry.handlerDecoratorArgs[0] === 'string'
      ? entry.handlerDecoratorArgs[0]
      : '/';
    const fullPath = joinRoutePaths(prefix, handlerPath);
    const routeKey = `${entry.adapterId}:${entry.handlerDecorator}:${fullPath}`;
    const existing = routeKeyToEntry.get(routeKey);

    if (existing !== undefined) {
      return err(buildDiagnostic({
        reason: `Route conflict: @${entry.handlerDecorator}('${fullPath}') is defined on both '${existing.className}.${existing.methodName}' and '${entry.className}.${entry.methodName}'.`,
      }));
    }

    routeKeyToEntry.set(routeKey, entry);
  }

  return undefined;
}

/**
 * Joins a controller prefix and handler path into a normalized route path.
 *
 * @param prefix - Controller-level path prefix (e.g. '/users').
 * @param handlerPath - Handler-level path (e.g. '/:id').
 * @returns Combined path (e.g. '/users/:id').
 */
function joinRoutePaths(prefix: string, handlerPath: string): string {
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const normalizedHandler = handlerPath.startsWith('/') ? handlerPath : `/${handlerPath}`;

  return `${normalizedPrefix}${normalizedHandler}`;
}

/** Accessor method names that trigger AOT validation wiring. */
const VALIDATION_ACCESSORS = new Set(['getBody', 'getParams']);

/**
 * Builds `CompiledValidationEntry[]` from context accessor calls found in
 * handler body (e.g. `ctx.request.getBody(CreateUserDto)`).
 *
 * Each matching usage produces an entry with the full accessor path and the
 * DTO class name. The adapter interprets the accessor path at boot time.
 *
 * @param contextUsages - Context member-access chains extracted from the handler body.
 * @returns Validation entries. Empty array when no matches.
 * @public
 */
export function buildValidationEntries(
  contextUsages: readonly ContextUsage[] | undefined,
): CompiledValidationEntry[] {
  if (contextUsages === undefined) {
    return [];
  }

  const result: CompiledValidationEntry[] = [];
  const seen = new Set<string>();

  for (const usage of contextUsages) {
    if (!usage.isCall || usage.dtoIdentifier === null) {
      continue;
    }

    const lastSegment = usage.path[usage.path.length - 1];

    if (lastSegment === undefined || !VALIDATION_ACCESSORS.has(lastSegment)) {
      continue;
    }

    const metatypeKey = usage.dtoIdentifier;

    if (metatypeKey === 'never' || metatypeKey === 'any' || metatypeKey === 'unknown') {
      continue;
    }

    const dedupeKey = `${usage.path.join('.')}:${metatypeKey}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    result.push({
      accessor: usage.path,
      metatypeKey,
    });
  }

  return result;
}

/**
 * Builds a deduplicated schema set from adapter extractions, keyed by adapter ID.
 *
 * @param extractions - Adapter extractions to deduplicate.
 * @returns Record of adapter static schemas keyed by adapter ID, or a diagnostic error.
 * @public
 */
export function buildAdapterStaticSchemaSet(extractions: AdapterExtraction[]): Result<Record<string, AdapterStaticSchema>, Diagnostic> {
  const sorted = [...extractions].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  const adapterStaticSchemas: Record<string, AdapterStaticSchema> = {};

  for (const entry of sorted) {
    if (Object.prototype.hasOwnProperty.call(adapterStaticSchemas, entry.adapterId)) {
      return err(buildDiagnostic({
        reason: `Duplicate adapterId detected: ${entry.adapterId}`,
      }));
    }

    adapterStaticSchemas[entry.adapterId] = entry.staticSchema;
  }

  return adapterStaticSchemas;
}

/**
 * Builds a map from controller class names to their owning adapter IDs.
 *
 * @param extractions - Adapter extractions containing entry decorator schemas.
 * @param fileMap - Map of file paths to their analysis results.
 * @returns Map of controller class names to adapter IDs, or a diagnostic error.
 * @public
 */
export function buildControllerAdapterMap(
  extractions: AdapterExtraction[],
  fileMap: Map<string, FileAnalysis>,
): Result<Map<string, string>, Diagnostic> {
  const adapterByController = new Map<string, string>();
  const adapters = extractions.map(extraction => ({
    adapterId: extraction.adapterId,
    entryDecorators: extraction.staticSchema.entryDecorators,
  }));

  // Pre-index: controller decorator name -> adapter entries that own it
  const adaptersByDecoratorName = new Map<string, typeof adapters>();

  for (const adapter of adapters) {
    const decoratorName = adapter.entryDecorators.controller;
    let list = adaptersByDecoratorName.get(decoratorName);

    if (list === undefined) {
      list = [];
      adaptersByDecoratorName.set(decoratorName, list);
    }

    list.push(adapter);
  }

  const controllerDecoratorNames = new Set(adaptersByDecoratorName.keys());

  for (const analysis of fileMap.values()) {
    for (const cls of analysis.classes) {
      const matchedDecorators = cls.decorators.filter(dec => controllerDecoratorNames.has(dec.name));

      if (matchedDecorators.length === 0) {
        continue;
      }

      // Collect all matching adapters across all controller decorators
      let controllerAdapters: typeof adapters = [];

      for (const decorator of matchedDecorators) {
        const matched = adaptersByDecoratorName.get(decorator.name);

        if (matched !== undefined) {
          controllerAdapters.push(...matched);
        }
      }

      // adapterNames constraint (ADAPTER-R-010): filter by explicit adapterNames if present
      const firstDecorator = matchedDecorators[0];

      if (firstDecorator !== undefined) {
        const adapterNames = extractAdapterNames(firstDecorator, extractions);
        if (isErr(adapterNames)) return adapterNames;

        if (adapterNames !== null) {
          controllerAdapters = controllerAdapters.filter(a => adapterNames.includes(a.adapterId));
        }
      }

      if (controllerAdapters.length > 1) {
        const names = controllerAdapters.map(adapter => adapter.adapterId).join(', ');

        return err(buildDiagnostic({
          reason: `Controller '${cls.className}' has multiple adapter owner decorators (${names}).`,
          file: analysis.filePath,
          symbol: cls.className,
        }));
      }

      if (controllerAdapters.length === 1) {
        const adapterEntry = controllerAdapters[0];

        if (adapterEntry) {
          adapterByController.set(cls.className, adapterEntry.adapterId);
        }
      }
    }
  }

  return adapterByController;
}
