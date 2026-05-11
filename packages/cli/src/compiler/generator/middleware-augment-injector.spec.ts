import { describe, expect, test } from 'bun:test';
import { extractMiddlewareAugmentEntries, injectAugmentsIntoSource } from './middleware-augment-injector';

describe('extractMiddlewareAugmentEntries', () => {
  test('extracts class augments from factory-only overload', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { RequestCookieJar } from './request-cookie-jar';
import { ResponseCookieJar } from './response-cookie-jar';

export const cookieMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new RequestCookieJar(http.request.headers);
  http.response.cookie = new ResponseCookieJar(http.response);
});
`;

    const entries = extractMiddlewareAugmentEntries('cookie.ts', source);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('cookieMiddleware');
    expect(entries[0]!.contextType).toBe('HttpContext');
    expect(entries[0]!.configText).toBeNull();
    expect(entries[0]!.adaptersText).toBeNull();
    expect(entries[0]!.augments).toHaveLength(2);
    expect(entries[0]!.augments[0]).toEqual({
      context: 'HttpContext',
      path: ['request', 'cookie'],
      kind: 'class',
      type: 'RequestCookieJar',
    });
    expect(entries[0]!.augments[1]).toEqual({
      context: 'HttpContext',
      path: ['response', 'cookie'],
      kind: 'class',
      type: 'ResponseCookieJar',
    });
  });

  test('extracts method augments', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

export const queryMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
});
`;

    const entries = extractMiddlewareAugmentEntries('query.ts', source);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.augments[0]).toEqual({
      context: 'HttpContext',
      path: ['request', 'getQuery'],
      kind: 'method',
      signature: '<T>(dto: Class<T>): T',
    });
  });

  test('extracts from config object overload', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { SessionStore } from './session-store';

export const sessionMiddleware = defineMiddleware({
  factory: () => (ctx) => {
    const http = ctx.to(HttpContext);
    http.request.session = new SessionStore();
  },
});
`;

    const entries = extractMiddlewareAugmentEntries('session.ts', source);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.configText).not.toBeNull();
    expect(entries[0]!.augments[0]).toEqual({
      context: 'HttpContext',
      path: ['request', 'session'],
      kind: 'class',
      type: 'SessionStore',
    });
  });

  test('extracts from adapters+factory overload', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter } from '@zipbul/http-adapter';
import { HttpContext } from '@zipbul/http-adapter';
import { CookieJar } from './cookie-jar';

export const cookieMiddleware = defineMiddleware([HttpAdapter], () => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new CookieJar();
});
`;

    const entries = extractMiddlewareAugmentEntries('cookie.ts', source);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.adaptersText).not.toBeNull();
    expect(entries[0]!.adaptersText).toContain('HttpAdapter');
    expect(entries[0]!.configText).toBeNull();
  });

  test('skips middleware without augments', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';

export const noopMiddleware = defineMiddleware(() => (ctx) => {
  // no context narrowing, no augments
});
`;

    const entries = extractMiddlewareAugmentEntries('noop.ts', source);

    expect(entries).toHaveLength(0);
  });

  test('extracts from multiple middleware in same file', () => {
    const source = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { CookieJar } from './cookie-jar';

export const cookieMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new CookieJar();
});

export const queryMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
});
`;

    const entries = extractMiddlewareAugmentEntries('multi.ts', source);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('cookieMiddleware');
    expect(entries[1]!.name).toBe('queryMiddleware');
  });
});

describe('injectAugmentsIntoSource', () => {
  test('injects __augments into factory-only overload (wraps in config)', () => {
    const source = `import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { CookieJar } from './cookie-jar';

export const cookieMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new CookieJar();
});
`;

    const entries = extractMiddlewareAugmentEntries('test.ts', source);
    const result = injectAugmentsIntoSource(source, entries);

    expect(result).toContain('__augments');
    expect(result).toContain('"request"');
    expect(result).toContain('"cookie"');
    expect(result).toContain('"CookieJar"');
    expect(result).toContain('factory:');
  });

  test('injects __augments into config object overload', () => {
    const source = `import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { SessionStore } from './session-store';

export const sessionMiddleware = defineMiddleware({
  factory: () => (ctx) => {
    const http = ctx.to(HttpContext);
    http.request.session = new SessionStore();
  },
});
`;

    const entries = extractMiddlewareAugmentEntries('test.ts', source);
    const result = injectAugmentsIntoSource(source, entries);

    expect(result).toContain('__augments');
    expect(result).toContain('"SessionStore"');
    // Should still have the original factory
    expect(result).toContain('factory:');
  });

  test('injects __augments into adapters+factory overload correctly', () => {
    const source = `import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';
import { CookieJar } from './cookie-jar';

export const cookieMiddleware = defineMiddleware([HttpAdapter], () => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new CookieJar();
});
`;

    const entries = extractMiddlewareAugmentEntries('test.ts', source);
    const result = injectAugmentsIntoSource(source, entries);

    // Should produce config object with adapters + factory + __augments
    expect(result).toContain('adapters:');
    expect(result).toContain('HttpAdapter');
    expect(result).toContain('factory:');
    expect(result).toContain('__augments');
    expect(result).toContain('"CookieJar"');
    // Should NOT have the old positional form
    expect(result).not.toContain('defineMiddleware([HttpAdapter],');
  });

  test('returns unchanged source when no augments found', () => {
    const source = `export const x = 1;`;
    const entries = extractMiddlewareAugmentEntries('test.ts', source);
    const result = injectAugmentsIntoSource(source, entries);

    expect(result).toBe(source);
  });
});
