import { describe, expect, it } from 'bun:test';
import { parseSource } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import {
  analyzeMiddlewareLibraryFile,
  validateMiddlewareLibraryShape,
} from './middleware-shape';
import { DiagnosticError } from '../diagnostics';

function parse(source: string, filePath = 'test.ts') {
  const result = parseSource(filePath, source);
  if (isErr(result)) throw new Error(`parseSource failed: ${JSON.stringify(result.data)}`);
  return { filePath, parsed: result };
}

describe('analyzeMiddlewareLibraryFile — FORM 1 (top-level export const)', () => {
  it('정상: export const 직접 initializer 를 form 1 로 발견', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const mw = defineMiddleware(() => () => {});`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.exportName).toBe('mw');
    expect(middlewares[0]!.form).toBe(1);
    expect(middlewares[0]!.calls.length).toBe(1);
  });

  it('위반: 비-export const (not-exported)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `const mw = defineMiddleware(() => () => {});`,
      `export { mw };`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-exported');
  });

  it('위반: export let (not-const)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export let mw = defineMiddleware(() => () => {});`,
    ].join('\n'));
    const { violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-const');
  });

  it('위반: 배열 element (not-top-level)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const items = [defineMiddleware(() => () => {})];`,
    ].join('\n'));
    const { violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-top-level');
  });
});

describe('analyzeMiddlewareLibraryFile — FORM 2 (exported factory function)', () => {
  it('정상: 단일 return defineMiddleware(...) — query-parser 형태', () => {
    const file = parse([
      `import { defineMiddleware, validatedAccessor } from '@zipbul/common';`,
      `import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';`,
      `export function queryParser(options?: { depth?: number }) {`,
      `  const parser = { parse: (s: string) => ({}) };`,
      `  return defineMiddleware({`,
      `    adapters: [HttpAdapter],`,
      `    augments: {`,
      `      request: {`,
      `        getQuery: (ctx) => parser.parse(''),`,
      `      },`,
      `    },`,
      `  });`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.exportName).toBe('queryParser');
    expect(middlewares[0]!.form).toBe(2);
    expect(middlewares[0]!.calls.length).toBe(1);
  });

  it('정상: cookie 형태 — const local 두 개 + object return', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function cookieMiddleware(options?: unknown) {`,
      `  const onRequest = defineMiddleware({ factory: () => (ctx) => {} });`,
      `  const beforeResponse = defineMiddleware({ factory: () => (ctx) => {} });`,
      `  return { onRequest, beforeResponse };`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.exportName).toBe('cookieMiddleware');
    expect(middlewares[0]!.form).toBe(2);
    expect(middlewares[0]!.calls.length).toBe(2);
  });

  it('정상: object return 에 직접 call + const-local 혼합', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function pair() {`,
      `  const a = defineMiddleware(() => () => {});`,
      `  return { a, b: defineMiddleware(() => () => {}) };`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares[0]!.calls.length).toBe(2);
  });

  it('정상: err() early return guard 는 non-definition return 으로 합법', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `import { err } from '@zipbul/result';`,
      `export function guarded(options?: { bad?: boolean }) {`,
      `  if (options?.bad) {`,
      `    return err('invalid options');`,
      `  }`,
      `  return defineMiddleware(() => () => {});`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.form).toBe(2);
  });

  it('정상: arrow expression body 도 return site', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const make = (opts?: unknown) => defineMiddleware(() => () => {});`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations).toEqual([]);
    expect(middlewares[0]!.exportName).toBe('make');
    expect(middlewares[0]!.form).toBe(2);
  });

  it('위반: 비-export 함수 안의 defineMiddleware (function-not-exported)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `function hidden() {`,
      `  return defineMiddleware(() => () => {});`,
      `}`,
      `export const mw = hidden();`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('function-not-exported');
  });

  it('위반: exported 함수 내부 nested function 의 defineMiddleware (nested-function)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function outer() {`,
      `  const inner = () => defineMiddleware(() => () => {});`,
      `  return inner();`,
      `}`,
    ].join('\n'));
    const { violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('nested-function');
  });

  it('위반: 조건문 안 return defineMiddleware (not-a-return-site)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function conditional(flag: boolean) {`,
      `  if (flag) {`,
      `    return defineMiddleware(() => () => {});`,
      `  }`,
      `  return null;`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-a-return-site');
  });

  it('위반: 두 개의 definition-bearing return site (multiple-definition-returns)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function twoReturns(flag: boolean) {`,
      `  const a = defineMiddleware(() => () => {});`,
      `  return flag ? a : a;`,
      `}`,
      `export function alsoTwo() {`,
      `  return defineMiddleware(() => () => {});`,
      `}`,
    ].join('\n'));
    // twoReturns: 삼항식 return 은 direct call/object 형태가 아니므로 위반;
    // alsoTwo 는 정상. (multiple-returns 케이스는 아래 별도 테스트)
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.exportName).toBe('alsoTwo');
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('위반: 서로 다른 두 return 이 각각 definition 을 반환 (multiple-definition-returns)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function ambiguous(flag: boolean) {`,
      `  const a = defineMiddleware(() => () => {});`,
      `  return { a };`,
      `  return defineMiddleware(() => () => {});`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.some(v => v.reason === 'multiple-definition-returns')).toBe(true);
  });

  it('위반: object return 에 spread 혼입 (malformed-return-object)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function bad(extra: Record<string, unknown>) {`,
      `  const a = defineMiddleware(() => () => {});`,
      `  return { a, ...extra };`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('malformed-return-object');
  });

  it('위반: object return 에 비-definition 값 혼입 (malformed-return-object)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function bad() {`,
      `  return { a: defineMiddleware(() => () => {}), b: 42 };`,
      `}`,
    ].join('\n'));
    const { violations } = analyzeMiddlewareLibraryFile(file);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('malformed-return-object');
  });

  it('위반: 사용되지 않는 definition const local (not-a-return-site)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export function leaky() {`,
      `  const unused = defineMiddleware(() => () => {});`,
      `  return defineMiddleware(() => () => {});`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]!.calls.length).toBe(1);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-a-return-site');
  });

  it('위반: call argument 위치의 defineMiddleware (not-a-return-site)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `declare function wrap(x: unknown): unknown;`,
      `export function wrapped() {`,
      `  return wrap(defineMiddleware(() => () => {}));`,
      `}`,
    ].join('\n'));
    const { middlewares, violations } = analyzeMiddlewareLibraryFile(file);
    expect(middlewares).toEqual([]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-a-return-site');
  });
});

describe('validateMiddlewareLibraryShape — aggregated throw + 타 defineX FORM 1 유지', () => {
  it('위반 시 fix-it 포함 단일 DiagnosticError', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `function hidden() { return defineMiddleware(() => () => {}); }`,
      `export const mw = hidden();`,
    ].join('\n'));
    expect(() => validateMiddlewareLibraryShape([file])).toThrow(DiagnosticError);
    try {
      validateMiddlewareLibraryShape([file]);
    } catch (cause) {
      const diag = (cause as DiagnosticError).diagnostic;
      expect(diag.why).toMatch(/1 violation/);
      expect(diag.how).toMatch(/export const/);
    }
  });

  it('defineGuard 등 나머지 defineX 는 FORM 2 허용 안 함', () => {
    const file = parse([
      `import { defineGuard } from '@zipbul/common';`,
      `export function makeGuard() {`,
      `  return defineGuard(() => () => true);`,
      `}`,
    ].join('\n'));
    expect(() => validateMiddlewareLibraryShape([file])).toThrow(DiagnosticError);
  });

  it('정상 파일은 발견된 middleware map 을 반환', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const mw = defineMiddleware(() => () => {});`,
    ].join('\n'));
    const discovered = validateMiddlewareLibraryShape([file]);
    expect(discovered.get('test.ts')!.length).toBe(1);
  });
});
