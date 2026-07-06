/**
 * Fixed-slot reader for the `augments` property of a `defineMiddleware({...})`
 * config object — the declarative replacement for the old assignment-walking
 * augment extractor in the `zb build middleware` flow.
 *
 * Each augments slot value is ONLY a bare synchronous supply function
 * `(ctx) => raw`, collected as a `validated-accessor`. Every deviation is a
 * HARD `DiagnosticError` (plan §3.4): computed keys, spreads, conditionals,
 * non-function values, async/generator supplies, augments with empty adapters,
 * and augments smuggled into the array overload.
 *
 * @public
 */
import { walk, is, isFunctionNode, buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';

import type { DefineCallShapeInput } from '../../define-call-shape';
import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import { findInnerHandler, findContextBindings, readFirstIdentifierParam } from './context-operation-extractor';

/**
 * One declared augment: `augments.<ns>.<prop> = (ctx) => raw`. Every augment
 * is a DTO-validated accessor.
 *
 * @public
 */
export interface ExtractedAugment {
  readonly ns: string;
  readonly prop: string;
  readonly kind: 'validated-accessor';
}

/**
 * The statically-readable parts of one `defineMiddleware(...)` call.
 *
 * @public
 */
export interface ExtractedDefinitionParts {
  /** Adapter class identifier names from the `adapters` array (empty when absent). */
  readonly adapters: readonly string[];
  readonly augments: readonly ExtractedAugment[];
  /** The factory function node when statically present. */
  readonly factory: AstNode | null;
}

/**
 * Reads adapters / augments / factory off a discovered `defineMiddleware`
 * call. Throws `DiagnosticError` on any §3.4 shape violation.
 *
 * @public
 */
export function extractDefinitionParts(params: {
  readonly file: DefineCallShapeInput;
  readonly call: AstNode;
  readonly exportName: string;
}): ExtractedDefinitionParts {
  const { file, call, exportName } = params;

  if (!is.CallExpression(call)) {
    return { adapters: [], augments: [], factory: null };
  }

  const fail = buildFailer(file, exportName);
  const args = call.arguments;

  if (args.length === 0) {
    return { adapters: [], augments: [], factory: null };
  }

  const first = args[0]!;

  // Factory-only overload — augment-less by construction.
  if (isFunctionNode(first)) {
    return { adapters: [], augments: [], factory: first };
  }

  // Array overload `defineMiddleware([Adapter], factory)` — legal but
  // augment-less; an object smuggled into the second slot with `augments`
  // is a hard error directing to the config overload.
  if (is.ArrayExpression(first)) {
    const second = args.length >= 2 ? unwrapTypeWrappers(args[1]!) : null;

    if (second !== null && is.ObjectExpression(second) && findProperty(second, 'augments') !== null) {
      fail(second.start,
        'the array overload `defineMiddleware([Adapter], ...)` cannot carry `augments`.',
        'Use the config-object overload: `defineMiddleware({ adapters: [...], augments: {...}, factory: ... })`.');
    }

    return {
      adapters: readAdapterNames(first),
      augments: [],
      factory: second !== null && isFunctionNode(second) ? second : null,
    };
  }

  if (!is.ObjectExpression(first)) {
    return { adapters: [], augments: [], factory: null };
  }

  // Config overload — the config must be a plain object literal so the
  // fixed-slot reader sees every property. Spreads hide slots → hard error.
  for (const prop of first.properties) {
    if (!is.Property(prop)) {
      fail(prop.start,
        'the defineMiddleware config must be a plain object literal — spread properties hide the `augments`/`adapters` slots from the static extractor.',
        'Inline the spread source into literal properties.');
    }
  }

  const factoryProp = findProperty(first, 'factory');
  const adaptersProp = findProperty(first, 'adapters');
  const augmentsProp = findProperty(first, 'augments');

  const factory = factoryProp !== null && isFunctionNode(factoryProp.value) ? factoryProp.value : null;
  const adapters = adaptersProp !== null && is.ArrayExpression(adaptersProp.value)
    ? readAdapterNames(adaptersProp.value)
    : [];

  if (augmentsProp === null) {
    return { adapters, augments: [], factory };
  }

  if (adapters.length === 0) {
    fail(augmentsProp.value.start,
      '`augments` requires a non-empty `adapters` array of adapter class identifiers — namespace names only have meaning per adapter context schema.',
      'Add `adapters: [HttpAdapter]` (or the relevant adapter class) to the defineMiddleware config.');
  }

  const augments: ExtractedAugment[] = [];

  const augmentsValue = augmentsProp.value;

  if (!is.ObjectExpression(augmentsValue)) {
    fail(augmentsValue.start,
      '`augments` must be an object literal of namespaces (`{ request: { ... } }`).',
      'Declare the slot inline: `augments: { request: { getQuery: (ctx) => ... } }`.');
  }

  for (const nsProp of (augmentsValue as AstNode & { properties: readonly AstNode[] }).properties) {
    const ns = readLiteralKey(nsProp, fail, 'augments namespace');
    const nsValue = (nsProp as AstNode & { value: AstNode }).value;

    if (!is.ObjectExpression(nsValue)) {
      fail(nsValue.start,
        `\`augments.${ns}\` must be an object literal of properties.`,
        'Declare each contributed property inline: `{ getQuery: (ctx) => ... }`.');
    }

    for (const accessorProp of (nsValue as AstNode & { properties: readonly AstNode[] }).properties) {
      const prop = readLiteralKey(accessorProp, fail, `augments.${ns} property`);
      const value = (accessorProp as AstNode & { value: AstNode }).value;

      augments.push(extractSupply({ ns, prop, value, fail }));
    }
  }

  return { adapters, augments, factory };
}

/**
 * Old assignment-walker, repurposed as a violation detector: returns the
 * byte offset of the first assignment rooted at a `ctx.to()` binding inside
 * the factory's inner handler, or `null` when clean. The caller turns a hit
 * into the "declare it in augments" `DiagnosticError`.
 *
 * @public
 */
export function findContextAssignmentStart(factory: AstNode): number | null {
  const handler = findInnerHandler(factory);

  if (handler === null || !isFunctionNode(handler)) return null;

  const ctxParam = readFirstIdentifierParam(handler);

  if (ctxParam === null) return null;

  const body = handler.body;

  if (!body || !is.BlockStatement(body)) return null;

  const roots = new Set(findContextBindings(body, ctxParam));
  let found: number | null = null;

  walk(body, {
    enter(node) {
      if (found !== null) return;
      if (!is.AssignmentExpression(node) || !is.MemberExpression(node.left)) return;
      if (memberChainRootsAtContext(node.left, roots, ctxParam)) {
        found = node.start;
      }
    },
  });

  return found;
}

/**
 * Finds the class name passed to `ctx.to(<Type>)` inside the factory's inner
 * handler — the manifest's fallback `contextType` for augment-less middleware.
 *
 * @public
 */
export function readFactoryContextType(factory: AstNode): string | null {
  const handler = findInnerHandler(factory);

  if (handler === null || !isFunctionNode(handler)) return null;

  const ctxParam = readFirstIdentifierParam(handler);

  if (ctxParam === null) return null;

  const body = handler.body;

  if (!body) return null;

  let found: string | null = null;

  walk(body, {
    enter(node) {
      if (found !== null) return;
      if (!is.CallExpression(node)) return;

      const callee = node.callee;

      if (!is.MemberExpression(callee) || callee.computed) return;
      if (!is.Identifier(callee.object) || callee.object.name !== ctxParam) return;
      if (!is.Identifier(callee.property) || callee.property.name !== 'to') return;

      const arg = node.arguments[0];

      if (arg !== undefined && is.Identifier(arg)) found = arg.name;
    },
  });

  return found;
}

/** Failer factory: DiagnosticError with file:line:column context baked in. */
type Failer = (start: number, reason: string, how: string) => never;

function buildFailer(file: DefineCallShapeInput, exportName: string): Failer {
  const lineOffsets = buildLineOffsets(file.parsed.sourceText);

  return (start, reason, how) => {
    const { line, column } = getLineColumn(lineOffsets, start);

    throw new DiagnosticError(buildDiagnostic({
      reason: `${file.filePath}:${line}:${column} \`${exportName}\`: ${reason}`,
      file: file.filePath,
      how,
    }));
  };
}

/** Non-computed `Property` lookup by identifier/string key on an object literal. */
function findProperty(obj: AstNode, name: string): (AstNode & { value: AstNode }) | null {
  if (!is.ObjectExpression(obj)) return null;

  for (const prop of obj.properties) {
    if (!is.Property(prop) || prop.computed) continue;
    if (is.Identifier(prop.key) && prop.key.name === name) return prop;
    if (readStringLiteral(prop.key) === name) return prop;
  }

  return null;
}

/** Strips `as` / `satisfies` / parenthesized wrappers off an expression. */
function unwrapTypeWrappers(node: AstNode): AstNode {
  let current = node;

  while (
    current.type === 'TSAsExpression'
    || current.type === 'TSSatisfiesExpression'
    || current.type === 'ParenthesizedExpression'
  ) {
    current = (current as AstNode & { expression: AstNode }).expression;
  }

  return current;
}

/** String value of a `Literal`/`StringLiteral` node, else `null`. */
function readStringLiteral(node: AstNode): string | null {
  const type = (node as { type: string }).type;

  if (type !== 'Literal' && type !== 'StringLiteral') return null;

  const value = (node as { value?: unknown }).value;

  return typeof value === 'string' ? value : null;
}

/** Identifier names from an adapters array literal (non-identifiers skipped). */
function readAdapterNames(arrayNode: AstNode): string[] {
  if (!is.ArrayExpression(arrayNode)) return [];

  const names: string[] = [];

  for (const element of arrayNode.elements) {
    if (element !== null && is.Identifier(element)) names.push(element.name);
  }

  return names;
}

/**
 * Reads a static key from an augments-object property. Spread elements and
 * computed keys are hard errors — the extractor must see every slot.
 */
function readLiteralKey(prop: AstNode, fail: Failer, what: string): string {
  if (!is.Property(prop)) {
    fail(prop.start,
      `spread properties are not allowed in the augments object (${what}).`,
      'List every namespace/property as a literal key.');
  }

  const property = prop as AstNode & { computed: boolean; key: AstNode };

  if (property.computed) {
    fail(property.key.start,
      `computed keys are not allowed in the augments object (${what}).`,
      'Use a literal identifier or string key.');
  }

  if (is.Identifier(property.key)) return property.key.name;

  const literal = readStringLiteral(property.key);

  if (literal !== null) return literal;

  fail(property.key.start,
    `augments keys must be identifiers or string literals (${what}).`,
    'Use a literal identifier or string key.');
}

/**
 * Validates one augments property value as a bare synchronous supply function
 * `(ctx) => raw`. Every accepted supply becomes a `validated-accessor`.
 */
function extractSupply(params: {
  readonly ns: string;
  readonly prop: string;
  readonly value: AstNode;
  readonly fail: Failer;
}): ExtractedAugment {
  const { ns, prop, value, fail } = params;
  const slot = `augments.${ns}.${prop}`;

  if (is.ConditionalExpression(value) || is.LogicalExpression(value)) {
    fail(value.start,
      `\`${slot}\` must be a bare supply function \`(ctx) => raw\` — conditional expressions are not statically extractable.`,
      'Move the condition inside the supply closure and keep the value unconditional.');
  }

  if (!isFunctionNode(value)) {
    fail(value.start,
      `\`${slot}\` must be a bare supply function \`(ctx) => raw\`.`,
      'Write `getX: (ctx) => <raw>` — the framework generates the `<T>(dto: Class<T>): T` accessor signature and wires baker validation.');
  }

  // Must be a PLAIN synchronous function: async / generator functions would
  // ship a Promise / iterator into baker validation.
  const fn = value as AstNode & { async?: boolean; generator?: boolean };

  if (fn.async === true || fn.generator === true) {
    fail(value.start,
      `\`${slot}\` supply must be a plain synchronous function — async and generator functions are not valid supplies.`,
      'Use a synchronous `(ctx) => <raw>` supply; move any awaiting into an earlier middleware phase.');
  }

  return { ns, prop, kind: 'validated-accessor' };
}

/**
 * True when a member chain (`a.b.c`) roots at a tracked context binding name
 * or directly at a `<ctxParam>.to(...)` call.
 */
function memberChainRootsAtContext(member: AstNode, roots: ReadonlySet<string>, ctxParam: string): boolean {
  let current: AstNode = member;

  while (is.MemberExpression(current)) {
    current = current.object;
  }

  if (is.Identifier(current)) return roots.has(current.name);

  // Direct `ctx.to(HttpContext).request.x = ...` (no intermediate binding).
  if (is.CallExpression(current)) {
    const callee = current.callee;

    return is.MemberExpression(callee)
      && !callee.computed
      && is.Identifier(callee.object)
      && callee.object.name === ctxParam
      && is.Identifier(callee.property)
      && callee.property.name === 'to';
  }

  return false;
}
