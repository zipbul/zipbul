import { describe, it, expect, mock } from 'bun:test';
import type { ZipbulContainer, MiddlewareDefinition, ExceptionFilterDefinition, GuardDefinition } from '@zipbul/common';
import type { MatchRouteResult } from './types';

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() {
      return { debug: mock(), info: mock(), warn: mock(), error: mock() };
    }
  },
}));

const { RouteHandler } = await import('./route-handler');

type RouteHandlerInstance = InstanceType<typeof RouteHandler>;

function createStubContainer(entries: Record<string, unknown> = {}): ZipbulContainer {
  return {
    get: mock((token: string) => {
      if (token in entries) {
        return entries[token];
      }
      throw new Error(`No provider for token: ${token}`);
    }),
    set: mock(),
    has: mock(() => false),
    getInstances: mock(function* () {}),
    keys: mock(function* () {}),
  } as unknown as ZipbulContainer;
}

function createRouteHandler(container?: ZipbulContainer): RouteHandlerInstance {
  return new RouteHandler(
    new Map(),
    { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
    undefined,
    container,
  );
}

function createMiddlewareDef(): MiddlewareDefinition {
  return Object.freeze({ factory: mock(() => mock(() => undefined)) });
}

function createFilterDef(): ExceptionFilterDefinition {
  return Object.freeze({
    factory: mock(() => mock((_error: unknown, _ctx: unknown) => ({ __err: true, data: 'filtered' }))),
    catchTypes: [],
  });
}

function createGuardDef(): GuardDefinition {
  return Object.freeze({ factory: mock(() => mock(() => undefined)) });
}

describe('RouteHandler', () => {
  // ── resolveMiddlewareKeys ──────────────────────────────

  describe('resolveMiddlewareKeys', () => {
    it('should return empty array when keys is empty', () => {
      // Arrange
      const handler = createRouteHandler(createStubContainer());

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when container is undefined', () => {
      // Arrange
      const handler = createRouteHandler(undefined);

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys(['key1']);

      // Assert
      expect(result).toEqual([]);
    });

    it('should resolve valid MiddlewareDefinition from container', () => {
      // Arrange
      const mw = createMiddlewareDef();
      const container = createStubContainer({ '__route_mw__:Ctrl.method:cls:0': mw });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys(['__route_mw__:Ctrl.method:cls:0']);

      // Assert — resolved middleware has handler (factory was called)
      expect(result).toHaveLength(1);
      expect(typeof result[0]!.handler).toBe('function');
    });

    it('should throw when value is not a MiddlewareDefinition', () => {
      // Arrange
      const container = createStubContainer({ 'key1': { notHandler: true } });
      const handler = createRouteHandler(container);

      // Act & Assert
      expect(() => handler.__testing__.resolveMiddlewareKeys(['key1'])).toThrow();
    });

    it('should throw when container.get throws', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);

      // Act & Assert
      expect(() => handler.__testing__.resolveMiddlewareKeys(['missing-key'])).toThrow();
    });

    it('should throw when container.get returns null', () => {
      // Arrange
      const container = createStubContainer({ 'key1': null });
      const handler = createRouteHandler(container);

      // Act & Assert
      expect(() => handler.__testing__.resolveMiddlewareKeys(['key1'])).toThrow();
    });
  });

  // ── resolveExceptionFilterKeys ─────────────────────────────

  describe('resolveExceptionFilterKeys', () => {
    it('should return empty array when keys is empty', () => {
      // Arrange
      const handler = createRouteHandler(createStubContainer());

      // Act
      const result = handler.__testing__.resolveExceptionFilterKeys([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should resolve valid ExceptionFilterDefinition from container', () => {
      // Arrange
      const entry = createFilterDef();
      const container = createStubContainer({ 'ef-key': entry });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveExceptionFilterKeys(['ef-key']);

      // Assert — resolved has handler and catchTypes
      expect(result).toHaveLength(1);
      expect(typeof result[0]!.handler).toBe('function');
      expect(result[0]!.catchTypes).toEqual([]);
    });

    it('should throw when value is not an ExceptionFilterDefinition', () => {
      // Arrange
      const container = createStubContainer({ 'ef-key': { factory: () => {} } });
      const handler = createRouteHandler(container);

      // Act & Assert
      expect(() => handler.__testing__.resolveExceptionFilterKeys(['ef-key'])).toThrow();
    });
  });

  // ── resolveGuardKeys ───────────────────────────────────

  describe('resolveGuardKeys', () => {
    it('should return empty array when keys is empty', () => {
      // Arrange
      const handler = createRouteHandler(createStubContainer());

      // Act
      const result = handler.__testing__.resolveGuardKeys([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should resolve valid GuardDefinition from container', () => {
      // Arrange
      const guard = createGuardDef();
      const container = createStubContainer({ 'gd-key': guard });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveGuardKeys(['gd-key']);

      // Assert — guards resolve to GuardHandlerFn[] (plain functions)
      expect(result).toHaveLength(1);
      expect(typeof result[0]).toBe('function');
    });

    it('should throw when value is not a GuardDefinition', () => {
      // Arrange
      const container = createStubContainer({ 'gd-key': { notHandler: true } });
      const handler = createRouteHandler(container);

      // Act & Assert
      expect(() => handler.__testing__.resolveGuardKeys(['gd-key'])).toThrow();
    });
  });

  // ── Type Guards ────────────────────────────────────────

  describe('isMiddlewareDefinition', () => {
    it('should return true for valid MiddlewareDefinition', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ factory: () => {} })).toBe(true);
    });

    it('should return false when factory property is missing', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ name: 'test' })).toBe(false);
    });

    it('should return false when factory is not a function', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ factory: 'string' })).toBe(false);
    });

    it('should return false for null', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition(null)).toBe(false);
    });

    it('should return true for GuardDefinition due to structural identity', () => {
      // Documents: MiddlewareDefinition and GuardDefinition are structurally identical
      const handler = createRouteHandler();
      const guard = createGuardDef();
      expect(handler.__testing__.isMiddlewareDefinition(guard)).toBe(true);
    });
  });

  describe('isExceptionFilterDefinition', () => {
    it('should return true for valid definition with factory and catchTypes', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterDefinition({ factory: () => {}, catchTypes: [] })).toBe(true);
    });

    it('should return false when catchTypes is missing', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterDefinition({ factory: () => {} })).toBe(false);
    });

    it('should return false for null', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterDefinition(null)).toBe(false);
    });
  });

  describe('isGuardDefinition', () => {
    it('should return true for valid GuardDefinition', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isGuardDefinition({ factory: () => {} })).toBe(true);
    });

    it('should return false when factory property is missing', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isGuardDefinition({ name: 'test' })).toBe(false);
    });

    it('should return false for null', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isGuardDefinition(null)).toBe(false);
    });
  });

  describe('isControllerInstance', () => {
    it('should return true for a plain object', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isControllerInstance({})).toBe(true);
    });

    it('should return false for null', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isControllerInstance(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isControllerInstance(undefined)).toBe(false);
    });

    it('should return false for a primitive', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isControllerInstance(42)).toBe(false);
    });

    it('should return true for an array since arrays are objects', () => {
      // Documents: arrays pass the object check
      const handler = createRouteHandler();
      expect(handler.__testing__.isControllerInstance([])).toBe(true);
    });
  });

  // ── registerFromHandlerIndex pipeline integration ──────

  describe('registerFromHandlerIndex', () => {
    it('should resolve middlewareKeys into route entry middlewares', () => {
      // Arrange
      const mw = createMiddlewareDef();
      const container = createStubContainer({ '__route_mw__:TestCtrl.doSomething:cls:0': mw });
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: ['__route_mw__:TestCtrl.doSomething:cls:0'],
        exceptionFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert — resolved middleware has handler (factory was called)
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.middlewares).toHaveLength(1);
      expect(typeof (match as MatchRouteResult).route.middlewares[0]!.handler).toBe('function');
    });

    it('should resolve exceptionFilterKeys into route entry exceptionFilters', () => {
      // Arrange
      const ef = createFilterDef();
      const container = createStubContainer({ 'ef-key': ef });
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: [],
        exceptionFilterKeys: ['ef-key'],
        guardKeys: [],
      }], controllerInstances);

      // Assert — resolved exception filter has handler and catchTypes
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.exceptionFilters).toHaveLength(1);
      expect(typeof (match as MatchRouteResult).route.exceptionFilters[0]!.handler).toBe('function');
      expect((match as MatchRouteResult).route.exceptionFilters[0]!.catchTypes).toEqual([]);
    });

    it('should resolve guardKeys into route entry guards', () => {
      // Arrange
      const guard = createGuardDef();
      const container = createStubContainer({ 'gd-key': guard });
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: [],
        exceptionFilterKeys: [],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert — guards are resolved to GuardHandlerFn[] (plain functions)
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.guards).toHaveLength(1);
      expect(typeof (match as MatchRouteResult).route.guards[0]).toBe('function');
    });

    it('should resolve all three key types simultaneously', () => {
      // Arrange
      const mw = createMiddlewareDef();
      const ef = createFilterDef();
      const guard = createGuardDef();
      const container = createStubContainer({ 'mw-key': mw, 'ef-key': ef, 'gd-key': guard });
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: ['mw-key'],
        exceptionFilterKeys: ['ef-key'],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert — all resolved from factories
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.middlewares).toHaveLength(1);
      expect((match as MatchRouteResult).route.exceptionFilters).toHaveLength(1);
      expect((match as MatchRouteResult).route.guards).toHaveLength(1);
    });

    it('should produce empty arrays when container is undefined but keys are present', () => {
      // Arrange
      const handler = createRouteHandler(undefined);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: ['mw-key'],
        exceptionFilterKeys: ['ef-key'],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.middlewares).toEqual([]);
      expect((match as MatchRouteResult).route.exceptionFilters).toEqual([]);
      expect((match as MatchRouteResult).route.guards).toEqual([]);
    });

    it('should resolve duplicate keys into duplicated entries', () => {
      // Arrange
      const mw = createMiddlewareDef();
      const container = createStubContainer({ 'mw-key': mw });
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: ['mw-key', 'mw-key'],
        exceptionFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.middlewares).toHaveLength(2);
      expect(typeof (match as MatchRouteResult).route.middlewares[0]!.handler).toBe('function');
      expect(typeof (match as MatchRouteResult).route.middlewares[1]!.handler).toBe('function');
    });

    it('should auto-create HEAD route when GET is registered', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: [],
        exceptionFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert — HEAD route should match the same path as GET
      const headMatch = handler.matchRoute('HEAD', '/test');
      expect(headMatch).toBeDefined();
      expect(headMatch.kind).toBe('matched');
    });

    it('should use same handler for HEAD as GET', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: [],
        exceptionFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert — HEAD route entry should be the same object as GET route entry
      const getMatch = handler.matchRoute('GET', '/test');
      const headMatch = handler.matchRoute('HEAD', '/test');
      expect(getMatch.kind).toBe('matched');
      expect(headMatch.kind).toBe('matched');
      expect((headMatch as MatchRouteResult).route).toBe((getMatch as MatchRouteResult).route);
    });

    it('should NOT auto-create HEAD route for non-GET methods', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { doPost: () => 'created', doPut: () => 'updated', doDelete: () => 'deleted' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([
        {
          id: 'TestAdapter:items#TestCtrl.doPost',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'doPost',
          handlerDecorator: 'Post',
          handlerDecoratorArgs: ['items'],
          params: [],
          middlewareKeys: [],
          exceptionFilterKeys: [],
          guardKeys: [],
        },
        {
          id: 'TestAdapter:items#TestCtrl.doPut',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'doPut',
          handlerDecorator: 'Put',
          handlerDecoratorArgs: ['items'],
          params: [],
          middlewareKeys: [],
          exceptionFilterKeys: [],
          guardKeys: [],
        },
        {
          id: 'TestAdapter:items#TestCtrl.doDelete',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'doDelete',
          handlerDecorator: 'Delete',
          handlerDecoratorArgs: ['items'],
          params: [],
          middlewareKeys: [],
          exceptionFilterKeys: [],
          guardKeys: [],
        },
      ], controllerInstances);

      // Assert — HEAD should not be in the matched routes (only POST, PUT, DELETE are registered)
      const headMatch = handler.matchRoute('HEAD', '/items');
      expect(headMatch.kind).not.toBe('matched');
      // HEAD is not registered, so it should be method-not-allowed (path exists with other methods)
      expect(headMatch.kind).toBe('method-not-allowed');
      if (headMatch.kind === 'method-not-allowed') {
        expect(headMatch.allowedMethods).not.toContain('HEAD');
      }
    });

    it('should add HEAD to registeredMethods when GET is registered', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        middlewareKeys: [],
        exceptionFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert — HEAD should appear in method-not-allowed allowedMethods for a different path
      // We verify HEAD is registered by checking that matchRoute recognizes HEAD on /test
      const headMatch = handler.matchRoute('HEAD', '/test');
      expect(headMatch.kind).toBe('matched');

      // Also verify POST /test returns method-not-allowed with both GET and HEAD in allowedMethods
      const postMatch = handler.matchRoute('POST', '/test');
      expect(postMatch.kind).toBe('method-not-allowed');
      if (postMatch.kind === 'method-not-allowed') {
        expect(postMatch.allowedMethods).toContain('GET');
        expect(postMatch.allowedMethods).toContain('HEAD');
      }
    });

    it('should auto-create HEAD for internal GET routes', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);

      // Act — registerInternalRoutes with a GET route
      handler.registerInternalRoutes([{
        method: 'GET',
        path: '/docs',
        handler: () => '<html>docs</html>',
      }]);

      // Assert — HEAD should also be registered for the internal route
      const headMatch = handler.matchRoute('HEAD', '/docs');
      expect(headMatch).toBeDefined();
      expect(headMatch.kind).toBe('matched');
    });

    it('should set rawBody true when options include RawBody', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { handle: () => 'ok' };
      const controllerInstances = new Map([['Ctrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['rawtest'],
        params: [],
        options: [{ name: 'RawBody', arguments: [] }],
      } as never], controllerInstances);

      // Assert
      const match = handler.matchRoute('POST', '/rawtest');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(true);
    });

    it('should set rawBody false when no options', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { handle: () => 'ok' };
      const controllerInstances = new Map([['Ctrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['noopt'],
        params: [],
      } as never], controllerInstances);

      // Assert
      const match = handler.matchRoute('POST', '/noopt');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(false);
    });

    it('should set rawBody false when options has unrelated decorator', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { handle: () => 'ok' };
      const controllerInstances = new Map([['Ctrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['other'],
        params: [],
        options: [{ name: 'SomeOther', arguments: [] }],
      } as never], controllerInstances);

      // Assert
      const match = handler.matchRoute('POST', '/other');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(false);
    });

    it('should set rawBody true when RawBody is among multiple options', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { handle: () => 'ok' };
      const controllerInstances = new Map([['Ctrl', instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['multi'],
        params: [],
        options: [
          { name: 'SomeOther', arguments: ['val'] },
          { name: 'RawBody', arguments: [] },
        ],
      } as never], controllerInstances);

      // Assert
      const match = handler.matchRoute('POST', '/multi');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(true);
    });

    it('should not crash when entry has no middlewareKeys/exceptionFilterKeys/guardKeys fields', () => {
      // Arrange — simulates CompiledHandlerEntry from compiler that omits optional fields
      const container = createStubContainer({});
      const handler = createRouteHandler(container);
      const instance = { doSomething: () => 'result' };
      const controllerInstances = new Map([['TestCtrl', instance]]);

      // Act — entry without pipeline key fields (undefined, not empty arrays)
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerInstances);

      // Assert — should register route with empty pipeline arrays, no crash
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.middlewares).toEqual([]);
      expect((match as MatchRouteResult).route.exceptionFilters).toEqual([]);
      expect((match as MatchRouteResult).route.guards).toEqual([]);
    });
  });
});
