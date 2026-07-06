import type { AdapterContext } from './interfaces';

/**
 * A middleware augment supply function — the SINGLE authoring form. The
 * middleware supplies the RAW value; the framework wires baker DTO validation
 * from the handler's `accessor(SomeDto)` call site (exactly like
 * `getBody`/`getParams`) and the installed accessor returns the validated
 * instance. Normalized to a {@link ValidatedAccessorSpec} at definition time.
 *
 * Must be a PLAIN synchronous function — async / generator / async-generator
 * functions and classes are rejected (they cannot be a `(ctx) => raw` supply).
 *
 * @public
 */
export type AugmentSupplyFn<Raw = unknown> = (ctx: AdapterContext) => Raw;

/**
 * The NORMALIZED internal spec produced from an {@link AugmentSupplyFn} by
 * `defineMiddleware`. Not authored directly. The installed accessor's public
 * signature is the generated `<T>(dto: Class<T>): T`.
 *
 * @public
 */
export interface ValidatedAccessorSpec<Raw = unknown> {
  readonly kind: 'validated-accessor';
  readonly supply: (ctx: AdapterContext) => Raw;
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
