import { deserialize } from '@zipbul/baker';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type {
  ParamTypeReference,
  RouteParamKind,
  RouteParamType,
  RouteParamValue,
  ParameterMetadata,
  MetadataRegistryKey,
  ClassMetadata,
} from './types';

interface ParamConfig {
  readonly type: RouteParamKind | undefined;
  readonly name: string | undefined;
  readonly metatype: RouteParamType | undefined;
  readonly index: number;
}

export type ParamFactory = (req: HttpRequest, res: HttpResponse) => Promise<readonly RouteParamValue[]>;

export class ParamResolver {
  private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;

  constructor(metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>) {
    this.metadataRegistry = metadataRegistry;
  }

  /**
   * Builds a paramFactory function from method parameter metadata.
   *
   * @param parameters - The parameter metadata from a controller method.
   * @returns A function that resolves handler arguments from req/res at runtime.
   * @public
   */
  buildParamFactory(parameters: readonly ParameterMetadata[]): ParamFactory {
    const paramsConfig: ParamConfig[] = parameters.map((parameter, index) => {
      const decorator = parameter.decorators?.[0];
      const normalized = normalizeParamKind(decorator?.name);

      return {
        type: normalized,
        name: parameter.name,
        metatype: this.resolveParamType(parameter.type),
        index,
      };
    });

    return async (req: HttpRequest, res: HttpResponse): Promise<readonly RouteParamValue[]> => {
      const params: RouteParamValue[] = [];

      for (const config of paramsConfig) {
        let paramValue: RouteParamValue = undefined;
        const { type, metatype } = config;
        let typeToUse: RouteParamKind | undefined = type;

        if (typeToUse === undefined && typeof config.name === 'string' && config.name.length > 0) {
          typeToUse = normalizeParamKind(config.name);
        }

        if (typeToUse) {
          paramValue = resolveParamValue(typeToUse, req, res);
        }

        if (metatype !== undefined && !isPrimitiveMetatype(metatype) && (typeToUse === 'body' || typeToUse === 'query')) {
          paramValue = await deserialize(metatype as new (...args: unknown[]) => RouteParamValue, paramValue);
        }

        params.push(paramValue);
      }

      return params;
    };
  }

  private resolveParamType(type: ParamTypeReference | undefined): RouteParamType | undefined {
    if (type === undefined) {
      return undefined;
    }

    if (typeof type !== 'string') {
      if (typeof type === 'function' && !('prototype' in type)) {
        return type();
      }

      return type;
    }

    if (['string', 'number', 'boolean', 'any', 'object', 'array'].includes(type.toLowerCase())) {
      return type;
    }

    for (const [ctor, meta] of this.metadataRegistry.entries()) {
      if (meta.className === type) {
        return ctor;
      }
    }

    return type;
  }
}

function resolveParamValue(typeToUse: RouteParamKind, req: HttpRequest, res: HttpResponse): RouteParamValue {
  switch (typeToUse) {
    case 'body':
      return req.body;
    case 'param':
    case 'params':
      return req.params;
    case 'query':
    case 'queries':
      return req.query;
    case 'header':
    case 'headers':
      return req.headers;
    case 'cookie':
    case 'cookies':
      return req.cookies;
    case 'request':
    case 'req':
      return req;
    case 'response':
    case 'res':
      return res;
    case 'ip':
      return req.ip;
    default:
      return undefined;
  }
}

export function normalizeParamKind(value: string | undefined): RouteParamKind | undefined {
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

function isPrimitiveMetatype(metatype: RouteParamType): boolean {
  return metatype === String || metatype === Boolean || metatype === Number || metatype === Array || metatype === Object;
}
