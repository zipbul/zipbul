import { describe, expect, test } from 'bun:test';
import {
  validateContextDependencies,
  formatViolationMessage,
  type ContextDependencyViolation,
} from './context-dependency-validator';
import type { HandlerIndexEntry, RouteRegistration } from '../interfaces';
import type { MiddlewareProducerInfo } from './middleware-context-types';
import type { ContextOperation } from '../parser/context-operation-extractor';
import { ZIPBUL_REF } from '@zipbul/common';

function makeHandler(
  id: string,
  middlewareKey?: string,
): HandlerIndexEntry {
  const base = {
    id,
    adapterId: 'TestAdapter',
    controllerKey: 'AppModule::Ctrl',
    methodName: 'handle',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: ['/x'],
  };
  if (middlewareKey === undefined) return base as never;
  return {
    ...base,
    mergedPhaseMiddlewareKeys: { BeforeHandle: [middlewareKey] },
  } as never;
}

function makeProducer(name: string, ops: ContextOperation[]): MiddlewareProducerInfo {
  return {
    middlewareName: name,
    sourceFilePath: '/tmp/' + name + '.ts',
    contextOps: ops,
  };
}

function makeRegistration(key: string, refName: string): RouteRegistration {
  return {
    key,
    value: { [ZIPBUL_REF]: refName } as never,
    kind: 'ref',
  };
}

describe('validateContextDependencies', () => {
  test('reports violation when handler uses unproduced key', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: 'SessionKey', start: 100 },
    ];
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, []);

    expect(result).toHaveLength(1);
    expect(result[0]?.keyIdentifier).toBe('SessionKey');
    expect(result[0]?.handlerId).toBe(handler.id);
    expect(result[0]?.start).toBe(100);
    expect(result[0]?.knownProducersForKey).toEqual([]);
  });

  test('passes when producer middleware is registered on the handler chain', () => {
    const mwKey = '__route_mw__:C.h:cls:0';
    const handler = makeHandler('Adapter:f.ts#C.h', mwKey);
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: 'SessionKey', start: 100 },
    ];
    const producer = makeProducer('sessionMiddleware', [
      { kind: 'set', keyIdentifier: 'SessionKey', start: 50 },
    ]);
    const handlerOps = new Map([[handler.id, consumerOps]]);
    const registrations = [makeRegistration(mwKey, 'sessionMiddleware')];

    const result = validateContextDependencies([handler], handlerOps, [producer], registrations);

    expect(result).toEqual([]);
  });

  test('reports violation when producer exists but is NOT on handler chain', () => {
    const handler = makeHandler('Adapter:f.ts#C.h'); // no middleware registered
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: 'SessionKey', start: 100 },
    ];
    const producer = makeProducer('sessionMiddleware', [
      { kind: 'set', keyIdentifier: 'SessionKey', start: 50 },
    ]);
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, [producer], []);

    expect(result).toHaveLength(1);
    expect(result[0]?.knownProducersForKey).toEqual(['sessionMiddleware']);
    expect(result[0]?.registeredMiddlewares).toEqual([]);
  });

  test('only reports use, not get (optional consumer)', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const consumerOps: ContextOperation[] = [
      { kind: 'get', keyIdentifier: 'OptionalKey', start: 100 },
      { kind: 'use', keyIdentifier: 'RequiredKey', start: 110 },
    ];
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, []);

    expect(result).toHaveLength(1);
    expect(result[0]?.keyIdentifier).toBe('RequiredKey');
  });

  test('reports each missing key separately', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: 'KeyA', start: 100 },
      { kind: 'use', keyIdentifier: 'KeyB', start: 110 },
    ];
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, []);

    expect(result).toHaveLength(2);
    expect(result.map((v) => v.keyIdentifier).sort()).toEqual(['KeyA', 'KeyB']);
  });

  test('null keyIdentifier (literal/expression argument) is not validated', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: null, start: 100 },
    ];
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, []);

    expect(result).toEqual([]);
  });

  test('knownProducers list shows registered producer middleware names', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const consumerOps: ContextOperation[] = [
      { kind: 'use', keyIdentifier: 'MissingKey', start: 100 },
    ];
    const producers = [
      makeProducer('mwA', [{ kind: 'set', keyIdentifier: 'KeyA', start: 50 }]),
      makeProducer('mwB', [{ kind: 'set', keyIdentifier: 'KeyB', start: 50 }]),
      makeProducer('mwC', [{ kind: 'use', keyIdentifier: 'SomeKey', start: 50 }]), // consumer-only, not a producer
    ];
    const handlerOps = new Map([[handler.id, consumerOps]]);

    const result = validateContextDependencies([handler], handlerOps, producers);

    expect(result).toHaveLength(1);
    expect(result[0]?.knownProducersForKey).toEqual([]);
  });

  test('multiple handlers — independent validation', () => {
    const mwKey = '__route_mw__:Shared:cls:0';
    const h1 = makeHandler('Adapter:a.ts#A.h', mwKey);
    const h2 = makeHandler('Adapter:b.ts#B.h', mwKey);
    const producer = makeProducer('mw', [
      { kind: 'set', keyIdentifier: 'SharedKey', start: 50 },
    ]);
    const handlerOps = new Map<string, readonly ContextOperation[]>([
      [h1.id, [{ kind: 'use', keyIdentifier: 'SharedKey', start: 100 }]],
      [h2.id, [{ kind: 'use', keyIdentifier: 'OtherKey', start: 100 }]],
    ]);
    const registrations = [makeRegistration(mwKey, 'mw')];

    const result = validateContextDependencies([h1, h2], handlerOps, [producer], registrations);

    expect(result).toHaveLength(1);
    expect(result[0]?.handlerId).toBe(h2.id);
    expect(result[0]?.keyIdentifier).toBe('OtherKey');
  });

  test('handler with no contextOps is skipped', () => {
    const handler = makeHandler('Adapter:f.ts#C.h');
    const handlerOps = new Map<string, readonly ContextOperation[]>();

    const result = validateContextDependencies([handler], handlerOps, []);

    expect(result).toEqual([]);
  });
});

describe('formatViolationMessage', () => {
  test('includes handler ID, key, hint, and known producers', () => {
    const v: ContextDependencyViolation = {
      handlerId: 'Adapter:f.ts#C.h',
      keyIdentifier: 'SessionKey',
      start: 100,
      knownProducersForKey: ['authMiddleware', 'cookieMiddleware'],
      registeredMiddlewares: [],
    };

    const message = formatViolationMessage(v);

    expect(message).toContain('Adapter:f.ts#C.h');
    expect(message).toContain('ctx.use(SessionKey)');
    expect(message).toContain('ctx.set(SessionKey, ...)');
    expect(message).toContain('authMiddleware, cookieMiddleware');
  });

  test('handles empty producer list', () => {
    const v: ContextDependencyViolation = {
      handlerId: 'Adapter:f.ts#C.h',
      keyIdentifier: 'SessionKey',
      start: 100,
      knownProducersForKey: [],
      registeredMiddlewares: [],
    };

    const message = formatViolationMessage(v);

    expect(message).toContain("No middleware in this build produces 'SessionKey'");
  });
});
