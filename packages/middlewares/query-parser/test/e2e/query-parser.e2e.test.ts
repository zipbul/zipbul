import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootQueryParserApp, parsedQuery, silentLogger, type QpTestApp } from './helpers';

describe('queryParserMiddleware e2e', () => {
  silentLogger();

  describe('default options', () => {
    let app: QpTestApp;
    beforeAll(async () => { app = await bootQueryParserApp(); });
    afterAll(async () => { await app.close(); });

    it('should parse a flat query string into request.query', async () => {
      const res = await app.fetch('/x?q=hello&city=seoul');
      expect(parsedQuery(res)).toEqual({ q: 'hello', city: 'seoul' });
    });

    it('should percent-decode values', async () => {
      const res = await app.fetch('/x?q=hello%20world');
      expect(parsedQuery(res)).toEqual({ q: 'hello world' });
    });

    it('should assign an empty object when there is no query string', async () => {
      const res = await app.fetch('/x');
      expect(parsedQuery(res)).toEqual({});
    });

    it('should keep the first value for duplicate keys (HPP-safe default)', async () => {
      const res = await app.fetch('/x?role=admin&role=user');
      expect(parsedQuery(res)).toEqual({ role: 'admin' });
    });

    it('should keep + literal by default', async () => {
      const res = await app.fetch('/x?q=a+b');
      expect(parsedQuery(res)).toEqual({ q: 'a+b' });
    });
  });

  describe('nesting + urlEncoded options', () => {
    let app: QpTestApp;
    beforeAll(async () => { app = await bootQueryParserApp({ nesting: true, urlEncoded: true }); });
    afterAll(async () => { await app.close(); });

    it('should build nested objects and decode + as space', async () => {
      const res = await app.fetch('/x?user[name]=a+b&user[city]=seoul');
      expect(parsedQuery(res)).toEqual({ user: { name: 'a b', city: 'seoul' } });
    });

    it('should build arrays from explicit indices', async () => {
      const res = await app.fetch('/x?tags[0]=a&tags[1]=b');
      expect(parsedQuery(res)).toEqual({ tags: ['a', 'b'] });
    });
  });

  describe('prototype-pollution safety end-to-end', () => {
    let app: QpTestApp;
    beforeAll(async () => { app = await bootQueryParserApp({ nesting: true }); });
    afterAll(async () => { await app.close(); });

    it('should drop a poisoned key and not pollute Object.prototype', async () => {
      const res = await app.fetch('/x?__proto__[polluted]=1&safe=ok');
      expect(parsedQuery(res)).toEqual({ safe: 'ok' });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
