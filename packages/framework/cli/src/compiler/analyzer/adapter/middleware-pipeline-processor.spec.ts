import { describe, expect, test } from 'bun:test';

import type { FileAnalysis } from '../graph/interfaces';
import type { ClassMetadata, RouteRegistration } from '../interfaces';
import type { AnalyzerValueRecord } from '../types';

import { ZIPBUL_REF, ZIPBUL_CALL, ZIPBUL_IMPORT_SOURCE, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';
import { DiagnosticError } from '../../../diagnostics';
import { toRecord } from '../type-guards';
import {
  extractMiddlewaresDecoratorRefKeys,
  extractGlobalPipelineBindings,
  ZIPBUL_MEMBER_KEY,
} from './middleware-pipeline-processor';

const MW_SOURCE = '/app/node_modules/@zipbul/query-parser/dist/index.ts';

function makeClass(_decoratorArgs: readonly unknown[], imports: Record<string, string> = {}): ClassMetadata {
  return {
    className: 'SearchController',
    decorators: [],
    methods: [],
    properties: [],
    imports,
  };
}

function makeMethod(decoratorArgs: readonly unknown[]): { decorators: { name: string; arguments: readonly never[] }[] } {
  return {
    decorators: [{ name: 'UseMiddlewares', arguments: decoratorArgs as never[] }],
  };
}

function extract(params: {
  decoratorArgs: readonly unknown[];
  imports?: Record<string, string>;
  localValues?: AnalyzerValueRecord;
}): { keys: string[]; registrations: RouteRegistration[] } {
  const registrations: RouteRegistration[] = [];
  const result = extractMiddlewaresDecoratorRefKeys(
    makeClass(params.decoratorArgs, params.imports ?? {}),
    makeMethod(params.decoratorArgs) as never,
    '__route_mw__:SearchController.search',
    registrations,
    0,
    params.localValues,
    '/app/src/search.controller.ts',
  );

  return { keys: result.keys, registrations };
}

describe('extractMiddlewaresDecoratorRefKeys — call-form resolution', () => {
  test('direct ref registrations keep kind ref', () => {
    const { registrations } = extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_REF]: 'corsMiddleware', [ZIPBUL_IMPORT_SOURCE]: '@zipbul/cors' }]],
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('ref');
  });

  test('factory call registrations resolve with kind call (positional form)', () => {
    const { registrations } = extract({
      decoratorArgs: ['OnReceive', [{
        [ZIPBUL_CALL]: 'queryParser',
        [ZIPBUL_IMPORT_SOURCE]: '@zipbul/query-parser',
        args: [{ depth: 3 }],
      }]],
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('call');

    const record = toRecord(registrations[0]!.value)!;

    expect(record[ZIPBUL_CALL]).toBe('queryParser');
  });

  test('factory call registrations resolve in the object-map form', () => {
    const { registrations } = extract({
      decoratorArgs: [{
        OnReceive: [{
          [ZIPBUL_CALL]: 'queryParser',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/query-parser',
          args: [],
        }],
      }],
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('call');
  });

  test('call without import source resolves through class imports', () => {
    const { registrations } = extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_CALL]: 'queryParser', args: [] }]],
      imports: { queryParser: '@zipbul/query-parser' },
    });

    expect(registrations[0]!.kind).toBe('call');

    const record = toRecord(registrations[0]!.value)!;

    expect(record[ZIPBUL_IMPORT_SOURCE]).toBe('@zipbul/query-parser');
  });

  test('const-local member registration resolves via same-file localValues', () => {
    const { registrations } = extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_REF]: 'cookies.onRequest' }]],
      localValues: {
        cookies: {
          [ZIPBUL_CALL]: 'cookieMiddleware',
          [ZIPBUL_IMPORT_SOURCE]: '@zipbul/cookie',
          args: [],
        },
      },
    });

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('call');

    const record = toRecord(registrations[0]!.value)!;

    expect(record[ZIPBUL_CALL]).toBe('cookieMiddleware');
    expect(record[ZIPBUL_MEMBER_KEY]).toBe('onRequest');
  });

  test('member registration without a resolvable local is a diagnostic error', () => {
    expect(() => extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_REF]: 'cookies.onRequest' }]],
    })).toThrow(DiagnosticError);
  });

  test('unresolvable expressions are a diagnostic error instead of silent drop', () => {
    expect(() => extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_UNRESOLVABLE]: true, sourceText: 'maybe ? a : b' }]],
    })).toThrow(DiagnosticError);
  });

  test('call whose callee cannot be resolved to an import is a diagnostic error', () => {
    expect(() => extract({
      decoratorArgs: ['OnReceive', [{ [ZIPBUL_CALL]: 'localFactory', args: [] }]],
    })).toThrow(DiagnosticError);
  });
});

describe('extractGlobalPipelineBindings — call-form resolution', () => {
  function makeAnalysis(middlewares: AnalyzerValueRecord, localValues?: AnalyzerValueRecord): FileAnalysis {
    return {
      filePath: '/app/src/app/__module__.ts',
      classes: [],
      reExports: [],
      exports: [],
      ...(localValues !== undefined ? { localValues } : {}),
      moduleDefinition: {
        name: 'AppModule',
        providers: [],
        imports: {},
        adapters: [{
          adapter: { [ZIPBUL_REF]: 'HttpAdapter' },
          middlewares,
        }],
      },
    };
  }

  test('global factory-call registration is analysis-visible with kind call', () => {
    const registrations: RouteRegistration[] = [];
    const fileMap = new Map<string, FileAnalysis>([[
      '/app/src/app/__module__.ts',
      makeAnalysis({
        OnReceive: [{
          [ZIPBUL_CALL]: 'queryParser',
          [ZIPBUL_IMPORT_SOURCE]: MW_SOURCE,
          args: [],
        }],
      }),
    ]]);

    const result = extractGlobalPipelineBindings(fileMap, 'HttpAdapter', registrations);

    expect(result.middlewareBindings).toHaveLength(1);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('call');
  });

  test('global const-local member registration resolves via localValues', () => {
    const registrations: RouteRegistration[] = [];
    const fileMap = new Map<string, FileAnalysis>([[
      '/app/src/app/__module__.ts',
      makeAnalysis(
        { OnReceive: [{ [ZIPBUL_REF]: 'cookies.onRequest' }] },
        { cookies: { [ZIPBUL_CALL]: 'cookieMiddleware', [ZIPBUL_IMPORT_SOURCE]: '@zipbul/cookie', args: [] } },
      ),
    ]]);

    const result = extractGlobalPipelineBindings(fileMap, 'HttpAdapter', registrations);

    expect(result.middlewareBindings).toHaveLength(1);

    const record = toRecord(registrations[0]!.value)!;

    expect(record[ZIPBUL_MEMBER_KEY]).toBe('onRequest');
  });

  test('unresolvable global middleware entry is a diagnostic error', () => {
    const fileMap = new Map<string, FileAnalysis>([[
      '/app/src/app/__module__.ts',
      makeAnalysis({ OnReceive: [{ [ZIPBUL_UNRESOLVABLE]: true, sourceText: 'wrap(mw)' }] }),
    ]]);

    expect(() => extractGlobalPipelineBindings(fileMap, 'HttpAdapter', [])).toThrow(DiagnosticError);
  });
});
