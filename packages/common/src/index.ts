export { err, isErr, safe } from '@zipbul/result';
export type { Result, Err, ResultAsync } from '@zipbul/result';

export { contextKey } from './context-key';
export type { ContextKey } from './context-key';

export { getContext, runInRequestContext } from './request-context';

export { Adapter } from './adapter/adapter';
export type { ResolvedMiddleware, ResolvedGuard, ResolvedExceptionFilter, ResolvedValidationEntry } from './adapter/adapter';
export { defineAdapter } from './adapter/define-adapter';
export { ClusterStrategy } from './adapter/types';
export type {
  AdapterDependsOn,
  DecoratorRef,
  AdapterEntryDecorators,
  AdapterClass,
} from './adapter/types';
export type { CompiledHandlerEntry, CompiledOptionEntry, CompiledValidationEntry } from './adapter/compiled-handler';

export { LogLevel, ZipbulSymbol } from './enums';

export { Context } from './interfaces';
export type {
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
  Validated,
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
export type { MiddlewareHandlerFn, MiddlewareFactory, MiddlewareDefinition } from './define-middleware';
export { defineGuard } from './define-guard';
export type { GuardHandlerFn, GuardFactory, GuardDefinition } from './define-guard';

export { Injectable } from './decorators/class.decorator';
export { Context as ContextDecorator } from './decorators/parameter.decorator';
export { UseMiddlewares } from './decorators/middleware.decorator';
export { UseExceptionFilters } from './decorators/exception.decorator';
export { UseGuards } from './decorators/guard.decorator';
export type { InjectableOptions } from './decorators/interfaces';
export type { InjectableScope, InjectableVisibleTo } from './decorators/types';

export { isClass, isUndefined, isNil, isEmpty, isSymbol, isString, isFunction } from './type-guards';
export { inject, lazy, runInInjectionContext } from './injection-context';

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

export {
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsOptional,
  IsIn,
  Min,
  Max,
  Nested,
  ValidateNested,
} from '@zipbul/baker/decorators';
