import { defineAdapter } from '@zipbul/common';
import { ZipbulHttpAdapter } from './zipbul-http-adapter';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';

/**
 * HTTP adapter specification.
 *
 * This is the static declaration consumed by the AOT compiler.
 * The CLI extracts the object literal at build time to determine
 * pipeline shape, middleware phases, and entry decorators.
 */
export const adapterSpec = defineAdapter({
  name: 'http',
  classRef: ZipbulHttpAdapter,
  pipeline: ['BeforeRequest', 'Guards', 'Pipes', 'Handler', 'AfterRequest'],
  middlewarePhaseOrder: ['BeforeRequest', 'AfterRequest'],
  supportedMiddlewarePhases: {
    BeforeRequest: true,
    AfterRequest: true,
  },
  decorators: {
    controller: RestController,
    handler: [Get, Post, Put, Delete, Patch, Options, Head],
  },
});
