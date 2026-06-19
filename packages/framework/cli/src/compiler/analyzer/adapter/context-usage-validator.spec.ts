import { describe, expect, test } from 'bun:test';
import { validateHandlerContextUsages } from './context-usage-validator';
import type { HandlerIndexEntry, RouteRegistration } from '../interfaces';
import type { ContextUsage } from '../parser/handler-context-usage-extractor';
import type { MiddlewareContextAugment } from './middleware-context-types';
import { ZIPBUL_REF } from '@zipbul/common';

const HID = 'HttpAdapter:src/search/search.controller.ts#SearchController.search';
const MW_KEY = '__route_mw__:SearchController.search:cls:0';

function makeHandler(id: string, middlewareKey?: string): HandlerIndexEntry {
  const base = {
    id,
    adapterId: 'HttpAdapter',
    controllerKey: 'AppModule::SearchController',
    methodName: 'search',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: [],
  };
  if (middlewareKey === undefined) return base as never;
  return { ...base, mergedPhaseMiddlewareKeys: { BeforeValidate: [middlewareKey] } } as never;
}

function makeHandlerWithBinding(id: string, bindingKey: string): HandlerIndexEntry {
  return {
    id,
    adapterId: 'HttpAdapter',
    controllerKey: 'AppModule::SearchController',
    methodName: 'search',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: [],
    middlewareBindings: [{ key: bindingKey, scope: 'controller', order: 0, phase: 'BeforeValidate' }],
  } as never;
}

function makeRegistration(key: string, refName: string): RouteRegistration {
  return { key, value: { [ZIPBUL_REF]: refName } as never, kind: 'ref' };
}

function makeUsage(path: readonly string[]): ContextUsage {
  return { path, isCall: true, dtoIdentifier: null };
}

function makeAugment(middlewareName: string, paths: readonly (readonly string[])[]): MiddlewareContextAugment {
  return {
    middlewareName,
    contextType: 'HttpContext',
    sourceFilePath: `/tmp/${middlewareName}.ts`,
    augments: paths.map(path => ({ path })) as never,
    classImports: new Map(),
  };
}

const getQueryAugment = makeAugment('queryParser', [['request', 'getQuery']]);

describe('validateHandlerContextUsages', () => {
  test('returns no warnings when there are no augments', () => {
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery'])]]]);

    expect(validateHandlerContextUsages([makeHandler(HID)], usages, [])).toEqual([]);
  });

  test('returns no warnings when the augments expose no paths', () => {
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery'])]]]);

    expect(validateHandlerContextUsages([makeHandler(HID)], usages, [makeAugment('queryParser', [])])).toEqual([]);
  });

  test('does NOT warn when the providing middleware is registered (binding key translated to name)', () => {
    // Regression: a handler binding carries a container key (`__route_mw__:...`)
    // while the augment is keyed by the middleware export name. Without the
    // key->name translation via routeRegistrations this always false-positived,
    // warning even for correctly-registered @UseMiddlewares.
    const handler = makeHandler(HID, MW_KEY);
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery', 'SearchQueryDto'])]]]);
    const registrations = [makeRegistration(MW_KEY, 'queryParser')];

    expect(validateHandlerContextUsages([handler], usages, [getQueryAugment], registrations)).toEqual([]);
  });

  test('translates middlewareBindings keys too, not only mergedPhaseMiddlewareKeys', () => {
    const handler = makeHandlerWithBinding(HID, MW_KEY);
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery'])]]]);
    const registrations = [makeRegistration(MW_KEY, 'queryParser')];

    expect(validateHandlerContextUsages([handler], usages, [getQueryAugment], registrations)).toEqual([]);
  });

  test('warns when getQuery is used but no middleware is registered', () => {
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery', 'SearchQueryDto'])]]]);

    const result = validateHandlerContextUsages([makeHandler(HID)], usages, [getQueryAugment]);

    expect(result).toHaveLength(1);
    expect(result[0]?.handlerId).toBe(HID);
    expect(result[0]?.providedByMiddleware).toBe('queryParser');
    expect(result[0]?.usagePath).toEqual(['request', 'getQuery', 'SearchQueryDto']);
  });

  test('warns when the registered binding maps to a different middleware', () => {
    const handler = makeHandler(HID, MW_KEY);
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery'])]]]);
    const registrations = [makeRegistration(MW_KEY, 'someOtherMiddleware')];

    const result = validateHandlerContextUsages([handler], usages, [getQueryAugment], registrations);

    expect(result).toHaveLength(1);
    expect(result[0]?.providedByMiddleware).toBe('queryParser');
  });

  test('warns when the binding key cannot be resolved to a name (no registration)', () => {
    const handler = makeHandler(HID, MW_KEY);
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery'])]]]);

    // No registrations -> key cannot translate to a name -> treated as unregistered.
    const result = validateHandlerContextUsages([handler], usages, [getQueryAugment], []);

    expect(result).toHaveLength(1);
    expect(result[0]?.providedByMiddleware).toBe('queryParser');
  });

  test('does not warn when the usage path matches no known augment (built-in property)', () => {
    const usages = new Map([[HID, [makeUsage(['request', 'headers'])]]]);

    expect(validateHandlerContextUsages([makeHandler(HID)], usages, [getQueryAugment])).toEqual([]);
  });

  test('matches the longest augment prefix for a deeper usage path', () => {
    const usages = new Map([[HID, [makeUsage(['request', 'getQuery', 'deep', 'nested'])]]]);

    const result = validateHandlerContextUsages([makeHandler(HID)], usages, [getQueryAugment]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providedByMiddleware).toBe('queryParser');
  });

  test('skips handlers that have no recorded context usages', () => {
    const usages = new Map<string, readonly ContextUsage[]>();

    expect(validateHandlerContextUsages([makeHandler(HID)], usages, [getQueryAugment])).toEqual([]);
  });
});
