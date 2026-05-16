/**
 * Well-known method key adapters use to expose their test surface to
 * `@zipbul/testing`. Declared once here so both the toolkit and adapter
 * packages share a single `unique symbol` — making `SurfaceOf<T>` infer
 * the concrete surface type without `as` casts at call sites.
 *
 * Adapters that don't need testability simply omit the method; the
 * toolkit throws at `app.adapter(X)` call time with a helpful message.
 *
 * @public
 */
export const TEST_SURFACE: unique symbol = Symbol.for('@zipbul/testing/surface');
