import { describe, expect, test } from 'bun:test';

import type { CodeRelation } from '@zipbul/gildash';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE, ZIPBUL_SPREAD, ZIPBUL_COMPUTED_PREFIX,
  ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE, ZIPBUL_UNRESOLVABLE,
  ZIPBUL_LAZY_REF,
} from '@zipbul/common';

import {
  convertExpression,
  convertDecorator,
  resolveTypeString,
  buildImportMap,
  detectInjectCall,
} from './expression-converter';

describe('convertExpression', () => {
  test('string literal', () => {
    expect(convertExpression({ kind: 'string', value: '/users' })).toBe('/users');
  });

  test('number literal', () => {
    expect(convertExpression({ kind: 'number', value: 42 })).toBe(42);
  });

  test('boolean literal', () => {
    expect(convertExpression({ kind: 'boolean', value: true })).toBe(true);
  });

  test('null literal', () => {
    expect(convertExpression({ kind: 'null', value: null })).toBeNull();
  });

  // 'undefined' kind is a defensive runtime branch not declared in gildash's
  // ExpressionValue union; type system forbids direct invocation. If gildash
  // ever adds the kind to the union, restore a typed test here.

  test('identifier without import', () => {
    const result = convertExpression({ kind: 'identifier', name: 'LocalClass' });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'LocalClass',
      [ZIPBUL_IMPORT_SOURCE]: undefined,
    });
  });

  test('identifier with importSource', () => {
    const result = convertExpression({
      kind: 'identifier',
      name: 'Svc',
      importSource: './my.service',
      originalName: 'MyService',
    });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'MyService',
      [ZIPBUL_IMPORT_SOURCE]: './my.service',
    });
  });

  test('identifier with importSource and no alias', () => {
    const result = convertExpression({
      kind: 'identifier',
      name: 'Injectable',
      importSource: '@zipbul/common',
    });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'Injectable',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
    });
  });

  test('member expression', () => {
    const result = convertExpression({
      kind: 'member',
      object: 'HttpMethod',
      property: 'Get',
      importSource: '@zipbul/http-adapter',
    });

    expect(result).toEqual({
      [ZIPBUL_REF]: 'HttpMethod.Get',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/http-adapter',
    });
  });

  test('call expression', () => {
    const result = convertExpression({
      kind: 'call',
      callee: 'contextKey',
      importSource: '@zipbul/common',
      arguments: [{ kind: 'string', value: 'http.body' }],
    });

    expect(result).toEqual({
      [ZIPBUL_CALL]: 'contextKey',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
      args: ['http.body'],
    });
  });

  test('lazy call with arrow function', () => {
    const result = convertExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => CircularRef' }],
    });

    expect(result).toEqual({ [ZIPBUL_LAZY_REF]: 'CircularRef' });
  });

  test('lazy call with block body', () => {
    const result = convertExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => { return Foo; }' }],
    });

    expect(result).toEqual({ [ZIPBUL_LAZY_REF]: 'Foo' });
  });

  test('lazy call with non-identifier body falls back to ZIPBUL_CALL', () => {
    const result = convertExpression({
      kind: 'call',
      callee: 'lazy',
      arguments: [{ kind: 'function', sourceText: '() => compute(x)' }],
    });

    expect(result).toEqual({
      [ZIPBUL_CALL]: 'lazy',
      [ZIPBUL_IMPORT_SOURCE]: undefined,
      args: [{ [ZIPBUL_FACTORY_CODE]: '() => compute(x)' }],
    });
  });

  test('new expression', () => {
    const result = convertExpression({
      kind: 'new',
      callee: 'MyClass',
      importSource: './my-class',
      arguments: [{ kind: 'string', value: 'arg' }],
    });

    expect(result).toEqual({
      [ZIPBUL_NEW]: 'MyClass',
      args: ['arg'],
    });
  });

  test('object expression', () => {
    const result = convertExpression({
      kind: 'object',
      properties: [
        { kind: 'property', key: { kind: 'string', value: 'name' }, value: { kind: 'string', value: 'test' } },
        { kind: 'property', key: { kind: 'string', value: 'count' }, value: { kind: 'number', value: 5 } },
      ],
    });

    expect(result).toEqual({ name: 'test', count: 5 });
  });

  test('object expression with computed key', () => {
    const result = convertExpression({
      kind: 'object',
      properties: [
        { kind: 'property', key: { kind: 'identifier', name: 'MySymbol' }, value: { kind: 'string', value: 'val' } },
        { kind: 'property', key: { kind: 'string', value: 'normal' }, value: { kind: 'number', value: 1 } },
      ],
    });

    expect(result).toEqual({
      [`${ZIPBUL_COMPUTED_PREFIX}0`]: {
        [ZIPBUL_COMPUTED_KEY]: { [ZIPBUL_REF]: 'MySymbol', [ZIPBUL_IMPORT_SOURCE]: undefined },
        [ZIPBUL_COMPUTED_VALUE]: 'val',
      },
      normal: 1,
    });
  });

  test('array expression', () => {
    const result = convertExpression({
      kind: 'array',
      elements: [
        { kind: 'string', value: 'a' },
        { kind: 'number', value: 1 },
        { kind: 'identifier', name: 'Ref', importSource: './ref' },
      ],
    });

    expect(result).toEqual([
      'a',
      1,
      { [ZIPBUL_REF]: 'Ref', [ZIPBUL_IMPORT_SOURCE]: './ref' },
    ]);
  });

  test('spread expression', () => {
    const result = convertExpression({
      kind: 'spread',
      argument: { kind: 'identifier', name: 'providers', importSource: './bundle' },
    });

    expect(result).toEqual({
      [ZIPBUL_SPREAD]: { [ZIPBUL_REF]: 'providers', [ZIPBUL_IMPORT_SOURCE]: './bundle' },
    });
  });

  test('function expression', () => {
    const result = convertExpression({
      kind: 'function',
      sourceText: '(svc) => svc.create()',
    });

    expect(result).toEqual({ [ZIPBUL_FACTORY_CODE]: '(svc) => svc.create()' });
  });

  test('template expression', () => {
    const result = convertExpression({ kind: 'template', sourceText: '`hello ${name}`' });

    expect(result).toEqual({ [ZIPBUL_UNRESOLVABLE]: true, sourceText: '`hello ${name}`' });
  });

  test('unresolvable expression', () => {
    const result = convertExpression({ kind: 'unresolvable', sourceText: 'complex++' });

    expect(result).toEqual({ [ZIPBUL_UNRESOLVABLE]: true, sourceText: 'complex++' });
  });

  test('nested object with array and identifiers', () => {
    const result = convertExpression({
      kind: 'object',
      properties: [
        { kind: 'property', key: { kind: 'string', value: 'name' }, value: { kind: 'string', value: 'user' } },
        { kind: 'property', key: { kind: 'string', value: 'providers' }, value: {
            kind: 'array',
            elements: [
              { kind: 'identifier', name: 'Svc', importSource: './svc', originalName: 'MyService' },
              { kind: 'spread', argument: { kind: 'identifier', name: 'bundle', importSource: './bundle' } },
            ],
          },
        },
      ],
    });

    expect(result).toEqual({
      name: 'user',
      providers: [
        { [ZIPBUL_REF]: 'MyService', [ZIPBUL_IMPORT_SOURCE]: './svc' },
        { [ZIPBUL_SPREAD]: { [ZIPBUL_REF]: 'bundle', [ZIPBUL_IMPORT_SOURCE]: './bundle' } },
      ],
    });
  });
});

describe('convertDecorator', () => {
  test('decorator without arguments', () => {
    expect(convertDecorator({ name: 'Injectable' })).toEqual({
      name: 'Injectable',
      arguments: [],
    });
  });

  test('decorator with string argument', () => {
    expect(convertDecorator({
      name: 'Get',
      arguments: [{ kind: 'string', value: '/users' }],
    })).toEqual({
      name: 'Get',
      arguments: ['/users'],
    });
  });

  test('decorator with member expression argument', () => {
    expect(convertDecorator({
      name: 'Middleware',
      arguments: [{ kind: 'member', object: 'Phase', property: 'Before', importSource: '@zipbul/http-adapter' }],
    })).toEqual({
      name: 'Middleware',
      arguments: [{ [ZIPBUL_REF]: 'Phase.Before', [ZIPBUL_IMPORT_SOURCE]: '@zipbul/http-adapter' }],
    });
  });
});

describe('resolveTypeString', () => {
  const importMap = new Map([
    ['Svc', { importSource: './my.service', originalName: 'MyService' }],
    ['OtherService', { importSource: '@zipbul/common', originalName: null }],
  ]);

  test('undefined type returns any', () => {
    expect(resolveTypeString(undefined, importMap)).toBe('any');
  });

  test('empty string returns any', () => {
    expect(resolveTypeString('', importMap)).toBe('any');
  });

  test('builtin types pass through', () => {
    expect(resolveTypeString('string', importMap)).toBe('string');
    expect(resolveTypeString('number', importMap)).toBe('number');
    expect(resolveTypeString('boolean', importMap)).toBe('boolean');
    expect(resolveTypeString('void', importMap)).toBe('void');
    expect(resolveTypeString('any', importMap)).toBe('any');
    expect(resolveTypeString('unknown', importMap)).toBe('unknown');
  });

  test('imported type resolves to ZIPBUL_REF with originalName', () => {
    expect(resolveTypeString('Svc', importMap)).toEqual({
      [ZIPBUL_REF]: 'MyService',
      [ZIPBUL_IMPORT_SOURCE]: './my.service',
    });
  });

  test('imported type without alias', () => {
    expect(resolveTypeString('OtherService', importMap)).toEqual({
      [ZIPBUL_REF]: 'OtherService',
      [ZIPBUL_IMPORT_SOURCE]: '@zipbul/common',
    });
  });

  test('array type resolves element', () => {
    expect(resolveTypeString('Svc[]', importMap)).toEqual({
      [ZIPBUL_REF]: 'MyService',
      [ZIPBUL_IMPORT_SOURCE]: './my.service',
    });
  });

  test('Array<T> generic resolves element', () => {
    expect(resolveTypeString('Array<Svc>', importMap)).toEqual({
      [ZIPBUL_REF]: 'MyService',
      [ZIPBUL_IMPORT_SOURCE]: './my.service',
    });
  });

  test('unknown type passes through as string', () => {
    expect(resolveTypeString('SomeLocalType', importMap)).toBe('SomeLocalType');
  });
});

describe('buildImportMap', () => {
  const makeRelation = (overrides: Partial<CodeRelation> & Pick<CodeRelation, 'type' | 'srcSymbolName' | 'dstSymbolName' | 'specifier'>): CodeRelation => ({
    srcFilePath: '/app/src/test.ts',
    dstFilePath: null,
    ...overrides,
  });

  test('builds map from value-level imports', () => {
    const relations: CodeRelation[] = [
      makeRelation({ type: 'imports', srcSymbolName: 'Injectable', dstSymbolName: 'Injectable', specifier: '@zipbul/common' }),
      makeRelation({ type: 'imports', srcSymbolName: 'Svc', dstSymbolName: 'MyService', specifier: './my.service' }),
    ];

    const map = buildImportMap(relations);

    expect(map.get('Injectable')).toEqual({
      importSource: '@zipbul/common',
      originalName: null,
    });
    expect(map.get('Svc')).toEqual({
      importSource: './my.service',
      originalName: 'MyService',
    });
    expect(map.has('MyService')).toBe(false);
  });

  test('skips type-only imports (kind === "type-references")', () => {
    const relations: CodeRelation[] = [
      makeRelation({ type: 'type-references', srcSymbolName: 'MyType', dstSymbolName: 'MyType', specifier: './types' }),
    ];

    const map = buildImportMap(relations);

    expect(map.size).toBe(0);
  });

  test('default import — dst="default" treated as non-aliased', () => {
    const relations: CodeRelation[] = [
      makeRelation({ type: 'imports', srcSymbolName: 'Default', dstSymbolName: 'default', specifier: '@zipbul/core' }),
    ];

    const map = buildImportMap(relations);

    expect(map.get('Default')).toEqual({
      importSource: '@zipbul/core',
      originalName: null,
    });
  });

  test('namespace import — dst="*" treated as non-aliased', () => {
    const relations: CodeRelation[] = [
      makeRelation({ type: 'imports', srcSymbolName: 'NS', dstSymbolName: '*', specifier: '@zipbul/core' }),
    ];

    const map = buildImportMap(relations);

    expect(map.get('NS')).toEqual({
      importSource: '@zipbul/core',
      originalName: null,
    });
  });
});

describe('detectInjectCall', () => {
  test('detects inject with identifier token', () => {
    const result = detectInjectCall(
      {
        kind: 'call',
        callee: 'inject',
        importSource: '@zipbul/common',
        arguments: [{ kind: 'identifier', name: 'MyToken', importSource: './tokens' }],
      },
      'test.ts',
    );

    expect(result).toEqual({
      tokenKind: 'token',
      token: { [ZIPBUL_REF]: 'MyToken', [ZIPBUL_IMPORT_SOURCE]: './tokens' },
      callee: 'inject',
      importSource: '@zipbul/common',
      filePath: 'test.ts',
    });
  });

  test('detects inject with thunk token', () => {
    const result = detectInjectCall(
      {
        kind: 'call',
        callee: 'inject',
        importSource: '@zipbul/common',
        arguments: [{ kind: 'function', sourceText: '() => LazyRef' }],
      },
      'test.ts',
    );

    expect(result).toEqual({
      tokenKind: 'thunk',
      token: { [ZIPBUL_REF]: 'LazyRef', [ZIPBUL_IMPORT_SOURCE]: undefined },
      callee: 'inject',
      importSource: '@zipbul/common',
      filePath: 'test.ts',
    });
  });

  test('returns null for non-inject calls', () => {
    expect(detectInjectCall(
      { kind: 'call', callee: 'something', importSource: '@zipbul/common', arguments: [] },
      'test.ts',
    )).toBeNull();
  });

  test('returns null for inject from wrong package', () => {
    expect(detectInjectCall(
      { kind: 'call', callee: 'inject', importSource: 'other-package', arguments: [] },
      'test.ts',
    )).toBeNull();
  });

  test('returns invalid for inject with wrong argument count', () => {
    const result = detectInjectCall(
      { kind: 'call', callee: 'inject', importSource: '@zipbul/common', arguments: [] },
      'test.ts',
    );

    expect(result?.tokenKind).toBe('invalid');
    expect(result?.token).toBeNull();
  });

  test('detects namespaced inject call', () => {
    const result = detectInjectCall(
      {
        kind: 'call',
        callee: 'common.inject',
        importSource: '@zipbul/common',
        arguments: [{ kind: 'identifier', name: 'Token' }],
      },
      'test.ts',
    );

    expect(result?.tokenKind).toBe('token');
  });
});
