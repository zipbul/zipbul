import { name as __pkgName, version as __pkgVersion } from '../package.json' with { type: 'json' };

export { contextKey } from './context-key';
export type { ContextKey } from './context-key';

export { defineAdapter } from './adapter/define-adapter';
export type { DefineAdapterConfig } from './adapter/define-adapter';
export { ClusterStrategy } from './adapter/types';
export type {
  Adapter,
  AdapterDependsOn,
  DecoratorRef,
  AdapterEntryDecorators,
  AdapterClass,
} from './adapter/types';
export type {
  CompiledHandlerEntry,
  CompiledMiddlewareBindingEntry,
  CompiledOptionEntry,
  CompiledPipelineBindingEntry,
  CompiledPipelineScope,
  CompiledValidationEntry,
  CompiledPhaseMiddlewareKeys,
} from './adapter/compiled-handler';

export { LogLevel, ZipbulSymbol } from './enums';

export type {
  Context,
  ApplicationContext,
  AdapterContext,
  ProviderToken,
  ProviderScope,
  ProviderBase,
  ProviderUseValue,
  ProviderUseClass,
  ProviderUseExisting,
  ProviderUseFactory,
  OnInit,
  BeforeStart,
  OnStart,
  OnShutdown,
  OnDestroy,
  AdapterGroup,
  AdapterCollection,
  Configurer,
  ApplicationOptions,
  ConfigService,
  EnvService,
  EnvSource,
  ZipbulFactory,
  ProviderRegistrationOptions,
  ProviderVisibleTo,
  ZipbulContainer,
  Module,
  AdapterModuleConfig,
  MiddlewareConfig,
  Provider,
} from './interfaces';

export type {
  ZipbulPrimitive,
  ZipbulArray,
  ZipbulRecord,
  ZipbulConstructorDescriptor,
  ZipbulInstance,
  ZipbulValue,
  ZipbulFunction,
  ProviderFactoryFn,
  Class,
  ClassToken,
  ClassProperties,
  MethodParams,
  MethodReturn,
  MethodTailParams,
  MethodSecondParam,
  SyncFunction,
  PrimitiveValue,
  PrimitiveArray,
  PrimitiveRecord,
  Callable,
  Constructor,
  ValueLike,
  LazyRefFactory,
  DecoratorTarget,
  ModuleMarker,
  ModuleMarkers,
} from './types';

export { ZipbulError } from './errors/errors';

export { ContextError } from './errors/context.error';
export { defineExceptionFilter } from './define-exception-filter';
export type {
  ExceptionFilterDefinition,
  ExceptionFilterFactory,
  ExceptionFilterHandlerFn,
  ExceptionConstructorLike,
} from './define-exception-filter';
export { defineMiddleware } from './define-middleware';
export type { MiddlewareHandlerFn, MiddlewareFactory, MiddlewareDefinition, DefineMiddlewareConfig } from './define-middleware';
export { defineGuard } from './define-guard';
export type { GuardHandlerFn, GuardFactory, GuardDefinition } from './define-guard';

export { Injectable } from './decorators/class.decorator';
export { UseMiddlewares } from './decorators/middleware.decorator';
export { UseExceptionFilters } from './decorators/exception.decorator';
export { UseGuards } from './decorators/guard.decorator';
export type { InjectableOptions } from './decorators/interfaces';
export type { InjectableScope, InjectableVisibleTo } from './decorators/types';

export { isClass, isUndefined, isNil, isEmpty, isSymbol, isString, isFunction } from './type-guards';

export {
  IS_DEVELOPMENT, IS_TEST, IS_PRODUCTION, CONFIG_SERVICE, ENV_SERVICE,
  ZIPBUL_REF, ZIPBUL_LAZY_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE, ZIPBUL_SPREAD, ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE,
  ZIPBUL_UNRESOLVABLE,
  SCOPED_KEY_SEPARATOR,
  FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE, FRAMEWORK_DEFINE_ADAPTER,
  TS_UTILITY_TYPES,
  VISIBILITY_ALL, VISIBILITY_MODULE, VISIBILITY_ALLOWLIST,
  SCOPE_SINGLETON, SCOPE_REQUEST, SCOPE_TRANSIENT,
} from './constants';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
