import { err, isErr } from '@zipbul/result';
import type { Err, Result } from '@zipbul/result';

import { POISONED_KEYS } from './constants';
import { QueryParserErrorReason } from './enums';
import { QueryParserError } from './errors';
import type { QueryParserErrorData } from './errors';
import type { QueryParserOptions } from './interfaces';
import { resolveQueryParserOptions, validateQueryParserOptions } from './options';
import type { QueryArray, QueryContainer, QueryValue, QueryValueRecord, ResolvedQueryParserOptions } from './types';

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
        if (keyEnd === -1) {
          keyEnd = i;
          valStart = i;
        }

        const pairResult = this.processPair(res, qs, keyStart, keyEnd, valStart, i);

        if (isErr(pairResult)) {
          return pairResult;
        }

        // Only a real key-value pair counts toward maxParams. Empty segments
        // (`&&`, `=&`) emit nothing (processPair returns false) and must not
        // erode the budget, or they would silently drop later real parameters.
        if (pairResult) {
          paramCount++;

          if (paramCount >= this.options.maxParams) {
            limitReached = true;
            break;
          }
        }

        // Reset
        keyStart = i + 1;
        keyEnd = -1;
        valStart = -1;
        isKey = true;
      }

      i++;
    }

    // Process last pair (only if limit was not reached)
    if (!limitReached && keyStart < len) {
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
   * Decodes and stores a single key-value pair.
   *
   * @returns `true` if a pair was emitted (counts toward maxParams), `false` if
   *   the segment was empty/skipped, or `Err` on a strict-mode failure.
   */
  private processPair(
    res: QueryValueRecord,
    qs: string,
    keyStart: number,
    keyEnd: number,
    valStart: number,
    valEnd: number,
  ): Err<QueryParserErrorData> | boolean {
    // Decode Key
    const keyRaw = qs.slice(keyStart, keyEnd);
    const keyNeedsDecode = keyRaw.includes('%') || (this.options.urlEncoded && keyRaw.includes('+'));
    const keyDecoded = keyNeedsDecode ? this.safeDecode(keyRaw) : keyRaw;

    if (isErr(keyDecoded)) {
      return keyDecoded;
    }

    const key = keyDecoded;

    if (!key) {
      return false;
    }

    // Decode Value
    let val = '';

    if (valStart < valEnd) {
      const valRaw = qs.slice(valStart, valEnd);
      const valNeedsDecode = valRaw.includes('%') || (this.options.urlEncoded && valRaw.includes('+'));
      const valDecoded = valNeedsDecode ? this.safeDecode(valRaw) : valRaw;

      if (isErr(valDecoded)) {
        return valDecoded;
      }

      val = valDecoded;
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

      // `?? true`: assign* returns undefined on success, Err on strict failure.
      // Map success to `true` so the caller counts this as an emitted pair.
      return this.assignLeaf(res, key, val) ?? true;
    }

    if (!this.options.nesting) {
      if (this.options.strict) {
        const bracketResult = this.validateBrackets(key);

        if (isErr(bracketResult)) {
          return bracketResult;
        }
      }

      return this.assignLeaf(res, key, val) ?? true;
    }

    return this.parseComplexKey(res, key, braceIdx, val) ?? true;
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

  private parseComplexKey(
    root: QueryValueRecord,
    key: string,
    firstBrace: number,
    value: string,
  ): Err<QueryParserErrorData> | undefined {
    // `current` is assigned from the resolved root container below (or the
    // function returns first), so no initializer is needed here.
    let current: QueryContainer;
    let depth = 0;
    const maxDepth = this.options.depth;
    const rootKey = key.slice(0, firstBrace);

    if (rootKey === '' || POISONED_KEYS.has(rootKey)) {
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

    // State machine for parsing brackets
    let i = firstBrace;
    const len = key.length;
    let partStart = -1;
    const keys: string[] = [rootKey];

    while (i < len) {
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

      i++;
    }

    // Unclosed bracket
    if (partStart !== -1) {
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: unclosed bracket in key "${key}"`,
        });
      }

      return this.assignLeaf(root, key, value);
    }

    // Pollution check — up front, before any container is built. A poisoned
    // segment anywhere in the key drops the whole pair; doing this before
    // container creation guarantees a rejected key leaves no phantom parent
    // behind (e.g. `a[__proto__][x]=1` yields {} rather than {a:{}}).
    for (let s = 1; s < keys.length; s++) {
      if (POISONED_KEYS.has(keys[s] ?? '')) {
        return;
      }
    }

    // Initialize/Validate root container
    if (!Object.prototype.hasOwnProperty.call(root, rootKey)) {
      const nextKey = keys[1] ?? '';

      root[rootKey] = this.shouldCreateArray(nextKey) ? [] : {};
    } else {
      if (typeof root[rootKey] !== 'object' || root[rootKey] === null) {
        if (this.options.strict) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: key "${rootKey}" is both a scalar and a nested structure`,
          });
        }

        const nextKey = keys[1] ?? '';

        root[rootKey] = this.shouldCreateArray(nextKey) ? [] : {};
      }
    }

    let parent: QueryContainer = root;
    let parentKey: string | number = rootKey;
    const rootContainer = root[rootKey];

    if (this.isRecordValue(rootContainer) || Array.isArray(rootContainer)) {
      current = rootContainer;
    } else {
      return;
    }

    // Traverse and build from 2nd key match
    for (let k = 1; k < keys.length; k++) {
      let prop = keys[k] ?? '';
      const isLast = k === keys.length - 1;

      // `[]` array-append targeting a parent that resolved to a record (e.g.
      // `a[k]=1&a[]=2`) would otherwise write to obj[''], a spurious empty-string
      // key. Treat it as a structure conflict in strict mode; in lenient mode
      // synthesize the next free numeric index so the value is preserved under a
      // sane key, symmetric with the array→object conversion path. This runs
      // BEFORE the depth cap so the boundary case still normalizes the empty prop
      // instead of assigning the value under '' at the deepest level.
      if (prop === '' && this.isRecordValue(current)) {
        if (this.options.strict) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: array-append "[]" used on an object structure at "${parentKey}"`,
          });
        }

        prop = this.nextRecordIndex(current);
      }

      // Depth cap. `depth` counts the container levels descended so far. When a
      // non-terminal key would push past the cap, stop descending and keep the
      // value at the deepest permitted level as a leaf. Dropping it here (and
      // leaving the just-created container empty) silently loses client data and
      // leaves a phantom `{}` where a scalar was sent. Like maxParams/arrayLimit
      // this truncates deeper structure silently rather than raising an error.
      if (!isLast && depth + 1 >= maxDepth) {
        return this.assignLeaf(current, prop, value);
      }

      // (Poisoned segments were already rejected up front, before any container
      // was built — see the pre-scan above.)

      // Conversion: Array with non-numeric key → Object
      if (Array.isArray(current) && prop !== '' && !this.isValidArrayIndex(prop)) {
        if (this.options.strict) {
          return err<QueryParserErrorData>({
            reason: QueryParserErrorReason.ConflictingStructure,
            message: `Conflict: non-numeric key "${prop}" used on an array structure at "${parentKey}"`,
          });
        }

        current = this.arrayToObject(current);

        if (Array.isArray(parent)) {
          const normalizedKey = this.normalizeKey(parentKey);

          this.assignArrayRecordValue(parent, normalizedKey, current);
        } else if (this.isRecordValue(parent)) {
          parent[this.normalizeKey(parentKey)] = current;
        }
      }

      if (Array.isArray(current)) {
        if (prop === '') {
          if (isLast) {
            const leafErr = this.assignLeaf(current, prop, value);

            if (isErr(leafErr)) {
              return leafErr;
            }

            depth++;

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          const nextContainer: QueryContainer = this.shouldCreateArray(nextKey) ? [] : {};

          current.push(nextContainer);
          parent = current;
          parentKey = current.length - 1;
          current = nextContainer;
          depth++;

          continue;
        }

        if (this.isValidArrayIndex(prop)) {
          const index = parseInt(prop, 10);

          if (index > this.options.arrayLimit) {
            return;
          }

          if (isLast) {
            const leafErr = this.assignLeaf(current, prop, value);

            if (isErr(leafErr)) {
              return leafErr;
            }

            depth++;

            continue;
          }

          const nextKey = keys[k + 1] ?? '';
          let nextValue = current[index];

          if (!this.isRecordValue(nextValue) && !Array.isArray(nextValue)) {
            // An existing scalar at this index being nested into is a
            // structure/scalar conflict — symmetric with the record path.
            if (nextValue !== undefined && this.options.strict) {
              return err<QueryParserErrorData>({
                reason: QueryParserErrorReason.ConflictingStructure,
                message: `Conflict: index "${prop}" is both a scalar and a nested structure`,
              });
            }

            nextValue = this.shouldCreateArray(nextKey) ? [] : {};
            this.assignArrayRecordValue(current, prop, nextValue);
          }

          parent = current;
          parentKey = prop;
          current = nextValue;
          depth++;

          continue;
        }
      }

      if (isLast) {
        const leafResult = this.assignLeaf(current, prop, value);

        if (isErr(leafResult)) {
          return leafResult;
        }
      } else {
        // Create next container
        if (this.isRecordValue(current) && !Object.prototype.hasOwnProperty.call(current, prop)) {
          const nextKey = keys[k + 1] ?? '';

          current[prop] = this.shouldCreateArray(nextKey) ? [] : {};
        } else if (this.isRecordValue(current)) {
          const target = current[prop];

          if (typeof target !== 'object' || target === null) {
            if (this.options.strict) {
              return err<QueryParserErrorData>({
                reason: QueryParserErrorReason.ConflictingStructure,
                message: `Conflict: key "${prop}" is both a scalar and a nested structure`,
              });
            }

            const nextKey = keys[k + 1] ?? '';

            current[prop] = this.shouldCreateArray(nextKey) ? [] : {};
          }
        }

        // Advance
        parent = current;
        parentKey = prop;

        const nextValue = this.isRecordValue(current) ? current[prop] : undefined;

        if (this.isRecordValue(nextValue) || Array.isArray(nextValue)) {
          current = nextValue;
        } else {
          return;
        }
      }

      depth++;
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
    if (POISONED_KEYS.has(key)) {
      return;
    }

    if (key === '' && Array.isArray(obj)) {
      obj.push(value);

      return;
    }

    if (Array.isArray(obj)) {
      if (this.isValidArrayIndex(key)) {
        const idx = parseInt(key, 10);

        if (idx > this.options.arrayLimit) {
          return;
        }

        return this.assignToArrayIndex(obj, idx, key, value);
      }

      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: non-numeric key "${key}" used on an array structure`,
        });
      }

      this.assignArrayRecordValue(obj, key, value);

      return;
    }

    return this.assignToRecord(obj, key, value);
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
      if (Array.isArray(existing) && this.options.duplicates === 'array') {
        existing.push(value);

        return;
      }

      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: key "${key}" is a nested structure but being assigned a scalar value`,
        });
      }

      if (this.options.duplicates !== 'last') {
        return;
      }
    }

    if (this.options.duplicates === 'first') {
      return;
    }

    if (this.options.duplicates === 'last') {
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
      if (Array.isArray(existing) && this.options.duplicates === 'array') {
        existing.push(value);

        return;
      }

      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.ConflictingStructure,
          message: `Conflict: index "${key}" is a nested structure but being assigned a scalar value`,
        });
      }

      if (this.options.duplicates !== 'last') {
        return;
      }
    }

    if (this.options.duplicates === 'first') {
      return;
    }

    if (this.options.duplicates === 'last') {
      this.assignArrayRecordValue(arr, key, value);

      return;
    }

    // duplicates:'array' with an existing scalar — combine into a pair. An
    // existing array is already handled by the fast path above, so `existing`
    // is necessarily a scalar at this point.
    this.assignArrayRecordValue(arr, key, [existing, value]);
  }

  private assignArrayRecordValue(target: QueryArray, key: string, value: QueryValue): void {
    // Direct assignment is safe here: `__proto__` is filtered upstream by
    // POISONED_KEYS before any write reaches this sink, and non-numeric keys
    // convert the array to a plain object before assignment — so `key` is only
    // ever a numeric index or an already-cleared property name. Any other name
    // (constructor, prototype, …) is written as a harmless own-property shadow.
    (target as unknown as Record<string, QueryValue>)[key] = value;
  }

  private normalizeKey(key: string | number): string {
    return typeof key === 'number' ? key.toString() : key;
  }

  /**
   * Smallest non-negative integer (as a string) that is not already an own key
   * of `obj`. Used to give `[]` array-append a sane index when its parent
   * resolved to a record instead of an array.
   */
  private nextRecordIndex(obj: QueryValueRecord): string {
    let n = 0;

    while (Object.prototype.hasOwnProperty.call(obj, String(n))) {
      n++;
    }

    return String(n);
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

  private safeDecode(raw: string): string | Err<QueryParserErrorData> {
    // '+'->space and percent-decoding are independent passes (WHATWG
    // x-www-form-urlencoded / URLSearchParams). Compute the '+'-substituted
    // string up front so a percent-decode failure still preserves it.
    const input = this.options.urlEncoded && raw.includes('+') ? raw.replaceAll('+', ' ') : raw;

    try {
      return decodeURIComponent(input);
    } catch {
      if (this.options.strict) {
        return err<QueryParserErrorData>({
          reason: QueryParserErrorReason.MalformedQueryString,
          message: `Malformed query string: invalid percent encoding in "${raw}"`,
        });
      }

      return input;
    }
  }
}
