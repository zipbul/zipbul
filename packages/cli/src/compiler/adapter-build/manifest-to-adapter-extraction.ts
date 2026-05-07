/**
 * Synthesizer — `ReadAdapterManifestResult` (read API output) →
 * `AdapterExtraction` (analyzer-side input). Bridge between Section M
 * (manifest read) and the existing user-app build pipeline (`AdapterDefinitionResolver`).
 *
 * Pure data transformation: no IO, no AST work. Caller (`AdapterDefinitionResolver`)
 * provides the manifest tree; synthesizer returns the same shape that
 * `extractFromConfigObject` would have produced from `.ts` static analysis.
 *
 * @public
 */
import type {
  AdapterExtraction,
  AdapterStaticSchema,
  AdapterEntryDecoratorsSchema,
  ContextNamespaceMap,
} from '../analyzer/interfaces';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type { ReadAdapterManifestResult } from './manifest-reader';

/**
 * Synthesizes the analyzer-side `AdapterExtraction` from a pre-compiled manifest.
 * Throws `DiagnosticError` when the manifest tree is missing fields the
 * downstream graph (`buildHandlerIndex`, `validateMiddlewarePhaseInputs`)
 * requires (currently: `decorators` is mandatory).
 *
 * @public
 */
export function synthesizeAdapterExtraction(result: ReadAdapterManifestResult): AdapterExtraction {
  if (result.decorators === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `[CONTRACT] Adapter manifest for ${result.packageName} is missing \`decorator-schema.json\` — entryDecorators is mandatory.`,
    }));
  }

  const entryDecorators: AdapterEntryDecoratorsSchema = {
    controller: result.decorators.controller,
    handlers: [...result.decorators.handlers],
    options: [...result.decorators.options],
  };

  const staticSchema: AdapterStaticSchema = { entryDecorators };

  if (result.pipeline !== null) {
    staticSchema.validPhases = new Set(result.pipeline.phaseMembers);
    staticSchema.pipeline = result.pipeline.pipeline.map(ref => ref.name);
  }

  if (result.contextNamespaces !== null) {
    staticSchema.contextNamespaces = synthesizeContextNamespaceMap(
      result.contextNamespaces,
      result.packageName,
    );
  }

  return {
    adapterId: result.adapter.adapterId,
    staticSchema,
  };
}

function synthesizeContextNamespaceMap(
  emit: ReadAdapterManifestResult['contextNamespaces'] & object,
  packageName: string,
): ContextNamespaceMap {
  const namespaces: Record<string, string> = {};
  for (const prop of emit.namespaces) {
    if (prop.type === null || prop.type.length === 0) continue;
    namespaces[prop.name] = prop.type;
  }

  return {
    contextType: emit.contextType,
    module: packageName,
    namespaces,
  };
}
