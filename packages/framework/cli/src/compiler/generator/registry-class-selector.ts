import type { ModuleGraph } from '../analyzer';
import type { HandlerIndexEntry } from '../analyzer/interfaces';
import type { MetadataClassEntry } from './interfaces';

/**
 * Selects the classes that must appear in the runtime metadata registry.
 *
 * The registry is only a `className → constructor` lookup for the router:
 * - **controllers** — looked up for the `@Controller` prefix and class resolution
 * - **handler DTOs** — looked up by `metatypeKey` to hand to `baker.deserialize`
 *
 * Everything else (providers, baker `@Recipe` DTOs not referenced by a handler,
 * scanned services/interfaces) is never resolved through the registry, so it is
 * excluded. baker owns DTO schemas via `Class[Symbol.metadata]` and seals nested
 * DTOs by recursion — the compiler must not analyze or emit those schemas.
 *
 * Selecting by `node.controllers` ∪ `handlerIndex.validations[].metatypeKey`
 * mirrors exactly what the router resolves at runtime, so no looked-up class is
 * dropped and no unreferenced class is carried.
 */
export function selectRegistryClasses(
  classes: readonly MetadataClassEntry[],
  graph: ModuleGraph,
  handlerIndex: readonly HandlerIndexEntry[],
): MetadataClassEntry[] {
  const wanted = new Set<string>();

  for (const node of graph.modules.values()) {
    for (const controller of node.controllers) {
      wanted.add(controller);
    }
  }

  for (const entry of handlerIndex) {
    for (const validation of entry.validations ?? []) {
      if (validation.metatypeKey !== undefined) {
        wanted.add(validation.metatypeKey);
      }
    }
  }

  return classes.filter(c => wanted.has(c.metadata.className));
}
