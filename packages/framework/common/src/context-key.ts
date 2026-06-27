/**
 * Branded symbol type for type-safe per-request context storage.
 * The phantom `__type` property carries the value type `T` at the type level
 * without adding runtime cost.
 *
 * @public
 */
export type ContextKey<T> = symbol & { readonly __type?: T };

/**
 * Creates a typed context key for per-request state sharing.
 *
 * @param description - Human-readable description for debugging (passed to `Symbol()`).
 * @returns A branded symbol that carries `T` at the type level.
 *
 * @example
 * ```typescript
 * const Cookies = contextKey<CookieJar>('zipbul.cookies');
 * ctx.set(Cookies, jar);
 * const jar = ctx.get(Cookies); // CookieJar | undefined
 * ```
 *
 * @public
 */
export function contextKey<T>(description: string): ContextKey<T> {
  return Symbol(description) as ContextKey<T>;
}
