import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';

import { DANGEROUS_KEYS, POISONED_KEYS } from './constants';
import { DuplicateStrategy, QueryParserErrorReason } from './enums';
import { QueryParserError } from './interfaces';
import type { QueryParserErrorData, QueryParserOptions } from './interfaces';
import { resolveQueryParserOptions, validateQueryParserOptions } from './options';
import type { QueryArray, QueryContainer, QueryValue, QueryValueRecord, ResolvedQueryParserOptions } from './types';

// Module-level singletons for the WHATWG percent-decode fallback. `ignoreBOM:true`
// implements "UTF-8 decode WITHOUT BOM" — a leading BOM must be preserved, not
// stripped. `fatal:false` maps invalid sequences to U+FFFD instead of throwing.
// Reused across calls: `decode()` (non-streaming) flushes state every call.
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48; // 0-9
  }

  if (code >= 65 && code <= 70) {
    return code - 55; // A-F
  }

  if (code >= 97 && code <= 102) {
    return code - 87; // a-f
  }

  return -1;
}

/**
 * WHATWG percent-decode of a string (WHATWG URL #percent-decode + WHATWG
 * Encoding #utf-8-decode-without-bom). A valid `%XX` becomes its byte, a
 * malformed `%` is preserved as the literal 0x25 octet and decoding continues
 * (§2.6), and invalid UTF-8 is replaced with U+FFFD (§2.5). Never throws.
 *
 * ASCII fast path: while every input char and every decoded byte is ASCII
 * (< 0x80) — the overwhelmingly common case, valid (`hello%20world`) or malformed
 * (`%ZZ`) — the result is built directly with no TextEncoder/TextDecoder and,
 * crucially, without `decodeURIComponent`'s costly throw on malformed input.
 * Returns `null` the moment a non-ASCII byte appears (part of a UTF-8 sequence),
 * signalling the caller to use the native decoder / byte-level path instead.
 */
function whatwgPercentDecodeAscii(input: string): string | null {
  const len = input.length;
  let result = '';
  let runStart = 0; // start of the current literal run to be sliced verbatim

  for (let i = 0; i < len; i++) {
    const c = input.charCodeAt(i);

    if (c >= 0x80) {
      return null;
    }

    if (c === 0x25) {
      const h1 = i + 2 < len ? hexNibble(input.charCodeAt(i + 1)) : -1;
      const h2 = h1 === -1 ? -1 : hexNibble(input.charCodeAt(i + 2));

      if (h2 !== -1) {
        const byte = h1 * 16 + h2;

        if (byte >= 0x80) {
          return null;
        }

        // Flush the literal run before this escape, then the decoded byte.
        result += input.slice(runStart, i) + String.fromCharCode(byte);
        i += 2;
        runStart = i + 1;
      }
      // A malformed '%' (h2 === -1) stays in the run and is sliced as a literal.
    }
  }

  return runStart === 0 ? input : result + input.slice(runStart);
}

/**
 * Byte-level path of {@link whatwgPercentDecodeAscii}: UTF-8 encodes the input, then
 * percent-decodes the bytes and decodes with replacement. Used when a non-ASCII
 * byte is involved (multi-byte UTF-8, valid or ill-formed).
 */
function whatwgPercentDecodeBytes(input: string): string {
  const src = UTF8_ENCODER.encode(input);
  const out = new Uint8Array(src.length);
  let o = 0;

  for (let i = 0; i < src.length; i++) {
    const b = src[i]!;

    if (b !== 0x25) {
      out[o++] = b;
      continue;
    }

    const h1 = i + 2 < src.length ? hexNibble(src[i + 1]!) : -1;
    const h2 = h1 === -1 ? -1 : hexNibble(src[i + 2]!);

    if (h2 !== -1) {
      out[o++] = h1 * 16 + h2;
      i += 2;
    } else {
      out[o++] = 0x25; // malformed '%' preserved as a literal octet
    }
  }

  return UTF8_DECODER.decode(out.subarray(0, o));
}

/**
 * High-performance, strict query string parser.
 * Implements RFC 3986 compliance with strict security controls.
 */
export class QueryParser {
  private readonly options: ResolvedQueryParserOptions;

  private constructor(options: ResolvedQueryParserOptions) {
    this.options = options;
  }

  /**
   * Creates a QueryParser instance after resolving and validating options.
   *
   * @throws {QueryParserError} when options fail validation.
   * @returns A ready-to-use QueryParser instance.
   */
  public static create(options?: QueryParserOptions): QueryParser {
    const resolved = resolveQueryParserOptions(options);
    const validation = validateQueryParserOptions(resolved);

    if (isErr(validation)) {
      throw new QueryParserError(validation.data);
    }

    return new QueryParser(resolved);
  }

  /**
   * Parses a query string into a key-value record.
   *
   * @throws {QueryParserError} in strict mode when the query string is malformed
   *         or contains conflicting key structures.
   * @returns Parsed query parameters as a record.
   */
  public parse(qs: string): QueryValueRecord {
    const result = this.parseInternal(qs);

    if (isErr(result)) {
      throw new QueryParserError(result.data);
    }

    return result;
  }

  /**
   * Result-returning parse — the non-throwing counterpart to {@link parse}.
   * Returns the parsed record on success, or an `Err<QueryParserErrorData>`
   * in strict mode when the query string is malformed / structurally
   * conflicting. Used by the HTTP middleware to translate a client-supplied
   * bad query into a 400 (returned `Err`) rather than a thrown 500.
   */
  public parseResult(qs: string): Result<QueryValueRecord, QueryParserErrorData> {
    return this.parseInternal(qs);
  }

  private parseInternal(qs: string): Result<QueryValueRecord, QueryParserErrorData> {
    if (qs.length === 0) {
      return {};
    }

    const res: QueryValueRecord = {};
    const len = qs.length;
    let i = 0;

    // Ignore leading '?'
    if (qs.charCodeAt(0) === 63) {
      i = 1;
    }

    let keyStart = i;
    let keyEnd = -1;
    let valStart = -1;
    let isKey = true;
    let paramCount = 0;
    let limitReached = false;

    // Fast path: Scan loop
    while (i < len) {
      const code = qs.charCodeAt(i);

      if (code === 61) {
        // '='
        if (isKey) {
          keyEnd = i;
          valStart = i + 1;
          isKey = false;
        }
      } else if (code === 38) {
        // '&'
        if (keyStart === i) {
          // §2.2: an empty byte sequence (leading/consecutive '&') produces no
          // pair and must NOT consume the maxParams budget. State is already in
          // the post-reset shape (keyEnd/valStart -1, isKey true).
          keyStart = i + 1;
        } else {
          if (keyEnd === -1) {
            keyEnd = i;
            valStart = i;
          }

          const pairResult = this.processPair(res, qs, keyStart, keyEnd, valStart, i);

          if (isErr(pairResult)) {
            return pairResult;
          }

          paramCount++;

          if (paramCount >= this.options.maxParams) {
            limitReached = true;
            break;
          }

          // Reset
          keyStart = i + 1;
          keyEnd = -1;
          valStart = -1;
          isKey = true;
        }
      }

      i++;
    }

    if (limitReached) {
      // #1: the scan already `break`s at the cap (no full tail scan, no
      // per-pair processing beyond it — DoS-safe). Strict mode still wants to
      // OBSERVE an over-limit condition rather than silently truncate, so it
      // does one bounded linear pass over just the leftover tail (starting at
      // `i`, the '&' that closed the maxParams-th pair) looking for a single
      // non-'&' character. A tail of only '&' (or nothing) is just empty
      // sequences — not a real extra pair — so it does NOT count as exceeded.
      // The (n+1)th pair's own content is never parsed: the reason is always
      // the deterministic `LimitExceeded`, never whatever Malformed/Conflict
      // that dropped content might otherwise have produced.
      if (this.options.strict) {
        for (let j = i; j < len; j++) {
          if (qs.charCodeAt(j) !== 38) {
            return err<QueryParserErrorData>({
              reason: QueryParserErrorReason.LimitExceeded,
              message: `Limit exceeded: query string has more than ${this.options.maxParams} parameters`,
            });
          }
        }
      }
    } else if (keyStart < len) {
      // Process last pair (only reached if the limit was not hit)
      if (keyEnd === -1) {
        keyEnd = len;
        valStart = len;
      }

      const pairResult = this.processPair(res, qs, keyStart, keyEnd, valStart, len);

      if (isErr(pairResult)) {
        return pairResult;
      }
    }

    return res;
  }

  /**
   * Whether `key` must be dropped rather than written into the parsed output.
   * `__proto__` is blocked unconditionally — even under `allowPrototypes: true`
   * — because a plain assignment to it invokes the prototype setter. Every
   * other `Object.prototype` own-name (`constructor`, `toString`,
   * `hasOwnProperty`, …) is blocked only when `allowPrototypes` is `false`
   * (the default); `allowPrototypes: true` reverts to the narrower
   * `__proto__`-only policy.
   */
  private isBlockedKey(key: string): boolean {
    if (POISONED_KEYS.has(key)) {
      return true;
    }

    if (this.options.allowPrototypes) {
      return false;
    }

    return DANGEROUS_KEYS.has(key);
  }

  private processPair(
    res: QueryValueRecord,
    qs: string,
    keyStart: number,
    keyEnd: number,
    valStart: number,
    valEnd: number,
  ): Err<QueryParserErrorData> | undefined {
    // Decode Key. An empty name (`=v`) is a valid §2.3 pair and is KEPT; empty
    // SEQUENCES (`&&`) are skipped upstream in the scan loop, so they never
    // reach here.
    const keyRaw = qs.slice(keyStart, keyEnd);
    const keyNeedsDecode = keyRaw.includes('%') || (this.options.urlEncoded && keyRaw.includes('+'));
    const key = keyNeedsDecode ? this.safeDecode(keyRaw) : keyRaw;

    // Decode Value
    let val = '';

    if (valStart < valEnd) {
      const valRaw = qs.slice(valStart, valEnd);
      const valNeedsDecode = valRaw.includes('%') || (this.options.urlEncoded && valRaw.includes('+'));
      val = valNeedsDecode ? this.safeDecode(valRaw) : valRaw;
    }

    // Check for Nesting
    const braceIdx = key.indexOf('[');

    if (braceIdx === -1) {
      if (this.options.strict && key.includes(']')) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unbalanced brackets in key "${key}"`,
        });
      }

      return this.assignLeaf(res, key, val);
    }

    if (!this.options.nesting) {
      if (this.options.strict) {
        const bracketResult = this.validateBrackets(key);

        if (isErr(bracketResult)) {
          return bracketResult;
        }
      }

      return this.assignLeaf(res, key, val);
    }

    return this.parseComplexKey(res, key, braceIdx, val);
  }

  /**
   * Validates bracket balance in a key string (strict mode only).
   */
  private validateBrackets(key: string): Err<QueryParserErrorData> | undefined {
    let open = 0;

    for (let i = 0; i < key.length; i++) {
      const char = key[i];

      if (char === '[') {
        if (open > 0) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: nested brackets in key "${key}"`,
          });
        }

        open++;
      } else if (char === ']') {
        open--;

        if (open < 0) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: unbalanced brackets in key "${key}"`,
          });
        }
      }
    }

    if (open !== 0) {
      return err<QueryParserErrorData>({
        reason: QueryParserErrorReason.MalformedQueryString,
        message: `Malformed query string: unclosed bracket in key "${key}"`,
      });
    }
  }

  /**
   * Splits a bracketed key (`a[b][c]`) into its path segments (`[a, b, c]`),
   * starting from `rootKey` and the first `[`. Returns the segments, an `Err`
   * in strict mode on malformed brackets (nested / unbalanced / stray chars /
   * unclosed), or `null` for a non-strict unclosed bracket (the caller then
   * assigns the whole key as a leaf).
   */
  private splitBracketKeys(
    key: string,
    rootKey: string,
    firstBrace: number,
  ): string[] | Err<QueryParserErrorData> | null {
    const len = key.length;
    let partStart = -1;
    const keys: string[] = [rootKey];

    for (let i = firstBrace; i < len; i++) {
      const code = key.charCodeAt(i);

      if (code === 91) {
        // '['
        if (partStart !== -1 && this.options.strict) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: nested brackets in key "${key}"`,
          });
        }

        partStart = i + 1;
      } else if (code === 93) {
        // ']'
        if (partStart !== -1) {
          keys.push(key.slice(partStart, i));
          partStart = -1;
        } else if (this.options.strict) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.MalformedQueryString,
            message: `Malformed query string: unbalanced brackets in key "${key}"`,
          });
        }
      } else if (partStart === -1 && this.options.strict) {
        // Strict: any character outside a bracket group (between ']' and the
        // next '[', or trailing after the last ']') is garbage — non-strict
        // mode silently drops it, strict mode rejects the whole key.
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unexpected characters between bracket groups in key "${key}"`,
        });
      }
    }

    if (partStart !== -1) {
      // Unclosed bracket: strict rejects; non-strict signals a whole-key leaf.
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unclosed bracket in key "${key}"`,
        });
      }

      return null;
    }

    return keys;
  }

  private parseComplexKey(
    root: QueryValueRecord,
    key: string,
    firstBrace: number,
    value: string,
  ): Err<QueryParserErrorData> | undefined {
    let current: QueryContainer = root;
    const maxDepth = this.options.depth;
    const rootKey = key.slice(0, firstBrace);

    if (rootKey === '' || this.isBlockedKey(rootKey)) {
      return;
    }

    // Strict: the root-key portion (before the first '[') sits outside the
    // bracket scan below, so a stray ']' there must be rejected explicitly.
    if (this.options.strict && rootKey.includes(']')) {
      return err<QueryParserErrorData>({
        reason: QueryParserErrorReason.MalformedQueryString,
        message: `Malformed query string: unbalanced brackets in key "${key}"`,
      });
    }

    // Split the bracket groups into path segments (`a[b][c]` → [a, b, c]).
    const segments = this.splitBracketKeys(key, rootKey, firstBrace);

    if (isErr(segments)) {
      return segments;
    }

    if (segments === null) {
      // Unclosed bracket (non-strict): assign the whole key as a leaf.
      return this.assignLeaf(root, key, value);
    }

    const keys = segments;

    // N-3/R2: depth is enforced BEFORE any container is created — a whole-pair
    // clean drop (non-strict) or `LimitExceeded` (strict), never the old
    // allocate-then-truncate that left an empty-node residue (`{ b: {} }`)
    // behind. `keys.length - 1` is the number of bracket groups (nesting
    // levels) this key requests.
    if (keys.length - 1 > maxDepth) {
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.LimitExceeded,
          message: `Limit exceeded: key "${key}" nests deeper than the configured depth (${maxDepth})`,
        });
      }

      return;
    }

    // Initialize/Validate root container. A scalar↔container collision here
    // (`a=1` then `a[b]=2`) is resolved by the `duplicates` strategy (#6) via
    // resolveScalarToContainer — never a hardcoded strict throw.
    let parent: QueryContainer = root;
    let parentKey: string | number = rootKey;

    if (!Object.prototype.hasOwnProperty.call(root, rootKey)) {
      const nextKey = keys[1] ?? '';
      const created: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

      root[rootKey] = created;
      current = created;
    } else {
      const existingRoot = root[rootKey];

      if (this.isRecordValue(existingRoot) || Array.isArray(existingRoot)) {
        current = existingRoot;
      } else if (existingRoot === undefined) {
        return;
      } else {
        const nextKey = keys[1] ?? '';
        const resolution = this.resolveScalarToContainer(existingRoot, nextKey, root, rootKey);

        if (isErr(resolution)) {
          return resolution;
        }

        if (resolution === undefined) {
          return;
        }

        current = resolution.container;
        parent = resolution.parent;
        parentKey = resolution.parentKey;
      }
    }

    // Traverse and build from 2nd key match
    for (let k = 1; k < keys.length; k++) {
      const prop = keys[k] ?? '';
      const isLast = k === keys.length - 1;

      // Pollution check — BEFORE any property access
      if (this.isBlockedKey(prop)) {
        return;
      }

      // Conversion: Array with non-numeric key → Object. This is a KEY-KIND
      // mismatch (`[]`/`[i]` vs `[foo]`), not a scalar/structure conflict — the
      // array and the incoming key both describe a CONTAINER, so materializing
      // is lossless and never throws, even in strict mode (#2). Strict mode
      // still rejects a genuine scalar↔container conflict elsewhere (#2b).
      if (Array.isArray(current) && prop !== '' && !this.isValidArrayIndex(prop)) {
        current = this.materializeArray(current, parent, parentKey);
      }

      // Conversion: Array with an explicit numeric index that would create a
      // hole (index > current.length) or exceeds arrayLimit (index > arrayLimit)
      // → Object. Materialized BEFORE any write, so a hole element is never
      // created (#4) and an over-limit index is never silently dropped (#5).
      // Unlike the non-numeric-key conversion above, this never throws — even
      // in strict mode — because it is a density/limit condition, not a
      // key-kind conflict (strict limit-observability is a separate concern,
      // out of scope for this change).
      if (Array.isArray(current) && this.isValidArrayIndex(prop)) {
        const index = parseInt(prop, 10);

        if (index > current.length || index > this.options.arrayLimit) {
          current = this.materializeArray(current, parent, parentKey);
        }
      }

      if (Array.isArray(current)) {
        if (prop === '') {
          if (isLast) {
            const leafErr = this.assignLeaf(current, prop, value);

            if (isErr(leafErr)) {
              return leafErr;
            }

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          const nextContainer: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

          current.push(nextContainer);
          parent = current;
          parentKey = current.length - 1;
          current = nextContainer;

          continue;
        }

        if (this.isValidArrayIndex(prop)) {
          const index = parseInt(prop, 10);

          // Invariant: the materialization check above guarantees `index <=
          // current.length && index <= arrayLimit` here — any hole or
          // over-limit index has already been converted to an object write.

          if (isLast) {
            const leafErr = this.assignLeaf(current, prop, value);

            if (isErr(leafErr)) {
              return leafErr;
            }

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          const existingValue = current[index];

          if (this.isRecordValue(existingValue) || Array.isArray(existingValue)) {
            parent = current;
            parentKey = prop;
            current = existingValue;
          } else if (existingValue === undefined) {
            const created: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

            this.assignArrayRecordValue(current, prop, created);
            parent = current;
            parentKey = prop;
            current = created;
          } else {
            // An existing scalar at this index being nested into is a
            // scalar↔container collision — symmetric with the record path,
            // resolved by the duplicates strategy (#6).
            const resolution = this.resolveScalarToContainer(existingValue, nextKey, current, prop);

            if (isErr(resolution)) {
              return resolution;
            }

            if (resolution === undefined) {
              return;
            }

            current = resolution.container;
            parent = resolution.parent;
            parentKey = resolution.parentKey;
          }

          continue;
        }
      }

      if (isLast) {
        // R3: an empty-bracket push (`a[]=x`) that lands on a RECORD (not an
        // array) container — e.g. `a[b]=1&a[]=2` — assigns to the next
        // integer key (max(numeric own keys)+1, else "0"), never the literal
        // "" key. `prop` only carries '' here as a bracket-derived push
        // marker (a bare, non-bracketed key can never reach this loop), so
        // this cannot be confused with a genuine top-level empty key name.
        const leafKey = prop === '' && this.isRecordValue(current) ? this.nextRecordIntegerKey(current) : prop;
        const leafResult = this.assignLeaf(current, leafKey, value);

        if (isErr(leafResult)) {
          return leafResult;
        }
      } else if (this.isRecordValue(current)) {
        // Create next container
        if (!Object.prototype.hasOwnProperty.call(current, prop)) {
          const nextKey = keys[k + 1] ?? '';
          const created: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

          current[prop] = created;
          parent = current;
          parentKey = prop;
          current = created;
        } else {
          const target = current[prop];

          if (this.isRecordValue(target) || Array.isArray(target)) {
            parent = current;
            parentKey = prop;
            current = target;
          } else if (target === undefined) {
            return;
          } else {
            // An existing scalar at this key being nested into is a
            // scalar↔container collision, resolved by the duplicates
            // strategy (#6) — symmetric with the array-index path above.
            const nextKey = keys[k + 1] ?? '';
            const resolution = this.resolveScalarToContainer(target, nextKey, current, prop);

            if (isErr(resolution)) {
              return resolution;
            }

            if (resolution === undefined) {
              return;
            }

            current = resolution.container;
            parent = resolution.parent;
            parentKey = resolution.parentKey;
          }
        }
      } else {
        return;
      }
    }
  }

  private shouldCreateArray(nextKey: string): boolean {
    if (nextKey === '') {
      return true;
    }

    if (this.isValidArrayIndex(nextKey)) {
      const n = parseInt(nextKey, 10);

      return n >= 0 && n <= this.options.arrayLimit;
    }

    return false;
  }

  /**
   * Assigns a value to a leaf position, with optional strict mode error reporting.
   */
  private assignLeaf(obj: QueryContainer, key: string, value: string): Err<QueryParserErrorData> | undefined {
    if (this.isBlockedKey(key)) {
      return;
    }

    if (key === '' && Array.isArray(obj)) {
      obj.push(value);

      return;
    }

    if (Array.isArray(obj)) {
      if (this.isValidArrayIndex(key)) {
        // Invariant: every caller that can reach this branch with an array
        // `obj` (parseComplexKey's push/leaf sites) has already materialized
        // any hole/over-limit index into an object beforehand, so `idx` here
        // is always <= obj.length && <= arrayLimit — never a drop candidate.
        const idx = parseInt(key, 10);

        return this.assignToArrayIndex(obj, idx, key, value);
      }

      // Key-kind mismatch (non-numeric key on an array), same as the
      // parseComplexKey traversal-time conversion above — lossless, never
      // throws even in strict mode (#2).
      this.assignArrayRecordValue(obj, key, value);

      return;
    }

    return this.assignToRecord(obj, key, value);
  }

  /**
   * R3 helper: the next integer key to use when an empty-bracket push (`[]`)
   * lands on a RECORD container instead of an array — `max(numeric own
   * keys) + 1`, or `"0"` when the record has no numeric own keys yet.
   */
  private nextRecordIntegerKey(obj: QueryValueRecord): string {
    let max = -1;

    for (const key of Object.keys(obj)) {
      if (this.isValidArrayIndex(key)) {
        const n = parseInt(key, 10);

        if (n > max) {
          max = n;
        }
      }
    }

    return (max + 1).toString();
  }

  /**
   * Assigns a value to a record, handling duplicate key strategy and conflict detection.
   */
  private assignToRecord(obj: QueryValueRecord, key: string, value: string): Err<QueryParserErrorData> | undefined {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      obj[key] = value;

      return;
    }

    const existing = obj[key];

    if (typeof existing === 'object' && existing !== null) {
      if (Array.isArray(existing) && this.options.duplicates === DuplicateStrategy.Array) {
        existing.push(value);

        return;
      }

      if (this.options.duplicates === DuplicateStrategy.Array) {
        // Existing value is a RECORD (not an array) — 'array' still combines
        // losslessly, wrapping both into a fresh array (#3/#6). Never throws.
        obj[key] = [existing, value];

        return;
      }

      // Lossy container→scalar collision (first/last): strict throws (#2b).
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: key "${key}" is a nested structure but being assigned a scalar value`,
        });
      }

      if (this.options.duplicates !== DuplicateStrategy.Last) {
        return;
      }
    }

    if (this.options.duplicates === DuplicateStrategy.First) {
      return;
    }

    if (this.options.duplicates === DuplicateStrategy.Last) {
      obj[key] = value;

      return;
    }

    // Array mode
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      obj[key] = existing === undefined ? [value] : [existing, value];
    }
  }

  /**
   * Assigns a scalar to an explicit array index, applying the same duplicate-key
   * strategy and structure/scalar conflict detection as {@link assignToRecord}
   * so array indices behave consistently with object keys.
   */
  private assignToArrayIndex(
    arr: QueryArray,
    idx: number,
    key: string,
    value: string,
  ): Err<QueryParserErrorData> | undefined {
    const existing = arr[idx];

    if (existing === undefined) {
      this.assignArrayRecordValue(arr, key, value);

      return;
    }

    if (typeof existing === 'object' && existing !== null) {
      if (Array.isArray(existing) && this.options.duplicates === DuplicateStrategy.Array) {
        existing.push(value);

        return;
      }

      if (this.options.duplicates === DuplicateStrategy.Array) {
        // Existing value is a RECORD (not an array) at this index — 'array'
        // still combines losslessly, wrapping both into a fresh array
        // (#3/#6). Never throws.
        this.assignArrayRecordValue(arr, key, [existing, value]);

        return;
      }

      // Lossy container→scalar collision (first/last): strict throws (#2b).
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: index "${key}" is a nested structure but being assigned a scalar value`,
        });
      }

      if (this.options.duplicates !== DuplicateStrategy.Last) {
        return;
      }
    }

    if (this.options.duplicates === DuplicateStrategy.First) {
      return;
    }

    if (this.options.duplicates === DuplicateStrategy.Last) {
      this.assignArrayRecordValue(arr, key, value);

      return;
    }

    // duplicates:'array' with an existing scalar — combine into a pair. An
    // existing array is already handled by the fast path above, so `existing`
    // is necessarily a scalar at this point.
    this.assignArrayRecordValue(arr, key, [existing, value]);
  }

  private assignArrayRecordValue(target: QueryArray, key: string, value: QueryValue): void {
    // Direct assignment is safe here: dangerous keys (Object.prototype own-names,
    // plus `__proto__`) are filtered upstream by isBlockedKey before any write
    // reaches this sink, and non-numeric keys convert the array to a plain
    // object before assignment — so `key` is only ever a numeric index or an
    // already-cleared property name.
    (target as unknown as Record<string, QueryValue>)[key] = value;
  }

  private normalizeKey(key: string | number): string {
    return typeof key === 'number' ? key.toString() : key;
  }

  /**
   * Checks if a string represents a valid non-negative integer for array indexing.
   * Rejects: negative numbers, floats, empty strings, non-numeric strings, leading zeros.
   */
  private isValidArrayIndex(str: string): boolean {
    if (str.length === 0 || str.length > 10) {
      return false;
    }

    const code = str.charCodeAt(0);

    // First char must be 0-9
    if (code < 48 || code > 57) {
      return false;
    }

    // Reject leading zeros (except "0" itself)
    if (code === 48 && str.length > 1) {
      return false;
    }

    for (let i = 1; i < str.length; i++) {
      const c = str.charCodeAt(i);

      if (c < 48 || c > 57) {
        return false;
      }
    }

    return true;
  }

  /**
   * Materializes an array container into a plain object in place, rewriting
   * the single reference the array's parent holds to it — the only place
   * that can be done without leaving an orphan reference is here, inside
   * {@link parseComplexKey}, which is the sole holder of `parent`/`parentKey`.
   * Used whenever an explicit index would otherwise create a hole
   * (`index > current.length`) or exceed `arrayLimit` (`index > arrayLimit`):
   * materializing BEFORE the write means no null/undefined element, and no
   * silently dropped value, is ever produced.
   */
  private materializeArray(
    current: QueryArray,
    parent: QueryContainer,
    parentKey: string | number,
  ): QueryValueRecord {
    const materialized = this.arrayToObject(current);

    this.writeContainerSlot(parent, parentKey, materialized);

    return materialized;
  }

  /**
   * Resolves a scalar↔container collision where a SCALAR value already
   * exists and the current key path needs to build a CONTAINER there (`a=1`
   * then `a[b]=2`, at any depth) — the mirror direction of
   * {@link assignToRecord}'s container↔scalar collision. Resolved by the
   * `duplicates` strategy (#6):
   * - `array`: wraps losslessly — never throws, even in strict mode (#3).
   *   `existingScalar` becomes the first element of a fresh array; when the
   *   next path segment is itself array-shaped (`a=2&a[]=1`), that array IS
   *   the slot's new value (`["2","1"]`); otherwise the slot becomes
   *   `[existingScalar, newContainer]` and traversal continues into
   *   `newContainer` (`a=2&a[b]=1` → `{a:["2",{b:"1"}]}`).
   * - `first`/`last` are lossy: strict throws `ConflictingStructure` (#2b).
   *   Non-strict `first` returns `undefined` — the caller must abort the
   *   whole pair, leaving the existing scalar untouched. Non-strict `last`
   *   overwrites the slot with a fresh, empty container.
   *
   * Writes the resolved replacement into `slotParent[slotKey]` itself, then
   * returns the container to continue traversal into plus its OWN
   * parent/parentKey (which, under an `array` wrap, is one level deeper than
   * `slotParent`/`slotKey` — the wrapper array, not the original slot).
   */
  private resolveScalarToContainer(
    existingScalar: QueryValue,
    nextKey: string,
    slotParent: QueryContainer,
    slotKey: string | number,
  ):
    | Err<QueryParserErrorData>
    | { container: QueryContainer; parent: QueryContainer; parentKey: string | number }
    | undefined {
    if (this.options.duplicates === DuplicateStrategy.Array) {
      if (this.shouldCreateArray(nextKey)) {
        const arr: QueryArray = [existingScalar];

        this.writeContainerSlot(slotParent, slotKey, arr);

        return { container: arr, parent: slotParent, parentKey: slotKey };
      }

      const container: QueryValueRecord = {};
      const wrapper: QueryArray = [existingScalar, container];

      this.writeContainerSlot(slotParent, slotKey, wrapper);

      return { container, parent: wrapper, parentKey: 1 };
    }

    if (this.options.strict) {
      return err<QueryParserErrorData>({
        reason: QueryParserErrorReason.ConflictingStructure,
        message: `Conflict: key "${this.normalizeKey(slotKey)}" is both a scalar and a nested structure`,
      });
    }

    if (this.options.duplicates === DuplicateStrategy.First) {
      return undefined;
    }

    // Last: overwrite entirely with a fresh, empty container.
    const container: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

    this.writeContainerSlot(slotParent, slotKey, container);

    return { container, parent: slotParent, parentKey: slotKey };
  }

  /** Writes `value` into `parent[key]`, whether `parent` is an array or a record. */
  private writeContainerSlot(parent: QueryContainer, key: string | number, value: QueryContainer): void {
    if (Array.isArray(parent)) {
      this.assignArrayRecordValue(parent, this.normalizeKey(key), value);
    } else if (this.isRecordValue(parent)) {
      parent[this.normalizeKey(key)] = value;
    }
  }

  /**
   * Converts an array to an object where indices become string keys.
   */
  private arrayToObject(arr: QueryArray): QueryValueRecord {
    const obj: QueryValueRecord = {};

    for (const key of Object.keys(arr)) {
      const value = (arr as unknown as Record<string, QueryValue>)[key];

      if (value !== undefined) {
        obj[key] = value;
      }
    }

    return obj;
  }

  private isRecordValue(value: QueryValue | undefined): value is QueryValueRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private safeDecode(raw: string): string {
    // '+'->space and percent-decoding are independent passes (WHATWG
    // x-www-form-urlencoded / URLSearchParams), applied in that order (§2.4).
    const input = this.options.urlEncoded && raw.includes('+') ? raw.replaceAll('+', ' ') : raw;

    // ASCII fast path — no throw; handles valid and malformed pure-ASCII input
    // (e.g. '%ZZ') directly, sidestepping decodeURIComponent's costly throw on
    // malformed input. Malformed '%' is preserved (§2.6); it is NOT an error,
    // even in strict mode (strict validates structure, not percent syntax).
    const ascii = whatwgPercentDecodeAscii(input);

    if (ascii !== null) {
      return ascii;
    }

    // A non-ASCII byte is involved: native decode is fastest for valid multi-byte
    // UTF-8; on invalid UTF-8 it throws and the byte-level decode applies
    // replacement (invalid UTF-8 → U+FFFD, §2.5) and never fails.
    try {
      return decodeURIComponent(input);
    } catch {
      return whatwgPercentDecodeBytes(input);
    }
  }
}
