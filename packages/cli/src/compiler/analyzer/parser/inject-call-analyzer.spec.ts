import { describe, expect, it } from 'bun:test';
import { ZIPBUL_IMPORT_SOURCE, ZIPBUL_REF } from '@zipbul/common';

import type { PatternMatch } from '@zipbul/gildash';

import type { InjectCall } from '../parser-models';

import {
  buildInjectCallFromCapture,
  collectFactoryInjectCalls,
  findImportSourceForCallee,
  resolveInjectCallee,
} from './inject-call-analyzer';

interface PatternMatchWithCaptures extends PatternMatch {
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly captures?: Record<string, { text: string }>;
}

function createMatch(overrides: Partial<PatternMatchWithCaptures>): PatternMatchWithCaptures {
  return {
    filePath: '/app/src/test.ts',
    startLine: 1,
    endLine: 1,
    matchedText: 'inject(Token)',
    ...overrides,
  };
}

describe('resolveInjectCallee', () => {
  it('should return callee name when text contains parenthesized args', () => {
    const result = resolveInjectCallee('inject(Foo)');

    expect(result).toBe('inject');
  });

  it('should strip namespace prefix and return method name when callee is namespaced', () => {
    const result = resolveInjectCallee('someModule.inject(Foo)');

    expect(result).toBe('someModule.inject');
  });

  it('should return full text when no parenthesis exists', () => {
    const result = resolveInjectCallee('inject');

    expect(result).toBe('inject');
  });
});

describe('findImportSourceForCallee', () => {
  it('should return import source when callee exists in sources', () => {
    const sources = { inject: '@zipbul/common' };
    const result = findImportSourceForCallee('inject', sources);

    expect(result).toBe('@zipbul/common');
  });

  it('should return import source for namespace prefix when callee has dot notation', () => {
    const sources = { zipbul: '@zipbul/common' };
    const result = findImportSourceForCallee('zipbul.inject', sources);

    expect(result).toBe('@zipbul/common');
  });

  it('should return undefined when callee is not found in empty sources', () => {
    const result = findImportSourceForCallee('inject', {});

    expect(result).toBeUndefined();
  });

  it('should return undefined when callee is not in sources and has no dot', () => {
    const sources = { other: '@zipbul/core' };
    const result = findImportSourceForCallee('inject', sources);

    expect(result).toBeUndefined();
  });

  it('should return undefined when namespace prefix is not in sources', () => {
    const sources = { other: '@zipbul/core' };
    const result = findImportSourceForCallee('zipbul.inject', sources);

    expect(result).toBeUndefined();
  });
});

describe('buildInjectCallFromCapture', () => {
  const defaultCallee = 'inject';
  const defaultImportSource = '@zipbul/common';
  const defaultFilePath = '/app/src/service.ts';
  const defaultImports: Record<string, string> = { TokenA: './tokens' };
  const identityResolve = (name: string): string => name;

  it('should return invalid when capture is undefined', () => {
    const result = buildInjectCallFromCapture(
      undefined,
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('invalid');
    expect(result.token).toBeNull();
    expect(result.callee).toBe(defaultCallee);
    expect(result.importSource).toBe(defaultImportSource);
    expect(result.filePath).toBe(defaultFilePath);
  });

  it('should return invalid when args contain multiple top-level arguments', () => {
    const result = buildInjectCallFromCapture(
      { text: 'TokenA, TokenB' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('invalid');
    expect(result.token).toBeNull();
  });

  it('should return invalid when args text is empty', () => {
    const result = buildInjectCallFromCapture(
      { text: '' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('invalid');
    expect(result.token).toBeNull();
  });

  it('should return invalid when args text is whitespace only', () => {
    const result = buildInjectCallFromCapture(
      { text: '   ' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('invalid');
    expect(result.token).toBeNull();
  });

  it('should return thunk tokenKind when arg is arrow function', () => {
    const result = buildInjectCallFromCapture(
      { text: '() => TokenA' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('thunk');
    expect(result.token).not.toBeNull();

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('TokenA');
    expect(token[ZIPBUL_IMPORT_SOURCE]).toBe('./tokens');
  });

  it('should return thunk tokenKind when arg is function expression', () => {
    const result = buildInjectCallFromCapture(
      { text: 'function() { return TokenA; }' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('thunk');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('TokenA');
  });

  it('should return token tokenKind when arg is bare identifier', () => {
    const result = buildInjectCallFromCapture(
      { text: 'TokenA' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('token');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('TokenA');
    expect(token[ZIPBUL_IMPORT_SOURCE]).toBe('./tokens');
  });

  it('should return token tokenKind when arg is member expression', () => {
    const imports = { ns: '@zipbul/common' };
    const result = buildInjectCallFromCapture(
      { text: 'ns.MyToken' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      imports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('token');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('ns.MyToken');
    expect(token[ZIPBUL_IMPORT_SOURCE]).toBe('@zipbul/common');
  });

  it('should return invalid when arg is unrecognized pattern', () => {
    const result = buildInjectCallFromCapture(
      { text: 'a + b' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('invalid');
    expect(result.token).toBeNull();
  });

  it('should resolve original name for identifier token', () => {
    const aliasResolve = (name: string): string => {
      if (name === 'Alias') {
        return 'OriginalToken';
      }

      return name;
    };
    const imports = { Alias: './tokens' };
    const result = buildInjectCallFromCapture(
      { text: 'Alias' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      imports,
      aliasResolve,
    );

    expect(result.tokenKind).toBe('token');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('OriginalToken');
  });

  it('should resolve original name for thunk reference', () => {
    const aliasResolve = (name: string): string => {
      if (name === 'Alias') {
        return 'OriginalToken';
      }

      return name;
    };
    const imports = { Alias: './tokens' };
    const result = buildInjectCallFromCapture(
      { text: '() => Alias' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      imports,
      aliasResolve,
    );

    expect(result.tokenKind).toBe('thunk');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('OriginalToken');
    expect(token[ZIPBUL_IMPORT_SOURCE]).toBe('./tokens');
  });

  it('should include import source from currentImports for member expression object', () => {
    const imports = { myModule: './my-module' };
    const aliasResolve = (name: string): string => {
      if (name === 'myModule') {
        return 'originalModule';
      }

      return name;
    };
    const result = buildInjectCallFromCapture(
      { text: 'myModule.Token' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      imports,
      aliasResolve,
    );

    expect(result.tokenKind).toBe('token');

    const token = result.token as Record<string, unknown>;

    expect(token[ZIPBUL_REF]).toBe('originalModule.Token');
    expect(token[ZIPBUL_IMPORT_SOURCE]).toBe('./my-module');
  });

  it('should not treat comma inside nested parens as multi-arg', () => {
    const result = buildInjectCallFromCapture(
      { text: '() => TokenA' },
      defaultCallee,
      defaultImportSource,
      defaultFilePath,
      defaultImports,
      identityResolve,
    );

    expect(result.tokenKind).toBe('thunk');
  });
});

describe('collectFactoryInjectCalls', () => {
  const defaultFilePath = '/app/src/factory.ts';
  const defaultImportSources: Record<string, string> = { inject: '@zipbul/common' };
  const defaultImports: Record<string, string> = { TokenA: './tokens' };
  const identityResolve = (name: string): string => name;

  it('should collect inject calls within factory range from @zipbul/common', () => {
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'inject(TokenA)',
        startOffset: 10,
        endOffset: 24,
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      0,
      100,
      defaultFilePath,
      defaultImportSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.tokenKind).toBe('token');
    expect(injectCalls).toHaveLength(1);
    expect(injectCalls[0]?.tokenKind).toBe('token');
  });

  it('should skip matches without byte offsets', () => {
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'inject(TokenA)',
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      0,
      100,
      defaultFilePath,
      defaultImportSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(0);
    expect(injectCalls).toHaveLength(0);
  });

  it('should skip matches outside factory function range', () => {
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'inject(TokenA)',
        startOffset: 200,
        endOffset: 214,
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      0,
      100,
      defaultFilePath,
      defaultImportSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(0);
    expect(injectCalls).toHaveLength(0);
  });

  it('should skip matches from non-@zipbul/common import source', () => {
    const nonZipbulSources = { inject: 'other-lib' };
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'inject(TokenA)',
        startOffset: 10,
        endOffset: 24,
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      0,
      100,
      defaultFilePath,
      nonZipbulSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(0);
    expect(injectCalls).toHaveLength(0);
  });

  it('should skip matches where resolved callee is not inject', () => {
    const sources = { notInject: '@zipbul/common' };
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'notInject(TokenA)',
        startOffset: 10,
        endOffset: 27,
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      0,
      100,
      defaultFilePath,
      sources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(0);
    expect(injectCalls).toHaveLength(0);
  });

  it('should compute relative byte offsets in result', () => {
    const funcStart = 50;
    const matches: PatternMatchWithCaptures[] = [
      createMatch({
        matchedText: 'inject(TokenA)',
        startOffset: 60,
        endOffset: 74,
        captures: { '$$$ARGS': { text: 'TokenA' } },
      }),
    ];
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      matches as PatternMatch[],
      [],
      funcStart,
      200,
      defaultFilePath,
      defaultImportSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.start).toBe(10);
    expect(result[0]?.end).toBe(24);
  });

  it('should return empty array when no matches provided', () => {
    const injectCalls: InjectCall[] = [];
    const result = collectFactoryInjectCalls(
      [],
      [],
      0,
      100,
      defaultFilePath,
      defaultImportSources,
      defaultImports,
      injectCalls,
      identityResolve,
    );

    expect(result).toHaveLength(0);
    expect(injectCalls).toHaveLength(0);
  });
});
