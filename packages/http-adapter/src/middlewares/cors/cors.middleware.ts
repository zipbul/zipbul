import { defineMiddleware, err, type MiddlewareDefinition } from '@zipbul/common';

import type { CorsOptions } from './interfaces';

import { HttpContext } from '../../adapter';
import { HeaderField, HttpMethod } from '../../enums';
import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';

/**
 * Creates a CORS middleware definition with the given options.
 *
 * @param options - CORS configuration. Defaults to allow-all.
 * @returns A frozen {@link MiddlewareDefinition} that handles CORS headers
 *   and preflight requests.
 *
 * @example
 * ```ts
 * adapter.addMiddlewares(MiddlewareHook.OnReceive, [
 *   corsMiddleware({ origin: 'https://example.com', credentials: true }),
 * ]);
 * ```
 *
 * @public
 */
export function corsMiddleware(options: CorsOptions = {}): MiddlewareDefinition {
  return defineMiddleware(async (ctx) => {
    const http = ctx.to(HttpContext);
    const req = http.request;
    const res = http.response;
    const origin = req.headers.get(HeaderField.Origin);
    const method = req.method;
    // Set defaults
    const allowedMethods = options.methods ?? CORS_DEFAULT_METHODS;
    const allowedHeaders = options.allowedHeaders;
    const exposedHeaders = options.exposedHeaders;
    const allowCredentials = options.credentials;
    const maxAge = options.maxAge;
    const preflightContinue = options.preflightContinue ?? false;
    const optionsSuccessStatus = options.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS;

    // Handle Origin
    if (origin === null || origin.length === 0) {
      return;
    }

    // Validate Origin and set header
    const allowedOrigin = await matchOrigin(origin, options);

    if (allowedOrigin === undefined) {
      return;
    }

    res.setHeader(HeaderField.AccessControlAllowOrigin, allowedOrigin);

    // If we echo the origin, we must set Vary: Origin
    if (allowedOrigin !== '*') {
      res.appendHeader(HeaderField.Vary, HeaderField.Origin);
    }

    // Credentials
    if (allowCredentials === true) {
      res.setHeader(HeaderField.AccessControlAllowCredentials, 'true');
    }

    // Exposed Headers (Actual Request)
    if (exposedHeaders !== undefined) {
      const headerValue = Array.isArray(exposedHeaders) ? exposedHeaders.join(',') : exposedHeaders;

      if (headerValue.length > 0) {
        res.setHeader(HeaderField.AccessControlExposeHeaders, headerValue);
      }
    }

    // Handle Preflight
    if (method === HttpMethod.Options) {
      // Access-Control-Request-Method
      const requestMethod = req.headers.get(HeaderField.AccessControlRequestMethod);

      if (requestMethod === null || requestMethod.length === 0) {
        // Proceed if not a valid preflight
        return;
      }

      // Access-Control-Allow-Methods
      if (allowedMethods !== undefined) {
        const headerValue = Array.isArray(allowedMethods) ? allowedMethods.join(',') : allowedMethods;

        if (headerValue.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowMethods, headerValue);
        } else {
          res.setHeader(HeaderField.AccessControlAllowMethods, '');
        }
      }

      // Access-Control-Allow-Headers
      if (allowedHeaders !== undefined) {
        const headerValue = Array.isArray(allowedHeaders) ? allowedHeaders.join(',') : allowedHeaders;

        if (headerValue.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowHeaders, headerValue);
        }
      } else {
        // If not specified, reflect request headers
        const requestHeaders = req.headers.get(HeaderField.AccessControlRequestHeaders);

        if (typeof requestHeaders === 'string' && requestHeaders.length > 0) {
          res.setHeader(HeaderField.AccessControlAllowHeaders, requestHeaders);
          res.appendHeader(HeaderField.Vary, HeaderField.AccessControlRequestHeaders);
        }
      }

      // Access-Control-Max-Age
      if (maxAge !== undefined) {
        res.setHeader(HeaderField.AccessControlMaxAge, maxAge.toString());
      }

      if (preflightContinue) {
        return;
      }

      // End response with success status
      res.setStatus(optionsSuccessStatus);

      return err({ reason: 'cors_preflight' });
    }
  });
}

function matchOrigin(origin: string, options: CorsOptions): Promise<string | undefined> {
  if (options.origin === false) {
    return Promise.resolve(undefined);
  }

  const originOption = options.origin;

  if (originOption === undefined || originOption === '*') {
    return Promise.resolve(options.credentials === true ? origin : '*');
  }

  if (typeof originOption === 'string') {
    return Promise.resolve(originOption === origin ? originOption : undefined);
  }

  if (typeof originOption === 'boolean') {
    return Promise.resolve(originOption ? origin : undefined);
  }

  if (originOption instanceof RegExp) {
    return Promise.resolve(originOption.test(origin) ? origin : undefined);
  }

  if (Array.isArray(originOption)) {
    const matched = originOption.some(candidate => {
      if (candidate instanceof RegExp) {
        return candidate.test(origin);
      }

      return candidate === origin;
    });

    return Promise.resolve(matched ? origin : undefined);
  }

  if (typeof originOption === 'function') {
    return new Promise<string | undefined>(resolve => {
      originOption(origin, (err, allow) => {
        if (err !== null || allow !== true) {
          resolve(undefined);
        } else {
          resolve(origin);
        }
      });
    });
  }

  return Promise.resolve(undefined);
}
