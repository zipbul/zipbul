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
  switch (expr.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return expr.value;

    case 'undefined':
      return undefined;

    case 'identifier':
      return identifierToRef(expr);

    case 'member':
      return {
        [ZIPBUL_REF]: `${expr.object}.${expr.property}`,
        [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
      };

    case 'call':
      return convertCallExpression(expr);

    case 'new':
      return {
        [ZIPBUL_NEW]: expr.callee,
        args: expr.arguments.map(convertExpression),
      };

    case 'object':
      return convertObjectExpression(expr);

    case 'array':
      return expr.elements.map(convertExpression);

    case 'spread':
      return { [ZIPBUL_SPREAD]: convertExpression(expr.argument) };

    case 'function':
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
  const result: AnalyzerValueRecord = {};
  let computedIndex = 0;
  let spreadIndex = 0;

  for (const entry of expr.properties) {
    if (entry.kind === 'spread') {
      // Spread inside an object literal — encode as a synthetic computed slot.
      result[`${ZIPBUL_COMPUTED_PREFIX}spread${spreadIndex}`] = { [ZIPBUL_SPREAD]: convertExpression(entry.argument) };
      spreadIndex++;

      continue;
    }

    const key = entry.key;

    if (isComputedKey(key)) {
      const keyExpr = convertExpression(key);
      const valExpr = convertExpression(entry.value);

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

    result[staticKey] = convertExpression(entry.value);
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
