import { describe, expect, test } from 'bun:test';

import {
  ContextTypesGenerator,
  type MiddlewareContextAugment,
  type ContextAdapterMap,
} from './context-types-generator';
import { ImportRegistry } from './import-registry';

const HTTP_ADAPTER_MAP: ContextAdapterMap = {
  HttpContext: {
    request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
    response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
  },
};

describe('ContextTypesGenerator', () => {
  test('generates declaration merging for class augments', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'cookieMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/cookie/src/index.ts',
        augments: [
          { path: ['request', 'cookie'], rhs: { kind: 'class', identifier: 'RequestCookieJar' } },
          { path: ['response', 'cookie'], rhs: { kind: 'class', identifier: 'ResponseCookieJar' } },
        ],
        classImports: new Map([
          ['RequestCookieJar', '/project/packages/cookie/src/request-cookie-jar.ts'],
          ['ResponseCookieJar', '/project/packages/cookie/src/response-cookie-jar.ts'],
        ]),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('interface HttpRequest {');
    expect(output).toContain('cookie: RequestCookieJar;');
    expect(output).toContain('interface HttpResponse {');
    expect(output).toContain('cookie: ResponseCookieJar;');
    expect(output).toContain('import type {');
  });

  test('generates method signatures with generics', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'queryParserMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/query-parser/src/index.ts',
        augments: [
          {
            path: ['request', 'getQuery'],
            rhs: {
              kind: 'method',
              typeParams: ['T'],
              params: [{ name: 'dto', type: 'Class<T>' }],
              returnType: 'T',
            },
          },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
  });

  test('merges multiple middlewares into one HttpRequest interface block', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'cookieMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/cookie/src/index.ts',
        augments: [
          { path: ['request', 'cookie'], rhs: { kind: 'class', identifier: 'CookieJar' } },
        ],
        classImports: new Map([
          ['CookieJar', '/project/packages/cookie/src/cookie-jar.ts'],
        ]),
      },
      {
        middlewareName: 'queryMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/query/src/index.ts',
        augments: [
          {
            path: ['request', 'getQuery'],
            rhs: { kind: 'method', typeParams: ['T'], params: [{ name: 'dto', type: 'Class<T>' }], returnType: 'T' },
          },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    const requestBlocks = output.match(/interface HttpRequest \{[^}]*\}/g);

    expect(requestBlocks).toHaveLength(1);
    expect(output).toContain('cookie: CookieJar;');
    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
  });

  test('skips augments whose namespace is not in the adapter map', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'badMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/bad.ts',
        augments: [
          // 'session' is not in HTTP_ADAPTER_MAP — should be dropped
          { path: ['session', 'data'], rhs: { kind: 'class', identifier: 'SessionData' } },
        ],
        classImports: new Map([
          ['SessionData', '/project/bad.ts'],
        ]),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).not.toContain('session');
    expect(output).not.toContain('data');
  });

  test('skips class augments without resolved import', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'badMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/bad.ts',
        augments: [
          { path: ['request', 'mystery'], rhs: { kind: 'class', identifier: 'UnknownClass' } },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).not.toContain('mystery');
  });

  test('works with non-HTTP adapter via custom adapter map', () => {
    const customMap: ContextAdapterMap = {
      WsContext: {
        client: { interface: 'WsClient', module: '@zipbul/ws-adapter' },
      },
    };

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'wsAuthMiddleware',
        contextType: 'WsContext',
        sourceFilePath: '/project/ws-auth.ts',
        augments: [
          { path: ['client', 'session'], rhs: { kind: 'class', identifier: 'Session' } },
        ],
        classImports: new Map([
          ['Session', '/project/session.ts'],
        ]),
      },
    ];

    const output = generator.generate(augments, registry, customMap);

    expect(output).toContain("declare module '@zipbul/ws-adapter'");
    expect(output).toContain('interface WsClient {');
    expect(output).toContain('session: Session;');
  });
});
