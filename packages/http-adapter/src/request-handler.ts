import type { ZipbulContainer, ZipbulRecord, ZipbulValue, Context } from '@zipbul/common';

import { ExceptionFilter, ZipbulMiddleware } from '@zipbul/common';
import { Logger, type LogMetadataValue } from '@zipbul/logger';
import { StatusCodes } from 'http-status-codes';

import type { RouteHandler } from './route-handler';
import type {
  ClassMetadata,
  DecoratorMetadata,
  ErrorFilterRunResult,
  ErrorHandlingStageParams,
  MatchCatchArgumentParams,
  MetadataRegistryKey,
  MatchResult,
  ResolveTokenContext,
  ResolveTokenOptions,
  ShouldCatchParams,
  SystemError,
  SystemErrorHandlerLike,
} from './types';

import { ZipbulHttpContext, ZipbulHttpContextAdapter } from './adapter';
import { ZipbulRequest } from './zipbul-request';
import { ZipbulResponse } from './zipbul-response';
import {
  HTTP_AFTER_RESPONSE,
  HTTP_BEFORE_REQUEST,
  HTTP_BEFORE_RESPONSE,
  HTTP_ERROR_FILTER,
  HTTP_SYSTEM_ERROR_HANDLER,
} from './constants';
import { HttpMethod } from './enums';
import { type HttpWorkerResponse, type RouteHandlerEntry } from './interfaces';
import { SystemErrorHandler } from './system-error-handler';

export class RequestHandler {
  private readonly logger = new Logger(RequestHandler.name);
  private globalBeforeRequest: ZipbulMiddleware[] = [];
  private globalBeforeResponse: ZipbulMiddleware[] = [];
  private globalAfterResponse: ZipbulMiddleware[] = [];
  private globalErrorFilters: Array<ExceptionFilter<SystemError>> = [];
  private errorFilterEngineHealthy = true;
  private systemErrorHandler: SystemErrorHandlerLike | undefined;

  constructor(
    private readonly container: ZipbulContainer,
    private readonly routeHandler: RouteHandler,
    private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
  ) {
    this.loadMiddlewares();
  }

  public async handle(
    req: ZipbulRequest,
    res: ZipbulResponse,
    method: HttpMethod,
    path: string,
    context?: ZipbulHttpContext,
  ): Promise<HttpWorkerResponse> {
    const ctx: Context = context ?? new ZipbulHttpContext(new ZipbulHttpContextAdapter(req, res));
    let matchResult: MatchResult | undefined = undefined;
    let systemErrorHandlerCalled = false;
    let errorFiltersCalled = false;
    let processingError: SystemError | undefined = undefined;

    const applyDefaultErrorHandler = (params: ErrorHandlingStageParams): void => {
      const { error, stage, allowBody } = params;
      const statusWasUnset = res.getStatus() === 0;

      if (statusWasUnset) {
        res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
      }

      const bodyWasUnset = res.getBody() === undefined;

      if (allowBody && bodyWasUnset) {
        res.setBody('Internal Server Error');
      }

      if (statusWasUnset || (allowBody && bodyWasUnset)) {
        this.logger.error('DefaultErrorHandler applied', {
          stage,
          statusWasUnset,
          bodyWasUnset: allowBody && bodyWasUnset,
          error: this.toLogMetadata(error),
        });
      }
    };

    const tryRunSystemErrorHandler = async (params: ErrorHandlingStageParams): Promise<void> => {
      const { error, stage, allowBody } = params;

      if (this.systemErrorHandler === undefined) {
        return;
      }

      if (systemErrorHandlerCalled) {
        return;
      }

      systemErrorHandlerCalled = true;

      try {
        await this.systemErrorHandler.handle(error, ctx);
      } catch {
        const handlerError = new Error('SystemErrorHandler failed');

        this.logger.error('SystemErrorHandler failed', {
          stage,
          handlerToken: this.systemErrorHandler.constructor?.name,
          originalError: this.toLogMetadata(error),
          handlerError,
        });

        applyDefaultErrorHandler({ error, stage: `${stage}:systemErrorHandlerFailed`, allowBody });
      }
    };

    try {
      // 1. Global Before Request
      const shouldContinue = await this.runMiddlewares(this.globalBeforeRequest, ctx);

      if (shouldContinue) {
        // 2. Routing
        matchResult = this.routeHandler.match(method, path);

        if (matchResult === undefined) {
          throw new Error(`Route not found: ${method} ${path}`);
        }

        req.params = matchResult.params;

        // 3. Scoped Middlewares (Before Handler) - Pre-calculated
        const scopedMiddlewares = matchResult.entry.middlewares;
        const scopedContinue = await this.runMiddlewares(scopedMiddlewares, ctx);

        if (scopedContinue) {
          this.logger.debug(`Matched Route: ${method}:${path}`);

          // 4. Handler
          const routeEntry = matchResult.entry;
          const handlerArgs = await routeEntry.paramFactory(req, res);
          const result = await routeEntry.handler(...handlerArgs);

          if (result instanceof Response) {
            return {
              body: await result.text(),
              init: { status: result.status, headers: result.headers.toJSON() },
            };
          }

          if (result instanceof ZipbulResponse) {
            return result.end();
          }

          if (result !== undefined) {
            if (typeof result === 'bigint') {
              res.setBody(result.toString());
            } else {
              res.setBody(result);
            }
          }
        }
      }
    } catch (error) {
      const normalizedError = this.normalizeSystemError(
        error instanceof Error || typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean'
          ? error
          : undefined,
      );
      const errorMessage = this.formatSystemError(normalizedError);
      const errorStack = normalizedError instanceof Error ? normalizedError.stack : undefined;

      this.logger.error(`Error during processing: ${errorMessage}`, errorStack);

      processingError = normalizedError;

      let currentError: SystemError = normalizedError;

      if (errorFiltersCalled) {
        this.logger.error('runErrorFilters reentry blocked', {
          stage: 'runErrorFilters:reentryBlocked',
          originalError: this.toLogMetadata(normalizedError),
          currentError: this.toLogMetadata(currentError),
        });
      } else {
        errorFiltersCalled = true;

        try {
          const result = await this.runErrorFilters(normalizedError, ctx, matchResult?.entry);

          currentError = result.currentError;
        } catch {
          const engineError = new Error('ErrorFilter engine failed');

          this.logger.error('ErrorFilter engine failed', {
            stage: 'runErrorFilters:failed',
            originalError: this.toLogMetadata(normalizedError),
            errorFilterEngineError: engineError,
          });

          currentError = engineError;
        }
      }

      processingError = currentError;

      if (res.getStatus() === 0) {
        await tryRunSystemErrorHandler({ error: currentError, stage: 'afterErrorFilters:statusUnset', allowBody: true });
      }

      applyDefaultErrorHandler({ error: currentError, stage: 'afterErrorFilters:default', allowBody: true });
    }

    // 5. Before Response
    try {
      await this.runMiddlewares(this.globalBeforeResponse, ctx);
    } catch {
      const normalizedError = new Error('beforeResponse failed');

      this.logger.error('Error in beforeResponse', normalizedError);

      await tryRunSystemErrorHandler({ error: normalizedError, stage: 'beforeResponse:error', allowBody: false });
      applyDefaultErrorHandler({ error: normalizedError, stage: 'beforeResponse:error', allowBody: false });
    }

    // 6. After Response
    try {
      await this.runMiddlewares(this.globalAfterResponse, ctx);
    } catch {
      const normalizedError = new Error('afterResponse failed');

      this.logger.error('Error in afterResponse', normalizedError);
    }

    if (processingError !== undefined) {
      applyDefaultErrorHandler({ error: processingError, stage: 'processingError:finalize', allowBody: true });
    }

    if (res.isSent()) {
      return res.getWorkerResponse();
    }

    return res.end();
  }

  private async runMiddlewares(middlewares: ZipbulMiddleware[], ctx: Context): Promise<boolean> {
    for (const mw of middlewares) {
      const result = await mw.handle(ctx);

      if (result === false) {
        return false;
      }
    }

    return true;
  }

  private isSystemErrorHandlerLike(value: ReturnType<ZipbulContainer['get']>): value is SystemErrorHandlerLike {
    if (value === null || value === undefined) {
      return false;
    }

    if (!this.isZipbulRecord(value)) {
      return false;
    }

    if (!('handle' in value)) {
      return false;
    }

    const handle = value.handle;

    return typeof handle === 'function';
  }

  private async runErrorFilters(
    error: SystemError,
    ctx: Context,
    entry: RouteHandlerEntry | undefined,
  ): Promise<ErrorFilterRunResult> {
    if (!this.errorFilterEngineHealthy) {
      throw new Error('ErrorFilter engine failed');
    }

    const filters: Array<ExceptionFilter<SystemError>> = [...(entry?.errorFilters ?? []), ...this.globalErrorFilters];
    const originalError = error;
    let currentError: SystemError = error;

    for (const filter of filters) {
      if (!this.shouldCatch({ error: currentError, filter })) {
        continue;
      }

      try {
        await this.invokeErrorFilter(filter, currentError, ctx);
      } catch {
        currentError = new Error('ErrorFilter failed');
      }
    }

    return { originalError, currentError };
  }

  private shouldCatch(params: ShouldCatchParams): boolean {
    const { error, filter } = params;
    const meta = this.findMetadataByName(filter.constructor?.name);
    const catchDec = (meta?.decorators ?? []).find((decorator: DecoratorMetadata) => decorator.name === 'Catch');

    if (!catchDec) {
      return true;
    }

    const args = Array.from(catchDec.arguments ?? []);

    if (args.length === 0) {
      return true;
    }

    for (const arg of args) {
      if (this.matchesCatchArgument({ error, arg })) {
        return true;
      }
    }

    return false;
  }

  private matchesCatchArgument(params: MatchCatchArgumentParams): boolean {
    const { error, arg } = params;
    const errorCause = error instanceof Error ? error.cause : undefined;

    if (arg === String) {
      if (typeof error === 'string') {
        return true;
      }

      if (error instanceof String) {
        return true;
      }

      if (typeof errorCause === 'string') {
        return true;
      }

      if (errorCause instanceof String) {
        return true;
      }

      return false;
    }

    if (arg === Number) {
      if (typeof error === 'number') {
        return true;
      }

      if (error instanceof Number) {
        return true;
      }

      if (typeof errorCause === 'number') {
        return true;
      }

      if (errorCause instanceof Number) {
        return true;
      }

      return false;
    }

    if (arg === Boolean) {
      if (typeof error === 'boolean') {
        return true;
      }

      if (error instanceof Boolean) {
        return true;
      }

      if (typeof errorCause === 'boolean') {
        return true;
      }

      if (errorCause instanceof Boolean) {
        return true;
      }

      return false;
    }

    if (typeof arg === 'string') {
      if (error === arg) {
        return true;
      }

      if (typeof errorCause === 'string') {
        return errorCause === arg;
      }

      if (errorCause instanceof String) {
        return errorCause.valueOf() === arg;
      }

      return false;
    }

    if (typeof arg === 'function') {
      try {
        return error instanceof arg;
      } catch {
        return false;
      }
    }

    return false;
  }

  private normalizeSystemError(error: SystemError | null | undefined): SystemError {
    if (error === null || error === undefined) {
      return new Error('Processing failed');
    }

    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
      return error;
    }

    return new Error('Processing failed');
  }

  private loadMiddlewares() {
    this.globalBeforeRequest = this.resolveMiddlewares(HTTP_BEFORE_REQUEST);
    this.globalBeforeResponse = this.resolveMiddlewares(HTTP_BEFORE_RESPONSE);
    this.globalAfterResponse = this.resolveMiddlewares(HTTP_AFTER_RESPONSE);

    try {
      this.globalErrorFilters = this.resolveErrorFilters(HTTP_ERROR_FILTER, { strict: true });
    } catch {
      this.errorFilterEngineHealthy = false;
      this.globalErrorFilters = [];
    }

    this.systemErrorHandler = this.resolveSystemErrorHandlers(HTTP_SYSTEM_ERROR_HANDLER, { strict: true })[0];
  }

  private resolveMiddlewares(token: string, options?: ResolveTokenOptions): ZipbulMiddleware[] {
    return this.resolveTokenValues(token, options, value => this.isMiddleware(value));
  }

  private resolveErrorFilters(token: string, options?: ResolveTokenOptions): Array<ExceptionFilter<SystemError>> {
    return this.resolveTokenValues(token, options, value => this.isErrorFilter(value));
  }

  private resolveSystemErrorHandlers(token: string, options?: ResolveTokenOptions): SystemErrorHandlerLike[] {
    return this.resolveTokenValues(token, options, value => this.isSystemErrorHandler(value));
  }

  private resolveTokenValues<T extends ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike>(
    token: string,
    options: ResolveTokenOptions | undefined,
    predicate: (value: ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike) => value is T,
  ): T[] {
    const results: T[] = [];
    const strict = options?.strict === true;

    // 1. Direct match (Global/Legacy)
    if (this.container.has(token)) {
      try {
        this.collectValues(results, this.container.get(token), predicate, { strict, token });
      } catch (e) {
        if (strict) {
          throw e;
        }
      }
    }

    // 2. Namespaced match (Module::Token)
    for (const key of this.container.keys()) {
      if (typeof key === 'string' && key.endsWith(`::${token}`)) {
        try {
          this.collectValues(results, this.container.get(key), predicate, { strict, token: key });
        } catch (e) {
          if (strict) {
            throw e;
          }
        }
      }
    }

    return results;
  }

  private collectValues<T extends ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike>(
    results: T[],
    value: ReturnType<ZipbulContainer['get']>,
    predicate: (value: ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike) => value is T,
    options: ResolveTokenContext,
  ): void {
    if (this.isValueArray(value)) {
      for (const entry of value) {
        if (!this.isTokenValue(entry)) {
          if (options.strict) {
            throw new Error(`Invalid provider value for token: ${options.token}`);
          }

          continue;
        }

        if (predicate(entry)) {
          results.push(entry);
        }
      }

      return;
    }

    if (!this.isTokenValue(value)) {
      if (options.strict) {
        throw new Error(`Invalid provider value for token: ${options.token}`);
      }

      return;
    }

    if (predicate(value)) {
      results.push(value);
    }
  }

  private isTokenValue(
    value: ReturnType<ZipbulContainer['get']>,
  ): value is ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike {
    if (value instanceof ZipbulMiddleware || value instanceof ExceptionFilter || value instanceof SystemErrorHandler) {
      return true;
    }

    return this.isSystemErrorHandlerLike(value);
  }

  private isMiddleware(
    value: ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike,
  ): value is ZipbulMiddleware {
    return value instanceof ZipbulMiddleware;
  }

  private isErrorFilter(
    value: ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike,
  ): value is ExceptionFilter<SystemError> {
    return value instanceof ExceptionFilter;
  }

  private isSystemErrorHandler(
    value: ZipbulMiddleware | ExceptionFilter<SystemError> | SystemErrorHandlerLike,
  ): value is SystemErrorHandlerLike {
    if (value instanceof SystemErrorHandler) {
      return true;
    }

    return this.isSystemErrorHandlerLike(value);
  }

  private isValueArray(value: ReturnType<ZipbulContainer['get']>): value is ReadonlyArray<ReturnType<ZipbulContainer['get']>> {
    return Array.isArray(value);
  }

  private formatSystemError(error: SystemError): string {
    if (typeof error === 'string') {
      return error;
    }

    if (typeof error === 'number' || typeof error === 'boolean') {
      return String(error);
    }

    if (error instanceof Error) {
      return error.message;
    }

    const errorName = typeof error.name === 'string' ? error.name : 'UnknownError';
    const errorMessage = typeof error.message === 'string' ? error.message : 'Processing failed';

    return `${errorName}: ${errorMessage}`;
  }

  private findMetadataByName(name: string | undefined): ClassMetadata | undefined {
    if (typeof name !== 'string' || name.length === 0) {
      return undefined;
    }

    for (const meta of this.metadataRegistry.values()) {
      if (meta.className === name) {
        return meta;
      }
    }

    return undefined;
  }

  private async invokeErrorFilter(filter: ExceptionFilter<SystemError>, error: SystemError, ctx: Context): Promise<void> {
    const catchHandler = filter.catch.bind(filter);

    await catchHandler(error, ctx);
  }

  private toLogMetadata(value: SystemError): LogMetadataValue {
    if (value instanceof Error) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    return { error: this.formatSystemError(value) };
  }

  private isZipbulRecord(value: ZipbulValue | null | undefined): value is ZipbulRecord {
    return typeof value === 'object' && value !== null;
  }
}
