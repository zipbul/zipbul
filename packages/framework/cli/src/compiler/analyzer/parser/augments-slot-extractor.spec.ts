import { describe, expect, it } from 'bun:test';
import { parseSource, is, walk } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import {
  extractDefinitionParts,
  findContextAssignmentStart,
  readFactoryContextType,
} from './augments-slot-extractor';
import { DiagnosticError } from '../../../diagnostics';

function parse(source: string, filePath = 'mw.ts') {
  const result = parseSource(filePath, source);
  if (isErr(result)) throw new Error(`parseSource failed: ${JSON.stringify(result.data)}`);
  return { filePath, parsed: result };
}

/** Grabs the first `defineMiddleware(...)` CallExpression in the file. */
function firstDefineCall(file: ReturnType<typeof parse>): AstNode {
  let found: AstNode | null = null;
  walk(file.parsed.program, {
    enter(node) {
      if (found !== null || !is.CallExpression(node)) return;
      if (is.Identifier(node.callee) && node.callee.name === 'defineMiddleware') found = node as AstNode;
    },
  });
  if (found === null) throw new Error('no defineMiddleware call in fixture');
  return found;
}

function extract(source: string) {
  const file = parse(source);
  return extractDefinitionParts({ file, call: firstDefineCall(file), exportName: 'mw' });
}

const HEADER = [
  `import { defineMiddleware } from '@zipbul/common';`,
  `import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';`,
  `import { CookieJar } from './cookie-jar';`,
].join('\n');

describe('extractDefinitionParts — 정상 shape', () => {
  it('bare 화살표 함수 슬롯을 kind=validated-accessor 로 추출', () => {
    const parts = extract([
      HEADER,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: (ctx) => ({}) } },`,
      `});`,
    ].join('\n'));
    expect(parts.adapters).toEqual(['HttpAdapter']);
    expect(parts.augments).toEqual([
      { ns: 'request', prop: 'getQuery', kind: 'validated-accessor' },
    ]);
  });

  it('bare function 표현식 슬롯도 kind=validated-accessor 로 추출', () => {
    const parts = extract([
      HEADER,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: function (ctx) { return {}; } } },`,
      `});`,
    ].join('\n'));
    expect(parts.augments).toEqual([
      { ns: 'request', prop: 'getQuery', kind: 'validated-accessor' },
    ]);
  });

  it('여러 bare 함수 슬롯을 각각 추출', () => {
    const parts = extract([
      HEADER,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: (ctx) => ({}), getParams: (ctx) => ({}) } },`,
      `});`,
    ].join('\n'));
    expect(parts.augments).toEqual([
      { ns: 'request', prop: 'getQuery', kind: 'validated-accessor' },
      { ns: 'request', prop: 'getParams', kind: 'validated-accessor' },
    ]);
  });

  it('bare 함수를 감싼 conditional 은 error', () => {
    expect(() => extract([
      HEADER,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: true ? ((ctx) => ({})) : ((ctx) => ({})) } },`,
      `});`,
    ].join('\n'))).toThrow(DiagnosticError);
  });

  it('array overload 는 adapters + factory 만 추출 (augment-less)', () => {
    const parts = extract([
      HEADER,
      `export const mw = defineMiddleware([HttpAdapter], () => (ctx) => {});`,
    ].join('\n'));
    expect(parts.adapters).toEqual(['HttpAdapter']);
    expect(parts.augments).toEqual([]);
    expect(parts.factory).not.toBeNull();
  });

  it('factory-only overload 는 전부 빈 값 + factory', () => {
    const parts = extract([
      HEADER,
      `export const mw = defineMiddleware(() => (ctx) => {});`,
    ].join('\n'));
    expect(parts.adapters).toEqual([]);
    expect(parts.augments).toEqual([]);
    expect(parts.factory).not.toBeNull();
  });
});

describe('extractDefinitionParts — §3.4 hard errors', () => {
  const expectFails = (body: string, pattern: RegExp) => {
    expect(() => extract([HEADER, body].join('\n'))).toThrow(DiagnosticError);
    try {
      extract([HEADER, body].join('\n'));
    } catch (cause) {
      expect((cause as DiagnosticError).diagnostic.why).toMatch(pattern);
    }
  };

  it('augments 인데 adapters 없음 → error', () => {
    expectFails([
      `export const mw = defineMiddleware({`,
      `  augments: { request: { getQuery: (ctx) => ({}) } },`,
      `});`,
    ].join('\n'), /non-empty `adapters`/);
  });

  it('computed key → error', () => {
    expectFails([
      `const key = 'getQuery';`,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { [key]: (ctx) => ({}) } },`,
      `});`,
    ].join('\n'), /computed keys/);
  });

  it('spread → error', () => {
    expectFails([
      `const extra = {};`,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { ...extra } },`,
      `});`,
    ].join('\n'), /spread/);
  });

  it('conditional 값 → error', () => {
    expectFails([
      `const flag = true;`,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: flag ? ((ctx) => ({})) : ((ctx) => ({})) } },`,
      `});`,
    ].join('\n'), /conditional/);
  });

  it('non-function 값 → error', () => {
    expectFails([
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: 42 } },`,
      `});`,
    ].join('\n'), /supply function/);
  });

  it('call 값 (e.g. validatedAccessor()) → error (bare 함수만 허용)', () => {
    expectFails([
      `const myAccessor = (fn: unknown) => fn;`,
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: myAccessor((ctx: unknown) => ({})) } },`,
      `});`,
    ].join('\n'), /supply function/);
  });

  it('async bare 함수 → error (동기 supply 만 허용)', () => {
    expectFails([
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: async (ctx) => ({}) } },`,
      `});`,
    ].join('\n'), /synchronous|async/i);
  });

  it('generator bare 함수 → error (동기 supply 만 허용)', () => {
    expectFails([
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: function* (ctx) { yield {}; } } },`,
      `});`,
    ].join('\n'), /synchronous|generator|async/i);
  });

  it('class 를 슬롯 값으로 → error', () => {
    expectFails([
      `export const mw = defineMiddleware({`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: class {} } },`,
      `});`,
    ].join('\n'), /supply function/);
  });

  it('array overload 에 augments smuggling → error', () => {
    expectFails([
      `export const mw = defineMiddleware([HttpAdapter], {`,
      `  augments: { request: { getQuery: (ctx) => ({}) } },`,
      `} as never);`,
    ].join('\n'), /array overload/);
  });

  it('config object 에 spread → error', () => {
    expectFails([
      `const base = {};`,
      `export const mw = defineMiddleware({`,
      `  ...base,`,
      `  adapters: [HttpAdapter],`,
      `  augments: { request: { getQuery: (ctx) => ({}) } },`,
      `});`,
    ].join('\n'), /spread/);
  });
});

describe('findContextAssignmentStart — 구식 assignment augment 검출', () => {
  const factoryOf = (source: string): AstNode => {
    const file = parse(source);
    const call = firstDefineCall(file);
    const first = (call as AstNode & { arguments: readonly AstNode[] }).arguments[0]!;
    return first;
  };

  it('ctx.to() binding 에 뿌리내린 assignment 를 검출', () => {
    const factory = factoryOf([
      HEADER,
      `export const mw = defineMiddleware(() => (ctx) => {`,
      `  const http = ctx.to(HttpContext);`,
      `  http.request.cookie = new CookieJar();`,
      `});`,
    ].join('\n'));
    expect(findContextAssignmentStart(factory)).not.toBeNull();
  });

  it('binding 없이 직접 ctx.to(...).x = 도 검출', () => {
    const factory = factoryOf([
      HEADER,
      `export const mw = defineMiddleware(() => (ctx) => {`,
      `  ctx.to(HttpContext).request.cookie = new CookieJar();`,
      `});`,
    ].join('\n'));
    expect(findContextAssignmentStart(factory)).not.toBeNull();
  });

  it('assignment 없는 factory 는 null', () => {
    const factory = factoryOf([
      HEADER,
      `export const mw = defineMiddleware(() => (ctx) => {`,
      `  const http = ctx.to(HttpContext);`,
      `  void http;`,
      `});`,
    ].join('\n'));
    expect(findContextAssignmentStart(factory)).toBeNull();
  });
});

describe('readFactoryContextType', () => {
  it('ctx.to(HttpContext) 에서 contextType 추출', () => {
    const file = parse([
      HEADER,
      `export const mw = defineMiddleware(() => (ctx) => {`,
      `  const http = ctx.to(HttpContext);`,
      `  void http;`,
      `});`,
    ].join('\n'));
    const call = firstDefineCall(file);
    const factory = (call as AstNode & { arguments: readonly AstNode[] }).arguments[0]!;
    expect(readFactoryContextType(factory)).toBe('HttpContext');
  });
});
