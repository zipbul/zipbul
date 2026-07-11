// Side-effect import: registering the baker @Recipe schema in options.ts must
// run before any QueryParser.create() validates options. Listed in package.json
// "sideEffects" so bundlers keep it. Do not drop.
import './src/options';

export { QueryParser } from './src/query-parser';
export { queryParser } from './src/middleware';
export { QueryParserError } from './src/errors';
export type { QueryParserErrorData } from './src/errors';
export type { QueryParserOptions } from './src/interfaces';
export { QueryParserErrorReason } from './src/enums';
export type { QueryValue, QueryArray, QueryValueRecord } from './src/types';

// Re-exported so `QueryParser.parseResult()` is usable without a second import:
// it returns a `Result` from @zipbul/result, and `isErr` is its discriminator.
export { isErr } from '@zipbul/result';
export type { Result } from '@zipbul/result';
