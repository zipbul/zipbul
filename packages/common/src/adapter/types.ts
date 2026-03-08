import type { Adapter } from './adapter';
import type { MiddlewareDefinition } from '../define-middleware';

/**
 * Fixed pipeline hooks provided by the framework.
 *
 * The pipeline execution order is:
 * `OnReceive → [parseInput] → PostParseData → Guards → PreHandle → Handler → [sendResult] → OnComplete`
 *
 * @public
 */
export enum MiddlewareHook {
  /** Runs immediately when a request is received, before any parsing. */
  OnReceive = 'OnReceive',
  /** Runs after the request body and query string have been parsed. */
  PostParseData = 'PostParseData',
  /** Runs just before the route handler is invoked, after guards pass. */
  PreHandle = 'PreHandle',
  /** Runs after the response has been sent; errors are suppressed. */
  OnComplete = 'OnComplete',
}

/** Registry mapping each middleware hook to its ordered middleware list. */
export type MiddlewareRegistry = Partial<Record<MiddlewareHook, MiddlewareDefinition[]>>;

/**
 * Adapter dependency declaration.
 *
 * - `AdapterClass` — depends on **all** instances of that adapter class.
 * - `string` — depends on the specific adapter instance registered with that `name`.
 * - Empty array = standalone (no dependency on other adapters).
 *
 * @public
 */
export type AdapterDependsOn = readonly (AdapterClass | string)[];

/**
 * Reference to a decorator function.
 *
 * `any` is intentional here: decorator factories accept heterogeneous
 * argument lists whose shapes are defined by each adapter, so a
 * single generic signature cannot capture all variants without
 * resorting to complex conditional types that provide no safety
 * benefit at the framework boundary.
 */
export type DecoratorRef = (...args: any[]) => any;

/** Adapter-specific entry decorators provided to user code. */
export type AdapterEntryDecorators = {
  controller: DecoratorRef;
  handler: DecoratorRef[];
};

/** Adapter class constructor type. Accepts any constructor args and produces an Adapter. */
export type AdapterClass = new (...args: any[]) => Adapter;
