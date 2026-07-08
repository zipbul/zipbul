import { Field, createRule, isBakerIssueSet } from '@zipbul/baker';
import { arrayEvery, arrayNotEmpty, isEnum, isFunction, isInt, max, min } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { compressionBaker } from './baker';
import {
  BREACH_SAFE_ENCODINGS,
  DEFAULT_ENCODINGS,
  DEFAULT_FILTER,
  DEFAULT_LEVELS,
  DEFAULT_THRESHOLD,
} from './constants';
import { CompressionCodec, CompressionErrorReason } from './enums';
import type { BreachOptions, CompressionErrorData, CompressionOptions } from './interfaces';
import type { ResolvedCompressionOptions } from './types';

// threshold is a byte count that must be finite and non-negative but NOT necessarily
// an integer (preserves the pre-baker contract); baker's isInt would reject e.g. 1024.5.
const isFiniteNonNegative = createRule(
  'isFiniteNonNegative',
  (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
);

type LevelMessageArgs = { property: string; value: unknown; constraints: Record<string, unknown> };
const levelMessage = (codec: string, lo: number, hi: number) =>
  ({ value }: LevelMessageArgs) => `${codec} level must be an integer between ${lo} and ${hi}, got ${value}`;

/**
 * Per-codec compression level ranges as a nested baker schema. Each codec has a
 * distinct integer range; the `message` thunk keeps the pre-baker "got <value>"
 * detail. Validated as `CompressionOptionsSchema.level` — baker recurses into the
 * nested DTO and reports `level.<codec>` paths carrying `InvalidLevel`.
 */
class CompressionLevelSchema {
  @Field(isInt, min(1), max(9), {
    optional: true,
    context: { reason: CompressionErrorReason.InvalidLevel },
    message: levelMessage('gzip', 1, 9),
  })
  gzip?: number;

  @Field(isInt, min(0), max(11), {
    optional: true,
    context: { reason: CompressionErrorReason.InvalidLevel },
    message: levelMessage('br', 0, 11),
  })
  br?: number;

  @Field(isInt, min(1), max(9), {
    optional: true,
    context: { reason: CompressionErrorReason.InvalidLevel },
    message: levelMessage('deflate', 1, 9),
  })
  deflate?: number;

  @Field(isInt, min(1), max(19), {
    optional: true,
    context: { reason: CompressionErrorReason.InvalidLevel },
    message: levelMessage('zstd', 1, 19),
  })
  zstd?: number;
}

/**
 * Compression options as a baker-validated data class — the same schema-driven
 * validation the sibling cors/cookie/query-parser middlewares use. `encodings`,
 * `threshold`, `filter`, and the per-codec `level` map (nested schema) are all
 * validated here. Only `breach` stays out of the schema: it is a separate
 * argument whose validity depends on a cross-field rule (a BREACH-safe encoding
 * must be present), which baker's per-field schema cannot express — cors handles
 * its own cross-field rules the same way, outside the schema.
 */
@compressionBaker.Recipe
class CompressionOptionsSchema {
  // arrayNotEmpty -> EmptyEncodings, arrayEvery -> InvalidEncodings (mapped via PATH_CODE_REASON).
  @Field(arrayNotEmpty, arrayEvery(isEnum(CompressionCodec)), { optional: true })
  encodings?: CompressionCodec[];

  @Field(isFiniteNonNegative, { optional: true, context: { reason: CompressionErrorReason.InvalidThreshold } })
  threshold?: number;

  @Field(isFunction, { optional: true, context: { reason: CompressionErrorReason.InvalidFilter } })
  filter?: (contentType: string) => boolean;

  @Field({ type: () => CompressionLevelSchema, optional: true })
  level?: CompressionLevelSchema;
}

// `encodings` is the only field whose two failure modes need two reasons (empty array
// vs. unknown codec) and it uses the generic built-ins, so its mapping is keyed by
// `path:code`. Every other field's reason rides on its single @Field context.
const PATH_CODE_REASON: Readonly<Record<string, CompressionErrorReason>> = {
  'encodings:arrayNotEmpty': CompressionErrorReason.EmptyEncodings,
  'encodings:arrayEvery': CompressionErrorReason.InvalidEncodings,
};

// Built-in baker rules (arrayNotEmpty/arrayEvery/isFiniteNonNegative/isFunction) carry
// no `message` thunk, so their issue.message is undefined. This table restores the
// pre-baker human-readable text keyed by `path:code`. `level` is absent here because
// its @Field carries a `message` thunk (issue.message is set) — that wins in messageFor.
const CODE_MESSAGE: Readonly<Record<string, string>> = {
  'encodings:arrayNotEmpty': 'encodings must not be empty',
  'threshold:isFiniteNonNegative': 'threshold must be a non-negative finite number',
  'filter:isFunction': 'filter must be a function',
};

const KNOWN_CODECS: ReadonlySet<string> = new Set(Object.values(CompressionCodec));

function messageFor(
  issue: { path: string; code: string; message?: string },
  resolved: ResolvedCompressionOptions,
): string {
  // `level` failures carry a thunk-built message ("gzip level must be … got 12").
  if (issue.message !== undefined) return issue.message;
  // arrayEvery doesn't expose which element failed, so recover it from the value to
  // reproduce the pre-baker "unknown encoding: <codec>" detail.
  if (`${issue.path}:${issue.code}` === 'encodings:arrayEvery') {
    const bad = resolved.encodings.find((e) => !KNOWN_CODECS.has(e));
    return `unknown encoding: ${String(bad)}`;
  }
  return CODE_MESSAGE[`${issue.path}:${issue.code}`] ?? `${issue.path}: ${issue.code}`;
}

let sealed = false;
function ensureSealed(): void {
  if (sealed) return;
  compressionBaker.seal();
  sealed = true;
}

export function resolveCompressionOptions(
  options?: CompressionOptions,
): ResolvedCompressionOptions {
  const level: Record<CompressionCodec, number> = { ...DEFAULT_LEVELS };
  if (options?.level !== undefined) {
    for (const codec of Object.values(CompressionCodec)) {
      const override = options.level[codec];
      if (override !== undefined) level[codec] = override;
    }
  }
  return {
    // 생성 시점 스냅숏 — 호출자가 배열을 사후 변조해도 동작이 바뀌지 않는다
    encodings: [...(options?.encodings ?? DEFAULT_ENCODINGS)],
    threshold: options?.threshold ?? DEFAULT_THRESHOLD,
    filter: options?.filter ?? DEFAULT_FILTER,
    level,
  };
}

export function validateCompressionOptions(
  resolved: ResolvedCompressionOptions,
  breach?: BreachOptions,
): Result<void, CompressionErrorData> {
  ensureSealed();

  const result = compressionBaker.validateSync(CompressionOptionsSchema, resolved);
  if (isBakerIssueSet(result)) {
    const issue = result.errors[0]!;
    const ctx = issue.context as { reason?: CompressionErrorReason } | undefined;
    const reason = PATH_CODE_REASON[`${issue.path}:${issue.code}`] ?? ctx?.reason;
    if (reason === undefined) {
      throw new Error(`internal: baker @Field for "${issue.path}" missing context.reason`);
    }
    return err<CompressionErrorData>({ reason, message: messageFor(issue, resolved) });
  }

  // breach: a separate argument + cross-field rule (requires a BREACH-safe encoding
  // present), neither expressible in the per-field schema above.
  if (breach !== undefined) {
    if (!Number.isInteger(breach.maxPadding) || breach.maxPadding < 1 || breach.maxPadding > 4096) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidBreach,
        message: 'breach.maxPadding must be an integer between 1 and 4096',
      });
    }

    const hasSafeEncoding = resolved.encodings.some((e) => BREACH_SAFE_ENCODINGS.has(e));
    if (!hasSafeEncoding) {
      return err<CompressionErrorData>({
        reason: CompressionErrorReason.InvalidBreach,
        message: 'breach requires at least one BREACH-safe encoding (gzip or zstd)',
      });
    }
  }

  return undefined;
}
