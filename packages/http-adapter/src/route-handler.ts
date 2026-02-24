import type { ZipbulContainer, ZipbulValue, ProviderToken } from '@zipbul/common';

import { ExceptionFilter, ZipbulMiddleware } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import type { ZipbulRequest } from './zipbul-request';
import type { ZipbulResponse } from './zipbul-response';
import type { RouteHandlerParamType } from './decorators';
import type { ArgumentMetadata, RouteHandlerEntry } from './interfaces';
import type { RouterOptions } from './router/types';
import type {
  ClassMetadata,
  ContainerInstance,
  ControllerInstance,
  ControllerConstructor,
  DecoratorArgument,
  DecoratorMetadata,
  HttpMethod,
  InternalRouteDefinition,
  LazyParamTypeFactory,
  MatchResult,
  MetadataRegistryKey,
  MethodMetadata,
  ParamTypeReference,
  RouteHandlerArgument,
  RouteHandlerFunction,
  RouteHandlerResult,
  RouteParamKind,
  RouteParamType,
  RouteParamValue,
  SystemError,
  TokenCarrier,
  TokenRecord,
} from './types';

import { ValidationPipe } from './pipes/validation.pipe';
import { Router } from './router';

export class RouteHandler {
  private container: ZipbulContainer;
  private metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;
  private scopedKeys: Map<ProviderToken, string>;
  private router: Router;
  private readonly logger = new Logger(RouteHandler.name);
  private validationPipe = new ValidationPipe();

  constructor(
    container: ZipbulContainer,
    metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
    scopedKeys: Map<ProviderToken, string> = new Map(),
    routerOptions?: RouterOptions,
  ) {
    this.container = container;
    this.metadataRegistry = metadataRegistry;
    this.scopedKeys = scopedKeys;
    this.router = new Router<MatchResult>({
      ignoreTrailingSlash: true,
      enableCache: true,
      ...routerOptions,
    });
  }

  match(method: string, path: string): MatchResult | undefined {
    const normalized = method.toUpperCase();

    if (!this.isHttpMethod(normalized)) {
      return undefined;
    }

    return this.router.match(normalized, path) ?? undefined;
  }

  register() {
    this.logger.debug('🔍 Registering routes from metadata...');

    for (const [targetClass, meta] of this.metadataRegistry.entries()) {
      if (!this.isControllerConstructor(targetClass)) {
        continue;
      }

      const controllerDec = (meta.decorators ?? []).find(
        d => d.name === 'RestController',
      );

      if (controllerDec) {
        this.logger.debug(`FOUND Controller: ${meta.className}`);

        this.registerController(targetClass, meta, controllerDec);
      }
    }
  }

  /**
   * Undocumented/internal route registration channel.
   * This is intentionally untyped at the package boundary.
   */
  registerInternalRoutes(routes: ReadonlyArray<InternalRouteDefinition>): void {
    for (const route of routes) {
      const method = String(route.method || '').toUpperCase();

      if (!this.isHttpMethod(method)) {
        continue;
      }

      if (method !== 'GET') {
        continue;
      }

      const fullPath = route.path.startsWith('/') ? route.path : `/${route.path}`;
      const entry: RouteHandlerEntry = {
        handler: route.handler,
        paramType: [],
        paramRefs: [],
        controllerClass: null,
        methodName: '__internal__',
        middlewares: [],
        errorFilters: [],
        paramFactory: async (req: ZipbulRequest, res: ZipbulResponse) => {
          const arity = typeof route.handler === 'function' ? route.handler.length : 0;
          const args: readonly RouteParamValue[] = arity >= 2 ? [req, res] : [req];

          return Promise.resolve([...args]);
        },
      };

      this.router.add(method, fullPath, params => ({
        entry,
        params,
      }));

      this.logger.info(`🛣️  Internal Route Registered: [${method}] ${fullPath}`);
    }
  }

  private registerController(targetClass: ControllerConstructor, meta: ClassMetadata, controllerDec: DecoratorMetadata): void {
    const rawPrefix = controllerDec.arguments?.[0];
    const prefix = typeof rawPrefix === 'string' ? rawPrefix : '';
    const scopedKey = this.scopedKeys.get(targetClass);
    let instance: ContainerInstance = undefined;

    try {
      if (typeof scopedKey === 'string' && scopedKey.length > 0) {
        instance = this.container.get(scopedKey);
      } else {
        instance = this.container.get(targetClass);
      }
    } catch {
      instance = undefined;
    }

    instance ??= this.tryCreateControllerInstance(targetClass);

    if (instance === undefined || instance === null) {
      const keyLabel = typeof scopedKey === 'string' && scopedKey.length > 0 ? scopedKey : targetClass.name;

      this.logger.warn(`⚠️  Cannot resolve controller instance: ${meta.className} (Key: ${keyLabel})`);

      return;
    }

    (meta.methods ?? []).forEach(method => {
      const routeDec = (method.decorators ?? []).find(d =>
        ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'].includes(d.name),
      );

      if (routeDec) {
        const httpMethodCandidate = routeDec.name.toUpperCase();

        if (!this.isHttpMethod(httpMethodCandidate)) {
          return;
        }

        const httpMethod = httpMethodCandidate;
        const rawSubPath = routeDec.arguments?.[0];
        const subPath = typeof rawSubPath === 'string' ? rawSubPath : '';
        const fullPath = '/' + [prefix, subPath].filter(Boolean).join('/').replace(/\/+/g, '/');
        const paramTypes = (method.parameters ?? []).map(parameter => {
          const normalized = this.normalizeParamKind(parameter.decorators?.[0]?.name);

          return this.toRouteHandlerParamType(normalized);
        });
        const paramRefs = (method.parameters ?? []).map(parameter => this.resolveParamType(parameter.type) ?? 'unknown');
        // Detect parameters early (moved into paramFactory closure)
        const paramsConfig = (method.parameters ?? []).map((parameter, index) => {
          const decorator = parameter.decorators?.[0];
          const normalized = this.normalizeParamKind(decorator?.name);

          return {
            type: normalized,
            name: parameter.name,
            metatype: this.resolveParamType(parameter.type),
            index,
          };
        });

        const paramFactory = async (req: ZipbulRequest, res: ZipbulResponse): Promise<readonly RouteParamValue[]> => {
          const params: RouteParamValue[] = [];

          for (const config of paramsConfig) {
            let paramValue: RouteParamValue = undefined;
            const { type, metatype } = config;
            let typeToUse: RouteParamKind | undefined = type;

            // Fallback to name-based detection if no decorator
            if (typeToUse === undefined && typeof config.name === 'string' && config.name.length > 0) {
              typeToUse = this.normalizeParamKind(config.name);
            }

            if (typeToUse) {
              switch (typeToUse) {
                case 'body':
                  paramValue = req.body;
                  break;
                case 'param':
                case 'params':
                  paramValue = req.params;
                  break;
                case 'query':
                case 'queries':
                  paramValue = req.query;
                  break;
                case 'header':
                case 'headers':
                  paramValue = req.headers;
                  break;
                case 'cookie':
                case 'cookies':
                  paramValue = req.cookies;
                  break;
                case 'request':
                case 'req':
                  paramValue = req;
                  break;
                case 'response':
                case 'res':
                  paramValue = res;
                  break;
                case 'ip':
                  paramValue = req.ip;
                  break;
                default:
                  paramValue = undefined;
                  break;
              }
            }

            if (metatype !== undefined && (typeToUse === 'body' || typeToUse === 'query')) {
              const validationType: 'body' | 'query' | 'param' | 'custom' = typeToUse === 'body' ? 'body' : 'query';
              const metadata: ArgumentMetadata = {
                type: validationType,
                metatype,
              };

              paramValue = this.validationPipe.transform(paramValue, metadata);
            }

            params.push(paramValue);
          }

          const resolvedParams = await Promise.resolve(params);

          return resolvedParams;
        };

        const middlewares = this.resolveMiddlewares(targetClass, method, meta);
        const errorFilters = this.resolveErrorFilters(targetClass, method, meta);
        const handler = this.resolveHandler(instance, method.name);
        const entry: RouteHandlerEntry = {
          handler,
          paramType: paramTypes,
          paramRefs,
          controllerClass: this.isControllerConstructor(targetClass) ? targetClass : null,
          methodName: method.name,
          middlewares,
          errorFilters,
          paramFactory,
        };

        this.router.add(httpMethod, fullPath, params => ({
          entry,
          params,
        }));

        this.logger.info(`🛣️  Route Registered: [${httpMethod}] ${fullPath} -> ${targetClass.name}.${method.name}`);
      }
    });
  }

  private isControllerInstance(value: ContainerInstance): value is ControllerInstance {
    return typeof value === 'object' && value !== null;
  }

  private isControllerConstructor(value: DecoratorArgument | MetadataRegistryKey): value is ControllerConstructor {
    return typeof value === 'function' && !this.isErrorConstructor(value);
  }

  private resolveHandler(instance: ContainerInstance, methodName: string): RouteHandlerFunction {
    if (!this.isControllerInstance(instance)) {
      throw new Error(`[RouteHandler] Invalid controller instance for method ${methodName}`);
    }

    const candidate = instance[methodName];

    if (typeof candidate !== 'function') {
      throw new Error(`[RouteHandler] Controller method not found: ${methodName}`);
    }

    const handler = candidate;

    return (...args: readonly RouteHandlerArgument[]): RouteHandlerResult | Promise<RouteHandlerResult> =>
      handler.apply(instance, [...args]);
  }

  private isTokenCarrier(value: DecoratorArgument): value is TokenCarrier {
    return typeof value === 'object' && value !== null && 'token' in value;
  }

  private isTokenRecord(value: DecoratorArgument): value is TokenRecord {
    return (
      typeof value === 'object' &&
      value !== null &&
      ('__zipbul_ref' in value || '__zipbul_forward_ref' in value || 'name' in value)
    );
  }

  private extractZipbulTokenRef(token: DecoratorArgument): string | undefined {
    if (!this.isTokenRecord(token)) {
      return undefined;
    }

    const ref = token.__zipbul_ref;

    if (typeof ref === 'string' && ref.length > 0) {
      return ref;
    }

    const forward = token.__zipbul_forward_ref;

    if (typeof forward === 'string' && forward.length > 0) {
      return forward;
    }

    return undefined;
  }

  private resolveProviderToken(token: DecoratorArgument): ProviderToken | undefined {
    if (token === null || token === undefined) {
      return undefined;
    }

    if (this.isTokenCarrier(token)) {
      return token.token;
    }

    if (typeof token === 'string' || typeof token === 'symbol') {
      return token;
    }

    if (typeof token === 'function' && !this.isErrorConstructor(token)) {
      return token;
    }

    const extracted = this.extractZipbulTokenRef(token);

    if (typeof extracted === 'string' && extracted.length > 0) {
      return extracted;
    }

    if (this.isTokenRecord(token) && typeof token.name === 'string' && token.name.length > 0) {
      return token.name;
    }

    return undefined;
  }

  private resolveControllerConstructor(token: DecoratorArgument): ControllerConstructor | undefined {
    if (this.isControllerConstructor(token)) {
      return token;
    }

    const resolved = this.resolveProviderToken(token);

    if (resolved !== undefined && typeof resolved === 'function' && this.isControllerConstructor(resolved)) {
      return resolved;
    }

    return undefined;
  }

  private tryCreateControllerInstance(targetClass: DecoratorArgument): ContainerInstance {
    const constructor = this.resolveControllerConstructor(targetClass);

    if (!constructor) {
      return undefined;
    }

    const meta = this.metadataRegistry.get(constructor);

    if (!meta) {
      return undefined;
    }

    const constructorParams = meta.constructorParams ?? [];
    const deps = constructorParams.map(param => {
      let token: DecoratorArgument = param.type;
      const extracted = this.extractZipbulTokenRef(token);

      if (typeof extracted === 'string' && extracted.length > 0) {
        token = extracted;
      }

      const decorators = param.decorators ?? [];
      const injectDec = decorators.find((decorator: DecoratorMetadata) => decorator.name === 'Inject');
      const injected = injectDec?.arguments?.[0];
      const injectedRef = this.extractZipbulTokenRef(injected);

      if (typeof injected !== 'undefined') {
        token = injected;

        if (typeof injectedRef === 'string' && injectedRef.length > 0) {
          token = injectedRef;
        }
      }

      return this.tryGetFromContainer(token);
    });
    const ctorArgs = deps.map(dep => (this.isZipbulValue(dep) ? dep : undefined));

    try {
      return new constructor(...ctorArgs);
    } catch {
      return undefined;
    }
  }

  private isZipbulValue(value: ZipbulValue | ContainerInstance): value is ZipbulValue {
    return (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      typeof value === 'symbol' ||
      typeof value === 'function' ||
      typeof value === 'object'
    );
  }

  private isErrorConstructor(value: DecoratorArgument): value is ErrorConstructor {
    if (typeof value !== 'function') {
      return false;
    }

    if (!('prototype' in value)) {
      return false;
    }

    return value.prototype instanceof Error;
  }

  private tryGetFromContainer(token: DecoratorArgument): ContainerInstance {
    const resolvedToken = this.resolveProviderToken(token);

    if (resolvedToken === undefined) {
      return undefined;
    }

    const scopedKey = this.scopedKeys.get(resolvedToken);

    if (typeof scopedKey === 'string' && scopedKey.length > 0) {
      try {
        return this.container.get(scopedKey);
      } catch {
        return undefined;
      }
    }

    try {
      return this.container.get(resolvedToken);
    } catch {
      return this.tryGetFromContainerBySuffix(resolvedToken);
    }
  }

  private tryGetFromContainerBySuffix(token: ProviderToken): ContainerInstance {
    const tokenName = this.normalizeToken(token);

    if (tokenName === undefined || tokenName.length === 0) {
      return undefined;
    }

    const suffix = `::${tokenName}`;

    for (const key of this.container.keys()) {
      if (typeof key !== 'string') {
        continue;
      }

      if (!key.endsWith(suffix)) {
        continue;
      }

      try {
        return this.container.get(key);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private normalizeToken(token: ProviderToken): string | undefined {
    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? token.toString();
    }

    if (typeof token === 'function' && token.name) {
      return token.name;
    }

    return undefined;
  }

  private formatTokenLabel(token: DecoratorArgument): string {
    if (token === null || token === undefined) {
      return 'undefined';
    }

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? 'symbol';
    }

    if (typeof token === 'function') {
      return token.name || 'anonymous';
    }

    if (this.isTokenCarrier(token)) {
      return this.formatTokenLabel(token.token);
    }

    const ref = this.extractZipbulTokenRef(token);

    if (typeof ref === 'string' && ref.length > 0) {
      return ref;
    }

    if (this.isTokenRecord(token) && typeof token.name === 'string' && token.name.length > 0) {
      return token.name;
    }

    return 'unknown-token';
  }

  private isZipbulMiddleware(value: ContainerInstance): value is ZipbulMiddleware {
    return value instanceof ZipbulMiddleware;
  }

  private isExceptionFilter(value: ContainerInstance): value is ExceptionFilter<SystemError> {
    return value instanceof ExceptionFilter;
  }

  private isHttpMethod(value: string): value is HttpMethod {
    return (
      value === 'GET' ||
      value === 'POST' ||
      value === 'PUT' ||
      value === 'PATCH' ||
      value === 'DELETE' ||
      value === 'OPTIONS' ||
      value === 'HEAD'
    );
  }

  private normalizeParamKind(value: string | undefined): RouteParamKind | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    const lower = value.toLowerCase();

    switch (lower) {
      case 'body':
      case 'param':
      case 'params':
      case 'query':
      case 'queries':
      case 'header':
      case 'headers':
      case 'cookie':
      case 'cookies':
      case 'request':
      case 'req':
      case 'response':
      case 'res':
      case 'ip':
        return lower;
      default:
        return undefined;
    }
  }

  private toRouteHandlerParamType(kind: RouteParamKind | undefined): RouteHandlerParamType {
    if (kind === undefined) {
      return 'param';
    }

    if (kind === 'params') {
      return 'param';
    }

    if (kind === 'queries') {
      return 'query';
    }

    if (kind === 'headers') {
      return 'header';
    }

    if (kind === 'cookies') {
      return 'cookie';
    }

    if (kind === 'req') {
      return 'request';
    }

    if (kind === 'res') {
      return 'response';
    }

    return kind;
  }

  private resolveMiddlewares(
    _targetClass: ControllerConstructor,
    method: MethodMetadata,
    classMeta: ClassMetadata,
  ): ZipbulMiddleware[] {
    const middlewares: ZipbulMiddleware[] = [];
    // Method Level
    const decs = (method.decorators ?? []).filter((decorator: DecoratorMetadata) => decorator.name === 'UseMiddlewares');

    decs.forEach(decorator => {
      (decorator.arguments ?? []).forEach(arg => {
        const resolved = this.tryGetFromContainer(arg);

        if (resolved !== undefined && resolved !== null && this.isZipbulMiddleware(resolved)) {
          middlewares.push(resolved);

          return;
        }

        const created = this.tryCreateControllerInstance(arg);

        if (created !== undefined && created !== null && this.isZipbulMiddleware(created)) {
          middlewares.push(created);
        }
      });
    });

    // Controller Level
    if (classMeta !== undefined) {
      const controllerDecs = (classMeta.decorators ?? []).filter(
        (decorator: DecoratorMetadata) => decorator.name === 'UseMiddlewares',
      );

      controllerDecs.forEach(decorator => {
        (decorator.arguments ?? []).forEach(arg => {
          const resolved = this.tryGetFromContainer(arg);

          if (resolved !== undefined && resolved !== null && this.isZipbulMiddleware(resolved)) {
            middlewares.push(resolved);

            return;
          }

          const created = this.tryCreateControllerInstance(arg);

          if (created !== undefined && created !== null && this.isZipbulMiddleware(created)) {
            middlewares.push(created);
          }
        });
      });
    }

    return middlewares;
  }

  private resolveErrorFilters(
    targetClass: ControllerConstructor,
    method: MethodMetadata,
    classMeta: ClassMetadata,
  ): Array<ExceptionFilter<SystemError>> {
    const tokens: DecoratorArgument[] = [];
    const methodDecs = (method.decorators ?? []).filter((decorator: DecoratorMetadata) => decorator.name === 'UseExceptionFilters');

    methodDecs.forEach(decorator => {
      (decorator.arguments ?? []).forEach(arg => {
        tokens.push(arg);
      });
    });

    if (classMeta !== undefined) {
      const classDecs = (classMeta.decorators ?? []).filter(
        (decorator: DecoratorMetadata) => decorator.name === 'UseExceptionFilters',
      );

      classDecs.forEach(decorator => {
        (decorator.arguments ?? []).forEach(arg => {
          tokens.push(arg);
        });
      });
    }

    const seen = new Set<DecoratorArgument>();
    const dedupedTokens = tokens.filter(token => {
      if (seen.has(token)) {
        return false;
      }

      seen.add(token);

      return true;
    });
    const resolved: Array<ExceptionFilter<SystemError>> = [];

    for (const token of dedupedTokens) {
      if (token === null || token === undefined) {
        continue;
      }

      const instance = this.tryGetFromContainer(token);

      if (instance !== undefined && instance !== null && this.isExceptionFilter(instance)) {
        resolved.push(instance);

        continue;
      }

      const created = this.tryCreateControllerInstance(token);

      if (created === undefined || created === null || !this.isExceptionFilter(created)) {
        throw new Error(
          `Cannot resolve ErrorFilter token for ${targetClass.name}.${method.name}: ${this.formatTokenLabel(token)}`,
        );
      }

      resolved.push(created);
    }

    return resolved;
  }

  private resolveParamType(type: ParamTypeReference | undefined): RouteParamType | undefined {
    if (type === undefined) {
      return undefined;
    }

    if (typeof type !== 'string') {
      if (typeof type === 'function' && !('prototype' in type)) {
        const resolved = (type as LazyParamTypeFactory)();

        console.log(`[RouteHandler] Resolved Lazy Type: ${String(type)} ->`, resolved);

        return resolved;
      }

      return type;
    }

    // Primitives
    if (['string', 'number', 'boolean', 'any', 'object', 'array'].includes(type.toLowerCase())) {
      return type;
    }

    // Lookup in registry
    for (const [ctor, meta] of this.metadataRegistry.entries()) {
      if (meta.className === type) {
        return ctor;
      }
    }

    return type;
  }
}
