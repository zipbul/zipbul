import { describe, expect, test } from 'bun:test';
import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type {
  Node as AstNode,
  CallExpression,
  ArrowFunctionExpression,
  Function as OxcFunction,
  VariableDeclaration,
  ImportDeclaration,
} from 'oxc-parser';

import {
  extractMiddlewareAugments,
  type MiddlewareAugmentResult,
} from './analyzer/parser/middleware-augment-extractor';
import {
  ContextTypesGenerator,
  type ContextAdapterMap,
} from './generator/context-types-generator';
import type { MiddlewareContextAugment } from './analyzer/adapter/middleware-context-types';
import { ImportRegistry } from './generator/import-registry';
import { extractLibAugments, injectAugmentsIntoSource } from './generator/lib-augment-injector';
import { AstParser } from './analyzer/parser';
import { toRecord, isAnalyzerValueArray } from './analyzer/type-guards';
import { ZIPBUL_CALL } from '@zipbul/common';

const HTTP_ADAPTER_MAP: ContextAdapterMap = {
  HttpContext: {
    request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
    response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
  },
};

function findDefineMiddlewareFactory(programBody: readonly AstNode[], name: string): OxcFunction | ArrowFunctionExpression | null {
  for (const stmt of programBody) {
    let varDecl: VariableDeclaration | null = null;

    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      varDecl = stmt.declaration;
    } else if (stmt.type === 'VariableDeclaration') {
      varDecl = stmt;
    }

    if (!varDecl) continue;

    for (const decl of varDecl.declarations) {
      if (decl.id.type !== 'Identifier' || decl.id.name !== name) continue;
      if (!decl.init || decl.init.type !== 'CallExpression') continue;

      const call = decl.init as CallExpression;
      const arg = call.arguments[0];

      if (!arg) return null;

      if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
        return arg as ArrowFunctionExpression | OxcFunction;
      }
    }
  }

  return null;
}

function buildImportMap(programBody: readonly AstNode[], baseDir: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const stmt of programBody) {
    if (stmt.type !== 'ImportDeclaration') continue;

    const imp = stmt as ImportDeclaration;
    const source = imp.source.value;

    if (typeof source !== 'string') continue;

    const resolved = source.startsWith('.') ? `${baseDir}/${source}.ts` : source;

    for (const spec of imp.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.local.type === 'Identifier') {
        map.set(spec.local.name, resolved);
      }
    }
  }

  return map;
}

function buildAugment(name: string, file: string, source: string): MiddlewareContextAugment | null {
  const parseResult = parseSource(file, source);

  if (isErr(parseResult)) return null;

  const parsed: ParsedFile = parseResult;
  const factory = findDefineMiddlewareFactory(parsed.program.body, name);

  if (!factory) return null;

  const result: MiddlewareAugmentResult | null = extractMiddlewareAugments(factory);

  if (!result) return null;

  const importMap = buildImportMap(parsed.program.body, file.replace(/\/index\.ts$/, ''));
  const classImports = new Map<string, string>();

  for (const aug of result.augments) {
    if (aug.rhs.kind === 'class') {
      const path = importMap.get(aug.rhs.identifier);

      if (path) classImports.set(aug.rhs.identifier, path);
    }
  }

  return {
    middlewareName: name,
    contextType: result.contextType,
    sourceFilePath: file,
    augments: result.augments,
    classImports,
  };
}

describe('integration: middleware factory → context.d.ts', () => {
  test('cookie middleware → declaration merging output', () => {
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

    const aug = buildAugment('cookieMiddleware', '/project/packages/cookie/src/index.ts', source);

    expect(aug).not.toBeNull();
    expect(aug?.classImports.size).toBe(2);

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate([aug!], registry, HTTP_ADAPTER_MAP);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('interface HttpRequest {');
    expect(output).toContain('cookie: RequestCookieJar;');
    expect(output).toContain('interface HttpResponse {');
    expect(output).toContain('cookie: ResponseCookieJar;');
    expect(output).toContain('import type { RequestCookieJar }');
    expect(output).toContain('import type { ResponseCookieJar }');
  });

  test('query parser middleware → method signature output', () => {
    const source = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';

      export const queryParserMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
      });
    `;

    const aug = buildAugment('queryParserMiddleware', '/project/packages/query/src/index.ts', source);

    expect(aug).not.toBeNull();

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate([aug!], registry, HTTP_ADAPTER_MAP);

    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
  });

  test('multiple middlewares merge into single interface block', () => {
    const cookieSource = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';
      import { CookieJar } from './cookie-jar';

      export const cookieMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.cookie = new CookieJar(http.request.headers);
      });
    `;

    const querySource = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';

      export const queryMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
      });
    `;

    const augments: MiddlewareContextAugment[] = [];
    const a = buildAugment('cookieMiddleware', '/project/cookie/src/index.ts', cookieSource);
    const b = buildAugment('queryMiddleware', '/project/query/src/index.ts', querySource);

    if (a) augments.push(a);
    if (b) augments.push(b);

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate(augments, registry, HTTP_ADAPTER_MAP);

    const requestBlocks = output.match(/interface HttpRequest \{[^}]*\}/g);

    expect(requestBlocks).toHaveLength(1);
    expect(output).toContain('cookie: CookieJar;');
    expect(output).toContain('getQuery<T>(dto: Class<T>): T;');
  });

  test('auto-derived contextNamespaces → ContextAdapterMap → correct declaration merging', () => {
    // Simulate what config-extractor produces from HttpContext getters
    const autoAdapterMap: ContextAdapterMap = {};

    // This is what extractContextGetterTypes would produce:
    const contextNamespaces = {
      contextType: 'HttpContext',
      module: '@zipbul/http-adapter',
      namespaces: { request: 'HttpRequest', response: 'HttpResponse' },
    };

    // Build ContextAdapterMap from contextNamespaces (same logic as collector)
    const targets: Record<string, { interface: string; module: string }> = {};

    for (const [getter, typeName] of Object.entries(contextNamespaces.namespaces)) {
      targets[getter] = { interface: typeName, module: contextNamespaces.module };
    }

    (autoAdapterMap as Record<string, unknown>)[contextNamespaces.contextType] = targets;

    // Verify it matches the expected shape
    expect(autoAdapterMap).toEqual(HTTP_ADAPTER_MAP);

    // Verify it produces correct output
    const cookieSource = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';
      import { CookieJar } from './cookie-jar';

      export const cookieMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.cookie = new CookieJar(http.request.headers);
      });
    `;

    const aug = buildAugment('cookieMiddleware', '/project/cookie/src/index.ts', cookieSource);

    expect(aug).not.toBeNull();

    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const output = generator.generate([aug!], registry, autoAdapterMap);

    expect(output).toContain("declare module '@zipbul/http-adapter'");
    expect(output).toContain('interface HttpRequest {');
    expect(output).toContain('cookie: CookieJar;');
  });

  test('e2e: zb build --lib output → consumer IR → context.d.ts', async () => {
    // Step 1: Package author writes middleware source
    const packageSource = `
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

    // Step 2: zb build --lib extracts and injects __augments
    const augmentEntries = extractLibAugments('cookie/src/index.ts', packageSource);

    expect(augmentEntries).toHaveLength(1);

    const injected = injectAugmentsIntoSource(packageSource, augmentEntries);

    expect(injected).toContain('__augments');

    // Step 3: Consumer's compiler parses the injected JS (simulating dist)
    const parser = new AstParser();
    const analysis = await parser.parse('node_modules/@zipbul/cookie/dist/index.js', injected);

    expect(isErr(analysis)).toBe(false);

    if (isErr(analysis)) return;

    const exportedValue = analysis.exportedValues?.cookieMiddleware;
    const rec = toRecord(exportedValue);

    expect(rec).not.toBeNull();

    const callName = rec![ZIPBUL_CALL];

    expect(callName).toBe('defineMiddleware');

    // Step 4: Consumer reads __augments from IR
    const args = isAnalyzerValueArray(rec!.args) ? rec!.args : [];
    const configObj = toRecord(args[0]);

    expect(configObj).not.toBeNull();
    expect(isAnalyzerValueArray(configObj!.__augments)).toBe(true);

    const augmentsIR = configObj!.__augments as readonly unknown[];

    expect(augmentsIR).toHaveLength(2);

    const firstAugment = toRecord(augmentsIR[0]);

    expect(firstAugment?.context).toBe('HttpContext');
    expect(firstAugment?.kind).toBe('class');
    expect(firstAugment?.type).toBe('RequestCookieJar');

    // Step 5: Build MiddlewareContextAugment from IR (simulating what collector does)
    const classImports = new Map<string, string>();

    classImports.set('RequestCookieJar', '@zipbul/cookie');
    classImports.set('ResponseCookieJar', '@zipbul/cookie');

    const middlewareAugment: MiddlewareContextAugment = {
      middlewareName: 'cookieMiddleware',
      contextType: 'HttpContext',
      sourceFilePath: 'node_modules/@zipbul/cookie/dist/index.js',
      augments: [
        { path: ['request', 'cookie'], rhs: { kind: 'class', identifier: 'RequestCookieJar' } },
        { path: ['response', 'cookie'], rhs: { kind: 'class', identifier: 'ResponseCookieJar' } },
      ],
      classImports,
    };

    // Step 6: Generate context.d.ts
    const generator = new ContextTypesGenerator();
    const registry = new ImportRegistry('/project/.zipbul');
    const contextDts = generator.generate([middlewareAugment], registry, HTTP_ADAPTER_MAP);

    expect(contextDts).toContain("declare module '@zipbul/http-adapter'");
    expect(contextDts).toContain('interface HttpRequest {');
    expect(contextDts).toContain('cookie: RequestCookieJar;');
    expect(contextDts).toContain('interface HttpResponse {');
    expect(contextDts).toContain('cookie: ResponseCookieJar;');
    expect(contextDts).toContain('import type { RequestCookieJar } from "@zipbul/cookie"');
    expect(contextDts).toContain('import type { ResponseCookieJar } from "@zipbul/cookie"');
  });
});
