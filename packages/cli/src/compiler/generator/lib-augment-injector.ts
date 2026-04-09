import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type {
  Node as AstNode,
  CallExpression,
  ArrowFunctionExpression,
  Function as OxcFunction,
  VariableDeclaration,
} from 'oxc-parser';

import {
  extractMiddlewareAugments,
  type MiddlewareAugmentResult,
  type PropAugment,
} from '../analyzer/parser/middleware-augment-extractor';

/**
 * Extracted augment metadata for a single middleware export.
 *
 * @public
 */
export interface LibAugmentEntry {
  /** Export variable name. */
  readonly name: string;
  /** Byte offset of the defineMiddleware() call's opening paren in the source. */
  readonly callStart: number;
  /** Byte offset after the defineMiddleware() call's closing paren. */
  readonly callEnd: number;
  /** The factory function source text. */
  readonly factoryText: string;
  /** The adapters array source text (for adapters+factory overload). */
  readonly adaptersText: string | null;
  /** The full config object source text (for config overload). */
  readonly configText: string | null;
  /** JSON-serializable augment metadata to inject. */
  readonly augments: readonly SerializedAugment[];
  /** Context type from ctx.to() call. */
  readonly contextType: string;
}

/**
 * Serialized augment entry for the `__augments` field.
 *
 * @public
 */
export interface SerializedAugment {
  readonly context: string;
  readonly path: readonly string[];
  readonly kind: 'class' | 'method';
  readonly type?: string;
  readonly signature?: string;
}

/**
 * Scans a TypeScript source file for `defineMiddleware()` exports and
 * extracts augment metadata that can be injected into the compiled output.
 *
 * @param filePath - The source file path.
 * @param sourceText - The file's source text.
 * @returns Array of augment entries, one per middleware export with augments.
 *
 * @public
 */
export function extractLibAugments(
  filePath: string,
  sourceText: string,
): LibAugmentEntry[] {
  const parseResult = parseSource(filePath, sourceText);

  if (isErr(parseResult)) return [];

  const parsed: ParsedFile = parseResult;
  const entries: LibAugmentEntry[] = [];

  for (const stmt of parsed.program.body) {
    let varDecl: VariableDeclaration | null = null;

    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      varDecl = stmt.declaration;
    } else if (stmt.type === 'VariableDeclaration') {
      varDecl = stmt;
    }

    if (varDecl === null) continue;

    for (const decl of varDecl.declarations) {
      if (decl.id.type !== 'Identifier') continue;
      if (decl.init === null || decl.init === undefined || decl.init.type !== 'CallExpression') continue;

      const call = decl.init as CallExpression;
      const calleeName = extractCalleeName(call);

      if (calleeName !== 'defineMiddleware') continue;

      const entry = processDefineMiddlewareCall(
        decl.id.name,
        call,
        sourceText,
      );

      if (entry !== null) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Transforms source text by injecting `__augments` into defineMiddleware calls.
 *
 * @param sourceText - Original TypeScript source.
 * @param entries - Augment entries to inject.
 * @returns Transformed source text with `__augments` injected.
 *
 * @public
 */
export function injectAugmentsIntoSource(
  sourceText: string,
  entries: readonly LibAugmentEntry[],
): string {
  if (entries.length === 0) return sourceText;

  // Sort by position descending so byte offsets don't shift
  const sorted = [...entries].sort((a, b) => b.callStart - a.callStart);
  let result = sourceText;

  for (const entry of sorted) {
    const augmentsJson = JSON.stringify(
      entry.augments.map(serializeAugmentEntry),
    );

    let newCallBody: string;

    if (entry.configText !== null) {
      // Config object overload: inject __augments before closing brace
      const lastBrace = entry.configText.lastIndexOf('}');

      if (lastBrace === -1) continue;

      newCallBody = `${entry.configText.slice(0, lastBrace)}, __augments: ${augmentsJson}${entry.configText.slice(lastBrace)}`;
    } else if (entry.adaptersText !== null) {
      // Adapters + factory overload: wrap both in config object
      newCallBody = `{ adapters: ${entry.adaptersText}, factory: ${entry.factoryText}, __augments: ${augmentsJson} }`;
    } else {
      // Factory-only overload: wrap in config object
      newCallBody = `{ factory: ${entry.factoryText}, __augments: ${augmentsJson} }`;
    }

    // Replace defineMiddleware(originalArg) → defineMiddleware(newCallBody)
    const beforeCall = result.slice(0, entry.callStart);
    const afterCall = result.slice(entry.callEnd);
    const calleePart = result.slice(entry.callStart, result.indexOf('(', entry.callStart) + 1);

    result = `${beforeCall}${calleePart}${newCallBody})${afterCall}`;
  }

  return result;
}

function processDefineMiddlewareCall(
  name: string,
  call: CallExpression,
  sourceText: string,
): LibAugmentEntry | null {
  const args = call.arguments;

  if (args.length === 0) return null;

  const firstArg = args[0]!;
  let factory: OxcFunction | ArrowFunctionExpression | null = null;
  let factoryNode: AstNode | null = null;
  let adaptersNode: AstNode | null = null;
  let configNode: AstNode | null = null;

  // Overload 1: factory-only
  if (isFunctionNode(firstArg)) {
    factory = firstArg as ArrowFunctionExpression | OxcFunction;
    factoryNode = firstArg;
  }
  // Overload 2: adapters + factory
  else if (args.length >= 2 && isFunctionNode(args[1]!)) {
    factory = args[1] as ArrowFunctionExpression | OxcFunction;
    factoryNode = args[1]!;
    adaptersNode = firstArg;
  }
  // Overload 3: config object with factory property
  else if (firstArg.type === 'ObjectExpression') {
    configNode = firstArg;

    for (const prop of firstArg.properties) {
      if (prop.type !== 'Property') continue;
      if (prop.key.type !== 'Identifier' || prop.key.name !== 'factory') continue;

      if (isFunctionNode(prop.value)) {
        factory = prop.value as ArrowFunctionExpression | OxcFunction;
        factoryNode = prop.value;
      }
    }
  }

  if (factory === null || factoryNode === null) return null;

  const augmentResult: MiddlewareAugmentResult | null = extractMiddlewareAugments(factory);

  if (augmentResult === null || augmentResult.augments.length === 0) return null;

  const serialized = augmentResult.augments.map(aug => propAugmentToSerialized(aug, augmentResult.contextType));

  return {
    name,
    callStart: call.start,
    callEnd: call.end,
    factoryText: sourceText.slice(factoryNode.start, factoryNode.end),
    adaptersText: adaptersNode !== null ? sourceText.slice(adaptersNode.start, adaptersNode.end) : null,
    configText: configNode !== null ? sourceText.slice(configNode.start, configNode.end) : null,
    augments: serialized,
    contextType: augmentResult.contextType,
  };
}

function propAugmentToSerialized(aug: PropAugment, contextType: string): SerializedAugment {
  if (aug.rhs.kind === 'class') {
    return {
      context: contextType,
      path: [...aug.path],
      kind: 'class',
      type: aug.rhs.identifier,
    };
  }

  const tParams = aug.rhs.typeParams.length > 0 ? `<${aug.rhs.typeParams.join(', ')}>` : '';
  const params = aug.rhs.params.map(p => p.type !== null ? `${p.name}: ${p.type}` : p.name).join(', ');
  const ret = aug.rhs.returnType ?? 'unknown';

  return {
    context: contextType,
    path: [...aug.path],
    kind: 'method',
    signature: `${tParams}(${params}): ${ret}`,
  };
}

function serializeAugmentEntry(aug: SerializedAugment): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    context: aug.context,
    path: aug.path,
    kind: aug.kind,
  };

  if (aug.type !== undefined) entry.type = aug.type;
  if (aug.signature !== undefined) entry.signature = aug.signature;

  return entry;
}

function extractCalleeName(call: CallExpression): string | null {
  if (call.callee.type === 'Identifier') {
    return (call.callee as AstNode & { name: string }).name;
  }

  return null;
}

function isFunctionNode(node: AstNode): boolean {
  return node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';
}
