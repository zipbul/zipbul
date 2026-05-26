import { describe, it, expect, mock } from 'bun:test';
import type { MatchRouteResult } from './interfaces';

import { loggerMockModule } from '@zipbul/logger/testing';

mock.module('@zipbul/logger', loggerMockModule());

const { RouteHandler } = await import('./route-handler');

type RouteHandlerInstance = InstanceType<typeof RouteHandler>;

function createRouteHandler(): RouteHandlerInstance {
  return new RouteHandler(
    new Map(),
    { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
  );
}

describe('RouteHandler', () => {
  // ── Type Guards ────────────────────────────────────────

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
    it('should register route with empty pipeline when no buildPipeline provided', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.pre).toEqual([]);
      expect((match as MatchRouteResult).route.post).toEqual([]);
      expect((match as MatchRouteResult).route.filters).toEqual([]);
    });

    it('should populate pre/post/filters from buildPipeline callback', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);
      const stubPre = mock();
      const stubPost = mock();
      const stubFilter = { handler: mock(), catchTypes: [] };
      const buildPipeline = mock(() => ({
        pre: [stubPre],
        post: [stubPost],
        filters: [stubFilter],
      }));

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories, buildPipeline as never);

      // Assert
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.pre).toHaveLength(1);
      expect((match as MatchRouteResult).route.post).toHaveLength(1);
      expect((match as MatchRouteResult).route.filters).toHaveLength(1);
    });

    it('should auto-create HEAD route when GET is registered', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories);

      // Assert — HEAD route should match the same path as GET
      const headMatch = handler.matchRoute('HEAD', '/test');
      expect(headMatch).toBeDefined();
      expect(headMatch.kind).toBe('matched');
    });

    it('should use same handler for HEAD as GET', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories);

      // Assert — HEAD route entry should be the same object as GET route entry
      const getMatch = handler.matchRoute('GET', '/test');
      const headMatch = handler.matchRoute('HEAD', '/test');
      expect(getMatch.kind).toBe('matched');
      expect(headMatch.kind).toBe('matched');
      expect((headMatch as MatchRouteResult).route).toBe((getMatch as MatchRouteResult).route);
    });

    it('should NOT auto-create HEAD route for non-GET methods', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { doPost: () => 'created', doPut: () => 'updated', doDelete: () => 'deleted' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

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
        },
        {
          id: 'TestAdapter:items#TestCtrl.doPut',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'doPut',
          handlerDecorator: 'Put',
          handlerDecoratorArgs: ['items'],
          params: [],
        },
        {
          id: 'TestAdapter:items#TestCtrl.doDelete',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'doDelete',
          handlerDecorator: 'Delete',
          handlerDecoratorArgs: ['items'],
          params: [],
        },
      ] as never[], controllerFactories);

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
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories);

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
      const handler = createRouteHandler();

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
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

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
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/rawtest');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(true);
    });

    it('should set rawBody false when no options', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['noopt'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/noopt');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(false);
    });

    it('should set rawBody false when options has unrelated decorator', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

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
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/other');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(false);
    });

    it('should set rawBody true when RawBody is among multiple options', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

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
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/multi');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.rawBody).toBe(true);
    });

    // ── @Sse extraction ──────────────────────────────────

    it('should set sse true when options include Sse', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:sse#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['sse-test'],
        params: [],
        options: [{ name: 'Sse' }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/sse-test');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.sse).toBe(true);
    });

    it('should set sse false when options do not include Sse', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-sse#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['no-sse'],
        params: [],
        options: [{ name: 'SomeOther', arguments: [] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/no-sse');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.sse).toBe(false);
    });

    // ── @BodyLimit extraction ───────────────────────────────

    it('should set bodyLimit when options include BodyLimit', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:bl#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['body-limit'],
        params: [],
        options: [{ name: 'BodyLimit', arguments: [5242880] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/body-limit');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.bodyLimit).toBe(5242880);
    });

    it('should set bodyLimit undefined when options do not include BodyLimit', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-bl#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['no-body-limit'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/no-body-limit');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.bodyLimit).toBeUndefined();
    });

    // ── @Status extraction ──────────────────────────────────

    it('should set status when options include Status', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:st#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['status-test'],
        params: [],
        options: [{ name: 'Status', arguments: [201] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/status-test');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.status).toBe(201);
    });

    it('should set status undefined when options do not include Status', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-st#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Post',
        handlerDecoratorArgs: ['no-status'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('POST', '/no-status');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.status).toBeUndefined();
    });

    // ── @Redirect extraction ────────────────────────────────

    it('should set redirect with url only when Redirect has single argument', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:rd#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['redirect-test'],
        params: [],
        options: [{ name: 'Redirect', arguments: ['/target'] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/redirect-test');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.redirect).toEqual({ url: '/target' });
    });

    it('should set redirect with url and status when Redirect has two arguments', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:rd2#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['redirect-status'],
        params: [],
        options: [{ name: 'Redirect', arguments: ['/target', 301] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/redirect-status');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.redirect).toEqual({ url: '/target', status: 301 });
    });

    it('should set redirect undefined when options do not include Redirect', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-rd#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['no-redirect'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/no-redirect');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.redirect).toBeUndefined();
    });

    // ── @ContentType extraction ─────────────────────────────

    it('should set contentType when options include ContentType', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:ct#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['content-type-test'],
        params: [],
        options: [{ name: 'ContentType', arguments: ['text/csv'] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/content-type-test');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.contentType).toBe('text/csv');
    });

    it('should set contentType undefined when options do not include ContentType', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-ct#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['no-content-type'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/no-content-type');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.contentType).toBeUndefined();
    });

    // ── @Header extraction ──────────────────────────────────

    it('should set headers when options include Header', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:hd#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['header-test'],
        params: [],
        options: [{ name: 'Header', arguments: ['X-Custom', 'value'] }],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/header-test');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.headers).toEqual([['X-Custom', 'value']]);
    });

    it('should collect multiple Header options into headers array', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:mhd#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['multi-header'],
        params: [],
        options: [
          { name: 'Header', arguments: ['X-First', 'one'] },
          { name: 'Header', arguments: ['X-Second', 'two'] },
        ],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/multi-header');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.headers).toEqual([
        ['X-First', 'one'],
        ['X-Second', 'two'],
      ]);
    });

    it('should set headers as empty array when options do not include Header', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:no-hd#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['no-header'],
        params: [],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/no-header');
      expect(match.kind).toBe('matched');
      expect((match as MatchRouteResult).route.headers).toEqual([]);
    });

    // ── Combined decorators ─────────────────────────────────

    it('should populate all decorator fields when multiple options are combined', () => {
      // Arrange
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['Ctrl', () => instance]]);

      // Act
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:combo#Ctrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'Ctrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['combined'],
        params: [],
        options: [
          { name: 'Sse' },
          { name: 'BodyLimit', arguments: [1048576] },
          { name: 'Status', arguments: [202] },
          { name: 'Header', arguments: ['X-Powered-By', 'Zipbul'] },
          { name: 'Header', arguments: ['X-Request-Id', 'abc'] },
        ],
      } as never], controllerFactories);

      // Assert
      const match = handler.matchRoute('GET', '/combined');
      expect(match.kind).toBe('matched');
      const route = (match as MatchRouteResult).route;
      expect(route.sse).toBe(true);
      expect(route.bodyLimit).toBe(1048576);
      expect(route.status).toBe(202);
      expect(route.headers).toEqual([
        ['X-Powered-By', 'Zipbul'],
        ['X-Request-Id', 'abc'],
      ]);
    });

    it('should register route with empty pipeline when entry has no pipeline fields', () => {
      // Arrange — simulates CompiledHandlerEntry from compiler that omits optional fields
      const handler = createRouteHandler();
      const instance = { doSomething: () => 'result' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // Act — entry without pipeline key fields (undefined, not empty arrays)
      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.doSomething',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'doSomething',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories);

      // Assert — should register route with empty pipeline arrays, no crash
      const match = handler.matchRoute('GET', '/test');
      expect(match).toBeDefined();
      expect((match as MatchRouteResult).route.pre).toEqual([]);
      expect((match as MatchRouteResult).route.post).toEqual([]);
      expect((match as MatchRouteResult).route.filters).toEqual([]);
    });
  });

  // ── resolveValidations via registerFromHandlerIndex ─────

  describe('validation resolution via accessor path', () => {
    it('should resolve getBody validation with readInput/writeOutput closures', () => {
      class UserDto {}
      const metatypeRegistry = new Map<new (...args: readonly unknown[]) => unknown, { className: string }>([
        [UserDto, { className: 'UserDto' }],
      ]);
      const handlerWithMeta = new RouteHandler(
        metatypeRegistry as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      let capturedValidations: readonly unknown[] = [];
      const buildPipeline = mock((_entry: unknown, validations: readonly unknown[]) => {
        capturedValidations = validations;
        return { pre: [], post: [], filters: [] };
      });

      handlerWithMeta.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        validations: [{ accessor: ['request', 'getBody'], metatypeKey: 'UserDto' }],
      } as never], controllerFactories, buildPipeline as never);

      expect(capturedValidations).toHaveLength(1);

      const entry = capturedValidations[0] as { accessor: readonly string[]; metatype: unknown; readInput: Function; writeOutput: Function };

      expect(entry.accessor).toEqual(['request', 'getBody']);
      expect(entry.metatype).toBe(UserDto);
      expect(typeof entry.readInput).toBe('function');
      expect(typeof entry.writeOutput).toBe('function');
    });

    it('should resolve getParams validation with readInput/writeOutput closures', () => {
      class ParamsDto {}
      const metatypeRegistry = new Map<new (...args: readonly unknown[]) => unknown, { className: string }>([
        [ParamsDto, { className: 'ParamsDto' }],
      ]);
      const handlerWithMeta = new RouteHandler(
        metatypeRegistry as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      let capturedValidations: readonly unknown[] = [];
      const buildPipeline = mock((_entry: unknown, validations: readonly unknown[]) => {
        capturedValidations = validations;
        return { pre: [], post: [], filters: [] };
      });

      handlerWithMeta.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        validations: [{ accessor: ['request', 'getParams'], metatypeKey: 'ParamsDto' }],
      } as never], controllerFactories, buildPipeline as never);

      expect(capturedValidations).toHaveLength(1);

      const entry = capturedValidations[0] as { accessor: readonly string[]; metatype: unknown };

      expect(entry.accessor).toEqual(['request', 'getParams']);
      expect(entry.metatype).toBe(ParamsDto);
    });

    it('should skip unknown accessor paths silently', () => {
      class SomeDto {}
      const metatypeRegistry = new Map<new (...args: readonly unknown[]) => unknown, { className: string }>([
        [SomeDto, { className: 'SomeDto' }],
      ]);
      const handlerWithMeta = new RouteHandler(
        metatypeRegistry as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      let capturedValidations: readonly unknown[] = [];
      const buildPipeline = mock((_entry: unknown, validations: readonly unknown[]) => {
        capturedValidations = validations;
        return { pre: [], post: [], filters: [] };
      });

      handlerWithMeta.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
        validations: [{ accessor: ['request', 'unknownAccessor'], metatypeKey: 'SomeDto' }],
      } as never], controllerFactories, buildPipeline as never);

      expect(capturedValidations).toEqual([]);
    });

    it('should throw when metatypeKey cannot be resolved', () => {
      const handlerWithMeta = new RouteHandler(
        new Map() as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      expect(() => {
        handlerWithMeta.registerFromHandlerIndex([{
          id: 'TestAdapter:test#TestCtrl.handle',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'handle',
          handlerDecorator: 'Get',
          handlerDecoratorArgs: ['test'],
          params: [],
          validations: [{ accessor: ['request', 'getBody'], metatypeKey: 'UnknownDto' }],
        } as never], controllerFactories);
      }).toThrow(/Cannot resolve DTO class for metatypeKey 'UnknownDto'/);
    });

    it('should return empty validations when entry has no validations field', () => {
      const handler = createRouteHandler();
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      let capturedValidations: readonly unknown[] = [];
      const buildPipeline = mock((_entry: unknown, validations: readonly unknown[]) => {
        capturedValidations = validations;
        return { pre: [], post: [], filters: [] };
      });

      handler.registerFromHandlerIndex([{
        id: 'TestAdapter:test#TestCtrl.handle',
        adapterId: 'TestAdapter',
        controllerKey: 'TestCtrl',
        methodName: 'handle',
        handlerDecorator: 'Get',
        handlerDecoratorArgs: ['test'],
        params: [],
      } as never], controllerFactories, buildPipeline as never);

      expect(capturedValidations).toEqual([]);
    });
  });

  // ── @Method scan validation (boot-time) ────────────────

  describe('method scan', () => {
    it('accepts @Method registration with non-standard token without throwing', () => {
      const handler = new RouteHandler(
        new Map() as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Method'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      expect(() => {
        handler.registerFromHandlerIndex([{
          id: 'TestAdapter:test#TestCtrl.handle',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'handle',
          handlerDecorator: 'Method',
          handlerDecoratorArgs: ['PURGE', '/x'],
          params: [],
        } as never], controllerFactories, mock(() => ({ pre: [], post: [], filters: [] })) as never);
      }).not.toThrow();
    });

    it('should reject @Method registration with empty method token', () => {
      const handler = new RouteHandler(
        new Map() as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Method'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      expect(() => {
        handler.registerFromHandlerIndex([{
          id: 'TestAdapter:test#TestCtrl.handle',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'handle',
          handlerDecorator: 'Method',
          handlerDecoratorArgs: ['', '/x'],
          params: [],
        } as never], controllerFactories);
      }).toThrow(/method token is missing or empty/);
    });

    it('should reject @Method registration with whitespace in method token', () => {
      const handler = new RouteHandler(
        new Map() as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Method'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      expect(() => {
        handler.registerFromHandlerIndex([{
          id: 'TestAdapter:test#TestCtrl.handle',
          adapterId: 'TestAdapter',
          controllerKey: 'TestCtrl',
          methodName: 'handle',
          handlerDecorator: 'Method',
          handlerDecoratorArgs: ['FOO BAR', '/x'],
          params: [],
        } as never], controllerFactories);
      }).toThrow(/not a valid HTTP token/);
    });

    it('should be atomic — no routes registered when one entry is invalid', () => {
      const handler = new RouteHandler(
        new Map() as never,
        { adapterId: 'TestAdapter', controllerDecoratorName: 'Controller', handlerDecoratorNames: ['Get', 'Method'] },
      );
      const instance = { handle: () => 'ok' };
      const controllerFactories = new Map<string, () => unknown>([['TestCtrl', () => instance]]);

      // 2 entries: 첫 번째는 valid GET, 두 번째는 invalid TRACE
      expect(() => {
        handler.registerFromHandlerIndex([
          {
            id: 'TestAdapter:test#TestCtrl.handle',
            adapterId: 'TestAdapter',
            controllerKey: 'TestCtrl',
            methodName: 'handle',
            handlerDecorator: 'Get',
            handlerDecoratorArgs: ['ok'],
            params: [],
          },
          {
            id: 'TestAdapter:test#TestCtrl.handle2',
            adapterId: 'TestAdapter',
            controllerKey: 'TestCtrl',
            methodName: 'handle',
            handlerDecorator: 'Method',
            handlerDecoratorArgs: ['TRACE', '/x'],
            params: [],
          },
        ] as never, controllerFactories, mock(() => ({ pre: [], post: [], filters: [] })) as never);
      }).toThrow(/permanently rejected/);

      // 첫 번째 라우트도 등록되지 않아야 함 (원자성)
      const matchResult = handler.matchRoute('GET', '/ok');
      expect(matchResult.kind).toBe('not-found');
    });

  });
});
