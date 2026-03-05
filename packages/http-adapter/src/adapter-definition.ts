import { defineAdapter } from '@zipbul/common';
import { HttpAdapter } from './http-adapter';

/**
 * HTTP adapter definition.
 *
 * This is the static declaration consumed by the AOT compiler.
 * The CLI extracts class properties (`name`, `decorators`)
 * from `HttpAdapter` at build time to determine
 * entry decorators.
 */
export const adapterDefinition = defineAdapter(HttpAdapter);
