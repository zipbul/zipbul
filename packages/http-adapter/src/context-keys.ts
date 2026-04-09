import { contextKey, type ContextKey } from '@zipbul/common';

/**
 * Context key for the parsed HTTP request body.
 *
 * Set by `HttpStep.ParseBody` after body parsing completes.
 * Use `ctx.validated(bodyInput, DtoClass)` in handlers to access
 * the validated body.
 *
 * @public
 */
export const bodyInput: ContextKey<unknown> = contextKey<unknown>('http.body');

/**
 * Context key for route path parameters.
 *
 * Set during route resolution after the router matches the request path.
 * Use `ctx.validated(paramsInput, DtoClass)` in handlers to access
 * validated path parameters.
 *
 * @public
 */
export const paramsInput: ContextKey<unknown> = contextKey<unknown>('http.params');

/**
 * Context key for parsed query string parameters.
 *
 * Set during route resolution from the request URL search params.
 * Use `ctx.validated(queryInput, DtoClass)` in handlers to access
 * validated query parameters.
 *
 * @public
 */
export const queryInput: ContextKey<unknown> = contextKey<unknown>('http.query');
