import type { AdapterRegistrationInput } from './types';

/**
 * Declares an adapter spec. This is an identity function — it returns
 * the input as-is. Its purpose is to serve as a static marker for
 * AOT collection: the CLI compiler looks for `defineAdapter(...)` call
 * expressions and extracts the object literal argument at build time.
 *
 * @example
 * ```ts
 * export const adapterSpec = defineAdapter({
 *   name: 'http',
 *   classRef: ZipbulHttpAdapter,
 *   pipeline: [
 *     HttpMiddlewarePhase.BeforeRequest,
 *     ReservedPipeline.Guards,
 *     ReservedPipeline.Pipes,
 *     ReservedPipeline.Handler,
 *     HttpMiddlewarePhase.AfterRequest,
 *   ],
 *   decorators: { controller: RestController, handler: [Get, Post, Put, Delete, Patch, Options, Head] },
 * });
 * ```
 */
export function defineAdapter(input: AdapterRegistrationInput): AdapterRegistrationInput {
  return input;
}
