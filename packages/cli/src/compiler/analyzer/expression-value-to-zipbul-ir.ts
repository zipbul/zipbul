import type {
  ExpressionValue,
  ExpressionCall,
  ExpressionFunction,
  ExpressionIdentifier,
  ExpressionObject,
  KeyExpression,
} from '@zipbul/gildash';

import type { AnalyzerValue, AnalyzerValueRecord } from './types';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE, ZIPBUL_SPREAD, ZIPBUL_COMPUTED_PREFIX,
  ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE, ZIPBUL_UNRESOLVABLE,
  ZIPBUL_LAZY_REF,
} from '@zipbul/common';

/**
 * Pure conversion: gildash `ExpressionValue` → zipbul IR (`AnalyzerValue`).
 *
 * Single responsibility — no side effects, no collection of inject calls,
 * no factory ref tracking. Higher-level extractors layer additional
 * passes on top of this primitive.
 *
 * @public
 */
export function convertExpression(expr: ExpressionValue): AnalyzerValue {
  return convertExpressionWithHooks(expr, undefined);
}

/**
 * Per-node hooks for {@link convertExpressionWithHooks} — enable the deep
 * converter (`expression-converter.ts:convertExpressionDeep`) to layer
 * inject-call collection, factory-ref tracking, import-source path
 * resolution, and lazy-thunk alias resolution on top of the same single
 * tree-walk used by the pure converter. With `hooks === undefined` the
 * walker behaves identically to the pure {@link convertExpression}.
 *
 * @public
 */
export interface ExpressionConvertHooks {
  /**
   * Transform a raw `importSource` string. Used by the deep converter to
   * resolve relative paths (`'./foo'`) to absolute paths via the project's
   * import resolver. Default = identity (returns input unchanged).
   */
  readonly resolveSource?: (raw: string | undefined) => string | undefined;
  /**
   * Fallback `importSource` lookup for `member` expressions whose own
   * `importSource` is `undefined`. Receives the root identifier of the
   * member chain (e.g. `'a'` in `a.b.c`) and returns the resolved source.
   * Default = no fallback.
   */
  readonly resolveObjectSource?: (rootIdent: string) => string | undefined;
  /**
   * Notification hook fired once per `call` node. Used by the deep
   * converter to collect `inject(...)` calls into a side channel without
   * affecting the converted IR shape.
   */
  readonly onCall?: (expr: ExpressionCall) => void;
  /**
   * Override for the lazy-thunk identifier resolver. Receives the bare
   * identifier captured from `lazy(() => Foo)`, returns the canonical
   * (alias-resolved) name. Default = identity.
   */
  readonly transformLazyRefName?: (refName: string) => string;
  /**
   * Notification hook fired once per `function` node. Used by the deep
   * converter to track factory references for downstream enrichment.
   */
  readonly onFunction?: (expr: ExpressionFunction) => void;
}

/**
 * Single tree-walking converter shared by the pure {@link convertExpression}
 * and the enriched `convertExpressionDeep`. Hooks are optional; when
 * `hooks === undefined` the walker emits the canonical IR with no side
 * effects and no path/alias resolution — identical to the pure converter.
 *
 * @public
 */
export function convertExpressionWithHooks(
  expr: ExpressionValue,
  hooks: ExpressionConvertHooks | undefined,
): AnalyzerValue {
  const recurse = (child: ExpressionValue): AnalyzerValue => convertExpressionWithHooks(child, hooks);

  switch (expr.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return expr.value;

    case 'undefined':
      return undefined;

    case 'identifier': {
      const importSource = hooks?.resolveSource !== undefined
        ? hooks.resolveSource(expr.importSource)
        : expr.importSource;
      return {
        [ZIPBUL_REF]: expr.originalName ?? expr.name,
        [ZIPBUL_IMPORT_SOURCE]: importSource,
      };
    }

    case 'member': {
      const ownSource = hooks?.resolveSource !== undefined
        ? hooks.resolveSource(expr.importSource)
        : expr.importSource;
      const fallbackSource = ownSource === undefined && hooks?.resolveObjectSource !== undefined
        ? hooks.resolveObjectSource(expr.object)
        : undefined;
      return {
        [ZIPBUL_REF]: `${expr.object}.${expr.property}`,
        [ZIPBUL_IMPORT_SOURCE]: ownSource ?? fallbackSource,
      };
    }

    case 'call': {
      hooks?.onCall?.(expr);

      // `lazy(() => Foo)` collapse — same logic as `convertCallExpression`,
      // optionally aliased through `hooks.transformLazyRefName`.
      if (expr.callee === 'lazy' && expr.arguments.length > 0) {
        const firstArg = expr.arguments[0];
        if (firstArg !== undefined && firstArg.kind === 'function') {
          const refName = extractLazyRefName(firstArg.sourceText);
          if (refName !== null) {
            const resolvedName = hooks?.transformLazyRefName !== undefined
              ? hooks.transformLazyRefName(refName)
              : refName;
            return { [ZIPBUL_LAZY_REF]: resolvedName };
          }
        }
      }

      const importSource = hooks?.resolveSource !== undefined
        ? hooks.resolveSource(expr.importSource)
        : expr.importSource;
      return {
        [ZIPBUL_CALL]: expr.callee,
        [ZIPBUL_IMPORT_SOURCE]: importSource,
        args: expr.arguments.map(recurse),
      };
    }

    case 'new':
      return {
        [ZIPBUL_NEW]: expr.callee,
        args: expr.arguments.map(recurse),
      };

    case 'object':
      return convertObjectExpressionWith(expr, recurse);

    case 'array':
      return expr.elements.map(recurse);

    case 'spread':
      return { [ZIPBUL_SPREAD]: recurse(expr.argument) };

    case 'function':
      hooks?.onFunction?.(expr);
      return convertFunctionExpression(expr);

    case 'template':
    case 'unresolvable':
      return { [ZIPBUL_UNRESOLVABLE]: true, sourceText: expr.sourceText };
  }
}

/**
 * Identifier → `{ [ZIPBUL_REF]: name, [ZIPBUL_IMPORT_SOURCE]?: source }`.
 * Aliased imports (`import { Foo as Bar }`) emit the original exported name.
 *
 * @public
 */
export function identifierToRef(expr: ExpressionIdentifier): AnalyzerValueRecord {
  return {
    [ZIPBUL_REF]: expr.originalName ?? expr.name,
    [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
  };
}

/**
 * Call expression → IR. Detects `lazy(() => Foo)` thunk pattern and
 * collapses it to `{ [ZIPBUL_LAZY_REF]: 'Foo' }`. All other calls
 * become generic `{ [ZIPBUL_CALL]: callee, args }`.
 *
 * @public
 */
export function convertCallExpression(expr: ExpressionCall): AnalyzerValue {
  if (expr.callee === 'lazy' && expr.arguments.length > 0) {
    const firstArg = expr.arguments[0];

    if (firstArg !== undefined && firstArg.kind === 'function') {
      const refName = extractLazyRefName(firstArg.sourceText);

      if (refName !== null) {
        return { [ZIPBUL_LAZY_REF]: refName };
      }
    }
  }

  return {
    [ZIPBUL_CALL]: expr.callee,
    [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
    args: expr.arguments.map(convertExpression),
  };
}

/**
 * Function expression → `{ [ZIPBUL_FACTORY_CODE]: sourceText }` plus
 * `__zipbul_factory_params` when typed parameters are present.
 *
 * @public
 */
export function convertFunctionExpression(expr: ExpressionFunction): AnalyzerValueRecord {
  const result: AnalyzerValueRecord = { [ZIPBUL_FACTORY_CODE]: expr.sourceText };

  if (expr.parameters !== undefined && expr.parameters.length > 0) {
    const params: AnalyzerValueRecord[] = expr.parameters.map(param => {
      const entry: AnalyzerValueRecord = {
        name: param.name,
        typeName: param.type ?? null,
      };

      if (param.typeImportSource !== undefined) {
        entry.importSource = param.typeImportSource;
      }

      if (param.isOptional === true) {
        entry.isOptional = true;
      }

      if (typeof param.defaultValue === 'string') {
        entry.defaultValue = param.defaultValue;
      }

      return entry;
    });

    result.__zipbul_factory_params = params;
  }

  return result;
}

/**
 * Determines whether a `KeyExpression` is a computed key
 * (`[expr]`) versus a plain literal/identifier key.
 *
 * Plain identifier keys (in source: `{ foo: 1 }`) are encoded by gildash
 * as `{ kind: 'string', value: 'foo' }` — same as string-literal keys.
 * Numeric keys (`{ 42: 'x' }`) are `{ kind: 'number', value: 42 }`.
 * Anything else (identifier ref, member access, call, etc.) is `[expr]`.
 */
function isComputedKey(key: KeyExpression): boolean {
  return key.kind !== 'string' && key.kind !== 'number' && key.kind !== 'boolean' && key.kind !== 'null' && key.kind !== 'undefined';
}

/**
 * Object expression → `AnalyzerValueRecord`. Computed keys are encoded
 * as `${ZIPBUL_COMPUTED_PREFIX}${index}` entries with `ZIPBUL_COMPUTED_KEY`
 * and `ZIPBUL_COMPUTED_VALUE` sub-records. Spread entries become a single
 * `${ZIPBUL_COMPUTED_PREFIX}spread${index}` carrying `ZIPBUL_SPREAD`.
 *
 * @public
 */
export function convertObjectExpression(expr: ExpressionObject): AnalyzerValueRecord {
  return convertObjectExpressionWith(expr, convertExpression);
}

/**
 * Variant of {@link convertObjectExpression} that delegates child conversion
 * to a caller-supplied recursor. Used by {@link convertExpressionWithHooks}
 * so that nested expressions inside an object pick up the same hooks
 * (inject collection, source resolution, etc.) as the parent walk.
 */
function convertObjectExpressionWith(
  expr: ExpressionObject,
  recurse: (child: ExpressionValue) => AnalyzerValue,
): AnalyzerValueRecord {
  const result: AnalyzerValueRecord = {};
  let computedIndex = 0;
  let spreadIndex = 0;

  for (const entry of expr.properties) {
    if (entry.kind === 'spread') {
      // Spread inside an object literal — encode as a synthetic computed slot.
      result[`${ZIPBUL_COMPUTED_PREFIX}spread${spreadIndex}`] = { [ZIPBUL_SPREAD]: recurse(entry.argument) };
      spreadIndex++;

      continue;
    }

    const key = entry.key;

    if (isComputedKey(key)) {
      const keyExpr = recurse(key);
      const valExpr = recurse(entry.value);

      result[`${ZIPBUL_COMPUTED_PREFIX}${computedIndex}`] = {
        [ZIPBUL_COMPUTED_KEY]: keyExpr,
        [ZIPBUL_COMPUTED_VALUE]: valExpr,
      };
      computedIndex++;

      continue;
    }

    // Static key (string / number / boolean / null literal). Coerce to string —
    // JS object keys are always strings (or symbols) at runtime.
    const staticKey = key.kind === 'string' || key.kind === 'number' || key.kind === 'boolean'
      ? String(key.value)
      : key.kind === 'null'
        ? 'null'
        : 'undefined';

    result[staticKey] = recurse(entry.value);
  }

  return result;
}

/**
 * Extracts the returned identifier name from a lazy thunk source text.
 * Matches `() => Foo` and `() => { return Foo; }` shapes.
 *
 * @public
 */
export function extractLazyRefName(sourceText: string): string | null {
  const arrowMatch = sourceText.match(/^\s*\(.*?\)\s*=>\s*(\w+)\s*$/);

  if (arrowMatch?.[1] !== undefined) {
    return arrowMatch[1];
  }

  const blockMatch = sourceText.match(/return\s+(\w+)\s*;?\s*\}/);

  if (blockMatch?.[1] !== undefined) {
    return blockMatch[1];
  }

  return null;
}
