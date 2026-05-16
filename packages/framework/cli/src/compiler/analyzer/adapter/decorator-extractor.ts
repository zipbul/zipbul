import type {
  AdapterExtraction,
  ClassMetadata,
  HandlerIndexEntry,
} from '../interfaces';
import type { AnalyzerValue } from '../types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';
import type { CompiledOptionEntry } from '@zipbul/common';

import { err } from '@zipbul/result';
import { buildDiagnostic } from '../../../diagnostics';
import { toRecord } from '../type-guards';

/**
 * Extracts `adapterNames` from a controller decorator argument.
 *
 * @param decorator - The decorator metadata.
 * @param extractions - Adapter extractions for validating adapter names.
 * @returns Array of validated adapter names, null if not specified, or a diagnostic error.
 */
export function extractAdapterNames(
  decorator: { name: string; arguments: readonly AnalyzerValue[] },
  extractions: AdapterExtraction[],
): Result<string[] | null, Diagnostic> {
  const args = decorator.arguments;

  if (args.length === 0) {
    return null;
  }

  const arg = toRecord(args[0]);

  if (arg === null) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(arg, 'adapterNames')) {
    return null;
  }

  const adapterNames = arg.adapterNames;

  if (!Array.isArray(adapterNames)) {
    return err(buildDiagnostic({
      reason: 'adapterNames must be an array.',
    }));
  }

  if (adapterNames.length === 0) {
    return err(buildDiagnostic({
      reason: 'adapterNames must not be empty.',
    }));
  }

  const knownIds = new Set(extractions.map(e => e.adapterId));
  const validated: string[] = [];

  for (const id of adapterNames) {
    if (typeof id !== 'string') {
      return err(buildDiagnostic({
        reason: 'adapterNames elements must be string literals.',
      }));
    }

    if (!knownIds.has(id)) {
      return err(buildDiagnostic({
        reason: `Unknown adapter name '${id}' in adapterNames.`,
      }));
    }

    validated.push(id);
  }

  return validated;
}

/**
 * Collects option decorators from class-level and method-level.
 * Class-level options apply to all handlers in the controller.
 * Method-level options apply to the specific handler. Duplicates are deduplicated by name.
 *
 * @param cls - The class metadata.
 * @param method - The method metadata.
 * @param optionNames - Adapter-declared option decorator names.
 * @returns Array of option entries with name and arguments.
 * @public
 */
export function extractOptionDecorators(
  cls: ClassMetadata,
  method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
  optionNames: readonly string[] | undefined,
): CompiledOptionEntry[] {
  if (optionNames === undefined || optionNames.length === 0) {
    return [];
  }

  const result: CompiledOptionEntry[] = [];
  const seen = new Set<string>();

  // Class-level first
  for (const decorator of cls.decorators) {
    if (optionNames.includes(decorator.name) && !seen.has(decorator.name)) {
      result.push({ name: decorator.name, arguments: decorator.arguments });
      seen.add(decorator.name);
    }
  }

  // Method-level overrides class-level (deduplicate by name)
  for (const decorator of method.decorators) {
    if (optionNames.includes(decorator.name)) {
      if (seen.has(decorator.name)) {
        // Method-level overrides class-level
        const index = result.findIndex(entry => entry.name === decorator.name);
        if (index !== -1) {
          result[index] = { name: decorator.name, arguments: decorator.arguments };
        }
      } else {
        result.push({ name: decorator.name, arguments: decorator.arguments });
        seen.add(decorator.name);
      }
    }
  }

  return result;
}

/**
 * Extracts handler parameter metadata from a method.
 *
 * @param method - The method metadata.
 * @returns Array of handler parameter entries.
 * @public
 */
export function extractHandlerParams(
  method: ClassMetadata['methods'][number],
): HandlerIndexEntry['params'] {
  const parameters = method.parameters ?? [];

  return parameters.map(param => {
    const primaryDecorator = param.decorators[0];
    const firstTypeArg = param.typeArgs?.[0];

    return {
      name: param.name,
      ...(primaryDecorator !== undefined ? { decoratorName: primaryDecorator.name } : {}),
      ...(primaryDecorator !== undefined ? { decoratorArgs: primaryDecorator.arguments } : {}),
      ...(typeof firstTypeArg === 'string' && firstTypeArg.length > 0 ? { metatypeKey: firstTypeArg } : {}),
    };
  });
}
