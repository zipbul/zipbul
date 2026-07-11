import { describe, expect, test } from 'bun:test';

import {
  ContextTypesGenerator,
  type ContextAdapterMap,
} from './context-types-generator';
import type { MiddlewareContextAugment } from '../analyzer/adapter/middleware-context-types';
import { ImportRegistry } from './import-registry';

const HTTP_ADAPTER_MAP: ContextAdapterMap = {
  HttpContext: {
    request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
    response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
  },
};

describe('ContextTypesGenerator', () => {
  test('generates declaration merging for validatedAccessor augments across interfaces', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'cookieMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/cookie/src/index.ts',
        augments: [
          { path: ['request', 'getCookie'] },
          { path: ['response', 'setCookie'] },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('interface HttpRequest {');
    expect(output).toContain('getCookie<T>(dto: Class<T>): T;');
    expect(output).toContain('interface HttpResponse {');
    expect(output).toContain('setCookie<T>(dto: Class<T>): T;');
    expect(output).toContain('import type { Class } from "@zipbul/common"');
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
          { path: ['request', 'getCookie'] },
        ],
        classImports: new Map(),
      },
      {
        middlewareName: 'queryMiddleware',
        contextType: 'HttpContext',
        sourceFilePath: '/project/packages/query/src/index.ts',
        augments: [
          { path: ['request', 'getQuery'] },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    const requestBlocks = output.match(/interface HttpRequest \{[^}]*\}/g);

    expect(requestBlocks).toHaveLength(1);
    expect(output).toContain('getCookie<T>(dto: Class<T>): T;');
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
          { path: ['session', 'getData'] },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).not.toContain('session');
    expect(output).not.toContain('getData');
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
          { path: ['client', 'getSession'] },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, customMap);

    expect(output).toContain("declare module '@zipbul/ws-adapter'");
    expect(output).toContain('interface WsClient {');
    expect(output).toContain('getSession<T>(dto: Class<T>): T;');
  });

  test('renders validatedAccessor augments with the standardized signature and Class import', () => {
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const augments: MiddlewareContextAugment[] = [
      {
        middlewareName: 'queryParser',
        contextType: 'HttpContext',
        sourceFilePath: '@zipbul/query-parser',
        packageName: '@zipbul/query-parser',
        augments: [
          { path: ['request', 'getQuery'] },
        ],
        classImports: new Map(),
      },
    ];

    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
    expect(output).toContain('import type { Class } from "@zipbul/common"');
  });
});
