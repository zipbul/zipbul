import { describe, expect, test } from 'bun:test';

import type { AdapterStaticSchema, HandlerIndexEntry, RouteRegistration } from '../interfaces';
import type { MiddlewareContextAugment } from './middleware-context-types';

import { ZIPBUL_REF, ZIPBUL_CALL, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';
import { DiagnosticError } from '../../../diagnostics';
import {
  buildAugmentAccessorRegistries,
  validateAccessorPhaseRules,
  formatAccessorPhaseViolation,
} from './augment-registry-builder';

function handlerEntry(overrides: Partial<HandlerIndexEntry>): HandlerIndexEntry {
  return {
    id: 'HttpAdapter:src/a.ts#C.m',
    adapterId: 'HttpAdapter',
    className: 'C',
    methodName: 'm',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: [],
    params: [],
    ...overrides,
  };
}

function refRegistration(key: string, refName: string): RouteRegistration {
  return { key, value: { [ZIPBUL_REF]: refName, [ZIPBUL_IMPORT_SOURCE]: '@pkg/x' }, kind: 'ref' };
}

function callRegistration(key: string, callee: string): RouteRegistration {
  return { key, value: { [ZIPBUL_CALL]: callee, [ZIPBUL_IMPORT_SOURCE]: '@pkg/x', args: [] }, kind: 'call' };
}

function accessorAugment(middlewareName: string, ns: string, prop: string, packageName?: string): MiddlewareContextAugment {
  return {
    middlewareName,
    contextType: 'HttpContext',
    sourceFilePath: packageName ?? '/src/mw.ts',
    ...(packageName !== undefined ? { packageName } : {}),
    augments: [{ path: [ns, prop] }],
    classImports: new Map(),
  };
}

describe('buildAugmentAccessorRegistries', () => {
  test('collects accessors reachable via route-scoped call registrations', () => {
    const registries = buildAugmentAccessorRegistries({
      handlerIndex: [handlerEntry({
        mergedPhaseMiddlewareKeys: { OnReceive: ['__route_mw__:C.m:mtd:0'] },
      })],
      routeRegistrations: [callRegistration('__route_mw__:C.m:mtd:0', 'queryParser')],
      augments: [accessorAugment('queryParser', 'request', 'getQuery', '@zipbul/query-parser')],
    });

    expect(registries.get('HttpAdapter')).toEqual([
      { namespace: 'request', prop: 'getQuery', kind: 'validated-accessor', package: '@zipbul/query-parser' },
    ]);
  });

  test('collects accessors from global bindings riding the handler entry', () => {
    const registries = buildAugmentAccessorRegistries({
      handlerIndex: [handlerEntry({
        mergedPhaseMiddlewareKeys: { OnReceive: ['__global_mw__:App:HttpAdapter:OnReceive:0'] },
      })],
      routeRegistrations: [refRegistration('__global_mw__:App:HttpAdapter:OnReceive:0', 'cookieParser')],
      augments: [{
        middlewareName: 'cookieParser',
        contextType: 'HttpContext',
        sourceFilePath: '/src/cookie.ts',
        augments: [{ path: ['request', 'cookie'] }],
        classImports: new Map(),
      }],
    });

    expect(registries.get('HttpAdapter')).toEqual([
      { namespace: 'request', prop: 'cookie', kind: 'validated-accessor' },
    ]);
  });

  test('identical tuples from the same middleware merge idempotently across handlers', () => {
    const registries = buildAugmentAccessorRegistries({
      handlerIndex: [
        handlerEntry({ id: 'HttpAdapter:a#C.m1', mergedPhaseMiddlewareKeys: { OnReceive: ['k1'] } }),
        handlerEntry({ id: 'HttpAdapter:a#C.m2', mergedPhaseMiddlewareKeys: { OnReceive: ['k2'] } }),
      ],
      routeRegistrations: [callRegistration('k1', 'queryParser'), callRegistration('k2', 'queryParser')],
      augments: [accessorAugment('queryParser', 'request', 'getQuery')],
    });

    expect(registries.get('HttpAdapter')).toHaveLength(1);
  });

  test('same (namespace, prop) from two different middlewares is a hard error', () => {
    expect(() => buildAugmentAccessorRegistries({
      handlerIndex: [handlerEntry({
        mergedPhaseMiddlewareKeys: { OnReceive: ['k1', 'k2'] },
      })],
      routeRegistrations: [callRegistration('k1', 'queryParserA'), callRegistration('k2', 'queryParserB')],
      augments: [
        accessorAugment('queryParserA', 'request', 'getQuery'),
        accessorAugment('queryParserB', 'request', 'getQuery'),
      ],
    })).toThrow(DiagnosticError);
  });

  test('middleware without declarative augments contributes nothing', () => {
    const registries = buildAugmentAccessorRegistries({
      handlerIndex: [handlerEntry({ mergedPhaseMiddlewareKeys: { OnReceive: ['k1'] } })],
      routeRegistrations: [refRegistration('k1', 'plainMiddleware')],
      augments: [],
    });

    expect(registries.size).toBe(0);
  });
});

describe('validateAccessorPhaseRules', () => {
  const HTTP_SCHEMA: AdapterStaticSchema = {
    entryDecorators: { controller: 'Controller', handlers: ['Get'] },
    validPhases: new Set(['OnReceive', 'BeforeResponse']),
    pipeline: ['OnReceive', 'Guard', 'Validation', 'Handler', 'BeforeResponse'],
  };

  test('accessor middleware before Validation passes', () => {
    const violations = validateAccessorPhaseRules({
      handlerIndex: [handlerEntry({ mergedPhaseMiddlewareKeys: { OnReceive: ['k1'] } })],
      routeRegistrations: [callRegistration('k1', 'queryParser')],
      adapterStaticSchemas: { HttpAdapter: HTTP_SCHEMA },
      augments: [accessorAugment('queryParser', 'request', 'getQuery')],
    });

    expect(violations).toHaveLength(0);
  });

  test('accessor middleware at a phase after Validation is a violation', () => {
    const violations = validateAccessorPhaseRules({
      handlerIndex: [handlerEntry({ mergedPhaseMiddlewareKeys: { BeforeResponse: ['k1'] } })],
      routeRegistrations: [callRegistration('k1', 'queryParser')],
      adapterStaticSchemas: { HttpAdapter: HTTP_SCHEMA },
      augments: [accessorAugment('queryParser', 'request', 'getQuery')],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]!.middlewareName).toBe('queryParser');
    expect(violations[0]!.phase).toBe('BeforeResponse');
    expect(formatAccessorPhaseViolation(violations[0]!)).toContain('Validation step');
  });

  test('adapters without a Validation step skip the rule', () => {
    const violations = validateAccessorPhaseRules({
      handlerIndex: [handlerEntry({ mergedPhaseMiddlewareKeys: { BeforeResponse: ['k1'] } })],
      routeRegistrations: [callRegistration('k1', 'queryParser')],
      adapterStaticSchemas: {
        HttpAdapter: {
          entryDecorators: { controller: 'Controller', handlers: ['Get'] },
          pipeline: ['OnReceive', 'Handler', 'BeforeResponse'],
        },
      },
      augments: [accessorAugment('queryParser', 'request', 'getQuery')],
    });

    expect(violations).toHaveLength(0);
  });
});
