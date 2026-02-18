import type { Class } from '@zipbul/common';

export type RouteHandlerParamType = 'body' | 'param' | 'query' | 'header' | 'cookie' | 'request' | 'response' | 'ip';

export type ControllerDecoratorTarget = Class;
