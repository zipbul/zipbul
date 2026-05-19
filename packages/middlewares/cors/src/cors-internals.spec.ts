import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/shared';
import { isErr } from '@zipbul/result';

import { Cors } from './cors';
import { CorsErrorReason, CorsRejectionReason, CorsAction } from './enums';

// Helper to access the @internal members of a Cors instance with full type safety.
// `Cors.create({...})` returns a Cors with all internal helpers attached.
function makeCors(opts?: Parameters<typeof Cors.create>[0]): Cors {
  return Cors.create(opts);
}

const dummyRequest = new Request('http://localhost');

// ── reject ──

describe('Cors#reject', () => {
  it('should return a Reject result carrying the given reason', () => {
    const cors = makeCors();
    expect(cors.reject(CorsRejectionReason.NoOrigin)).toEqual({
      action: CorsAction.Reject,
      reason: CorsRejectionReason.NoOrigin,
    });
  });
});

// ── matchOrigin ──

describe('Cors#matchOrigin', () => {
  it('should return undefined when origin option is false', async () => {
    const cors = makeCors({ origin: false });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBeUndefined();
  });

  it('should return "*" literal when origin option is "*"', async () => {
    const cors = makeCors({ origin: '*' });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('*');
  });

  it('should return the request origin when string option matches exactly', async () => {
    const cors = makeCors({ origin: 'https://a.com' });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should return undefined when string option does not match', async () => {
    const cors = makeCors({ origin: 'https://a.com' });
    expect(await cors.matchOrigin('https://b.com', dummyRequest)).toBeUndefined();
  });

  it('should reflect the request origin when boolean option is true', async () => {
    const cors = makeCors({ origin: true });
    expect(await cors.matchOrigin('https://any.com', dummyRequest)).toBe('https://any.com');
  });

  it('should return the request origin when RegExp option matches', async () => {
    const cors = makeCors({ origin: /^https:\/\/.*\.example\.com$/ });
    expect(await cors.matchOrigin('https://sub.example.com', dummyRequest)).toBe('https://sub.example.com');
  });

  it('should return undefined when RegExp option does not match', async () => {
    const cors = makeCors({ origin: /^https:\/\/a\.com$/ });
    expect(await cors.matchOrigin('https://b.com', dummyRequest)).toBeUndefined();
  });

  it('should reset RegExp /g lastIndex between calls for consistent matching', async () => {
    const cors = makeCors({ origin: /^https:\/\/a\.com$/g });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should match the first matching entry in a string-only array', async () => {
    const cors = makeCors({ origin: ['https://a.com', 'https://b.com'] });
    expect(await cors.matchOrigin('https://b.com', dummyRequest)).toBe('https://b.com');
  });

  it('should return undefined when no entry in a string array matches', async () => {
    const cors = makeCors({ origin: ['https://a.com', 'https://b.com'] });
    expect(await cors.matchOrigin('https://c.com', dummyRequest)).toBeUndefined();
  });

  it('should match a mixed array entry when RegExp matches before strings', async () => {
    const cors = makeCors({ origin: [/^https:\/\/.+\.example\.com$/, 'https://a.com'] });
    expect(await cors.matchOrigin('https://sub.example.com', dummyRequest)).toBe('https://sub.example.com');
  });

  it('should fall through RegExp-mismatch to string match within a mixed array', async () => {
    const cors = makeCors({ origin: [/^https:\/\/never\.com$/, 'https://a.com'] });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should reset RegExp /g lastIndex on array entries between calls', async () => {
    const cors = makeCors({ origin: [/^https:\/\/a\.com$/g] });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should reflect the request origin when OriginFn returns true synchronously', async () => {
    const cors = makeCors({ origin: () => true });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should use the literal string when OriginFn returns a non-empty string synchronously', async () => {
    const cors = makeCors({ origin: () => 'https://override.com' });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://override.com');
  });

  it('should return undefined when OriginFn returns false synchronously', async () => {
    const cors = makeCors({ origin: () => false });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBeUndefined();
  });

  it('should return undefined when OriginFn returns an empty string synchronously', async () => {
    const cors = makeCors({ origin: () => '' });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBeUndefined();
  });

  it('should reflect the request origin when OriginFn returns Promise<true>', async () => {
    const cors = makeCors({ origin: async () => true });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://a.com');
  });

  it('should use the resolved string when OriginFn returns Promise<string>', async () => {
    const cors = makeCors({ origin: async () => 'https://override.com' });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBe('https://override.com');
  });

  it('should return undefined when OriginFn returns Promise<false>', async () => {
    const cors = makeCors({ origin: async () => false });
    expect(await cors.matchOrigin('https://a.com', dummyRequest)).toBeUndefined();
  });

  it('should wrap synchronous OriginFn throw as Err(OriginFunctionError)', async () => {
    const cors = makeCors({ origin: () => { throw new Error('boom'); } });
    const result = await cors.matchOrigin('https://a.com', dummyRequest);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.OriginFunctionError);
    }
  });

  it('should wrap asynchronous OriginFn reject as Err(OriginFunctionError)', async () => {
    const cors = makeCors({ origin: async () => { throw new Error('boom'); } });
    const result = await cors.matchOrigin('https://a.com', dummyRequest);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.OriginFunctionError);
    }
  });

  it('should preserve the original thrown value in Err.cause when OriginFn throws', async () => {
    const original = new Error('boom');
    const cors = makeCors({ origin: () => { throw original; } });
    const result = await cors.matchOrigin('https://a.com', dummyRequest);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.cause).toBe(original);
    }
  });
});

// ── resolveOriginResult ──

describe('Cors#resolveOriginResult', () => {
  it('should return the request origin when result is boolean true', () => {
    const cors = makeCors();
    expect(cors.resolveOriginResult('https://a.com', true)).toBe('https://a.com');
  });

  it('should return undefined when result is boolean false', () => {
    const cors = makeCors();
    expect(cors.resolveOriginResult('https://a.com', false)).toBeUndefined();
  });

  it('should return the literal string when result is a non-empty string', () => {
    const cors = makeCors();
    expect(cors.resolveOriginResult('https://a.com', 'https://override.com')).toBe('https://override.com');
  });

  it('should return undefined when result is an empty string', () => {
    const cors = makeCors();
    expect(cors.resolveOriginResult('https://a.com', '')).toBeUndefined();
  });
});

// ── serializeExposeHeaders ──

describe('Cors#serializeExposeHeaders', () => {
  it('should join headers with comma when credentials is false', () => {
    const cors = makeCors({ origin: '*', credentials: false, exposedHeaders: ['X-A', 'X-B'] });
    expect(cors.serializeExposeHeaders(['X-A', 'X-B'])).toBe('X-A,X-B');
  });

  it('should pass wildcard "*" through join when credentials is false', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: false, exposedHeaders: ['*'] });
    expect(cors.serializeExposeHeaders(['*'])).toBe('*');
  });

  it('should return undefined when credentials is true and only wildcard is present', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, exposedHeaders: ['*'] });
    expect(cors.serializeExposeHeaders(['*'])).toBeUndefined();
  });

  it('should return only explicit headers when credentials is true and wildcard is mixed', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, exposedHeaders: ['*', 'X-A'] });
    expect(cors.serializeExposeHeaders(['*', 'X-A'])).toBe('X-A');
  });

  it('should join explicit headers when credentials is true and no wildcard present', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, exposedHeaders: ['X-A', 'X-B'] });
    expect(cors.serializeExposeHeaders(['X-A', 'X-B'])).toBe('X-A,X-B');
  });
});

// ── isMethodAllowed ──

describe('Cors#isMethodAllowed', () => {
  it('should return true when allowed methods is a wildcard', () => {
    const cors = makeCors();
    expect(cors.isMethodAllowed('PATCH', ['*'])).toBe(true);
  });

  it('should return true when method is in the allowed list (exact case)', () => {
    const cors = makeCors();
    expect(cors.isMethodAllowed('GET', ['GET', 'POST'])).toBe(true);
  });

  it('should return false when method is not in the allowed list', () => {
    const cors = makeCors();
    expect(cors.isMethodAllowed('DELETE', ['GET', 'POST'])).toBe(false);
  });

  it('should return false when method case does not match (case-sensitive comparison)', () => {
    const cors = makeCors();
    expect(cors.isMethodAllowed('get', ['GET', 'POST'])).toBe(false);
  });
});

// ── serializeAllowedMethods ──

describe('Cors#serializeAllowedMethods', () => {
  it('should join non-wildcard methods with comma', () => {
    const cors = makeCors();
    expect(cors.serializeAllowedMethods(['GET', 'POST'], 'GET')).toBe('GET,POST');
  });

  it('should join all default methods with comma when none is wildcard', () => {
    const cors = makeCors();
    expect(cors.serializeAllowedMethods(['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'], 'GET'))
      .toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
  });

  it('should echo the request method when wildcard is allowed and credentials is true', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, methods: ['*'] });
    expect(cors.serializeAllowedMethods(['*'], 'PATCH')).toBe('PATCH');
  });

  it('should emit "*" when wildcard is allowed and credentials is false', () => {
    const cors = makeCors({ methods: ['*'] });
    expect(cors.serializeAllowedMethods(['*'], 'PUT')).toBe('*');
  });
});

// ── areRequestHeadersAllowed ──

describe('Cors#areRequestHeadersAllowed', () => {
  it('should allow when request headers list is empty regardless of allowed headers', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed([], [])).toBe(true);
    expect(cors.areRequestHeadersAllowed([], ['X-Custom'])).toBe(true);
  });

  it('should reject when allowed headers is empty but request headers list is non-empty', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['X-Custom'], [])).toBe(false);
  });

  it('should allow any non-Authorization header when allowed is wildcard with no credentials', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['X-Custom'], ['*'])).toBe(true);
  });

  it('should reject Authorization header when allowed is wildcard with no explicit Authorization', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['Authorization'], ['*'])).toBe(false);
  });

  it('should reject Authorization (lowercase) when allowed is wildcard with no explicit Authorization', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['authorization'], ['*'])).toBe(false);
  });

  it('should allow Authorization when wildcard with explicit Authorization in allowed list', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['Authorization'], ['*', 'Authorization'])).toBe(true);
  });

  it('should allow when wildcard with credentials and headers include explicit Authorization plus other non-Authorization', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, allowedHeaders: ['*', 'Authorization'] });
    expect(cors.areRequestHeadersAllowed(['Authorization', 'X-Custom'], ['*', 'Authorization'])).toBe(true);
  });

  it('should allow all when no wildcard and every request header is in allowed list', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['X-A', 'X-B'], ['X-A', 'X-B', 'X-C'])).toBe(true);
  });

  it('should reject when no wildcard and at least one request header is missing from allowed list', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['X-A', 'X-Forbidden'], ['X-A', 'X-B'])).toBe(false);
  });

  it('should treat allowed-list match as case-insensitive', () => {
    const cors = makeCors();
    expect(cors.areRequestHeadersAllowed(['x-custom'], ['X-Custom'])).toBe(true);
  });
});

// ── serializeAllowedHeaders ──

describe('Cors#serializeAllowedHeaders', () => {
  it('should return undefined when allowed headers array is empty', () => {
    const cors = makeCors();
    expect(cors.serializeAllowedHeaders([], 'X-Anything')).toBeUndefined();
  });

  it('should join allowed headers with comma when no wildcard is present', () => {
    const cors = makeCors();
    expect(cors.serializeAllowedHeaders(['X-A', 'X-B'], 'X-A')).toBe('X-A,X-B');
  });

  it('should echo raw request headers when wildcard with credentials and request headers are non-empty', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, allowedHeaders: ['*'] });
    expect(cors.serializeAllowedHeaders(['*'], 'X-A, X-B')).toBe('X-A, X-B');
  });

  it('should return undefined when wildcard with credentials and request headers are null', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, allowedHeaders: ['*'] });
    expect(cors.serializeAllowedHeaders(['*'], null)).toBeUndefined();
  });

  it('should return undefined when wildcard with credentials and request headers are empty string', () => {
    const cors = makeCors({ origin: 'https://a.com', credentials: true, allowedHeaders: ['*'] });
    expect(cors.serializeAllowedHeaders(['*'], '')).toBeUndefined();
  });

  it('should emit "*" when wildcard with no credentials', () => {
    const cors = makeCors({ allowedHeaders: ['*'] });
    expect(cors.serializeAllowedHeaders(['*'], 'X-A')).toBe('*');
  });
});

// ── includesWildcard ──

describe('Cors#includesWildcard', () => {
  it('should return true when the array contains exactly "*"', () => {
    const cors = makeCors();
    expect(cors.includesWildcard(['*'])).toBe(true);
  });

  it('should return true when the array contains "*" among other entries', () => {
    const cors = makeCors();
    expect(cors.includesWildcard(['X-A', '*', 'X-B'])).toBe(true);
  });

  it('should return false when the array does not contain "*"', () => {
    const cors = makeCors();
    expect(cors.includesWildcard(['X-A', 'X-B'])).toBe(false);
  });

  it('should return false for an empty array', () => {
    const cors = makeCors();
    expect(cors.includesWildcard([])).toBe(false);
  });

  it('should return false for "*" with surrounding whitespace (no normalization)', () => {
    const cors = makeCors();
    expect(cors.includesWildcard([' * '])).toBe(false);
  });
});

// ── includesHeader ──

describe('Cors#includesHeader', () => {
  it('should match exact-case header name', () => {
    const cors = makeCors();
    expect(cors.includesHeader(['X-Custom'], 'X-Custom')).toBe(true);
  });

  it('should match lowercased request header against title-case allowed entry', () => {
    const cors = makeCors();
    expect(cors.includesHeader(['X-Custom'], 'x-custom')).toBe(true);
  });

  it('should match title-case request header against lowercase allowed entry', () => {
    const cors = makeCors();
    expect(cors.includesHeader(['x-custom'], 'X-Custom')).toBe(true);
  });

  it('should return false when no entry matches case-insensitively', () => {
    const cors = makeCors();
    expect(cors.includesHeader(['X-A', 'X-B'], 'X-C')).toBe(false);
  });

  it('should return false for an empty allowed list', () => {
    const cors = makeCors();
    expect(cors.includesHeader([], 'X-Any')).toBe(false);
  });
});

// ── parseCommaSeparatedValues ──

describe('Cors#parseCommaSeparatedValues', () => {
  it('should return an empty array when value is null', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues(null)).toEqual([]);
  });

  it('should return an empty array when value is an empty string', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('')).toEqual([]);
  });

  it('should split a single-value string into a single-entry array', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('X-A')).toEqual(['X-A']);
  });

  it('should split a multi-value string and trim each entry', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('X-A, X-B, X-C')).toEqual(['X-A', 'X-B', 'X-C']);
  });

  it('should drop empty tokens between consecutive commas', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('X-A, , X-B')).toEqual(['X-A', 'X-B']);
  });

  it('should drop entries that are entirely whitespace', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('X-A,   ,X-B')).toEqual(['X-A', 'X-B']);
  });

  it('should drop leading and trailing empty tokens', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues(', X-A, X-B, ')).toEqual(['X-A', 'X-B']);
  });

  it('should preserve internal whitespace within a single token', () => {
    const cors = makeCors();
    expect(cors.parseCommaSeparatedValues('X A')).toEqual(['X A']);
  });
});

// Use HttpHeader to keep the import live in case future helpers consume it.
void HttpHeader;
