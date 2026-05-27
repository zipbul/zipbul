import { HttpMethod, HttpStatus } from '@zipbul/http-adapter';

export const CORS_DEFAULT_METHODS = [
  HttpMethod.Get,
  HttpMethod.Head,
  HttpMethod.Put,
  HttpMethod.Patch,
  HttpMethod.Post,
  HttpMethod.Delete,
] as const satisfies readonly HttpMethod[];

export const CORS_DEFAULT_OPTIONS_SUCCESS_STATUS = HttpStatus.NoContent;

/**
 * ECMAScript §6.1.6.1.30 (Number::toString) switches to exponential notation
 * when the value is ≥ 10^21. Above this threshold the wire output (e.g.
 * `"1e+21"`) violates RFC 9111 §1.2.2 `delta-seconds = 1*DIGIT`, so maxAge
 * must stay strictly below it.
 */
export const CORS_MAX_AGE_EXPONENTIAL_THRESHOLD = 1e21;
