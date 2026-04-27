import { describe, expect, test } from 'bun:test';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE, ZIPBUL_SPREAD, ZIPBUL_COMPUTED_PREFIX,
  ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE, ZIPBUL_UNRESOLVABLE,
  ZIPBUL_LAZY_REF,
} from '@zipbul/common';

import {
  convertExpression,
  convertCallExpression,
  convertFunctionExpression,
  convertObjectExpression,
  identifierToRef,
  extractLazyRefName,
} from './expression-value-to-zipbul-ir';

describe('expression-value-to-zipbul-ir', () => {
  // ── Literals ──────────────────────────────────────────────

  test('string literal passes through', () => {
    expect(convertExpression({ kind: 'string', value: 'hello' })).toBe('hello');
  });

  test('number literal passes through', () => {
    expect(convertExpression({ kind: 'number', value: 42 })).toBe(42);
  });

  test('boolean literal passes through', () => {
    expect(convertExpression({ kind: 'boolean', value: true })).toBe(true);
  });

  test('null literal passes through', () => {
    expect(convertExpression({ kind: 'null', value: null })).toBeNull();
  });

  test('undefined literal collapses to undefined', () => {
    expect(convertExpression({ kind: 'undefined', value: null })).toBeUndefined();
  });

  // ── Identifier ────────────────────────────────────────────

  test('identifier becomes ZIPBUL_REF', () => {
    const result = convertExpression({ kind: 'identifier', name: 'Foo', importSource: '@zipbul/common' });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'Foo',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
    });
  });

  test('aliased identifier emits originalName', () => {
    const result = identifierToRef({ kind: 'identifier', name: 'Bar', originalName: 'Foo', importSource: 'lib' });

    expect(result[ZIPBUL_REF]).toBe('Foo');
  });

  // ── Member ────────────────────────────────────────────────

  test('member access flattens to dot path', () => {
    const result = convertExpression({
      kind: 'member',
      object: 'HttpStep',
      property: 'Validation',
      importSource: '@zipbul/http-adapter',
    });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'HttpStep.Validation',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/http-adapter',
    });
  });

  // ── Call (generic) ────────────────────────────────────────

  test('generic call becomes ZIPBUL_CALL with args', () => {
    const result = convertCallExpression({
      kind: 'call',
      callee: 'inject',
      importSource: '@zipbul/common',
      arguments: [{ kind: 'identifier', name: 'TOKEN' }],
    });

    expect(result).toMatchObject({
      [ZIPBUL_CALL]: 'inject',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
    });
    expect((result as Record<string, unknown>).args).toHaveLength(1);
  });

  // ── Call (lazy thunk) ─────────────────────────────────────

  test('lazy(() => Foo) collapses to ZIPBUL_LAZY_REF', () => {
    const result = convertCallExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => Foo' }],
    });

    expect(result).toEqual({ [ZIPBUL_LAZY_REF]: 'Foo' });
  });

  test('lazy(() => { return Foo; }) collapses to ZIPBUL_LAZY_REF', () => {
    const result = convertCallExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => { return Foo; }' }],
    });

    expect(result).toEqual({ [ZIPBUL_LAZY_REF]: 'Foo' });
  });

  test('lazy without function arg falls back to generic call', () => {
    const result = convertCallExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'identifier', name: 'X' }],
    });

    expect((result as Record<string, unknown>)[ZIPBUL_CALL]).toBe('lazy');
  });

  // ── New ───────────────────────────────────────────────────

  test('new expression becomes ZIPBUL_NEW', () => {
    const result = convertExpression({
      kind: 'new',
      callee: 'Foo',
      arguments: [{ kind: 'string', value: 'a' }],
    });

    expect(result).toEqual({
      [ZIPBUL_NEW]: 'Foo',
      args: ['a'],
    });
  });

  // ── Object ────────────────────────────────────────────────

  test('plain object preserves keys', () => {
    const result = convertObjectExpression({
      kind: 'object',
      properties: [
        { key: 'port', value: { kind: 'number', value: 5000 } },
        { key: 'name', value: { kind: 'string', value: 'app' } },
      ],
    });

    expect(result).toEqual({ port: 5000, name: 'app' });
  });

  test('computed key uses ZIPBUL_COMPUTED_PREFIX index', () => {
    const result = convertObjectExpression({
      kind: 'object',
      properties: [
        { key: 'KEY', value: { kind: 'string', value: 'v' }, computed: true },
      ],
    });

    expect(result).toHaveProperty(`${ZIPBUL_COMPUTED_PREFIX}0`);
    const entry = result[`${ZIPBUL_COMPUTED_PREFIX}0`] as Record<string, unknown>;
    expect(entry[ZIPBUL_COMPUTED_KEY]).toEqual({ [ZIPBUL_REF]: 'KEY', [ZIPBUL_IMPORT_SOURCE]: undefined });
    expect(entry[ZIPBUL_COMPUTED_VALUE]).toBe('v');
  });

  // ── Array ─────────────────────────────────────────────────

  test('array maps elements', () => {
    const result = convertExpression({
      kind: 'array',
      elements: [
        { kind: 'string', value: 'a' },
        { kind: 'number', value: 1 },
      ],
    });

    expect(result).toEqual(['a', 1]);
  });

  // ── Spread ────────────────────────────────────────────────

  test('spread becomes ZIPBUL_SPREAD', () => {
    const result = convertExpression({
      kind: 'spread',
      argument: { kind: 'identifier', name: 'items' },
    });

    expect(result).toEqual({
      [ZIPBUL_SPREAD]: { [ZIPBUL_REF]: 'items', [ZIPBUL_IMPORT_SOURCE]: undefined },
    });
  });

  // ── Function ──────────────────────────────────────────────

  test('function expression carries sourceText', () => {
    const result = convertFunctionExpression({
      kind: 'function',
      sourceText: '() => 42',
    });

    expect(result).toEqual({ [ZIPBUL_FACTORY_CODE]: '() => 42' });
  });

  test('function with typed parameters emits factory params', () => {
    const result = convertFunctionExpression({
      kind: 'function',
      sourceText: '(svc: MyService) => svc',
      parameters: [
        { name: 'svc', type: 'MyService', typeImportSource: './my.service', isOptional: false },
      ],
    });

    expect(result[ZIPBUL_FACTORY_CODE]).toBe('(svc: MyService) => svc');
    expect(result.__zipbul_factory_params).toEqual([
      { name: 'svc', typeName: 'MyService', importSource: './my.service' },
    ]);
  });

  // ── Template / Unresolvable ──────────────────────────────

  test('template literal becomes ZIPBUL_UNRESOLVABLE', () => {
    const result = convertExpression({
      kind: 'template',
      sourceText: '`hello ${name}`',
    });

    expect(result).toEqual({ [ZIPBUL_UNRESOLVABLE]: true, sourceText: '`hello ${name}`' });
  });

  test('unresolvable preserves sourceText', () => {
    const result = convertExpression({
      kind: 'unresolvable',
      sourceText: 'foo as Bar',
    });

    expect(result).toEqual({ [ZIPBUL_UNRESOLVABLE]: true, sourceText: 'foo as Bar' });
  });

  // ── extractLazyRefName ────────────────────────────────────

  test('extractLazyRefName arrow form', () => {
    expect(extractLazyRefName('() => Foo')).toBe('Foo');
    expect(extractLazyRefName('  () =>  Bar  ')).toBe('Bar');
  });

  test('extractLazyRefName block form', () => {
    expect(extractLazyRefName('() => { return Baz; }')).toBe('Baz');
    expect(extractLazyRefName('function() { return Qux }')).toBe('Qux');
  });

  test('extractLazyRefName non-thunk returns null', () => {
    // function call body, expression with operator — neither matches the
    // single-identifier arrow shape nor the `return X;` block shape
    expect(extractLazyRefName('() => compute(x)')).toBeNull();
    expect(extractLazyRefName('() => 1 + 2')).toBeNull();
  });

  // ── Edge cases — no importSource ──────────────────────────

  test('identifier without importSource emits undefined importSource', () => {
    const result = convertExpression({ kind: 'identifier', name: 'localVar' });
    expect(result).toEqual({
      [ZIPBUL_REF]: 'localVar',
      [ZIPBUL_IMPORT_SOURCE]: undefined,
    });
  });

  test('member access without importSource emits undefined importSource', () => {
    const result = convertExpression({
      kind: 'member',
      object: 'localObj',
      property: 'prop',
    });
    expect(result).toEqual({
      [ZIPBUL_REF]: 'localObj.prop',
      [ZIPBUL_IMPORT_SOURCE]: undefined,
    });
  });

  test('lazy with function arg whose body is not an identifier falls back to ZIPBUL_CALL', () => {
    const result = convertCallExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => doSomething(x).then(y => y)' }],
    });
    // body is `doSomething(x)...` — not a bare identifier, not `return X;` → null ref → fallback
    expect((result as Record<string, unknown>)[ZIPBUL_CALL]).toBe('lazy');
  });

  // ── Edge case — deeply nested ──────────────────────────────

  test('nested call inside call args recursively converts', () => {
    const result = convertExpression({
      kind: 'call',
      callee: 'outer',
      arguments: [{
        kind: 'call',
        callee: 'inner',
        arguments: [{ kind: 'string', value: 'x' }],
      }],
    });
    const outer = result as Record<string, unknown>;
    expect(outer[ZIPBUL_CALL]).toBe('outer');
    const args = outer.args as Array<Record<string, unknown>>;
    expect(args).toHaveLength(1);
    expect(args[0]?.[ZIPBUL_CALL]).toBe('inner');
    expect((args[0]?.args as unknown[])[0]).toBe('x');
  });

  test('object with nested array of identifiers', () => {
    const result = convertExpression({
      kind: 'object',
      properties: [
        {
          key: 'controllers',
          value: {
            kind: 'array',
            elements: [
              { kind: 'identifier', name: 'A', importSource: './a' },
              { kind: 'identifier', name: 'B', importSource: './b' },
            ],
          },
        },
      ],
    });
    const obj = result as Record<string, unknown>;
    const list = obj.controllers as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0]?.[ZIPBUL_REF]).toBe('A');
    expect(list[0]?.[ZIPBUL_IMPORT_SOURCE]).toBe('./a');
    expect(list[1]?.[ZIPBUL_REF]).toBe('B');
  });
});
