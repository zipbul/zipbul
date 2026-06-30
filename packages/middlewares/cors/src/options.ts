import { Field, createRule } from '@zipbul/baker';

import { corsBaker } from './baker';
import {
  oneOf,
  arrayEvery,
  arrayNotEmpty,
  isBoolean,
  isFunction,
  isInt,
  isStatelessRegExp,
  isCorsOrigin,
  isHttpToken,
  isEnum,
  min,
  max,
} from '@zipbul/baker/rules';
import { HttpMethod } from '@zipbul/http-adapter';

import type { OriginOptions, ResolvedCorsOptions } from './types';

import {
  CORS_DEFAULT_METHODS,
  CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
  CORS_MAX_AGE_EXPONENTIAL_THRESHOLD,
} from './constants';
import { CorsErrorReason } from './enums';

/**
 * baker `isEnum` only accepts an object (enum entity), so we build a tiny
 * rule that accepts the wildcard literal `'*'` for the methods union.
 */
const isMethodsWildcard = createRule('isMethodsWildcard', (v) => v === '*');

/**
 * CORS options as a baker-validated data class.
 *
 * Drives input validation for {@link Cors.create}. Users pass plain objects;
 * baker `validateSync` checks the input shape against the schema below.
 * Cross-field semantics (`credentials` + wildcard origin/methods) and array
 * normalization/cloning/freezing live in `Cors.create`, not the schema.
 */
@corsBaker.Recipe
export class CorsOptions {
  /**
   * Allowed origin(s).
   * Accepts boolean, RFC 6454 §6.2 serialized string (incl. `'*'`/`'null'`),
   * stateless `RegExp` (no `g`/`y` flags), array of strings/RegExps, or a
   * function. Anything else fails with {@link CorsErrorReason.InvalidOrigin}.
   */
  @Field(
    oneOf(
      isBoolean,
      isCorsOrigin,
      isStatelessRegExp,
      arrayEvery(oneOf(isCorsOrigin, isStatelessRegExp)),
      isFunction,
    ),
    { optional: true, context: { reason: CorsErrorReason.InvalidOrigin } },
  )
  origin?: OriginOptions;

  /**
   * Allowed HTTP methods. Each entry must be a known {@link HttpMethod}
   * or the wildcard `'*'`. Empty arrays are rejected at boot via
   * `arrayNotEmpty`.
   */
  @Field(
    arrayNotEmpty,
    arrayEvery(oneOf(isEnum(HttpMethod), isMethodsWildcard)),
    { optional: true, context: { reason: CorsErrorReason.InvalidMethods } },
  )
  methods?: Array<HttpMethod | '*'>;

  /** Request headers allowed in preflight. Each entry must satisfy RFC 9110 §5.6.2 `token`. */
  @Field(
    arrayEvery(isHttpToken),
    { optional: true, nullable: true, context: { reason: CorsErrorReason.InvalidAllowedHeaders } },
  )
  allowedHeaders?: string[] | null;

  /** Response headers exposed to browser JS. Each entry must satisfy RFC 9110 §5.6.2 `token`. */
  @Field(
    arrayEvery(isHttpToken),
    { optional: true, nullable: true, context: { reason: CorsErrorReason.InvalidExposedHeaders } },
  )
  exposedHeaders?: string[] | null;

  /** Whether to send `Access-Control-Allow-Credentials: true`. */
  @Field(isBoolean, { optional: true })
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds.
   * Must satisfy RFC 9111 §1.2.2 `delta-seconds = 1*DIGIT`: non-negative
   * integer below `1e21` (above which `Number.prototype.toString` emits
   * exponential notation that violates the ABNF).
   */
  @Field(
    isInt,
    min(0),
    max(CORS_MAX_AGE_EXPONENTIAL_THRESHOLD, { exclusive: true }),
    { optional: true, nullable: true, context: { reason: CorsErrorReason.InvalidMaxAge } },
  )
  maxAge?: number | null;

  /** When `true`, preflight returns `Continue` instead of `RespondPreflight`. */
  @Field(isBoolean, { optional: true })
  preflightContinue?: boolean;

  /** HTTP status for the preflight response. Must be a 2xx integer (200–299). */
  @Field(
    isInt,
    min(200),
    max(299),
    { optional: true, context: { reason: CorsErrorReason.InvalidStatusCode } },
  )
  optionsSuccessStatus?: number;

  /** When `true`, preflight requests carrying PNA header receive the allow-PNA echo. */
  @Field(isBoolean, { optional: true })
  allowPrivateNetwork?: boolean;
}

/**
 * Public input shape — partial. Users pass plain objects matching this type.
 * Resolved options (after defaults + validation) are the full
 * {@link ResolvedCorsOptions} shape held by the {@link Cors} instance.
 */
export type CorsOptionsInput = Partial<{
  origin: OriginOptions;
  methods: Array<HttpMethod | '*'>;
  allowedHeaders: string[] | null;
  exposedHeaders: string[] | null;
  credentials: boolean;
  maxAge: number | null;
  preflightContinue: boolean;
  optionsSuccessStatus: number;
  allowPrivateNetwork: boolean;
}>;

/**
 * Defaults merged with caller-provided options inside `Cors.create`. The
 * resolved instance is held privately by the `Cors` object; callers should
 * not mutate inputs they passed in after registration.
 */
export const CORS_DEFAULTS: ResolvedCorsOptions = {
  origin: '*',
  methods: CORS_DEFAULT_METHODS,
  allowedHeaders: null,
  exposedHeaders: null,
  credentials: false,
  maxAge: null,
  preflightContinue: false,
  optionsSuccessStatus: CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
  allowPrivateNetwork: false,
};
