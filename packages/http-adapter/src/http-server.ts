import type { Server } from 'bun';

import {
  ExceptionFilter,
  MiddlewareHook,
  Adapter,
  type ZipbulArray,
  type ZipbulContainer,
  type ZipbulRecord,
  type ZipbulValue,
  type ExceptionFilterToken,
  type ProviderToken,
} from '@zipbul/common';
import { Logger, type LogMetadataValue } from '@zipbul/logger';
import { StatusCodes } from 'http-status-codes';

import type {
  HttpServerBootOptions,
  HttpServerOptions,
  HttpWorkerResponse,
} from './interfaces';
import type {
  AdaptiveRequest,
  ClassMetadata,
  MetadataRegistryKey,
  RequestBodyValue,
  RequestQueryMap,
} from './types';

import { HttpContext, HttpContextAdapter } from './adapter';
import { HttpRequest } from './http-request';
import { HttpResponse } from './http-response';
import { HTTP_ERROR_FILTER } from './constants';
import { HttpMethod } from './enums';
import { BakerValidationExceptionFilter } from './baker-validation-exception-filter';
import { RequestHandler } from './request-handler';
import { RouteHandler } from './route-handler';
import { getIps } from './utils';

const isHttpMethod = (value: string): value is HttpMethod => {
  const methods: string[] = Object.values(HttpMethod);

  return methods.includes(value);
};

const normalizeHttpMethod = (value: string): HttpMethod => {
  const normalized = value.toUpperCase();

  return isHttpMethod(normalized) ? normalized : HttpMethod.Get;
};

export class HttpServer {
  private container: ZipbulContainer;
  private routeHandler: RouteHandler;
  private requestHandler: RequestHandler;
  private adapter: Adapter;
  private logger = new Logger(HttpServer.name);

  private options: HttpServerOptions;
  private server: Server<ZipbulValue>;

  async boot(container: ZipbulContainer, options: HttpServerBootOptions, adapter: Adapter): Promise<void> {
    this.container = container;
    this.adapter = adapter;
    this.options = options.options ?? options; // Handle nested options

    this.logger.info('🚀 HttpServer booting...');

    const builtinErrorFilter = new BakerValidationExceptionFilter();

    if (Array.isArray(this.options.errorFilters) && this.options.errorFilters.length > 0) {
      const tokens: readonly ExceptionFilterToken[] = this.options.errorFilters;

      this.container.set(HTTP_ERROR_FILTER, (c: ZipbulContainer) => {
        const resolved: ZipbulValue[] = tokens.map(token => c.get(token));
        const userFilters = resolved.filter((value): value is ExceptionFilter => this.isErrorFilter(value));

        return [builtinErrorFilter, ...userFilters];
      });
    } else {
      this.container.set(HTTP_ERROR_FILTER, () => [builtinErrorFilter]);
    }

    const metadataRegistry = options.metadata ?? new Map<MetadataRegistryKey, ClassMetadata>();
    const scopedKeysMap: Map<ProviderToken, string> = options.scopedKeys ?? new Map<ProviderToken, string>();

    this.routeHandler = new RouteHandler(this.container, metadataRegistry, scopedKeysMap);

    this.routeHandler.register();

    if (Array.isArray(options.internalRoutes) && options.internalRoutes.length > 0) {
      this.routeHandler.registerInternalRoutes(options.internalRoutes);
    }

    this.requestHandler = new RequestHandler(this.container, this.routeHandler, metadataRegistry, this.adapter);

    const serveOptions: Parameters<typeof Bun.serve>[0] = {
      fetch: this.fetch.bind(this),
      reusePort: this.options.reusePort ?? true,
    };

    if (this.options.port !== undefined) {
      serveOptions.port = this.options.port;
    }

    if (this.options.bodyLimit !== undefined) {
      serveOptions.maxRequestBodySize = this.options.bodyLimit;
    }

    this.server = Bun.serve<ZipbulValue>(serveOptions);

    this.logger.info(`✨ Server listening on port ${this.options.port}`);

    await Promise.resolve();
  }

  async fetch(req: Request): Promise<Response> {
    const adaptiveReq: AdaptiveRequest = {
      httpMethod: normalizeHttpMethod(req.method),
      url: req.url,
      headers: req.headers.toJSON(),
      queryParams: {},
      params: {},
      ip: '',
      ips: [],
      isTrustedProxy: this.options.trustProxy ?? false,
    };
    const zipbulReq = new HttpRequest(adaptiveReq);
    const zipbulRes = new HttpResponse(zipbulReq, new Headers());

    try {
      const adapter = new HttpContextAdapter(zipbulReq, zipbulRes);
      const context = new HttpContext(adapter);

      // 1. OnReceive
      const continueOnReceive = await this.adapter.runMiddlewares(MiddlewareHook.OnReceive, context);

      if (!continueOnReceive) {
        return this.toResponse(zipbulRes.end());
      }

      // [parseData] — implicit adapter hook
      const httpMethod = normalizeHttpMethod(req.method);
      let body: RequestBodyValue | undefined = undefined;
      const contentType = req.headers.get('content-type') ?? '';

      if (
        httpMethod !== HttpMethod.Get &&
        httpMethod !== HttpMethod.Delete &&
        httpMethod !== HttpMethod.Head &&
        httpMethod !== HttpMethod.Options
      ) {
        if (contentType.includes('application/json')) {
          try {
            const parsed = await req.json();

            body = this.isJsonValue(parsed) ? parsed : {};
          } catch {
            body = {};
          }
        } else {
          body = await req.text();
        }
      }

      const { ip, ips } = getIps(req, this.server, this.options.trustProxy);
      const urlObj = new URL(req.url, 'http://localhost');
      const path = urlObj.pathname;
      const queryParams: RequestQueryMap = Object.fromEntries(urlObj.searchParams.entries());

      Object.assign(adaptiveReq, {
        body,
        queryParams,
        ip,
        ips,
        query: queryParams,
      });

      zipbulReq.body = body ?? null;
      zipbulReq.query = queryParams;

      // 2. PostParseData
      const continuePostParseData = await this.adapter.runMiddlewares(MiddlewareHook.PostParseData, context);

      if (!continuePostParseData) {
        return this.toResponse(zipbulRes.end());
      }

      // 3. Guards + PreHandle + Handler (delegated to requestHandler)
      const workerRes = await this.requestHandler.handle(zipbulReq, zipbulRes, httpMethod, path, context);

      // [sendResult] — implicit adapter hook
      const response = this.toResponse(workerRes);

      // 4. OnComplete (post-response, errors suppressed)
      try {
        await this.adapter.runMiddlewares(MiddlewareHook.OnComplete, context);
      } catch (error) {
        const logValue: LogMetadataValue =
          error instanceof Error
            ? error
            : typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean'
              ? error
              : typeof error === 'object'
                ? (() => { try { return JSON.stringify(error); } catch { return 'Unknown error (circular)'; } })()
                : 'Unknown error';

        this.logger.error('Error in OnComplete', logValue);
      }

      return response;
    } catch (error) {
      const logValue: LogMetadataValue =
        error instanceof Error
          ? error
          : typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean'
            ? error
            : typeof error === 'object'
              ? (JSON.stringify(error) ?? 'Unknown error')
              : 'Unknown error';

      this.logger.error('Fetch Error', logValue);

      return new Response('Internal server error', {
        status: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }
  }

  private isErrorFilter(value: ZipbulValue | ExceptionFilter | null | undefined): value is ExceptionFilter {
    if (!this.isZipbulRecord(value)) {
      return false;
    }

    return 'catch' in value;
  }

  private isJsonValue(value: ZipbulValue, seen?: Set<object>): value is RequestBodyValue {
    if (value === null) {
      return true;
    }

    const valueType = typeof value;

    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      return true;
    }

    if (typeof value === 'object') {
      const visited = seen ?? new Set<object>();

      if (visited.has(value)) {
        return false;
      }

      visited.add(value);

      if (this.isZipbulArray(value)) {
        for (const entry of value) {
          if (!this.isJsonValue(entry, visited)) {
            return false;
          }
        }

        return true;
      }

      if (this.isZipbulRecord(value)) {
        for (const entry of Object.values(value)) {
          if (!this.isJsonValue(entry, visited)) {
            return false;
          }
        }

        return true;
      }
    }

    return false;
  }

  private isZipbulArray(value: ZipbulValue): value is ZipbulArray {
    return Array.isArray(value);
  }

  private isZipbulRecord(value: ZipbulValue): value is ZipbulRecord {
    return typeof value === 'object' && value !== null;
  }

  private toResponse(workerRes: HttpWorkerResponse): Response {
    const init: ResponseInit = workerRes.init ?? {};
    const status = init.status;

    if (status === 0 || status === undefined) {
      const { status: _status, statusText: _statusText, ...rest } = init;

      return new Response(workerRes.body, rest);
    }

    if (typeof status === 'number' && status !== StatusCodes.SWITCHING_PROTOCOLS && (status < 200 || status > 599)) {
      return new Response(workerRes.body, {
        ...init,
        status: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }

    return new Response(workerRes.body, init);
  }
}
