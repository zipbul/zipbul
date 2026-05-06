import { parseSource, type ParsedFile, is, isFunctionNode } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { Node as AstNode } from '@zipbul/gildash';

import {
  extractMiddlewareAugments,
  type MiddlewareAugmentResult,
  type PropAugment,
} from '../analyzer/parser/middleware-augment-extractor';
import { extractMiddlewareContextOps } from '../analyzer/parser/context-operation-extractor';

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
  /**
   * JSON-serializable producer/consumer ops (`ctx.set/use/get(KEY, ...)`).
   * Consumed by the AOT producer-consumer dependency validator after lib install.
   */
  readonly contextOps: readonly SerializedContextOp[];
  /** Context type from `ctx.to(<Type>)` call — `null` when no augments exist. */
  readonly contextType: string | null;
}

/**
 * Serialized context operation entry for the `__contextOps` field.
 *
 * @public
 */
export interface SerializedContextOp {
  readonly kind: 'set' | 'use' | 'get';
  readonly keyIdentifier: string | null;
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
    let varDecl: AstNode | null = null;

    if (is.ExportNamedDeclaration(stmt) && stmt.declaration && is.VariableDeclaration(stmt.declaration)) {
      varDecl = stmt.declaration;
    } else if (is.VariableDeclaration(stmt)) {
      varDecl = stmt;
    }

    if (varDecl === null || !is.VariableDeclaration(varDecl)) continue;

    for (const decl of varDecl.declarations) {
      if (!is.Identifier(decl.id)) continue;
      if (decl.init === null || decl.init === undefined || !is.CallExpression(decl.init)) continue;

      const calleeName = extractCalleeName(decl.init);

      if (calleeName !== 'defineMiddleware') continue;

      const entry = processDefineMiddlewareCall(
        decl.id.name,
        decl.init,
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
    const augmentsField = entry.augments.length > 0
      ? `, __augments: ${JSON.stringify(entry.augments.map(serializeAugmentEntry))}`
      : '';
    const contextOpsField = entry.contextOps.length > 0
      ? `, __contextOps: ${JSON.stringify(entry.contextOps)}`
      : '';

    let newCallBody: string;

    if (entry.configText !== null) {
      const lastBrace = entry.configText.lastIndexOf('}');
      if (lastBrace === -1) continue;
      newCallBody = `${entry.configText.slice(0, lastBrace)}${augmentsField}${contextOpsField}${entry.configText.slice(lastBrace)}`;
    } else if (entry.adaptersText !== null) {
      newCallBody = `{ adapters: ${entry.adaptersText}, factory: ${entry.factoryText}${augmentsField}${contextOpsField} }`;
    } else {
      newCallBody = `{ factory: ${entry.factoryText}${augmentsField}${contextOpsField} }`;
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
  call: AstNode,
  sourceText: string,
): LibAugmentEntry | null {
  if (!is.CallExpression(call)) return null;

  const args = call.arguments;

  if (args.length === 0) return null;

  const firstArg = args[0]!;
  let factoryNode: AstNode | null = null;
  let adaptersNode: AstNode | null = null;
  let configNode: AstNode | null = null;

  if (isFunctionNode(firstArg)) {
    factoryNode = firstArg;
  } else if (args.length >= 2 && isFunctionNode(args[1]!)) {
    factoryNode = args[1]!;
    adaptersNode = firstArg;
  } else if (is.ObjectExpression(firstArg)) {
    configNode = firstArg;

    for (const prop of firstArg.properties) {
      if (!is.Property(prop)) continue;
      if (!is.Identifier(prop.key) || prop.key.name !== 'factory') continue;

      if (isFunctionNode(prop.value)) {
        factoryNode = prop.value;
      }
    }
  }

  if (factoryNode === null) return null;

  const augmentResult: MiddlewareAugmentResult | null = extractMiddlewareAugments(factoryNode);
  const contextOps = extractMiddlewareContextOps(factoryNode);

  // Skip emit if neither augments nor contextOps exist — middleware adds nothing
  // observable to the AOT layer.
  const hasAugments = augmentResult !== null && augmentResult.augments.length > 0;
  const hasContextOps = contextOps.length > 0;
  if (!hasAugments && !hasContextOps) return null;

  const serializedAugments = hasAugments
    ? augmentResult!.augments.map(aug => propAugmentToSerialized(aug, augmentResult!.contextType))
    : [];

  const serializedContextOps: SerializedContextOp[] = contextOps.map((op) => ({
    kind: op.kind,
    keyIdentifier: op.keyIdentifier,
  }));

  return {
    name,
    callStart: call.start,
    callEnd: call.end,
    factoryText: sourceText.slice(factoryNode.start, factoryNode.end),
    adaptersText: adaptersNode !== null ? sourceText.slice(adaptersNode.start, adaptersNode.end) : null,
    configText: configNode !== null ? sourceText.slice(configNode.start, configNode.end) : null,
    augments: serializedAugments,
    contextOps: serializedContextOps,
    contextType: augmentResult?.contextType ?? null,
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

function extractCalleeName(call: AstNode): string | null {
  if (!is.CallExpression(call)) return null;

  if (is.Identifier(call.callee)) {
    return call.callee.name;
  }

  return null;
}

