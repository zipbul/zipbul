import { describe, expect, test, beforeAll } from 'bun:test';
import { MiddlewareAugmentCollector } from './middleware-augment-collector';
import { buildAugmentsManifestIndex, type ManifestMiddlewareEntry } from './augments-manifest-reader';
import type { FileAnalysis } from '../graph/interfaces';
import type { AdapterStaticSchema } from '../interfaces';

const COOKIE_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter } from '@zipbul/http-adapter';
import { RequestCookieJar } from './request-cookie-jar';
import { ResponseCookieJar } from './response-cookie-jar';

export const cookieMiddleware = defineMiddleware({
  adapters: [HttpAdapter],
  augments: {
    request: { cookie: (ctx) => new RequestCookieJar() },
    response: { cookie: (ctx) => new ResponseCookieJar() },
  },
});
`;

const QUERY_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

export function queryParserMiddleware(options?: { depth?: number }) {
  return defineMiddleware({
    adapters: [HttpAdapter],
    augments: {
      request: { getQuery: (ctx) => ctx.to(HttpContext).request.url },
    },
  });
}
`;

const NOOP_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';

export const noopMiddleware = defineMiddleware(() => (ctx) => {
  // does nothing
});
`;

const OPS_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { SESSION_KEY } from './keys';

export const sessionMiddleware = defineMiddleware(() => (ctx) => {
  ctx.set(SESSION_KEY, 'session');
});
`;

const ASSIGNMENT_MIDDLEWARE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { RequestCookieJar } from './request-cookie-jar';

export const legacyMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  http.request.cookie = new RequestCookieJar(http.request.headers);
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

function buildFileAnalysis(filePath: string): FileAnalysis {
  return { filePath, classes: [], reExports: [], exports: [] };
}

function manifestEntry(overrides: Partial<ManifestMiddlewareEntry>): ManifestMiddlewareEntry {
  return {
    packageName: '@test/pkg',
    exportName: 'testMiddleware',
    form: 1,
    contextType: 'HttpContext',
    augments: [],
    contextOps: [],
    ...overrides,
  };
}

describe('MiddlewareAugmentCollector', () => {
  const tmpDir = `/tmp/zipbul-test-collector-${Date.now()}`;

  beforeAll(async () => {
    await Bun.write(`${tmpDir}/cookie/index.ts`, COOKIE_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/query/index.ts`, QUERY_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/noop/index.ts`, NOOP_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/ops/index.ts`, OPS_MIDDLEWARE_SOURCE);
    await Bun.write(`${tmpDir}/legacy/index.ts`, ASSIGNMENT_MIDDLEWARE_SOURCE);
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

  test('extracts augments-slot declarations from a local FORM 1 middleware', async () => {
    const filePath = `${tmpDir}/cookie/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('cookieMiddleware');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toHaveLength(2);

    const requestAugment = aug.augments.find(a => a.path[0] === 'request');

    expect(requestAugment).toBeDefined();
    expect(requestAugment!.path).toEqual(['request', 'cookie']);
  });

  test('extracts validatedAccessor declarations from a local FORM 2 middleware', async () => {
    const filePath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('queryParserMiddleware');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toEqual([
      { path: ['request', 'getQuery'] },
    ]);
  });

  test('middleware without augments contributes nothing', async () => {
    const filePath = `${tmpDir}/noop/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(0);
  });

  test('extracts producer infos from local factory ctx.set calls', async () => {
    const filePath = `${tmpDir}/ops/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.producerInfos).toHaveLength(1);
    expect(result.producerInfos[0]!.middlewareName).toBe('sessionMiddleware');
    expect(result.producerInfos[0]!.contextOps[0]!.kind).toBe('set');
    expect(result.producerInfos[0]!.contextOps[0]!.keyIdentifier).toBe('SESSION_KEY');
  });

  test('assignment-style context augments are a hard error with fix-it', async () => {
    const filePath = `${tmpDir}/legacy/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);

    const collector = new MiddlewareAugmentCollector();

    expect(collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA }))
      .rejects.toThrow(/assignment-style context augments .* are no longer supported/i);
  });

  test('filters by registered middleware refs when provided', async () => {
    const cookiePath = `${tmpDir}/cookie/index.ts`;
    const queryPath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [cookiePath, buildFileAnalysis(cookiePath)],
      [queryPath, buildFileAnalysis(queryPath)],
    ]);

    const collector = new MiddlewareAugmentCollector();
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
      [cookiePath, buildFileAnalysis(cookiePath)],
      [queryPath, buildFileAnalysis(queryPath)],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    const names = result.augments.map(a => a.middlewareName).sort();

    expect(names).toEqual(['cookieMiddleware', 'queryParserMiddleware']);
  });

  test('node_modules files are never source-parsed (manifest channel only)', async () => {
    // A node_modules path with assignment-style source would throw if parsed;
    // being skipped proves the source channel excludes packages.
    const filePath = `${tmpDir}/node_modules/@test/legacy/index.ts`;

    await Bun.write(filePath, ASSIGNMENT_MIDDLEWARE_SOURCE);

    const fileMap = new Map<string, FileAnalysis>([[filePath, buildFileAnalysis(filePath)]]);
    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    expect(result.augments).toHaveLength(0);
    expect(result.producerInfos).toHaveLength(0);
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

  test('converts manifest validated-accessor entries', async () => {
    const index = buildAugmentsManifestIndex([manifestEntry({
      packageName: '@zipbul/query-parser',
      exportName: 'queryParser',
      form: 2,
      augments: [{ ns: 'request', prop: 'getQuery', kind: 'validated-accessor' }],
    })]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(new Map(), { HttpAdapter: HTTP_ADAPTER_SCHEMA }, undefined, index);

    expect(result.augments).toHaveLength(1);

    const aug = result.augments[0]!;

    expect(aug.middlewareName).toBe('queryParser');
    expect(aug.packageName).toBe('@zipbul/query-parser');
    expect(aug.contextType).toBe('HttpContext');
    expect(aug.augments).toEqual([
      { path: ['request', 'getQuery'] },
    ]);
  });

  test('converts manifest contextOps into producer infos', async () => {
    const index = buildAugmentsManifestIndex([manifestEntry({
      packageName: '@zipbul/session',
      exportName: 'sessionMiddleware',
      contextType: null,
      contextOps: [{ kind: 'set', keyIdentifier: 'SESSION' }],
    })]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(new Map(), { HttpAdapter: HTTP_ADAPTER_SCHEMA }, undefined, index);

    expect(result.augments).toHaveLength(0);
    expect(result.producerInfos).toEqual([{
      middlewareName: 'sessionMiddleware',
      sourceFilePath: '@zipbul/session',
      contextOps: [{ kind: 'set', keyIdentifier: 'SESSION', start: null }],
    }]);
  });

  test('manifest entries respect the registered-refs filter', async () => {
    const index = buildAugmentsManifestIndex([
      manifestEntry({
        packageName: '@zipbul/query-parser',
        exportName: 'queryParser',
        augments: [{ ns: 'request', prop: 'getQuery', kind: 'validated-accessor' }],
      }),
      manifestEntry({
        packageName: '@zipbul/cookie',
        exportName: 'cookieMiddleware',
        augments: [{ ns: 'request', prop: 'cookie', kind: 'validated-accessor' }],
      }),
    ]);

    const collector = new MiddlewareAugmentCollector();
    const result = await collector.collect(
      new Map(),
      { HttpAdapter: HTTP_ADAPTER_SCHEMA },
      new Set(['queryParser']),
      index,
    );

    expect(result.augments).toHaveLength(1);
    expect(result.augments[0]!.middlewareName).toBe('queryParser');
  });
});
