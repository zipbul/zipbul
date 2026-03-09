export { err, isErr, safe } from '@zipbul/result';
export type { Result, Err, ResultAsync } from '@zipbul/result';

export { Adapter } from './adapter/adapter';
export { defineAdapter } from './adapter/define-adapter';
export { MiddlewareHook } from './adapter/types';
export type {
  MiddlewareRegistry,
  AdapterDependsOn,
  DecoratorRef,
  AdapterEntryDecorators,
  AdapterClass,
} from './adapter/types';

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
  ExceptionFilterToken,
  ExceptionFilterEntry,
  Module,
  AdapterModuleConfig,
  MiddlewareConfig,
  ExceptionFilterConfig,
  Provider,
} from './interfaces';

export type {
  ZipbulPrimitive,
  ErrorConstructorLike,
  ErrorToken,
  ZipbulArray,
  ZipbulRecord,
  ZipbulConstructorDescriptor,
  ZipbulInstance,
  ZipbulValue,
  ZipbulFunction,
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
export { ExceptionFilter } from './exception-filter';
export { defineMiddleware } from './define-middleware';
export type { MiddlewareHandlerFn, MiddlewareDefinition } from './define-middleware';
export { defineGuard } from './define-guard';
export type { GuardHandlerFn, GuardDefinition } from './define-guard';

export { Injectable } from './decorators/class.decorator';
export { Context as ContextDecorator } from './decorators/parameter.decorator';
export { UseMiddlewares } from './decorators/middleware.decorator';
export { Catch, UseExceptionFilters } from './decorators/exception.decorator';
export { UseGuards } from './decorators/guard.decorator';
export type { InjectableOptions } from './decorators/interfaces';
export type { InjectableScope, InjectableVisibleTo } from './decorators/types';

export { isClass, isUndefined, isNil, isEmpty, isSymbol, isString, isFunction } from './type-guards';
export { inject, lazy, runInInjectionContext } from './injection-context';

export { IS_DEVELOPMENT, IS_TEST, IS_PRODUCTION, CONFIG_SERVICE, ENV_SERVICE } from './constants';

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
