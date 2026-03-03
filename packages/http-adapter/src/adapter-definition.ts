import { defineAdapter } from '@zipbul/common';
import { ZipbulHttpAdapter } from './zipbul-http-adapter';

/**
 * HTTP adapter specification.
 *
 * This is the static declaration consumed by the AOT compiler.
 * The CLI extracts class properties (`name`, `pipeline`, `decorators`)
 * from `ZipbulHttpAdapter` at build time to determine pipeline shape,
 * middleware phases, and entry decorators.
 */
export const adapterSpec = defineAdapter(ZipbulHttpAdapter);
