import type { FileAnalysis } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterEntryDecoratorsSchema,
} from '../interfaces';
import type { DecoratorArguments } from '../types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { err, isErr } from '@zipbul/result';
import { ZIPBUL_REF, ZIPBUL_COMPUTED_PREFIX } from '@zipbul/common';

/** All IR sentinel keys start with this prefix. */
const SENTINEL_PREFIX = '__zipbul_';
import { buildDiagnostic } from '../../../diagnostics';
import { PathResolver } from '../../../common';
import { toRecord, isAnalyzerValueArray, isNonEmptyString } from '../type-guards';

/**
 * Validates that all middleware phase IDs used in module definitions and decorators
 * are declared in the adapter's `validPhases` set.
 *
 * @param extractions - Adapter extractions containing valid phases.
 * @param fileMap - Map of file paths to their analysis results.
 * @param controllerAdapterMap - Map of controller class names to adapter IDs.
 * @returns void on success, or a diagnostic error.
 * @public
 */
export function validateMiddlewarePhaseInputs(
  extractions: AdapterExtraction[],
  fileMap: Map<string, FileAnalysis>,
  controllerAdapterMap: Map<string, string>,
): Result<void, Diagnostic> {
  for (const extraction of extractions) {
    const validPhases = extraction.staticSchema.validPhases;

    if (validPhases === undefined) {
      return err(buildDiagnostic({
        reason: `Adapter '${extraction.adapterId}' does not declare validPhases.`,
        how: 'Add `static readonly validPhases: ReadonlySet<string> = new Set([HttpPhase.OnRequest, HttpPhase.PreHandler, ...])` to the adapter class. The set lists every phase identifier the adapter accepts in @UseMiddlewares decorators.',
      }));
    }

    const modulePhaseIds = collectModuleMiddlewarePhaseIds(fileMap, extraction.adapterId);
    if (isErr(modulePhaseIds)) return modulePhaseIds;

    const decoratorPhaseIds = collectDecoratorPhaseIds(
      fileMap,
      extraction.adapterId,
      extraction.staticSchema.entryDecorators,
      controllerAdapterMap,
    );
    if (isErr(decoratorPhaseIds)) return decoratorPhaseIds;

    const combinedPhaseIds = [...modulePhaseIds, ...decoratorPhaseIds];

    for (const phaseId of combinedPhaseIds) {
      if (!validPhases.has(phaseId)) {
        return err(buildDiagnostic({
          reason: `Unsupported middleware phase '${phaseId}' for adapter '${extraction.adapterId}'. Valid phases: ${[...validPhases].join(', ')}.`,
        }));
      }
    }
  }

  return undefined;
}

/**
 * Collects middleware phase IDs from module definition adapter entries.
 *
 * @param fileMap - Map of file paths to their analysis results.
 * @param adapterId - The adapter identifier to match.
 * @returns Array of phase IDs, or a diagnostic error.
 */
function collectModuleMiddlewarePhaseIds(fileMap: Map<string, FileAnalysis>, adapterId: string): Result<string[], Diagnostic> {
  const phaseIds: string[] = [];

  for (const analysis of fileMap.values()) {
    const moduleDefinition = analysis.moduleDefinition;

    if (moduleDefinition?.adapters === undefined) {
      continue;
    }

    const adaptersArray = isAnalyzerValueArray(moduleDefinition.adapters) ? moduleDefinition.adapters : null;

    if (adaptersArray === null) {
      continue;
    }

    for (const adapterNode of adaptersArray) {
      const itemRecord = toRecord(adapterNode);

      if (itemRecord === null) {
        continue;
      }

      const adapterRef = toRecord(itemRecord.adapter);
      const adapterClassName = typeof adapterRef?.[ZIPBUL_REF] === 'string' ? adapterRef[ZIPBUL_REF] : null;

      if (adapterClassName !== adapterId) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(itemRecord, 'middlewares')) {
        continue;
      }

      const middlewares = toRecord(itemRecord.middlewares);

      if (middlewares === null) {
        return err(buildDiagnostic({
          reason: `middlewares must be an object literal for '${adapterId}'.`,
          file: analysis.filePath,
        }));
      }

      for (const key of Object.keys(middlewares)) {
        if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
          return err(buildDiagnostic({
            reason: `Middleware phase keys must be string literals for '${adapterId}'.`,
            file: analysis.filePath,
            symbol: adapterId,
          }));
        }

        // Skip IR sentinel keys (__zipbul_ref, __zipbul_import_source, etc.)
        if (key.startsWith(SENTINEL_PREFIX)) continue;

        if (key.length === 0) {
          return err(buildDiagnostic({
            reason: `Middleware phase keys must be non-empty for '${adapterId}'.`,
            file: analysis.filePath,
            symbol: adapterId,
          }));
        }

        const phaseIdCheck = assertValidPhaseId(key, adapterId, 'middlewares');
        if (isErr(phaseIdCheck)) return phaseIdCheck;

        phaseIds.push(key);
      }
    }
  }

  return phaseIds;
}

/**
 * Collects middleware phase IDs from `@UseMiddlewares` decorators on controllers and handlers.
 *
 * @param fileMap - Map of file paths to their analysis results.
 * @param adapterId - The adapter identifier to match.
 * @param entryDecorators - The adapter's entry decorator schema.
 * @param controllerAdapterMap - Map of controller class names to adapter IDs.
 * @returns Array of phase IDs, or a diagnostic error.
 */
function collectDecoratorPhaseIds(
  fileMap: Map<string, FileAnalysis>,
  adapterId: string,
  entryDecorators: AdapterEntryDecoratorsSchema,
  controllerAdapterMap: Map<string, string>,
): Result<string[], Diagnostic> {
  const phaseIds: string[] = [];

  for (const analysis of fileMap.values()) {
    for (const cls of analysis.classes) {
      const controllerAdapterId = controllerAdapterMap.get(cls.className);
      const isAdapterController = controllerAdapterId === adapterId;

      if (isAdapterController) {
        for (const decorator of cls.decorators) {
          if (decorator.name !== 'UseMiddlewares') {
            continue;
          }

          const extracted = extractPhaseIdsFromDecorator(decorator, adapterId);
          if (isErr(extracted)) return extracted;

          phaseIds.push(...extracted);
        }
      }

      for (const method of cls.methods) {
        const hasHandlerDecorator = method.decorators.some(dec => entryDecorators.handlers.includes(dec.name));

        if (!hasHandlerDecorator) {
          continue;
        }

        if (!isAdapterController) {
          if (!isNonEmptyString(controllerAdapterId)) {
            return err(buildDiagnostic({
              reason: `@UseMiddlewares handlers '${cls.className}.${method.name}' must belong to adapter '${adapterId}'.`,
              file: analysis.filePath,
              symbol: `${cls.className}.${method.name}`,
            }));
          }

          continue;
        }

        for (const decorator of method.decorators) {
          if (decorator.name !== 'UseMiddlewares') {
            continue;
          }

          const extracted = extractPhaseIdsFromDecorator(decorator, adapterId);
          if (isErr(extracted)) return extracted;

          phaseIds.push(...extracted);
        }
      }
    }
  }

  return phaseIds;
}

/**
 * Extracts phase IDs from a single `@UseMiddlewares` decorator.
 *
 * @param decorator - The decorator metadata.
 * @param adapterId - The adapter identifier for error messages.
 * @returns Array of phase IDs, or a diagnostic error.
 */
function extractPhaseIdsFromDecorator(decorator: DecoratorArguments, adapterId: string): Result<string[], Diagnostic> {
  const args = decorator.arguments;

  if (args.length === 2) {
    const phaseId = typeof args[0] === 'string' ? args[0] : null;

    if (!isNonEmptyString(phaseId)) {
      return err(buildDiagnostic({
        reason: `@UseMiddlewares phaseId must be a string literal for '${adapterId}'.`,
        how: `Pass the phase identifier as a member access on the adapter's phase enum, e.g. \`@UseMiddlewares(HttpPhase.OnRequest, [...])\`. Variables, expressions, and computed values are not supported.`,
      }));
    }

    const phaseIdCheck = assertValidPhaseId(phaseId, adapterId, '@UseMiddlewares');
    if (isErr(phaseIdCheck)) return phaseIdCheck;

    return [phaseId];
  }

  if (args.length === 1) {
    const mapping = toRecord(args[0]);

    if (mapping === null) {
      return err(buildDiagnostic({
        reason: `@UseMiddlewares map must be an object literal for '${adapterId}'.`,
      }));
    }

    const keys: string[] = [];

    for (const key of Object.keys(mapping)) {
      if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
        return err(buildDiagnostic({
          reason: `@UseMiddlewares phaseId must be a string literal for '${adapterId}'.`,
        }));
      }

      // Skip IR sentinel keys (__zipbul_ref, __zipbul_import_source, etc.)
      if (key.startsWith(SENTINEL_PREFIX)) continue;

      if (key.length === 0) {
        return err(buildDiagnostic({
          reason: `@UseMiddlewares phaseId must be non-empty for '${adapterId}'.`,
        }));
      }

      const phaseIdCheck = assertValidPhaseId(key, adapterId, '@UseMiddlewares');
      if (isErr(phaseIdCheck)) return phaseIdCheck;

      keys.push(key);
    }

    return keys;
  }

  return err(buildDiagnostic({
    reason: `@UseMiddlewares expects (phaseId, refs) or ({ [phaseId]: refs }) for '${adapterId}'.`,
  }));
}

/**
 * Normalizes a file path relative to the project root.
 *
 * @param projectRoot - The project root path.
 * @param filePath - The file path to normalize.
 * @returns Normalized relative path.
 * @public
 */
export function normalizeProjectPath(projectRoot: string, filePath: string): string {
  if (!filePath.startsWith(projectRoot)) {
    return PathResolver.normalize(filePath);
  }

  const trimmed = filePath.slice(projectRoot.length);

  if (trimmed.startsWith('/')) {
    return PathResolver.normalize(trimmed.slice(1));
  }

  return PathResolver.normalize(trimmed || '.');
}

/**
 * Asserts that a phase ID is valid (non-empty, no colons).
 *
 * @param phaseId - The phase ID to validate.
 * @param context - Context string for error messages.
 * @param field - Field name for error messages.
 * @returns void on success, or a diagnostic error.
 * @public
 */
export function assertValidPhaseId(phaseId: string, context: string, field: string): Result<void, Diagnostic> {
  if (phaseId.length === 0) {
    return err(buildDiagnostic({
      reason: `${field} phase id must be non-empty (${context}).`,
    }));
  }

  if (phaseId.includes(':')) {
    return err(buildDiagnostic({
      reason: `${field} phase id must not contain ':' (${context}).`,
    }));
  }

  return undefined;
}
