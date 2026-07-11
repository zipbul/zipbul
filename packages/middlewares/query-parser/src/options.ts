import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { isBoolean, isInt, isIn, min } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { DEFAULT_QUERY_PARSER_OPTIONS } from './constants';
import { QueryParserErrorReason } from './enums';
import type { QueryParserErrorData } from './errors';
import type { QueryParserOptions } from './interfaces';
import type { ResolvedQueryParserOptions } from './types';

const DUPLICATE_MODES: string[] = ['first', 'last', 'array'];

/**
 * Query-parser-owned baker. baker 5.x scopes registration to an instance, so
 * only {@link QueryParserOptionsSchema} registers here (`@queryParserBaker.Recipe`),
 * and `queryParserBaker.validateSync` runs against the executor this baker sealed.
 * Mirrors the cors middleware's package-private baker.
 */
const queryParserBaker = new Baker();

/**
 * Lazy seal — defer sealing {@link queryParserBaker} to the first validation so
 * the seal runs after the schema import has settled. The boolean guard makes
 * repeat validations skip the redundant seal.
 */
let isSealed = false;
function ensureSealed(): void {
  if (isSealed) return;
  queryParserBaker.seal();
  isSealed = true;
}

/**
 * Resolves partial {@link QueryParserOptions} into a fully populated
 * {@link ResolvedQueryParserOptions} by applying defaults via nullish coalescing.
 */
export function resolveQueryParserOptions(options?: QueryParserOptions): ResolvedQueryParserOptions {
  return {
    depth: options?.depth ?? DEFAULT_QUERY_PARSER_OPTIONS.depth,
    maxParams: options?.maxParams ?? DEFAULT_QUERY_PARSER_OPTIONS.maxParams,
    nesting: options?.nesting ?? DEFAULT_QUERY_PARSER_OPTIONS.nesting,
    arrayLimit: options?.arrayLimit ?? DEFAULT_QUERY_PARSER_OPTIONS.arrayLimit,
    duplicates: options?.duplicates ?? DEFAULT_QUERY_PARSER_OPTIONS.duplicates,
    strict: options?.strict ?? DEFAULT_QUERY_PARSER_OPTIONS.strict,
    urlEncoded: options?.urlEncoded ?? DEFAULT_QUERY_PARSER_OPTIONS.urlEncoded,
  };
}

/**
 * Query-parser options as a baker-validated data class — the same schema-driven
 * validation the sibling CORS middleware uses for its options. Field order
 * matters: baker reports the first failing field, so depth precedes maxParams
 * to keep the documented "first failure wins" ordering. Every field carries a
 * `context.reason` so an invalid value surfaces as a typed {@link QueryParserError}
 * rather than baker's internal-invariant error.
 */
@queryParserBaker.Recipe
export class QueryParserOptionsSchema {
  /** Maximum nesting depth — non-negative integer. */
  @Field(isInt, min(0), { optional: true, context: { reason: QueryParserErrorReason.InvalidDepth } })
  depth?: number;

  /** Maximum number of parameters — positive integer. */
  @Field(isInt, min(1), { optional: true, context: { reason: QueryParserErrorReason.InvalidMaxParams } })
  maxParams?: number;

  /** Whether bracket nesting is enabled. */
  @Field(isBoolean, { optional: true, context: { reason: QueryParserErrorReason.InvalidNesting } })
  nesting?: boolean;

  /** Maximum array index — non-negative integer. */
  @Field(isInt, min(0), { optional: true, context: { reason: QueryParserErrorReason.InvalidArrayLimit } })
  arrayLimit?: number;

  /** Duplicate-key strategy. */
  @Field(isIn(DUPLICATE_MODES), { optional: true, context: { reason: QueryParserErrorReason.InvalidDuplicates } })
  duplicates?: 'first' | 'last' | 'array';

  /** Whether strict mode is enabled. */
  @Field(isBoolean, { optional: true, context: { reason: QueryParserErrorReason.InvalidStrict } })
  strict?: boolean;

  /** Whether `+` is decoded as a space (application/x-www-form-urlencoded). */
  @Field(isBoolean, { optional: true, context: { reason: QueryParserErrorReason.InvalidUrlEncoded } })
  urlEncoded?: boolean;
}

/**
 * Validates resolved query-parser options against {@link QueryParserOptionsSchema}.
 *
 * @returns `undefined` (void) if valid, or `Err<QueryParserErrorData>` carrying the
 *   first violated field's reason.
 */
export function validateQueryParserOptions(resolved: ResolvedQueryParserOptions): Result<void, QueryParserErrorData> {
  ensureSealed();

  const result = queryParserBaker.validateSync(QueryParserOptionsSchema, resolved);

  if (isBakerIssueSet(result)) {
    const issue = result.errors[0];

    if (issue === undefined) {
      throw new Error('internal: baker reported an issue set with no issues');
    }

    const ctx = issue.context as { reason?: QueryParserErrorReason } | undefined;

    if (ctx?.reason === undefined) {
      throw new Error(`internal: baker @Field for "${issue.path}" missing context.reason`);
    }

    return err<QueryParserErrorData>({
      reason: ctx.reason,
      message: `${issue.path}: ${issue.code}`,
    });
  }
}
