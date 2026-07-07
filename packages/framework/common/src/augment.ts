import type { Result } from '@zipbul/result';

import type { AdapterContext } from './interfaces';

/**
 * A middleware augment supply function — the SINGLE authoring form. The
 * middleware supplies the RAW value; the framework wires baker DTO validation
 * from the handler's `accessor(SomeDto)` call site (exactly like
 * `getBody`/`getParams`) and the installed accessor returns the validated
 * instance. Normalized to a {@link ValidatedAccessorSpec} at definition time.
 *
 * Returns the raw value, OR an `Err` to signal a CLIENT error (e.g. a
 * malformed query): the framework short-circuits the pipeline into that `Err`
 * response — same value-or-error channel a middleware handler uses — so a bad
 * input becomes a 4xx, never a thrown 500. (`Result<Raw> = Raw | Err`, so a
 * supply that only ever returns a value needs no change.)
 *
 * Must be a PLAIN synchronous function — async / generator / async-generator
 * functions and classes are rejected (they cannot be a `(ctx) => raw` supply).
 *
 * @public
 */
export type AugmentSupplyFn<Raw = unknown> = (ctx: AdapterContext) => Result<Raw, unknown>;

/**
 * The NORMALIZED internal spec produced from an {@link AugmentSupplyFn} by
 * `defineMiddleware`. Not authored directly. The installed accessor's public
 * signature is the generated `<T>(dto: Class<T>): T`.
 *
 * @public
 */
export interface ValidatedAccessorSpec<Raw = unknown> {
  readonly kind: 'validated-accessor';
  readonly supply: (ctx: AdapterContext) => Result<Raw, unknown>;
}

/**
 * The normalized augment spec carried on a middleware definition. There is a
 * single kind — every augment is a DTO-validated accessor.
 *
 * @public
 */
export type MiddlewareAugmentSpec = ValidatedAccessorSpec<unknown>;

/**
 * The AUTHORED `augments` slot shape (config input): namespace (e.g. `request`)
 * → property name → a bare supply function. Normalized to
 * {@link MiddlewareAugments} by `defineMiddleware`.
 *
 * @public
 */
export type MiddlewareAugmentsInput = Readonly<Record<string, Readonly<Record<string, AugmentSupplyFn>>>>;

/**
 * The NORMALIZED `augments` shape carried on a middleware definition and read
 * by the runtime: namespace → property name → spec.
 *
 * @public
 */
export type MiddlewareAugments = Readonly<Record<string, Readonly<Record<string, MiddlewareAugmentSpec>>>>;
