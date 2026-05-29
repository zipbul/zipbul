import { HttpHeader, HttpMethod } from '@zipbul/http-adapter';
import { describe, expect, it } from 'bun:test';

import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from './interfaces';
import type { CorsResult } from './types';

import { Cors } from './cors';
import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import { CorsError } from './interfaces';

// ── helpers ──

function makeRequest(method: string, origin?: string, headers?: Record<string, string>): Request {
  const h: Record<string, string> = { ...headers };
  if (origin !== undefined) {
    h[HttpHeader.Origin] = origin;
  }
  return new Request('http://localhost', { method, headers: h });
}

function makePreflight(origin: string, requestMethod: string, requestHeaders?: string): Request {
  const h: Record<string, string> = {
    [HttpHeader.Origin]: origin,
    [HttpHeader.AccessControlRequestMethod]: requestMethod,
  };
  if (requestHeaders !== undefined) {
    h[HttpHeader.AccessControlRequestHeaders] = requestHeaders;
  }
  return new Request('http://localhost', { method: HttpMethod.Options, headers: h });
}

function assertReject(result: CorsResult): asserts result is CorsRejectResult {
  expect(result.action).toBe(CorsAction.Reject);
}

function assertContinue(result: CorsResult): asserts result is CorsContinueResult {
  expect(result.action).toBe(CorsAction.Continue);
}

function assertPreflight(result: CorsResult): asserts result is CorsPreflightResult {
  expect(result.action).toBe(CorsAction.RespondPreflight);
}

// ── tests ──

describe('Cors', () => {
  // ── Cors.create ──

  describe('create', () => {
    it('should return Cors instance for valid options', () => {
      // Arrange / Act
      const cors = Cors.create({ origin: 'https://a.com' });
      // Assert
      expect(cors).toBeInstanceOf(Cors);
    });

    it('should throw CorsError for invalid options', () => {
      expect(() => Cors.create({ credentials: true, origin: '*' })).toThrow(CorsError);
    });

    it('should throw CorsError with CredentialsWithWildcardOrigin reason for invalid options', () => {
      try {
        Cors.create({ credentials: true, origin: '*' });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
      }
    });

    it('should throw CorsError with InvalidAllowedHeaders reason when an entry is not a valid HTTP token', () => {
      try {
        Cors.create({ origin: 'https://a.com', allowedHeaders: ['X-Foo(bar)'] });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
      }
    });

    it('should throw CorsError with CredentialsWithWildcardMethods reason for methods:["*"] + credentials:true (D7)', () => {
      try {
        Cors.create({ origin: 'https://a.com', methods: ['*'], credentials: true });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardMethods);
      }
    });

    it('should throw CorsError with InvalidOrigin reason for trailing-slash origin (DN-3)', () => {
      try {
        Cors.create({ origin: 'https://a.com/' });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidOrigin);
      }
    });

    it('should throw CorsError with InvalidExposedHeaders reason when an entry is not a valid HTTP token', () => {
      try {
        Cors.create({ origin: 'https://a.com', exposedHeaders: ['X Bad'] });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidExposedHeaders);
      }
    });
  });

  // ── Origin resolution ──

  describe('origin resolution', () => {
    it('should reject when Origin header is missing', async () => {
      // Arrange
      const cors = Cors.create();
      const req = makeRequest('GET');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.NoOrigin);
    });

    it('should reject when Origin header is empty string', async () => {
      // Arrange
      const cors = Cors.create();
      const req = makeRequest('GET', '');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.NoOrigin);
    });

    it('should return ACAO:* for wildcard origin and GET', async () => {
      // Arrange
      const cors = Cors.create();
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
    });

    it('should reflect origin when origin:true with credentials', async () => {
      const cors = Cors.create({ origin: true, credentials: true });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should return ACAO matching the request origin for specific string origin match', async () => {
      const cors = Cors.create({ origin: 'https://a.com' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should append Vary:Origin for specific string origin match', async () => {
      const cors = Cors.create({ origin: 'https://a.com' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.Origin);
    });

    it('should reject when specific string origin does not match', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com' });
      const req = makeRequest('GET', 'https://b.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should reflect origin when origin is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: true });
      const req = makeRequest('GET', 'https://any.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://any.com');
    });

    it('should reject when origin is false', async () => {
      // Arrange
      const cors = Cors.create({ origin: false });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should allow when origin matches RegExp', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/.*\.example\.com$/ });
      const req = makeRequest('GET', 'https://sub.example.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://sub.example.com');
    });

    it('should reject when origin does not match RegExp', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/allowed\.com$/ });
      const req = makeRequest('GET', 'https://other.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
    });

    it('should throw CorsError(InvalidOrigin) when origin RegExp carries the /g flag (stateful matcher rejected at boot)', () => {
      try {
        Cors.create({ origin: /^https:\/\/a\.com$/g });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidOrigin);
      }
    });

    it('should throw CorsError(InvalidOrigin) when origin RegExp carries the /y (sticky) flag', () => {
      try {
        Cors.create({ origin: /^https:\/\/a\.com$/y });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidOrigin);
      }
    });

    it('should throw CorsError(InvalidOrigin) when an array contains a /g flag RegExp', () => {
      try {
        Cors.create({ origin: [/^https:\/\/a\.com$/g, 'https://b.com'] });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.InvalidOrigin);
      }
    });

    it('should allow when origin matches any entry in array (string+RegExp)', async () => {
      // Arrange
      const cors = Cors.create({ origin: ['https://a.com', /\.example\.com$/] });
      const req = makeRequest('GET', 'https://sub.example.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://sub.example.com');
    });

    it('should reject when origin matches no entry in array', async () => {
      // Arrange
      const cors = Cors.create({ origin: ['https://a.com', /^https:\/\/b\.com$/] });
      const req = makeRequest('GET', 'https://c.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
    });

    it('should reflect the request origin in ACAO when OriginFn returns true', async () => {
      const cors = Cors.create({ origin: () => true });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should pass the request origin and Request instance to OriginFn for decision', async () => {
      const seen: { origin?: string; request?: Request } = {};
      const cors = Cors.create({
        origin: (origin, request) => {
          seen.origin = origin;
          seen.request = request;
          return true;
        },
      });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
      expect(seen.origin).toBe('https://a.com');
      expect(seen.request).toBe(req);
    });

    it('should use custom string when OriginFn returns string', async () => {
      // Arrange
      const cors = Cors.create({ origin: () => 'https://custom.com' });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://custom.com');
    });

    it('should reject when OriginFn returns false', async () => {
      // Arrange
      const cors = Cors.create({ origin: () => false });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
    });

    it('should reject with CorsError when OriginFn throws', async () => {
      const cors = Cors.create({
        origin: () => {
          throw new Error('boom');
        },
      });
      const req = makeRequest('GET', 'https://a.com');
      await expect(cors.handle(req)).rejects.toBeInstanceOf(CorsError);
    });

    it('should set CorsError.reason to OriginFunctionError when OriginFn throws', async () => {
      const cors = Cors.create({
        origin: () => {
          throw new Error('boom');
        },
      });
      const req = makeRequest('GET', 'https://a.com');
      try {
        await cors.handle(req);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.OriginFunctionError);
      }
    });













    // ── D-NEW-2 regression guards (valid returns must still pass) ──

    it('should pass when OriginFn returns IPv6 bracket origin', async () => {
      const cors = Cors.create({ origin: () => 'https://[::1]' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://[::1]');
    });

    it('should pass when OriginFn returns IPv6 origin with explicit port', async () => {
      const cors = Cors.create({ origin: () => 'https://[::1]:8443' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://[::1]:8443');
    });

    it('should pass when OriginFn returns punycode IDN origin', async () => {
      const cors = Cors.create({ origin: () => 'https://xn--bj0bj06e.com' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://xn--bj0bj06e.com');
    });

    it('should pass when OriginFn returns the RFC 6454 opaque literal "null"', async () => {
      const cors = Cors.create({ origin: () => 'null' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('null');
    });

    it('should reflect "null" when option origin is the RFC 6454 opaque literal and the request Origin matches', async () => {
      const cors = Cors.create({ origin: 'null' });
      const req = makeRequest('GET', 'null');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('null');
    });

    it('should reject when option origin is "null" but the request Origin is a different value', async () => {
      const cors = Cors.create({ origin: 'null' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should reject (OriginNotAllowed) when OriginFn returns false', async () => {
      const cors = Cors.create({ origin: () => false });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should echo the request Origin header when OriginFn returns true', async () => {
      const cors = Cors.create({ origin: () => true });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should preserve original thrown value in CorsError.cause', async () => {
      const original = new Error('boom');
      const cors = Cors.create({
        origin: () => {
          throw original;
        },
      });
      const req = makeRequest('GET', 'https://a.com');
      try {
        await cors.handle(req);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).cause).toBe(original);
      }
    });
  });

  // ── Credentials ──

  describe('credentials', () => {
    it('should set ACAC:true when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', credentials: true });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    });

    it('should throw CorsError(CredentialsWithWildcardOrigin) when OriginFn returns "*" with credentials:true (Fetch Standard §3.2.5)', async () => {
      const cors = Cors.create({ origin: () => '*', credentials: true });
      try {
        await cors.handle(makeRequest('GET', 'https://a.com'));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
      }
    });

    it('should throw CorsError(CredentialsWithWildcardOrigin) when async OriginFn returns "*" with credentials:true', async () => {
      const cors = Cors.create({ origin: async () => '*', credentials: true });
      try {
        await cors.handle(makeRequest('GET', 'https://a.com'));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
      }
    });

    it('should NOT throw and emit ACAO:* when OriginFn returns "*" with credentials:false (wildcard allowed without credentials)', async () => {
      const cors = Cors.create({ origin: () => '*', credentials: false });
      const result = await cors.handle(makeRequest('GET', 'https://a.com'));
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
      expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBeNull();
    });

    it('should throw CorsError(CredentialsWithWildcardOrigin) on preflight when OriginFn returns "*" with credentials:true', async () => {
      const cors = Cors.create({ origin: () => '*', credentials: true });
      try {
        await cors.handle(makePreflight('https://a.com', 'POST'));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(CorsError);
        expect((e as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
      }
    });
  });

  // ── Exposed headers ──

  describe('exposed headers', () => {
    it('should set ACEH for non-preflight when exposedHeaders is set', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, exposedHeaders: ['X-Custom', 'X-Other'] });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Custom,X-Other');
    });

    it('should not set ACEH when exposedHeaders is wildcard and credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['*'], credentials: true });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.has(HttpHeader.AccessControlExposeHeaders)).toBe(false);
    });

    it('should keep explicit headers filtering wildcard when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['*', 'X-Custom'], credentials: true });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Custom');
    });

    it('should keep multiple explicit headers filtering wildcard when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['X-A', '*', 'X-B'], credentials: true });
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-A,X-B');
    });
  });

  // ── Preflight ──

  describe('preflight', () => {
    it('should return Continue when OPTIONS has no ACRM', async () => {
      // Arrange
      const cors = Cors.create({ origin: true });
      const req = makeRequest('OPTIONS', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
      expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBeNull();
    });

    it('should return RespondPreflight with ACAM when method is allowed', async () => {
      const cors = Cors.create({ origin: true });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
    });

    it('should reject when preflight method is not allowed', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, methods: [HttpMethod.Get] });
      const req = makePreflight('https://a.com', 'DELETE');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.MethodNotAllowed);
    });

    it('should reject when preflight method has wrong case', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, methods: [HttpMethod.Get, HttpMethod.Post] });
      const req = makePreflight('https://a.com', 'get');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.MethodNotAllowed);
    });

    it('should set ACAH when explicit allowedHeaders match', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-Custom', 'Authorization'] });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom,Authorization');
    });

    it('should reject when explicit allowedHeaders do not match', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-Allowed'] });
      const req = makePreflight('https://a.com', 'POST', 'X-Forbidden');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.HeaderNotAllowed);
    });

    it('should echo request headers when allowedHeaders is null (echo mode)', async () => {
      // Arrange — default allowedHeaders is null after resolve
      const cors = Cors.create({ origin: true });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom, X-Other');
      // Act
      const result = await cors.handle(req);
      // Assert — ACRH echoed verbatim (no per-entry validation)
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom, X-Other');
    });

    it('should set ACAH:* when allowedHeaders is wildcard without credentials', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['*'] });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('*');
    });

    it('should reject when wildcard allowedHeaders with Authorization but no explicit entry', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['*'] });
      const req = makePreflight('https://a.com', 'POST', 'Authorization');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.HeaderNotAllowed);
    });

    it('should allow Authorization with wildcard when explicitly listed', async () => {
      // Arrange
      const cors = Cors.create({
        origin: 'https://a.com',
        allowedHeaders: ['*', 'Authorization'],
        credentials: true,
      });
      const req = makePreflight('https://a.com', 'POST', 'Authorization, X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('Authorization, X-Custom');
    });

    it('should set ACMA when maxAge is configured', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, maxAge: 86400 });
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('86400');
    });

    it('should return Continue when preflightContinue is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, preflightContinue: true });
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
      expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
    });

    it('should use custom optionsSuccessStatus', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, optionsSuccessStatus: 200 });
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result);
      expect(result.statusCode).toBe(200);
    });
  });

  // ── Method serialization ──

  describe('method serialization', () => {
    it('should return ACAM:* when methods is wildcard without credentials', async () => {
      const cors = Cors.create({ origin: true, methods: ['*'] });
      const req = makePreflight('https://a.com', 'PUT');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('*');
    });
  });

  // ── HEAD method (CORS-safelisted) ──

  describe('HEAD method', () => {
    it('should treat HEAD as a non-preflight request and emit ACAO', async () => {
      const cors = Cors.create({ origin: 'https://a.com' });
      const req = makeRequest('HEAD', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should append Vary:Origin for HEAD when ACAO is non-wildcard', async () => {
      const cors = Cors.create({ origin: 'https://a.com' });
      const req = makeRequest('HEAD', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.Origin);
    });

    it('should attach ACEH on HEAD when exposedHeaders is configured', async () => {
      const cors = Cors.create({ origin: true, exposedHeaders: ['X-Trace'] });
      const req = makeRequest('HEAD', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Trace');
    });
  });

  // ── Negative assertions (header absence) ──

  describe('header absence (negative assertions)', () => {
    it('should not set ACAC when credentials is false', async () => {
      const cors = Cors.create({ origin: 'https://a.com', credentials: false });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowCredentials)).toBe(false);
    });

    it('should not set ACEH on preflight (OPTIONS + ACRM) even when exposedHeaders is configured', async () => {
      const cors = Cors.create({ origin: true, exposedHeaders: ['X-Trace'] });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.has(HttpHeader.AccessControlExposeHeaders)).toBe(false);
    });

    it('should not set ACEH on OPTIONS + no ACRM (non-preflight OPTIONS) even when exposedHeaders is configured', async () => {
      const cors = Cors.create({ origin: true, exposedHeaders: ['X-Trace'] });
      const req = makeRequest('OPTIONS', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.has(HttpHeader.AccessControlExposeHeaders)).toBe(false);
    });

    it('should not set Vary:Origin when ACAO is wildcard with no credentials', async () => {
      const cors = Cors.create({ origin: '*' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.has(HttpHeader.Vary)).toBe(false);
    });
  });

  // ── ACEH wildcard + no credentials ──

  describe('exposed headers wildcard without credentials', () => {
    it('should emit ACEH:* literally when exposedHeaders is ["*"] and credentials is false', async () => {
      const cors = Cors.create({ origin: true, exposedHeaders: ['*'] });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('*');
    });

    it('should emit ACEH joined when exposedHeaders has no wildcard and credentials is true', async () => {
      const cors = Cors.create({ origin: 'https://a.com', credentials: true, exposedHeaders: ['X-A', 'X-B'] });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-A,X-B');
    });
  });

  // ── async OriginFn ──

  describe('async OriginFn', () => {
    it('should reflect origin when OriginFn returns Promise<true>', async () => {
      const cors = Cors.create({ origin: async () => true });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should use literal when OriginFn returns Promise<string>', async () => {
      const cors = Cors.create({ origin: async () => 'https://override.com' });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://override.com');
    });

    it('should reject when OriginFn returns Promise<false>', async () => {
      const cors = Cors.create({ origin: async () => false });
      const req = makeRequest('GET', 'https://a.com');
      const result = await cors.handle(req);
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should throw CorsError(OriginFunctionError) when OriginFn rejects', async () => {
      const cors = Cors.create({
        origin: async () => {
          throw new Error('boom');
        },
      });
      const req = makeRequest('GET', 'https://a.com');
      await expect(cors.handle(req)).rejects.toBeInstanceOf(CorsError);
    });

    // ── D-NEW-2 async sanitize ──




  });

  // ── pure string array origin ──

  describe('pure string array origin', () => {
    it('should match the first matching string entry', async () => {
      const cors = Cors.create({ origin: ['https://a.com', 'https://b.com'] });
      const req = makeRequest('GET', 'https://b.com');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://b.com');
    });

    it('should reject when no string entry matches', async () => {
      const cors = Cors.create({ origin: ['https://a.com', 'https://b.com'] });
      const req = makeRequest('GET', 'https://c.com');
      const result = await cors.handle(req);
      assertReject(result);
    });
  });

  // ── preflight with empty ACRM ──

  describe('preflight with empty ACRM', () => {
    it('should treat OPTIONS + empty ACRM as non-preflight (Continue)', async () => {
      const cors = Cors.create({ origin: true });
      const req = new Request('http://localhost', {
        method: HttpMethod.Options,
        headers: {
          [HttpHeader.Origin]: 'https://a.com',
          [HttpHeader.AccessControlRequestMethod]: '',
        },
      });
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
      expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBeNull();
    });
  });

  // ── preflight with explicit allowedHeaders ──

  describe('preflight with explicit allowedHeaders edge cases', () => {
    it('should reject when allowedHeaders is empty array and ACRH is non-empty', async () => {
      const cors = Cors.create({ origin: true, allowedHeaders: [] });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      const result = await cors.handle(req);
      assertReject(result);
      expect(result.reason).toBe(CorsRejectionReason.HeaderNotAllowed);
    });

    it('should allow when allowedHeaders is empty array and ACRH is absent', async () => {
      const cors = Cors.create({ origin: true, allowedHeaders: [] });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBeNull();
    });

    it('should set ACAH from explicit allowedHeaders list even when ACRH is absent', async () => {
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-A'] });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-A');
    });

    it('should match Authorization header case-insensitively under wildcard ACAH', async () => {
      const cors = Cors.create({ origin: 'https://a.com', allowedHeaders: ['*', 'Authorization'], credentials: true });
      const req = makePreflight('https://a.com', 'POST', 'AUTHORIZATION');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('AUTHORIZATION');
    });

    it('should pass when ACAH wildcard with credentials and ACRH contains a non-Authorization header', async () => {
      const cors = Cors.create({ origin: 'https://a.com', allowedHeaders: ['*'], credentials: true });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom');
    });
  });

  // ── maxAge serialization ──

  describe('maxAge serialization', () => {
    it('should serialize maxAge=0 as ACMA:"0"', async () => {
      const cors = Cors.create({ origin: true, maxAge: 0 });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('0');
    });
  });

  // ── preflightContinue header attachment ──

  describe('preflightContinue', () => {
    it('should attach ACAM headers even when preflightContinue is true', async () => {
      const cors = Cors.create({ origin: true, preflightContinue: true });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
    });

    it('should attach ACAH headers even when preflightContinue is true', async () => {
      const cors = Cors.create({ origin: true, preflightContinue: true, allowedHeaders: ['X-Custom'] });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom');
    });

    it('should attach ACMA when preflightContinue is true and maxAge is configured', async () => {
      const cors = Cors.create({ origin: true, preflightContinue: true, maxAge: 3600 });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertContinue(result);
      expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('3600');
    });
  });

  // ── Vary header on preflight ──

  describe('Vary header on preflight', () => {
    it('should append Access-Control-Request-Method to Vary on preflight', async () => {
      const cors = Cors.create({ origin: true });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestMethod);
    });

    it('should append Access-Control-Request-Headers to Vary when ACAH is emitted', async () => {
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-Custom'] });
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestHeaders);
    });
  });

  // ── Private Network Access ──

  describe('PNA (private network access)', () => {
    it('should set ACAPN:true when allowPrivateNetwork=true and ACRPN:true', async () => {
      const cors = Cors.create({ origin: true, allowPrivateNetwork: true });
      const req = new Request('http://localhost', {
        method: HttpMethod.Options,
        headers: {
          [HttpHeader.Origin]: 'https://a.com',
          [HttpHeader.AccessControlRequestMethod]: 'POST',
          [HttpHeader.AccessControlRequestPrivateNetwork]: 'true',
        },
      });
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.get(HttpHeader.AccessControlAllowPrivateNetwork)).toBe('true');
    });

    it('should not set ACAPN when ACRPN header is absent', async () => {
      const cors = Cors.create({ origin: true, allowPrivateNetwork: true });
      const req = makePreflight('https://a.com', 'POST');
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowPrivateNetwork)).toBe(false);
    });

    it('should not set ACAPN when ACRPN is "false"', async () => {
      const cors = Cors.create({ origin: true, allowPrivateNetwork: true });
      const req = new Request('http://localhost', {
        method: HttpMethod.Options,
        headers: {
          [HttpHeader.Origin]: 'https://a.com',
          [HttpHeader.AccessControlRequestMethod]: 'POST',
          [HttpHeader.AccessControlRequestPrivateNetwork]: 'false',
        },
      });
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowPrivateNetwork)).toBe(false);
    });

    it('should not set ACAPN when allowPrivateNetwork=false even with ACRPN:true', async () => {
      const cors = Cors.create({ origin: true, allowPrivateNetwork: false });
      const req = new Request('http://localhost', {
        method: HttpMethod.Options,
        headers: {
          [HttpHeader.Origin]: 'https://a.com',
          [HttpHeader.AccessControlRequestMethod]: 'POST',
          [HttpHeader.AccessControlRequestPrivateNetwork]: 'true',
        },
      });
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowPrivateNetwork)).toBe(false);
    });

    it('should not set ACAPN when ACRPN is non-canonical "TRUE" (case-sensitive match required)', async () => {
      const cors = Cors.create({ origin: true, allowPrivateNetwork: true });
      const req = new Request('http://localhost', {
        method: HttpMethod.Options,
        headers: {
          [HttpHeader.Origin]: 'https://a.com',
          [HttpHeader.AccessControlRequestMethod]: 'POST',
          [HttpHeader.AccessControlRequestPrivateNetwork]: 'TRUE',
        },
      });
      const result = await cors.handle(req);
      assertPreflight(result);
      expect(result.headers.has(HttpHeader.AccessControlAllowPrivateNetwork)).toBe(false);
    });
  });
});
