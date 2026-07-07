import { augmentValidatedKey } from '@zipbul/common';

import { getAdapterContext } from '../adapter-context';

/**
 * Install bookkeeping: prototype → set of installed props. Resolves the
 * `configurable:false` vs idempotent-reinstall vs prototype-probe conflict —
 * a re-install of the same prop is a no-op (multiple boots per process, e.g.
 * `@zipbul/testing`); a prop present on the prototype but NOT in this set is a
 * schema collision with a real class member.
 */
const installed = new Map<object, Set<string>>();

/**
 * Installs an augment-declared validated accessor on the given namespace
 * prototype — the protocol-AGNOSTIC install mechanism. Adapters contribute
 * only the namespace→prototype declaration; this core helper owns the
 * `Object.defineProperty` installation, bookkeeping, and collision guards.
 *
 * The installed non-enumerable METHOD `(dto) => validated instance` reads the
 * per-request validated slot through the adapter ALS (`getAdapterContext()`),
 * so per-request state never lives on the class instance (no hidden-class
 * forks, no per-request closures). It throws (ContextError) when no validation
 * step has populated the slot.
 *
 * Idempotent per process; rejects a collision with a real prototype member.
 *
 * @param prototype - The namespace target prototype (e.g. `HttpRequest.prototype`).
 * @param namespace - Context namespace (e.g. `request`).
 * @param prop - Member name (e.g. `getQuery`).
 * @param adapterName - Declaring adapter, for diagnostics.
 * @public
 */
export function installAugmentAccessorOnPrototype(
  prototype: object,
  namespace: string,
  prop: string,
  adapterName: string,
): void {
  let bookkeeping = installed.get(prototype);

  if (bookkeeping === undefined) {
    bookkeeping = new Set();
    installed.set(prototype, bookkeeping);
  }

  if (bookkeeping.has(prop)) {
    return; // idempotent re-install (same member, another boot)
  }

  if (prop in prototype) {
    throw new Error(
      `[${adapterName}] Context augment '${prop}' collides with an existing member of '${namespace}'. `
      + 'Choose a different member name.',
    );
  }

  const validatedKey = augmentValidatedKey(namespace, prop);

  Object.defineProperty(prototype, prop, {
    value: function augmentValidatedAccessor(_dto: unknown): unknown {
      return getAdapterContext().use(validatedKey);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  bookkeeping.add(prop);
}
