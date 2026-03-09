import type { AdapterClass } from './types';

/**
 * Declares an adapter class. This is an identity function — it returns
 * the class reference as-is. Its purpose is to serve as a static marker
 * for AOT collection: the CLI compiler looks for `defineAdapter(...)` call
 * expressions and extracts adapter metadata from the class properties
 * (`decorators`) at build time.
 *
 * @param classRef - The adapter class whose instance properties declare `decorators`.
 * @returns The same class reference, unmodified.
 *
 * @example
 * ```ts
 * export const adapterDefinition = defineAdapter(HttpAdapter);
 * ```
 */
export function defineAdapter<T extends AdapterClass>(classRef: T): T {
  return classRef;
}
