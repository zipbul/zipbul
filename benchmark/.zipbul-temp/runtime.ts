
import { ContextError } from "../../packages/common/src/errors/context.error";
import { ZipbulError } from "../../packages/common/src/errors/errors";
import { Adapter } from "../../packages/core/src/adapter/adapter";
import { AppContext } from "../../packages/core/src/application/application";
import { Application } from "../../packages/core/src/application/application";
import { ApplicationWorker } from "../../packages/core/src/cluster/application-worker";
import { ClusterBaseWorker } from "../../packages/core/src/cluster/cluster-base-worker";
import { ClusterManager } from "../../packages/core/src/cluster/cluster-manager";
import { InvalidStateTransitionError } from "../../packages/core/src/cluster/errors";
import { RpcAbortedError } from "../../packages/core/src/cluster/errors";
import { RpcTimeoutError } from "../../packages/core/src/cluster/errors";
import { WorkerStartupTimeoutError } from "../../packages/core/src/cluster/errors";
import { Container } from "../../packages/core/src/injector/container";
import { Container as Container_1 } from "../../packages/core/src/injector/container";
import { RequestScopeContainer } from "../../packages/core/src/injector/request-scope-container";
import { HttpError } from "../../packages/http-adapter/src/errors/http-error";
import { HttpAdapter } from "../../packages/http-adapter/src/http-adapter";
import { HttpContext } from "../../packages/http-adapter/src/http-context";
import { HttpRequest } from "../../packages/http-adapter/src/http-request";
import { HttpRequest as HttpRequest_1 } from "../../packages/http-adapter/src/http-request";
import { HttpResponse } from "../../packages/http-adapter/src/http-response";
import { HttpResponse as HttpResponse_1 } from "../../packages/http-adapter/src/http-response";
import { HttpServer } from "../../packages/http-adapter/src/http-server";
import { RouteHandler } from "../../packages/http-adapter/src/route-handler";
import { ServerSentEvent } from "../../packages/http-adapter/src/server-sent-event";
import { RequestContext } from "../../packages/logger/src/async-storage";
import { Logger } from "../../packages/logger/src/logger";
import { ConsoleTransport } from "../../packages/logger/src/transports/console";
import { BenchController } from "../src/bench.controller";
import { registerBootstrapState } from "@zipbul/core";

const deepFreeze = (obj: unknown, visited = new WeakSet<object>()): unknown => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (visited.has(obj)) {
    return obj;
  }

  if (!Object.isFrozen(obj)) {
    visited.add(obj);
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      const record = obj as Record<string, unknown>;

      deepFreeze(record[prop], visited);
    });
  }

  return obj;
};

const sealMap = <K, V>(map: Map<K, V>): Map<K, V> => {
  (map as unknown as { set: (...args: unknown[]) => unknown }).set = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  (map as unknown as { delete: (...args: unknown[]) => unknown }).delete = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  (map as unknown as { clear: (...args: unknown[]) => unknown }).clear = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  Object.freeze(map);
  return map;
};

const _meta = (
  className: string,
  decorators: readonly unknown[],
  params: readonly unknown[],
  methods: readonly unknown[],
  props: readonly unknown[],
): {
  className: string;
  decorators: readonly unknown[];
  constructorParams: readonly unknown[];
  methods: readonly unknown[];
  properties: readonly unknown[];
} => ({
  className,
  decorators,
  constructorParams: params,
  methods,
  properties: props
});


import { Container } from "@zipbul/core";
import { runInInjectionContext } from "@zipbul/core";

export function createContainer() {
  const container = new Container();

  return container;
}

export const adapterConfig = deepFreeze({

});

export async function registerDynamicModules(container: { loadDynamicModule: (name: string, module: unknown) => Promise<void> }) {

}



export function createMetadataRegistry() {
  const registry = new Map();
  registry.set(Adapter, _meta(
        'Adapter',
        [],
        [],
        [],
        [{
          name: 'clusterStrategy',
          type: "ClusterStrategy",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'middlewareRegistry',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'resolvedMiddlewareRegistry',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'exceptionFilterDefs',
          type: "ExceptionFilterDefinition",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'guardDefs',
          type: "GuardDefinition",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'resolvedExceptionFilters',
          type: "ResolvedExceptionFilter",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'resolvedGuards',
          type: "ResolvedGuard",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        }]
      ));
  registry.set(AppContext, _meta(
        'AppContext',
        [],
        [{name: "container",type: "ZipbulContainer",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(Application, _meta(
        'Application',
        [],
        [{name: "container",type: Container,typeArgs: undefined,decorators: []},{name: "options",type: "CreateApplicationOptions",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'logger',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'adapters',
          type: "AdapterEntry",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'clusterManagers',
          type: "ClusterManager<TestWorkerRpc>",
          isClass: false,
          typeArgs: ["ClusterManager<TestWorkerRpc>"],
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'startOrder',
          type: "AdapterEntry",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'started',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'stopped',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(ApplicationWorker, _meta(
        'ApplicationWorker',
        [],
        [],
        [],
        []
      ));
  registry.set(BenchController, _meta(
        'BenchController',
        [{name: "RestController",arguments: [""]}],
        [],
        [{
                  name: 'json',
                  decorators: [{name: "Get",arguments: ["/"]}],
                  parameters: []
              }],
        []
      ));
  registry.set(ClusterBaseWorker, _meta(
        'ClusterBaseWorker',
        [],
        [],
        [],
        []
      ));
  registry.set(ClusterManager, _meta(
        'ClusterManager',
        [],
        [{name: "options",type: "ClusterOptions",typeArgs: undefined,decorators: []},{name: "config",type: "ClusterManagerConfig",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'logger',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'reviveControllers',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'destroying',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'replacementInProgress',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'rollingRestartInProgress',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'initialized',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: '__testing__',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(ConsoleTransport, _meta(
        'ConsoleTransport',
        [],
        [{name: "options",type: "LoggerOptions",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(Container, _meta(
        'Container',
        [],
        [{name: "initialFactories",type: "Map<Token, FactoryFn>",typeArgs: ["Token","FactoryFn"],decorators: []}],
        [],
        [{
          name: 'registrations',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'singletons',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'registrationOrder',
          type: "Token",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'constructorParamsCache',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(ContextError, _meta(
        'ContextError',
        [],
        [{name: "message",type: "string",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(HttpAdapter, _meta(
        'HttpAdapter',
        [],
        [{name: "options",type: "HttpServerOptions",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'clusterStrategy',
          type: "ClusterStrategy",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'middlewareRegistry',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'resolvedMiddlewareRegistry',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'exceptionFilterDefs',
          type: "ExceptionFilterDefinition",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'guardDefs',
          type: "GuardDefinition",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'resolvedExceptionFilters',
          type: "ResolvedExceptionFilter",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'resolvedGuards',
          type: "ResolvedGuard",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: true,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'validPhases',
          type: "ReadonlySet",
          isClass: false,
          typeArgs: ["string"],
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'decorators',
          type: "AdapterEntryDecorators",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'logger',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'internalRoutes',
          type: "InternalRouteEntry",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        }]
      ));
  registry.set(HttpContext, _meta(
        'HttpContext',
        [],
        [{name: "_request",type: HttpRequest,typeArgs: undefined,decorators: []},{name: "_response",type: HttpResponse,typeArgs: undefined,decorators: []},{name: "rawRequest",type: "Request",typeArgs: undefined,decorators: []},{name: "_container",type: "ZipbulContainer",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'store',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(HttpError, _meta(
        'HttpError',
        [],
        [{name: "statusCode",type: "StatusCodes",typeArgs: undefined,decorators: []},{name: "message",type: "string",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(HttpRequest, _meta(
        'HttpRequest',
        [],
        [{name: "data",type: "HttpRequestData",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: '_host',
          type: "string | null | undefined",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: '_hostname',
          type: "string | null | undefined",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: '_port',
          type: "number | undefined",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(HttpResponse, _meta(
        'HttpResponse',
        [],
        [{name: "req",type: HttpRequest,typeArgs: undefined,decorators: []},{name: "headers",type: "Headers",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: '_status',
          type: "StatusCodes | 0",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: '_committed',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: '_serialized',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(HttpServer, _meta(
        'HttpServer',
        [],
        [],
        [],
        [{
          name: 'logger',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(InvalidStateTransitionError, _meta(
        'InvalidStateTransitionError',
        [],
        [{name: "workerId",type: "number",typeArgs: undefined,decorators: []},{name: "from",type: "string",typeArgs: undefined,decorators: []},{name: "to",type: "string",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(Logger, _meta(
        'Logger',
        [],
        [{name: "context",type: "string | LogContextTarget",typeArgs: undefined,decorators: []},{name: "metadata",type: "LogMetadataRecord",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'globalOptions',
          type: "LoggerOptions",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'transports',
          type: "Transport",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: true,
          isEnum: undefined,
          items: { typeName: 'Unknown' },
          literals: undefined
        },{
          name: 'scopeStore',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(RequestContext, _meta(
        'RequestContext',
        [],
        [],
        [],
        [{
          name: 'storage',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(RequestScopeContainer, _meta(
        'RequestScopeContainer',
        [],
        [{name: "parent",type: Container,typeArgs: undefined,decorators: []},{name: "contextId",type: "string",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'requestInstances',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(RouteHandler, _meta(
        'RouteHandler',
        [],
        [{name: "metadataRegistry",type: "Map<MetadataRegistryKey, ClassMetadata>",typeArgs: ["MetadataRegistryKey","ClassMetadata"],decorators: []},{name: "decoratorConfig",type: "RouteHandlerDecoratorConfig",typeArgs: undefined,decorators: []},{name: "routerOptions",type: "RouterOptions",typeArgs: undefined,decorators: []}],
        [],
        [{
          name: 'logger',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        },{
          name: 'registeredMethods',
          type: "any",
          isClass: false,
          typeArgs: undefined,
          decorators: [],
          isOptional: false,
          isArray: undefined,
          isEnum: undefined,
          items: undefined,
          literals: undefined
        }]
      ));
  registry.set(RpcAbortedError, _meta(
        'RpcAbortedError',
        [],
        [{name: "reason",type: "string",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(RpcTimeoutError, _meta(
        'RpcTimeoutError',
        [],
        [{name: "method",type: "string",typeArgs: undefined,decorators: []},{name: "timeoutMs",type: "number",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(ServerSentEvent, _meta(
        'ServerSentEvent',
        [],
        [{name: "data",type: "JsonValue | string",typeArgs: undefined,decorators: []},{name: "options",type: "ServerSentEventOptions",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(WorkerStartupTimeoutError, _meta(
        'WorkerStartupTimeoutError',
        [],
        [{name: "workerId",type: "number",typeArgs: undefined,decorators: []},{name: "timeoutMs",type: "number",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  registry.set(ZipbulError, _meta(
        'ZipbulError',
        [],
        [{name: "message",type: "string",typeArgs: undefined,decorators: []}],
        [],
        []
      ));
  
  registry.forEach(v => deepFreeze(v));
  return sealMap(registry);
}


export function createScopedKeysMap() {
  const map = new Map();
  map.set(BenchController, 'src::BenchController');
  return sealMap(map);
}

export const metadataRegistry = createMetadataRegistry();
export const scopedKeysMap = createScopedKeysMap();
export const handlerIndex = [{"id":"HttpAdapter:src/bench.controller.ts#BenchController.json","adapterId":"HttpAdapter","className":"BenchController","ownerModuleName":"src","methodName":"json","handlerDecorator":"Get","handlerDecoratorArgs":["/"],"params":[],"compiledPre":["ResolveRoute","ParseBody"],"compiledPost":["WriteResponse","Serialize"],"controllerKey":"src::BenchController"}] as const;

const __container__ = createContainer();

// Route-level pipeline registrations (middleware/filter/guard container keys)


function createControllerFactories() {
  const factories = new Map();
  factories.set('src::BenchController', () => runInInjectionContext(__container__, () => new BenchController()));
  return factories;
}

const __controllerFactories__ = createControllerFactories();

function resolveControllerInstances() {
  const instances = new Map();
  for (const [key, factory] of __controllerFactories__) {
    instances.set(key, factory());
  }
  return instances;
}

registerBootstrapState({
  container: __container__,
  metadataRegistry,
  scopedKeys: scopedKeysMap,
  isAotRuntime: true,
  adapterConfig,
  handlerIndex,
});

registerBootstrapState({
  controllerInstances: resolveControllerInstances(),
});

