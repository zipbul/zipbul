import { describe, expect, test, beforeAll } from 'bun:test';
import { MiddlewareAugmentCollector } from './middleware-augment-collector';
import type { FileAnalysis } from '../graph/interfaces';
import type { AdapterStaticSchema } from '../interfaces';
import { ZIPBUL_CALL, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';

const COOKIE_MIDDLEWARE_SOURCE = `
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

const QUERY_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

export const queryParserMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
});
`;

const NOOP_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';

export const noopMiddleware = defineMiddleware(() => (ctx) => {
  // does nothing
});
`;

const CONFIG_OVERLOAD_SOURCE = `
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

const HTTP_ADAPTER_SCHEMA: AdapterStaticSchema = {
  entryDecorators: { controller: 'Controller', handlers: ['Get', 'Post'] },
  contextNamespaces: {
    contextType: 'HttpContext',
    module: '@zipbul/http-adapter',
    namespaces: { request: 'HttpRequest', response: 'HttpResponse' },
  },
};

function buildFileAnalysis(filePath: string, exportedValues: Record<string, unknown>): FileAnalysis {
  return {
    filePath,
    classes: [],
    reExports: [],
    exports: Object.keys(exportedValues),
    exportedValues: exportedValues as NonNullable<FileAnalysis['exportedValues']>,
  };
}

describe('MiddlewareAugmentCollector', () => {
  const tmpDir = `/tmp/zipbul-test-collector-${Date.now()}`;

  beforeAll(async () => {
    await Bun.write(`${tmpDir}/cookie/index.ts`, COOKIE_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/query/index.ts`, QUERY_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/noop/index.ts`, NOOP_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/session/index.ts`, CONFIG_OVERLOAD_SOURCE);
  });

  test('builds ContextAdapterMap from adapter schemas', async () => {
    const fileMap = new Map<string, FileAnalysis>();
    const collector = new MiddlewareAugmentCollector();

    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.adapterMap).toEqual({
      HttpContext: {
        request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
        response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
      },
    });
  });

  test('extracts augments from defineMiddleware factory-only overload', async () => {
    const filePath = `${tmpDir}/cookie/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        cookieMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('cookieMiddleware');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toHaveLength(2);

    const requestAugment = aug.augments.find(a => a.path[0] === 'request');
    const responseAugment = aug.augments.find(a => a.path[0] === 'response');

    expect(requestAugment).toBeDefined();
    expect(requestAugment!.path).toEqual(['request', 'cookie']);
    expect(requestAugment!.rhs.kind).toBe('class');

    expect(responseAugment).toBeDefined();
    expect(responseAugment!.path).toEqual(['response', 'cookie']);
    expect(responseAugment!.rhs.kind).toBe('class');

    expect(aug.classImports.has('RequestCookieJar')).toBe(true);
    expect(aug.classImports.has('ResponseCookieJar')).toBe(true);
  });

  test('extracts method augments from middleware', async () => {
    const filePath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        queryParserMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.contextType).toBe('HttpContext');

    const queryAugment = aug.augments.find(a => a.path[1] === 'getQuery');

    expect(queryAugment).toBeDefined();
    expect(queryAugment!.rhs.kind).toBe('method');
  });

  test('skips middleware without ctx.to() context narrowing', async () => {
    const filePath = `${tmpDir}/noop/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        noopMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(0);
  });

  test('handles config object overload with factory property', async () => {
    const filePath = `${tmpDir}/session/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        sessionMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('sessionMiddleware');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toHaveLength(1);
    expect(aug.augments[0]!.path).toEqual(['request', 'session']);
  });

  test('filters by registered middleware refs when provided', async () => {
    const cookiePath = `${tmpDir}/cookie/index.ts`;
    const queryPath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [cookiePath, buildFileAnalysis(cookiePath, {
        cookieMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
      [queryPath, buildFileAnalysis(queryPath, {
        queryParserMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();

    // Only collect cookieMiddleware
    const result = await collector.collect(
      fileMap,
      { HttpAdapter: HTTP_ADAPTER_SCHEMA },
      new Set(['cookieMiddleware']),
    );

    expect(result.augments).toHaveLength(1);
    expect(result.augments[0]!.middlewareName).toBe('cookieMiddleware');
  });

  test('collects from multiple middleware files', async () => {
    const cookiePath = `${tmpDir}/cookie/index.ts`;
    const queryPath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [cookiePath, buildFileAnalysis(cookiePath, {
        cookieMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
      [queryPath, buildFileAnalysis(queryPath, {
        queryParserMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(2);

    const names = result.augments.map(a => a.middlewareName).sort();

    expect(names).toEqual(['cookieMiddleware', 'queryParserMiddleware']);
  });

  test('skips non-defineMiddleware exports', async () => {
    const filePath = `${tmpDir}/cookie/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        someConstant: 'hello',
        anotherExport: { [ZIPBUL_CALL]: 'defineGuard', args: [] },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(0);
  });

  test('returns empty adapterMap when no adapters have contextNamespaces', async () => {
    const fileMap = new Map<string, FileAnalysis>();
    const collector = new MiddlewareAugmentCollector();

    const schemaWithout: AdapterStaticSchema = {
      entryDecorators: { controller: 'Controller', handlers: ['Get'] },
    };

    const result = await collector.collect(fileMap, { HttpAdapter: schemaWithout });

    expect(result.adapterMap).toEqual({});
  });

  test('builds ContextAdapterMap correctly from contextNamespaces', async () => {
    const fileMap = new Map<string, FileAnalysis>();
    const collector = new MiddlewareAugmentCollector();

    const schema: AdapterStaticSchema = {
      entryDecorators: { controller: 'Controller', handlers: ['Get'] },
      contextNamespaces: {
        contextType: 'WsContext',
        module: '@zipbul/ws-adapter',
        namespaces: { client: 'WsClient' },
      },
    };

    const result = await collector.collect(fileMap, { WsAdapter: schema });

    expect(result.adapterMap).toEqual({
      WsContext: {
        client: { interface: 'WsClient', module: '@zipbul/ws-adapter' },
      },
    });
  });

  test('extracts augments from __augments IR field (zb build --lib output)', async () => {
    // Simulate a compiled npm package with __augments in the IR
    const filePath = '/fake/node_modules/@zipbul/cookie/dist/index.js';
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        cookieMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [{
            factory: { __zipbul_factory_code: '() => (ctx) => {}' },
            __augments: [
              { context: 'HttpContext', path: ['request', 'cookie'], kind: 'class', type: 'RequestCookieJar' },
              { context: 'HttpContext', path: ['response', 'cookie'], kind: 'class', type: 'ResponseCookieJar' },
            ],
          }],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('cookieMiddleware');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toHaveLength(2);

    expect(aug.augments[0]!.path).toEqual(['request', 'cookie']);
    expect(aug.augments[0]!.rhs).toEqual({ kind: 'class', identifier: 'RequestCookieJar' });

    expect(aug.augments[1]!.path).toEqual(['response', 'cookie']);
    expect(aug.augments[1]!.rhs).toEqual({ kind: 'class', identifier: 'ResponseCookieJar' });

    // classImports should point to the package name
    expect(aug.classImports.get('RequestCookieJar')).toBe('@zipbul/cookie');
    expect(aug.classImports.get('ResponseCookieJar')).toBe('@zipbul/cookie');
  });

  test('extracts method augments from __augments IR field', async () => {
    const filePath = '/fake/node_modules/@zipbul/query/dist/index.js';
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        queryMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [{
            factory: { __zipbul_factory_code: '() => (ctx) => {}' },
            __augments: [
              { context: 'HttpContext', path: ['request', 'getQuery'], kind: 'method', signature: '<T>(dto: Class<T>): T' },
            ],
          }],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;
    const methodAugment = aug.augments[0]!;

    expect(methodAugment.path).toEqual(['request', 'getQuery']);
    expect(methodAugment.rhs.kind).toBe('method');

    if (methodAugment.rhs.kind === 'method') {
      expect(methodAugment.rhs.typeParams).toEqual(['T']);
      expect(methodAugment.rhs.params).toHaveLength(1);
      expect(methodAugment.rhs.params[0]!.name).toBe('dto');
      expect(methodAugment.rhs.params[0]!.type).toBe('Class<T>');
      expect(methodAugment.rhs.returnType).toBe('T');
    }
  });

  test('__augments IR takes priority over factory body parsing', async () => {
    // Even if the file exists on disk with parseable source,
    // __augments in IR should be used instead
    const filePath = `${tmpDir}/cookie/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [filePath, buildFileAnalysis(filePath, {
        cookieMiddleware: {
          [ZIPBUL_CALL]: 'defineMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
          args: [{
            factory: { __zipbul_factory_code: '() => (ctx) => {}' },
            __augments: [
              { context: 'HttpContext', path: ['request', 'overridden'], kind: 'class', type: 'OverriddenType' },
            ],
          }],
        },
      })],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    // Should use __augments IR data, NOT factory body parsing
    expect(result.augments[0]!.augments[0]!.path).toEqual(['request', 'overridden']);
    expect(result.augments[0]!.augments[0]!.rhs).toEqual({ kind: 'class', identifier: 'OverriddenType' });
  });
});
