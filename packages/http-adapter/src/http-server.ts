import type { Server } from 'bun';

import type {
  ZipbulContainer,
  ZipbulValue,
  ProviderToken,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { StatusCodes } from 'http-status-codes';

import type {
  HttpServerBootOptions,
  HttpServerOptions,
  HttpWorkerResponse,
} from './interfaces';
import type {
  ClassMetadata,
  MetadataRegistryKey,
} from './types';

import { HttpContext, HttpContextAdapter } from './adapter';
import { HttpRequest } from './http-request';
import { HttpResponse } from './http-response';
import { HttpMethod } from './enums';
import { RouteHandler } from './route-handler';
import { getIps } from './utils';
import type { HttpAdapter } from './http-adapter';

const isHttpMethod = (value: string): value is HttpMethod => {
  const methods: string[] = Object.values(HttpMethod);

  return methods.includes(value);
};

const normalizeHttpMethod = (value: string): HttpMethod | undefined => {
  const normalized = value.toUpperCase();

  return isHttpMethod(normalized) ? normalized : undefined;
};

export class HttpServer {
  private container: ZipbulContainer;
  private adapter: HttpAdapter;
  private readonly logger = Logger.inherit();

  private options: HttpServerOptions;
  private server: Server<ZipbulValue>;

  async boot(container: ZipbulContainer, options: HttpServerBootOptions, adapter: HttpAdapter): Promise<void> {
    this.container = container;
    this.adapter = adapter;
    this.options = options.options ?? options;

    this.logger.debug('Booting...');

    const metadataRegistry = options.metadata ?? new Map<MetadataRegistryKey, ClassMetadata>();
    const scopedKeysMap: Map<ProviderToken, string> = options.scopedKeys ?? new Map<ProviderToken, string>();

    const routeHandler = new RouteHandler(this.container, metadataRegistry, scopedKeysMap);

    routeHandler.register();

    if (Array.isArray(options.internalRoutes) && options.internalRoutes.length > 0) {
      routeHandler.registerInternalRoutes(options.internalRoutes);
    }

    this.adapter.setRouteHandler(routeHandler);

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

    this.logger.info(`Listening on :${this.options.port}`);
  }

  async fetch(req: Request): Promise<Response> {
    const httpMethod = normalizeHttpMethod(req.method);

    if (httpMethod === undefined) {
      return new Response('Method Not Allowed', {
        status: StatusCodes.METHOD_NOT_ALLOWED,
      });
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const queryParams = Object.fromEntries(urlObj.searchParams.entries());
    const { ip, ips } = getIps(req, this.server, this.options.trustProxy);

    const zipbulReq = new HttpRequest({
      httpMethod,
      url: req.url,
      headers: req.headers.toJSON(),
      params: {},
      ip: ip ?? '',
      ips: ips ?? [],
      isTrustedProxy: this.options.trustProxy ?? false,
      query: queryParams,
    });

    const zipbulRes = new HttpResponse(zipbulReq, new Headers());

    try {
      const contextAdapter = new HttpContextAdapter(zipbulReq, zipbulRes, req);
      const context = new HttpContext(contextAdapter);

      await this.adapter.dispatchRequest(context);

      return this.toResponse(zipbulRes.end());
    } catch (error) {
      this.logger.error('Fetch Error', error instanceof Error ? error : undefined);

      return new Response('Internal server error', {
        status: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }
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
