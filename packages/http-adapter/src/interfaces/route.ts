import type { ResolvedExceptionFilter, ResolvedValidationEntry, PipelineStepFn } from '@zipbul/core';

import type { HttpResponse } from '../http-response';
import type { InternalRouteHandler, InternalRouteMethod, RouteHandlerFunction } from '../types';

export interface MatchedRouteMetadata {
  readonly rawBody: boolean;
  readonly sse: boolean;
  readonly bodyLimit: number | undefined;
  readonly status: number | undefined;
  readonly redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined;
  readonly contentType: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
  readonly applyResponseDefaults?: (response: HttpResponse) => void;
  readonly handler: RouteHandlerFunction;
  readonly validations: readonly ResolvedValidationEntry[];
  readonly pre: readonly PipelineStepFn[];
  readonly post: readonly PipelineStepFn[];
  readonly filters: readonly ResolvedExceptionFilter[];
}

export interface MatchRouteResult {
  readonly kind: 'matched';
  readonly route: MatchedRouteMetadata;
  readonly params: Record<string, string | undefined>;
}

export interface MatchRouteNotFound {
  readonly kind: 'not-found';
}

export interface MatchRouteMethodNotAllowed {
  readonly kind: 'method-not-allowed';
  readonly allowedMethods: readonly string[];
}

export interface InternalRouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandlerFunction;
}

export interface InternalRouteEntry {
  readonly method: InternalRouteMethod;
  readonly path: string;
  readonly handler: InternalRouteHandler;
}
