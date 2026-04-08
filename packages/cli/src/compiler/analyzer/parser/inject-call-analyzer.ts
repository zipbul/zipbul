import type { PatternMatch } from '@zipbul/gildash';
import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';

import type { InjectCall } from '../parser-models';
import type { FactoryInjectCall } from '../types';

/**
 * Extended PatternMatch with byte offset fields.
 *
 * The runtime API includes `startOffset`/`endOffset`/`startColumn`/`endColumn`
 * but the published type declarations may omit them. This type ensures
 * safe access.
 */
type PatternMatchWithOffsets = PatternMatch & {
  readonly startOffset?: number;
  readonly endOffset?: number;
};

/**
 * Callback that resolves a local name to its original (pre-alias) name
 * using the current file's import original-name map.
 */
interface ResolveOriginalName {
  (localName: string): string;
}

/**
 * Resolves the callee name from a matched inject call text.
 *
 * Strips the parenthesized argument portion from the matched text,
 * returning only the function/method name part.
 *
 * @param matchedText - Raw matched text from patternSearch (e.g. `'inject(Token)'`)
 * @returns The callee name without arguments (e.g. `'inject'`)
 */
export function resolveInjectCallee(matchedText: string): string {
  const parenIndex = matchedText.indexOf('(');

  if (parenIndex < 0) {
    return matchedText;
  }

  return matchedText.slice(0, parenIndex).trim();
}

/**
 * Finds the import source for a callee name (direct or namespace.method).
 *
 * Looks up the callee in the import-source map. If the callee contains
 * a dot (namespace access like `zipbul.inject`), falls back to looking
 * up the namespace prefix.
 *
 * @param calleeName - Callee name (e.g. `'inject'` or `'zipbul.inject'`)
 * @param currentImportSources - Map from local identifier to import source path
 * @returns The raw import source string, or undefined
 */
export function findImportSourceForCallee(
  calleeName: string,
  currentImportSources: Readonly<Record<string, string>>,
): string | undefined {
  const directSource = currentImportSources[calleeName];

  if (directSource !== undefined) {
    return directSource;
  }

  const dotIndex = calleeName.indexOf('.');

  if (dotIndex > 0) {
    const ns = calleeName.slice(0, dotIndex);

    return currentImportSources[ns];
  }

  return undefined;
}

/**
 * Builds an `InjectCall` from a patternSearch capture.
 *
 * Analyzes the captured argument text to determine the token kind:
 * - **thunk**: arrow/function expression wrapping a reference (e.g. `() => Token`)
 * - **token**: bare identifier or member expression (e.g. `Token`, `ns.Token`)
 * - **invalid**: empty args, multiple args, or unrecognized patterns
 *
 * @param capture - The `$$ARGS` capture from patternSearch, or undefined
 * @param callee - Resolved callee name
 * @param importSource - Import source string
 * @param currentFilePath - Absolute path of the file being analyzed
 * @param currentImports - Map from local identifier to import source path
 * @param resolveOriginalName - Function that resolves a local name to its original name
 * @returns The constructed InjectCall
 */
export function buildInjectCallFromCapture(
  capture: { text: string } | undefined,
  callee: string,
  importSource: string,
  currentFilePath: string,
  currentImports: Readonly<Record<string, string>>,
  resolveOriginalName: ResolveOriginalName,
): InjectCall {
  if (capture === undefined) {
    return {
      tokenKind: 'invalid',
      token: null,
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  const argText = capture.text.trim();

  // Multi-arg detection: if capture contains a comma at the top level, it's invalid
  if (hasMultipleArgs(argText)) {
    return {
      tokenKind: 'invalid',
      token: null,
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  // Empty args
  if (argText.length === 0) {
    return {
      tokenKind: 'invalid',
      token: null,
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  // Check for thunk patterns: () => X, function() { return X; }
  const thunkMatch = argText.match(/^\(\s*\)\s*=>\s*(\w+)\s*$/)
    ?? argText.match(/^function\s*\(\s*\)\s*\{\s*return\s+(\w+)\s*;?\s*\}$/);

  if (thunkMatch?.[1] !== undefined) {
    const refName = thunkMatch[1];
    const resolvedName = resolveOriginalName(refName);

    return {
      tokenKind: 'thunk',
      token: {
        [ZIPBUL_REF]: resolvedName,
        [ZIPBUL_IMPORT_SOURCE]: currentImports[refName],
      },
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  // Check for identifier token
  if (/^\w+$/.test(argText)) {
    const resolvedName = resolveOriginalName(argText);

    return {
      tokenKind: 'token',
      token: {
        [ZIPBUL_REF]: resolvedName,
        [ZIPBUL_IMPORT_SOURCE]: currentImports[argText],
      },
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  // Check for member expression (e.g., ns.Token)
  const memberMatch = argText.match(/^(\w+)\.(\w+)$/);

  if (memberMatch?.[1] !== undefined && memberMatch[2] !== undefined) {
    const objName = memberMatch[1];
    const propName = memberMatch[2];

    return {
      tokenKind: 'token',
      token: {
        [ZIPBUL_REF]: `${resolveOriginalName(objName)}.${propName}`,
        [ZIPBUL_IMPORT_SOURCE]: currentImports[objName],
      },
      callee,
      importSource,
      filePath: currentFilePath,
    };
  }

  return {
    tokenKind: 'invalid',
    token: null,
    callee,
    importSource,
    filePath: currentFilePath,
  };
}

/**
 * Collects inject calls that fall within a factory function's byte range
 * from pre-computed patternSearch results.
 *
 * Uses byte offsets from patternSearch matches to compute positions
 * relative to the factory function start for code replacement by the
 * injector generator.
 *
 * @param injectMatches - All inject pattern matches from patternSearch
 * @param _lineOffsets - Line offset table (unused, kept for call-site consistency)
 * @param funcStart - Factory function start byte offset
 * @param funcEnd - Factory function end byte offset
 * @param currentFilePath - Absolute path of the file being analyzed
 * @param currentImportSources - Map from local identifier to import source path
 * @param currentImports - Map from local identifier to import source path
 * @param currentInjectCalls - Mutable array to which discovered inject calls are appended
 * @param resolveOriginalName - Function that resolves a local name to its original name
 * @returns Array of factory inject calls with relative byte offsets
 */
export function collectFactoryInjectCalls(
  injectMatches: readonly PatternMatch[],
  _lineOffsets: readonly number[],
  funcStart: number,
  funcEnd: number,
  currentFilePath: string,
  currentImportSources: Readonly<Record<string, string>>,
  currentImports: Readonly<Record<string, string>>,
  currentInjectCalls: InjectCall[],
  resolveOriginalName: ResolveOriginalName,
): FactoryInjectCall[] {
  const result: FactoryInjectCall[] = [];

  for (const match of injectMatches) {
    const extMatch = match as PatternMatchWithOffsets;
    const matchByteStart = extMatch.startOffset;
    const matchByteEnd = extMatch.endOffset;

    if (matchByteStart === undefined || matchByteEnd === undefined) {
      continue;
    }

    // Filter: must be within factory function range
    if (matchByteStart < funcStart || matchByteEnd > funcEnd) {
      continue;
    }

    const calleeName = resolveInjectCallee(match.matchedText);
    const resolvedCallee = resolveOriginalName(calleeName);
    const importSource = findImportSourceForCallee(calleeName, currentImportSources);

    if (importSource !== '@zipbul/common') {
      continue;
    }

    if (resolvedCallee !== 'inject' && !resolvedCallee.endsWith('.inject')) {
      continue;
    }

    const capture = match.captures?.['$$$ARGS'];
    const injectCall = buildInjectCallFromCapture(
      capture,
      resolvedCallee,
      importSource,
      currentFilePath,
      currentImports,
      resolveOriginalName,
    );

    currentInjectCalls.push(injectCall);

    result.push({
      start: matchByteStart - funcStart,
      end: matchByteEnd - funcStart,
      token: injectCall.token,
      tokenKind: injectCall.tokenKind,
    });
  }

  return result;
}

/**
 * Checks whether a capture text represents multiple arguments.
 *
 * Scans for commas at the top level (not inside parentheses, brackets,
 * or braces) to determine if the captured text is multi-argument.
 *
 * @param text - Captured argument text from patternSearch
 * @returns `true` if the text contains multiple top-level arguments
 */
function hasMultipleArgs(text: string): boolean {
  let depth = 0;

  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth--;
    } else if (char === ',' && depth === 0) {
      return true;
    }
  }

  return false;
}
