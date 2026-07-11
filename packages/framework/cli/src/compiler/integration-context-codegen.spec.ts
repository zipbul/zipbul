import { describe, expect, test, beforeAll } from 'bun:test';

import type { FileAnalysis } from './analyzer/graph/interfaces';
import type { AdapterStaticSchema } from './analyzer/interfaces';

import { MiddlewareAugmentCollector } from './analyzer/adapter/middleware-augment-collector';
import { buildAugmentsManifestIndex } from './analyzer/adapter/augments-manifest-reader';
import {
  ContextTypesGenerator,
  type ContextAdapterMap,
} from './generator/context-types-generator';
import { ImportRegistry } from './generator/import-registry';

const HTTP_ADAPTER_MAP: ContextAdapterMap = {
  HttpContext: {
    request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
    response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
  },
};

const HTTP_ADAPTER_SCHEMA: AdapterStaticSchema = {
  entryDecorators: { controller: 'Controller', handlers: ['Get', 'Post'] },
  contextNamespaces: {
    contextType: 'HttpContext',
    module: '@zipbul/http-adapter',
    namespaces: { request: 'HttpRequest', response: 'HttpResponse' },
  },
};

const COOKIE_SOURCE = `
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter } from '@zipbul/http-adapter';
import { RequestCookieJar } from './request-cookie-jar';
import { ResponseCookieJar } from './response-cookie-jar';

export const cookieMiddleware = defineMiddleware({
  adapters: [HttpAdapter],
  augments: {
    request: { getCookie: (ctx) => new RequestCookieJar() },
    response: { setCookie: (ctx) => new ResponseCookieJar() },
  },
});
`;

const QUERY_SOURCE = `
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

function buildFileAnalysis(filePath: string): FileAnalysis {
  return { filePath, classes: [], reExports: [], exports: [] };
}

describe('integration: declarative middleware augments → context.d.ts', () => {
  const tmpDir = `/tmp/zipbul-test-integration-codegen-${Date.now()}`;

  beforeAll(async () => {
    await Bun.write(`${tmpDir}/cookie/index.ts`, COOKIE_SOURCE);
    await Bun.write(`${tmpDir}/query/index.ts`, QUERY_SOURCE);
  });

  test('augments-slot middleware → declaration merging output', async () => {
    const cookiePath = `${tmpDir}/cookie/index.ts`;
    const queryPath = `${tmpDir}/query/index.ts`;
    const fileMap = new Map<string, FileAnalysis>([
      [cookiePath, buildFileAnalysis(cookiePath)],
      [queryPath, buildFileAnalysis(queryPath)],
    ]);

    const collector = new MiddlewareAugmentCollector();
    const collected = await collector.collect(fileMap, { HttpAdapter: HTTP_ADAPTER_SCHEMA });

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate(collected.augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('interface HttpRequest {');
    expect(output).toContain('getCookie<T>(dto: Class<T>): T;');
    expect(output).toContain('interface HttpResponse {');
    expect(output).toContain('setCookie<T>(dto: Class<T>): T;');
    // Every augment renders the standardized generated accessor signature.
    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
    expect(output).toContain('import type { Class } from "@zipbul/common"');

    const requestBlocks = output.match(/interface HttpRequest \{[^}]*\}/g);

    expect(requestBlocks).toHaveLength(1);
  });

  test('manifest channel → context.d.ts (published package path)', async () => {
    const index = buildAugmentsManifestIndex([{
      packageName: '@zipbul/cookie',
      exportName: 'cookieMiddleware',
      form: 1,
      contextType: 'HttpContext',
      augments: [
        { ns: 'request', prop: 'getCookie', kind: 'validated-accessor' },
        { ns: 'request', prop: 'getQuery', kind: 'validated-accessor' },
      ],
      contextOps: [],
    }]);

    const collector = new MiddlewareAugmentCollector();
    const collected = await collector.collect(new Map(), { HttpAdapter: HTTP_ADAPTER_SCHEMA }, undefined, index);

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate(collected.augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('getCookie<T>(dto: Class<T>): T;');
    expect(output).toContain('import type { Class } from "@zipbul/common"');
    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
  });
});
