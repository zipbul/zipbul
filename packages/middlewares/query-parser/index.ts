// Side-effect import: registers the options schema on the package-private baker
// (`@queryParserBaker.Recipe`) so option validation works. Intentionally unassigned.
// oxlint-disable-next-line import/no-unassigned-import
import './src/options';

export { QueryParser } from './src/query-parser';
export { queryParser } from './src/middleware';
export { QueryParserError } from './src/interfaces';
export type { QueryParserErrorData, QueryParserOptions } from './src/interfaces';
export { DuplicateStrategy, QueryParserErrorReason } from './src/enums';
export type { QueryValue, QueryArray, QueryValueRecord } from './src/types';

// Re-exported so `QueryParser.parseResult()` is usable without a second import:
// it returns a `Result` from @zipbul/result, and `isErr` is its discriminator.
export { isErr } from '@zipbul/result';
export type { Result } from '@zipbul/result';
