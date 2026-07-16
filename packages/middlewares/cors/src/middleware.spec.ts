import { HttpAdapter, HttpHeader, HttpMethod, HttpStatus } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';
/**
 * Unit spec for the `corsMiddleware` factory (colocated with the source).
 * Covers the adapter integration contract — every branch in `middleware.ts`
 * is exercised against a real `HttpContext` produced by `@zipbul/http-adapter/testing`.
 *
 * The framework-agnostic `Cors` engine is verified separately in `cors.spec.ts`.
 * This file focuses on `MiddlewareDefinition`
 * shape, `ctx.to(HttpContext)`, `rawRequest` guard, action dispatch, and
 * header attachment style (`setHeader` vs `appendHeader`).
 */
import { describe, expect, it } from 'bun:test';

import { CorsErrorReason } from './enums';
import { CorsError } from './interfaces';
import { corsMiddleware } from './middleware';

const ORIGIN = 'https://allowed.example';

describe('corsMiddleware factory — definition shape', () => {
  it('should return a MiddlewareDefinition keyed to [HttpAdapter]', () => {
    const def = corsMiddleware({ origin: ORIGIN });
    expect(def).toBeDefined();
    expect(def.adapters).toEqual([HttpAdapter]);
    expect(typeof def.factory).toBe('function');
  });

  it('should throw CorsError synchronously when options are invalid', () => {
    expect(() => corsMiddleware({ credentials: true, origin: '*' })).toThrow(CorsError);
  });

  it('should throw CorsError with CredentialsWithWildcardOrigin reason for invalid options', () => {
    try {
      corsMiddleware({ credentials: true, origin: '*' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CorsError);
      expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
    }
  });

});

describe('corsMiddleware factory — Continue action (non-preflight)', () => {
  it('should set ACAO header via setHeader on a matching simple request', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe(ORIGIN);
  });

  it('should append Vary:Origin via appendHeader (preserves prior Vary values)', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    ctx.response.appendHeader(HttpHeader.Vary, 'Accept-Encoding');
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    const vary = ctx.response.headers.get(HttpHeader.Vary);
    expect(vary).toContain('Accept-Encoding');
    expect(vary).toContain(HttpHeader.Origin);
  });

  it('should leave the response untouched on Reject (silent drop)', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: 'https://blocked.example' }) });
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowCredentials)).toBeNull();
  });

  it('should no-op when Origin header is absent (same-origin or non-CORS request)', async () => {
    const ctx = mockContext();
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
  });

  it('should set ACAC:true via setHeader when credentials is true and origin matches', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    const handler = corsMiddleware({ origin: ORIGIN, credentials: true }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
  });

  it('should set ACEH via setHeader when exposedHeaders is configured', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    const handler = corsMiddleware({ origin: ORIGIN, exposedHeaders: ['X-Trace'] }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Trace');
  });
});

describe('corsMiddleware factory — RespondPreflight action', () => {
  it('should set status to the configured optionsSuccessStatus on a valid preflight', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    const handler = corsMiddleware({ origin: ORIGIN, optionsSuccessStatus: HttpStatus.NoContent }).factory();
    await handler(ctx);
    expect(ctx.response.getStatus()).toBe(HttpStatus.NoContent);
  });

  it('should attach ACAM via setHeader on a valid preflight', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
  });

  it('should set Content-Length:"0" on a preflight response body', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.ContentLength)).toBe('0');
  });

  it('should not commit the response on a rejected preflight (silent drop)', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: 'https://blocked.example',
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowMethods)).toBeNull();
  });

  it('should append Vary via appendHeader on a committed preflight (preserves prior values)', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    ctx.response.appendHeader(HttpHeader.Vary, 'Accept-Encoding');
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    const vary = ctx.response.headers.get(HttpHeader.Vary);
    expect(vary).toContain('Accept-Encoding');
    expect(vary?.toLowerCase()).toContain('origin');
    expect(vary?.toLowerCase()).toContain('access-control-request-method');
  });
});

describe('corsMiddleware factory — rawRequest guard', () => {
  it('should no-op when rawRequest is undefined (consumed body / non-Bun adapter)', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    ctx.consumeRawRequest();
    const handler = corsMiddleware({ origin: ORIGIN }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
    expect(ctx.response.headers.get(HttpHeader.ContentLength)).toBeNull();
  });
});

describe('corsMiddleware factory — error propagation', () => {
  it('should propagate CorsError(OriginFunctionError) when origin function throws at request time', async () => {
    const handler = corsMiddleware({
      origin: () => { throw new Error('boom'); },
    }).factory();
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    try {
      await handler(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CorsError);
      expect((e as CorsError).reason).toBe(CorsErrorReason.OriginFunctionError);
    }
  });

  it('should propagate CorsError(CredentialsWithWildcardOrigin) when OriginFn returns "*" with credentials:true and leave the response untouched', async () => {
    const handler = corsMiddleware({
      origin: () => '*',
      credentials: true,
    }).factory();
    const ctx = mockContext({ headers: new Headers({ Origin: ORIGIN }) });
    try {
      await handler(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CorsError);
      expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
    }
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowCredentials)).toBeNull();
  });
});

describe('corsMiddleware factory — preflightContinue Continue path', () => {
  it('should attach preflight headers without committing the response when preflightContinue is true', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    const handler = corsMiddleware({ origin: ORIGIN, preflightContinue: true }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe(ORIGIN);
    expect(ctx.response.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
    expect(ctx.response.headers.get(HttpHeader.ContentLength)).toBeNull();
  });

  it('should append Vary via appendHeader on the preflightContinue path (preserves prior values)', async () => {
    const ctx = mockContext({
      method: HttpMethod.Options,
      headers: new Headers({
        Origin: ORIGIN,
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      }),
    });
    ctx.response.appendHeader(HttpHeader.Vary, 'Accept-Encoding');
    const handler = corsMiddleware({ origin: ORIGIN, preflightContinue: true }).factory();
    await handler(ctx);
    const vary = ctx.response.headers.get(HttpHeader.Vary);
    expect(vary).toContain('Accept-Encoding');
    expect(vary).toContain(HttpHeader.Origin);
  });
});
