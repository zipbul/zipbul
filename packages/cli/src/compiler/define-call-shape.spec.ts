import { describe, expect, it } from 'bun:test';
import { parseSource } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import {
  findDefineCallShapeViolations,
  validateDefineCallShape,
} from './define-call-shape';
import { DiagnosticError } from '../diagnostics';

function parse(source: string, filePath = 'test.ts') {
  const result = parseSource(filePath, source);
  if (isErr(result)) throw new Error(`parseSource failed: ${JSON.stringify(result.data)}`);
  return { filePath, parsed: result };
}

describe('validateDefineCallShape — defineX 호출은 top-level export const 의 직접 initializer', () => {
  it('정상: import + 직접 사용', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const mw = defineMiddleware(() => () => {});`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('정상: alias import (`as mw`)', () => {
    const file = parse([
      `import { defineMiddleware as mw } from '@zipbul/common';`,
      `export const cookie = mw(() => () => {});`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('정상: namespace import (`* as zb`)', () => {
    const file = parse([
      `import * as zb from '@zipbul/common';`,
      `export const cookie = zb.defineMiddleware(() => () => {});`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('정상: defineAdapter / defineGuard / defineExceptionFilter / defineModule 모두 동일 규칙', () => {
    const file = parse([
      `import { defineAdapter, defineGuard, defineExceptionFilter, defineModule } from '@zipbul/common';`,
      `export const a = defineAdapter({} as any);`,
      `export const g = defineGuard(() => () => true);`,
      `export const e = defineExceptionFilter(() => () => {});`,
      `export const m = defineModule({ name: 'x' } as any);`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('위반: top-level const 인데 export 없음 (not-exported)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `const mw = defineMiddleware(() => () => {});`,
      `export { mw };`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.callee).toBe('defineMiddleware');
    expect(violations[0]!.reason).toBe('not-exported');
  });

  it('위반: let 으로 선언 (not-const)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export let mw = defineMiddleware(() => () => {});`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-const');
  });

  it('위반: 배열 element (not-top-level)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export const items = [`,
      `  defineMiddleware(() => () => {}),`,
      `  defineMiddleware(() => () => {}),`,
      `];`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(2);
    for (const v of violations) {
      expect(v.reason).toBe('not-top-level');
    }
  });

  it('위반: 클래스 메서드 본문 (not-top-level)', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `export class Registry {`,
      `  build() { return defineMiddleware(() => () => {}); }`,
      `}`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-top-level');
  });

  it('alias 우회 — 더 이상 silent 통과 안 함', () => {
    // 이전 결함: `defineMiddleware as mw` 후 `mw(...)` 비-export 호출이 검출 안 되던 케이스
    const file = parse([
      `import { defineMiddleware as mw } from '@zipbul/common';`,
      `const x = mw(() => () => {});`,
      `export { x };`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.callee).toBe('defineMiddleware');
    expect(violations[0]!.reason).toBe('not-exported');
  });

  it('namespace 우회 — `zb.defineMiddleware(...)` 비-export 도 검출', () => {
    const file = parse([
      `import * as zb from '@zipbul/common';`,
      `const cookie = zb.defineMiddleware(() => () => {});`,
      `export { cookie };`,
    ].join('\n'));
    const violations = findDefineCallShapeViolations([file]);
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toBe('not-exported');
  });

  it('관련 없는 함수 — `something()` 같은 비-defineX 호출은 무시', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `function helper() {}`,
      `helper();`,
      `export const used = defineMiddleware(() => () => {});`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('다른 모듈에서 import 한 동일 이름 함수 — `@zipbul/common` 가 아니면 무시', () => {
    const file = parse([
      `import { defineMiddleware } from 'unrelated-package';`,
      `defineMiddleware();`,
    ].join('\n'));
    expect(findDefineCallShapeViolations([file])).toEqual([]);
  });

  it('regulatedCallees 좁히기 — user-app context 는 defineModule 만 검사', () => {
    // user-app 에서 defineMiddleware 는 factory 함수 안에서 runtime options 받는
    // 패턴이 정상. defineModule 만 strict shape 강제.
    const file = parse([
      `import { defineMiddleware, defineModule } from '@zipbul/common';`,
      `export function makeTimingMw(opts: { name: string }) {`,
      `  return defineMiddleware([], () => () => {});`,
      `}`,
      `const m = defineModule();`,
      `export { m };`,
    ].join('\n'));

    // 전체 set: defineMiddleware (in factory) + defineModule (not exported) 둘 다 위반
    expect(findDefineCallShapeViolations([file]).length).toBe(2);

    // user-app set: defineModule 위반만
    const userAppViolations = findDefineCallShapeViolations([file], new Set(['defineModule']));
    expect(userAppViolations.length).toBe(1);
    expect(userAppViolations[0]!.callee).toBe('defineModule');
    expect(userAppViolations[0]!.reason).toBe('not-exported');
  });

  it('validateDefineCallShape 가 위반 시 단일 aggregated DiagnosticError throw', () => {
    const file = parse([
      `import { defineMiddleware } from '@zipbul/common';`,
      `const a = defineMiddleware(() => () => {});`,
      `export let b = defineMiddleware(() => () => {});`,
      `export { a };`,
    ].join('\n'));
    expect(() => validateDefineCallShape([file])).toThrow(DiagnosticError);
    try {
      validateDefineCallShape([file]);
    } catch (cause) {
      const diag = (cause as DiagnosticError).diagnostic;
      expect(diag.why).toMatch(/2 violation/);
      expect(diag.why).toMatch(/is not exported|instead of `const`/);
    }
  });
});
