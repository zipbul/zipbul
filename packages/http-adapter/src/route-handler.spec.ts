import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import type { ZipbulContainer, MiddlewareDefinition, ExceptionFilterEntry, GuardDefinition } from '@zipbul/common';

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
  return Object.freeze({ handler: mock(() => undefined) });
}

function createFilterEntry(): ExceptionFilterEntry {
  return Object.freeze({
    filter: { catch: mock(() => ({ __err: true, data: 'filtered' })) },
    catchTypes: [],
  });
}

function createGuardDef(): GuardDefinition {
  return Object.freeze({ handler: mock(() => undefined) });
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

      // Assert
      expect(result).toEqual([mw]);
    });

    it('should skip value that is not a MiddlewareDefinition', () => {
      // Arrange
      const container = createStubContainer({ 'key1': { notHandler: true } });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys(['key1']);

      // Assert
      expect(result).toEqual([]);
    });

    it('should log warning and skip when container.get throws', () => {
      // Arrange
      const container = createStubContainer({});
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys(['missing-key']);

      // Assert
      expect(result).toEqual([]);
    });

    it('should skip null value from container.get', () => {
      // Arrange
      const container = createStubContainer({ 'key1': null });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveMiddlewareKeys(['key1']);

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ── resolveErrorFilterKeys ─────────────────────────────

  describe('resolveErrorFilterKeys', () => {
    it('should return empty array when keys is empty', () => {
      // Arrange
      const handler = createRouteHandler(createStubContainer());

      // Act
      const result = handler.__testing__.resolveErrorFilterKeys([]);

      // Assert
      expect(result).toEqual([]);
    });

    it('should resolve valid ExceptionFilterEntry from container', () => {
      // Arrange
      const entry = createFilterEntry();
      const container = createStubContainer({ 'ef-key': entry });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveErrorFilterKeys(['ef-key']);

      // Assert
      expect(result).toEqual([entry]);
    });

    it('should skip invalid value without filter and catchTypes', () => {
      // Arrange
      const container = createStubContainer({ 'ef-key': { handler: () => {} } });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveErrorFilterKeys(['ef-key']);

      // Assert
      expect(result).toEqual([]);
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

      // Assert
      expect(result).toEqual([guard]);
    });

    it('should skip invalid value without handler function', () => {
      // Arrange
      const container = createStubContainer({ 'gd-key': { notHandler: true } });
      const handler = createRouteHandler(container);

      // Act
      const result = handler.__testing__.resolveGuardKeys(['gd-key']);

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ── Type Guards ────────────────────────────────────────

  describe('isMiddlewareDefinition', () => {
    it('should return true for valid MiddlewareDefinition', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ handler: () => {} })).toBe(true);
    });

    it('should return false when handler property is missing', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ name: 'test' })).toBe(false);
    });

    it('should return false when handler is not a function', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isMiddlewareDefinition({ handler: 'string' })).toBe(false);
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

  describe('isExceptionFilterEntry', () => {
    it('should return true for valid entry with filter and catchTypes', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterEntry({ filter: {}, catchTypes: [] })).toBe(true);
    });

    it('should return false when catchTypes is missing', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterEntry({ filter: {} })).toBe(false);
    });

    it('should return false for null', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isExceptionFilterEntry(null)).toBe(false);
    });
  });

  describe('isGuardDefinition', () => {
    it('should return true for valid GuardDefinition', () => {
      const handler = createRouteHandler();
      expect(handler.__testing__.isGuardDefinition({ handler: () => {} })).toBe(true);
    });

    it('should return false when handler property is missing', () => {
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
        errorFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.middlewares).toEqual([mw]);
    });

    it('should resolve errorFilterKeys into route entry errorFilters', () => {
      // Arrange
      const ef = createFilterEntry();
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
        errorFilterKeys: ['ef-key'],
        guardKeys: [],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.errorFilters).toEqual([ef]);
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
        errorFilterKeys: [],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.guards).toEqual([guard]);
    });

    it('should resolve all three key types simultaneously', () => {
      // Arrange
      const mw = createMiddlewareDef();
      const ef = createFilterEntry();
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
        errorFilterKeys: ['ef-key'],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.middlewares).toEqual([mw]);
      expect(match!.value.errorFilters).toEqual([ef]);
      expect(match!.value.guards).toEqual([guard]);
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
        errorFilterKeys: ['ef-key'],
        guardKeys: ['gd-key'],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.middlewares).toEqual([]);
      expect(match!.value.errorFilters).toEqual([]);
      expect(match!.value.guards).toEqual([]);
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
        errorFilterKeys: [],
        guardKeys: [],
      }], controllerInstances);

      // Assert
      const match = handler.match('GET', '/test');
      expect(match).toBeDefined();
      expect(match!.value.middlewares).toHaveLength(2);
      expect(match!.value.middlewares[0]).toBe(mw);
      expect(match!.value.middlewares[1]).toBe(mw);
    });
  });
});
