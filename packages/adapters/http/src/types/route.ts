import type { MatchRouteMethodNotAllowed, MatchRouteNotFound, MatchRouteResult } from '../interfaces';
import type { HttpContext } from '../http-context';

import type { RequestBodyValue } from './request';

export type RouteHandlerResult = Response | AsyncIterable<unknown> | RequestBodyValue | bigint | null | undefined | void;

export type RouteHandlerFunction = (ctx: HttpContext) => RouteHandlerResult | Promise<RouteHandlerResult>;

export type MatchRouteOutput = MatchRouteResult | MatchRouteNotFound | MatchRouteMethodNotAllowed;

export type InternalRouteMethod = 'GET';

export type InternalRouteHandler = (ctx: HttpContext) => RouteHandlerResult;
