import type { MiddlewareDefinition } from '@zipbul/common';
import { augmentRawKey } from '@zipbul/common';
import { installAugmentAccessorOnPrototype, runInAdapterContext } from '@zipbul/core';

import type { HttpContext } from '../http-context';
import { HTTP_NAMESPACE_PROTOTYPES } from '../context-namespaces';

/**
 * Unit-test helper for augment-declaring middleware: installs the
 * definition's augments (idempotent), runs each spec's supply/create against
 * the given mock context to populate the per-request slots, then executes
 * `fn` inside the adapter ALS so installed prototype accessors resolve.
 *
 * Scope: populates the RAW slot only — no baker validation step runs here,
 * so validated accessors (e.g. `getQuery(Dto)`) are NOT invocable under this
 * helper (they read the validated slot and throw). Assert the supply output
 * via `ctx.get(augmentRawKey(ns, prop))` instead; the DTO path is end-to-end
 * territory.
 *
 * @public
 */
export async function withAugments<T>(
  definition: MiddlewareDefinition,
  ctx: HttpContext,
  fn: (ctx: HttpContext) => T | Promise<T>,
): Promise<T> {
  if (definition.augments !== undefined) {
    for (const [namespace, props] of Object.entries(definition.augments)) {
      const prototype = HTTP_NAMESPACE_PROTOTYPES[namespace];

      for (const [prop, spec] of Object.entries(props)) {
        if (prototype !== undefined) {
          installAugmentAccessorOnPrototype(prototype, namespace, prop, 'HttpAdapter');
        }
        ctx.set(augmentRawKey(namespace, prop), spec.supply(ctx));
      }
    }
  }

  return await runInAdapterContext(ctx, () => fn(ctx));
}
