import type { HttpMethod } from '@zipbul/http-adapter';

import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from './interfaces';
import type { CorsOptions } from './options';

/**
 * Return value of an origin function.
 * `true` to reflect the request `Origin`, `false` to reject, or a string to
 * emit as `Access-Control-Allow-Origin`. A returned string is held to the same
 * standard as a config origin (STANDARDS §1.2/§1.3): it must be `'*'`, the
 * literal `'null'`, or a serialized origin (its own `new URL(v).origin`) —
 * anything else (trailing slash, path, explicit default port, blank, control
 * characters) is treated as not-allowed rather than emitted. `'*'` combined
 * with `credentials:true` throws per Fetch Standard §3.3.5.
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
