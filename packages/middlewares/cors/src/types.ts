import type { HttpMethod } from '@zipbul/http-adapter';

import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from './interfaces';
import type { CorsOptions } from './options';

/**
 * Return value of an origin function.
 * `true` to reflect the request `Origin`, `false` to reject, or a string to
 * emit verbatim as `Access-Control-Allow-Origin`. The middleware does not
 * validate the returned string, except `'*'` combined with `credentials:true`
 * is rejected per Fetch Standard §3.3.5. Otherwise supply a serialized
 * RFC 6454 §6.2 origin (or `'null'`/`'*'`) yourself.
 */
export type OriginResult = boolean | string;

/**
 * Function that dynamically resolves whether an origin is allowed.
 */
export type OriginFn = (origin: string, request: Request) => OriginResult | Promise<OriginResult>;

/**
 * All accepted forms for the `origin` option.
 */
export type OriginOptions = boolean | string | RegExp | Array<string | RegExp> | OriginFn;

/**
 * Discriminated union returned by {@link Cors.handle}.
 * Branch on `action` to determine next step.
 */
export type CorsResult = CorsContinueResult | CorsPreflightResult | CorsRejectResult;

/**
 * Fully resolved CORS options with all defaults applied. Derived from the
 * canonical {@link CorsOptions} schema (single source of truth) — every field
 * required, `methods` frozen to a `ReadonlyArray`. `null` indicates "use default
 * behavior" (e.g., echo mode for headers). Adding a `@Field` to the schema
 * automatically requires it here, so the two cannot silently drift.
 */
export type ResolvedCorsOptions = Required<Omit<CorsOptions, 'methods'>> & {
  methods: ReadonlyArray<HttpMethod | '*'>;
};
