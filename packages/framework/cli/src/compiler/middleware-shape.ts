/**
 * Shape grammar v2 for the `zb build middleware` context — validates AND
 * discovers `defineMiddleware` call sites in a middleware library package.
 *
 * Legal forms:
 *
 * - FORM 1 — `export const x = defineMiddleware(<config|adapters,factory>)`
 *   (top-level direct initializer; same rule as the shared validator).
 * - FORM 2 — top-level exported function where EXACTLY ONE return site's
 *   expression "contains definitions": either (a) a direct `defineMiddleware`
 *   call, or (b) an object literal each of whose property values is a direct
 *   `defineMiddleware` call or an identifier of a same-function const local
 *   whose initializer is one (cookie's `{ onRequest, beforeResponse }`).
 *   All OTHER return sites must contain NO defineMiddleware content —
 *   non-definition early returns (`return err(...)` guards) are legal.
 *
 * A "return site" is a return statement (or implicit arrow-body return)
 * lexically owned by the exported function's OWN body; returns inside nested
 * functions are never return sites — `defineMiddleware` appearing in them
 * falls under the nested-function violation, which takes precedence.
 * `defineMiddleware` anywhere else (conditionals, loops, nested functions,
 * call arguments) is a violation.
 *
 * The other four regulated callees (`defineAdapter` / `defineGuard` /
 * `defineExceptionFilter` / `defineModule`) keep the strict FORM 1 rule via
 * the shared validator. `zb build adapter` and `zb build` (user-app) are NOT
 * affected — they keep calling {@link validateDefineCallShape} directly.
 *
 * @public
 */
import { walk, is, buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import type { Node } from '@zipbul/gildash';

import {
  buildCalleeResolver,
  findDefineCallShapeViolations,
  resolveTrackedCallee,
  type CalleeResolver,
  type DefineCallShapeInput,
  type DefineCallShapeReason,
} from './define-call-shape';
import { buildDiagnostic, DiagnosticError } from '../diagnostics';

/** Only defineMiddleware follows grammar v2; the other four stay FORM 1. */
const MIDDLEWARE_CALLEE: ReadonlySet<string> = new Set(['defineMiddleware']);
const OTHER_REGULATED_CALLEES: ReadonlySet<string> = new Set([
  'defineAdapter',
  'defineGuard',
  'defineExceptionFilter',
  'defineModule',
]);

/**
 * Grammar-v2 violation reasons — the shared FORM 1 taxonomy plus the FORM 2
 * specific classifications.
 *
 * - `function-not-exported`: call sits inside a top-level function that is
 *   not exported (FORM 2 requires an exported function).
 * - `nested-function`: call sits inside a function nested within the
 *   exported function (takes precedence over all return-site reasons).
 * - `not-a-return-site`: call sits inside the exported function but not at
 *   a legal return site / returned-object const-local position (conditional,
 *   loop, call argument, unreferenced const local, wrapped expression, …).
 * - `multiple-definition-returns`: more than one return site of the exported
 *   function contains definitions.
 * - `malformed-return-object`: the returned object literal mixes definition
 *   properties with spreads / computed keys / non-definition values.
 *
 * @public
 */
export type MiddlewareShapeReason =
  | DefineCallShapeReason
  | 'function-not-exported'
  | 'nested-function'
  | 'not-a-return-site'
  | 'multiple-definition-returns'
  | 'malformed-return-object';

export interface MiddlewareShapeViolation {
  readonly callee: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly reason: MiddlewareShapeReason;
}

/**
 * One discovered middleware export — a FORM 1 const (single call) or a
 * FORM 2 exported function (one call, or several for an object return).
 *
 * @public
 */
export interface DiscoveredMiddleware {
  readonly exportName: string;
  readonly form: 1 | 2;
  /** Direct `defineMiddleware(...)` CallExpression nodes, in source order. */
  readonly calls: readonly Node[];
}

/**
 * Per-file grammar-v2 analysis result: what was discovered and what violated.
 *
 * @public
 */
export interface MiddlewareFileAnalysis {
  readonly middlewares: readonly DiscoveredMiddleware[];
  readonly violations: readonly MiddlewareShapeViolation[];
}

/** A collected defineMiddleware call together with its ancestor chain. */
interface CollectedCall {
  readonly node: Node;
  /** Ancestor chain root→…→call (parenthesized wrappers stripped). */
  readonly path: readonly Node[];
}

/** A return site owned by an exported function's own body. */
interface OwnReturnSite {
  /** The ReturnStatement node, or the arrow function for expression bodies. */
  readonly node: Node;
  /** The returned expression (`null` for bare `return;`). */
  readonly expression: Node | null;
  /** True when the site is a direct top-level statement of the body block (or the arrow expression body). */
  readonly atBodyTopLevel: boolean;
}

/** FORM 2 candidate: a top-level exported function. */
interface ExportedFunction {
  readonly exportName: string;
  readonly fn: Node;
}

/**
 * Analyzes one parsed file against grammar v2 and returns the discovered
 * middleware exports plus every violation. Pure — throwing is the caller's
 * job ({@link validateMiddlewareLibraryShape}).
 *
 * @public
 */
export function analyzeMiddlewareLibraryFile(file: DefineCallShapeInput): MiddlewareFileAnalysis {
  const resolver = buildCalleeResolver(file);
  const lineOffsets = buildLineOffsets(file.parsed.sourceText);
  const program = file.parsed.program as Node;

  const calls = collectMiddlewareCalls(program, resolver);
  const exportedFunctions = collectExportedFunctions(program);

  const middlewares: DiscoveredMiddleware[] = [];
  const violations: MiddlewareShapeViolation[] = [];
  const report = (node: Node, reason: MiddlewareShapeReason): void => {
    const { line, column } = getLineColumn(lineOffsets, node.start);
    violations.push({ callee: 'defineMiddleware', filePath: file.filePath, line, column, reason });
  };

  // Partition calls by their outermost enclosing function (if any).
  const topLevelCalls: CollectedCall[] = [];
  const callsByFunction = new Map<Node, CollectedCall[]>();

  for (const call of calls) {
    // Functions passed INTO a defineMiddleware call (factory / supply
    // closures) are argument context, not enclosing context — the chain is
    // cut at the first enclosing defineMiddleware call.
    const ownChain = enclosingFunctionsOutsideDefineCalls(call, calls);

    if (ownChain.length === 0) {
      topLevelCalls.push(call);
      continue;
    }

    const outer = ownChain[0]!;
    const bucket = callsByFunction.get(outer) ?? [];

    bucket.push(call);
    callsByFunction.set(outer, bucket);

    if (ownChain.length > 1) {
      report(call.node, 'nested-function');
    }
  }

  // ── FORM 1: top-level calls ─────────────────────────────────
  for (const call of topLevelCalls) {
    const form1 = matchForm1(call);

    if (form1 !== null) {
      middlewares.push({ exportName: form1, form: 1, calls: [call.node] });
      continue;
    }

    report(call.node, classifyTopLevelReason(call));
  }

  // ── FORM 2: per exported function ───────────────────────────
  const exportedByFn = new Map<Node, ExportedFunction>(exportedFunctions.map(e => [e.fn, e]));

  for (const [fn, fnCalls] of callsByFunction) {
    const exported = exportedByFn.get(fn);

    if (exported === undefined) {
      for (const call of fnCalls) {
        if (!callIsInNestedFunction(call, fn)) report(call.node, 'function-not-exported');
      }
      continue;
    }

    const directCalls = fnCalls.filter(c => !callIsInNestedFunction(c, fn));
    const analysis = analyzeExportedFunction(exported, directCalls);

    for (const [node, reason] of analysis.violations) report(node, reason);

    if (analysis.definitionCalls.length > 0) {
      middlewares.push({
        exportName: exported.exportName,
        form: 2,
        calls: [...analysis.definitionCalls].sort((a, b) => a.start - b.start),
      });
    }
  }

  middlewares.sort((a, b) => (a.calls[0]?.start ?? 0) - (b.calls[0]?.start ?? 0));

  return { middlewares, violations };
}

/**
 * Validates every file against grammar v2 (defineMiddleware) plus the strict
 * FORM 1 rule for the other four regulated callees, throwing one aggregated
 * `DiagnosticError` on any violation. Returns the discovered middleware
 * exports per file path on success.
 *
 * @public
 */
export function validateMiddlewareLibraryShape(
  files: readonly DefineCallShapeInput[],
): Map<string, readonly DiscoveredMiddleware[]> {
  const discovered = new Map<string, readonly DiscoveredMiddleware[]>();
  const violations: MiddlewareShapeViolation[] = [];

  for (const file of files) {
    const analysis = analyzeMiddlewareLibraryFile(file);

    violations.push(...analysis.violations);

    if (analysis.middlewares.length > 0) {
      discovered.set(file.filePath, analysis.middlewares);
    }
  }

  // The other defineX callees keep the shared strict shape.
  violations.push(...findDefineCallShapeViolations(files, OTHER_REGULATED_CALLEES));

  if (violations.length === 0) return discovered;

  const formatted = violations
    .map(v => `  - ${v.filePath}:${v.line}:${v.column} \`${v.callee}(...)\` — ${describeMiddlewareReason(v.reason)}`)
    .join('\n');

  throw new DiagnosticError(buildDiagnostic({
    reason: `Middleware library defineX calls violate the shape grammar. Found ${violations.length} violation(s):\n${formatted}`,
    how: 'Fix shape: FORM 1 `export const mw = defineMiddleware(...)`, or FORM 2 `export function mw(opts?) { return defineMiddleware(...); }` (a single return site may also return an object literal of direct defineMiddleware calls / same-function const locals). Early `return err(...)` guards are fine; defineMiddleware inside conditionals, loops, or nested functions is not.',
  }));
}

function describeMiddlewareReason(reason: MiddlewareShapeReason): string {
  switch (reason) {
    case 'not-top-level':
      return 'not at top level (nested inside another expression / function / class)';
    case 'not-exported':
      return 'top-level `const` is not exported';
    case 'not-const':
      return 'declared with `let`/`var` instead of `const`';
    case 'function-not-exported':
      return 'enclosing top-level function is not exported (FORM 2 requires `export function`)';
    case 'nested-function':
      return 'inside a function nested within the exported function — hoist the call to the exported function\'s own return';
    case 'not-a-return-site':
      return 'not at a return site of the exported function (conditionals, loops, call arguments, and unreferenced const locals are not return sites)';
    case 'multiple-definition-returns':
      return 'the exported function has more than one definition-bearing return site — exactly one is allowed';
    case 'malformed-return-object':
      return 'returned object literal must contain ONLY direct defineMiddleware calls or same-function const-local aliases (no spreads, computed keys, or other values)';
  }
}

/** FunctionDeclaration / FunctionExpression / ArrowFunctionExpression. */
function isFunctionLike(node: Node): boolean {
  return is.FunctionDeclaration(node) || is.FunctionExpression(node) || is.ArrowFunctionExpression(node);
}

/**
 * Collects every CallExpression resolving to `defineMiddleware` together with
 * its ancestor chain. Parenthesized wrappers are stripped from the chain so
 * `() => ({ ... })` matches the same segments as a block-body return.
 */
function collectMiddlewareCalls(program: Node, resolver: CalleeResolver): CollectedCall[] {
  const stack: Node[] = [];
  const out: CollectedCall[] = [];

  walk(program, {
    enter(node) {
      stack.push(node as Node);

      if (is.CallExpression(node) && resolveTrackedCallee(node as Node, resolver, MIDDLEWARE_CALLEE) !== null) {
        out.push({
          node: node as Node,
          path: stack.filter(n => n.type !== 'ParenthesizedExpression'),
        });
      }
    },
    leave() {
      stack.pop();
    },
  });

  return out;
}

/**
 * Returns the enclosing function chain (outermost first) of a call, cutting
 * the chain at any OTHER enclosing defineMiddleware call — functions passed
 * as arguments to a definition (factory / augment supply closures) belong to
 * that definition, not to the surrounding factory function.
 */
function enclosingFunctionsOutsideDefineCalls(
  call: CollectedCall,
  allCalls: readonly CollectedCall[],
): readonly Node[] {
  const defineNodes = new Set(allCalls.map(c => c.node));
  const chain: Node[] = [];

  // Walk root→call; once another defineMiddleware call encloses this one,
  // everything below it is argument context — reset tracking.
  for (const node of call.path) {
    if (node === call.node) break;

    if (defineNodes.has(node)) {
      chain.length = 0;
      continue;
    }

    if (isFunctionLike(node)) chain.push(node);
  }

  return chain;
}

/** True when a call has a function between itself and `fn` (nested). */
function callIsInNestedFunction(call: CollectedCall, fn: Node): boolean {
  const start = call.path.indexOf(fn);

  if (start === -1) return false;

  for (let i = start + 1; i < call.path.length - 1; i += 1) {
    if (isFunctionLike(call.path[i]!)) return true;
  }

  return false;
}

/** Matches `export const NAME = defineMiddleware(...)`; returns the name. */
function matchForm1(call: CollectedCall): string | null {
  const path = call.path;
  const idx = path.length - 1;
  const declarator = path[idx - 1];
  const declaration = path[idx - 2];
  const exportDecl = path[idx - 3];
  const programNode = path[idx - 4];

  if (declarator === undefined || !is.VariableDeclarator(declarator)) return null;
  if (declarator.init !== call.node) return null;
  if (declaration === undefined || !is.VariableDeclaration(declaration) || declaration.kind !== 'const') return null;
  if (exportDecl === undefined || !is.ExportNamedDeclaration(exportDecl)) return null;
  if (programNode === undefined || !is.Program(programNode)) return null;
  if (!is.Identifier(declarator.id)) return null;

  return declarator.id.name;
}

/** Classifies a non-FORM-1 top-level call with the shared FORM 1 taxonomy. */
function classifyTopLevelReason(call: CollectedCall): DefineCallShapeReason {
  const path = call.path;
  const idx = path.length - 1;
  const declarator = path[idx - 1];
  const declaration = path[idx - 2];

  if (declarator !== undefined && is.VariableDeclarator(declarator) && declarator.init === call.node
    && declaration !== undefined && is.VariableDeclaration(declaration)) {
    const parent = path[idx - 3];

    if (declaration.kind !== 'const') return 'not-const';
    if (parent !== undefined && is.Program(parent)) return 'not-exported';
  }

  return 'not-top-level';
}

/** Collects every top-level exported function (declaration or const-bound). */
function collectExportedFunctions(program: Node): ExportedFunction[] {
  const out: ExportedFunction[] = [];
  const body = (program as Node & { body: readonly Node[] }).body;

  for (const stmt of body) {
    if (!is.ExportNamedDeclaration(stmt) || !stmt.declaration) continue;

    const decl = stmt.declaration;

    if (is.FunctionDeclaration(decl) && decl.id && is.Identifier(decl.id)) {
      out.push({ exportName: decl.id.name, fn: decl });
      continue;
    }

    if (is.VariableDeclaration(decl) && decl.kind === 'const') {
      for (const d of decl.declarations) {
        if (!is.Identifier(d.id) || d.init === null || d.init === undefined) continue;

        const init = unwrapParens(d.init);

        if (isFunctionLike(init)) out.push({ exportName: d.id.name, fn: init });
      }
    }
  }

  return out;
}

function unwrapParens(node: Node): Node {
  let current = node;

  while (current.type === 'ParenthesizedExpression') {
    current = (current as Node & { expression: Node }).expression;
  }

  return current;
}

interface ExportedFunctionAnalysis {
  /** Calls sanctioned as definitions of this export. */
  readonly definitionCalls: readonly Node[];
  readonly violations: ReadonlyArray<readonly [Node, MiddlewareShapeReason]>;
}

/**
 * FORM 2 core: classifies every direct defineMiddleware call of an exported
 * function against the single-definition-return grammar.
 */
function analyzeExportedFunction(
  exported: ExportedFunction,
  directCalls: readonly CollectedCall[],
): ExportedFunctionAnalysis {
  const fn = exported.fn;
  const callNodes = new Set(directCalls.map(c => c.node));
  const locals = collectDefinitionLocals(fn, callNodes);
  const returnSites = collectOwnReturnSites(fn);

  // Classify each return site: no content / well-formed definitions / malformed.
  interface ContentSite {
    readonly site: OwnReturnSite;
    readonly wellFormed: boolean;
    readonly directDefCalls: readonly Node[];
    readonly referencedLocals: readonly string[];
  }

  const contentSites: ContentSite[] = [];

  for (const site of returnSites) {
    if (site.expression === null) continue;

    const expr = unwrapParens(site.expression);
    const containedCalls = directCalls.filter(c => c.path.includes(expr) || c.node === expr).map(c => c.node);
    const referencedLocals = collectLocalReferences(expr, locals);

    if (containedCalls.length === 0 && referencedLocals.length === 0) continue; // non-definition return — legal

    // Direct call form (a).
    if (is.CallExpression(expr) && callNodes.has(expr) && containedCalls.length === 1 && site.atBodyTopLevel) {
      contentSites.push({ site, wellFormed: true, directDefCalls: [expr], referencedLocals: [] });
      continue;
    }

    // Object literal form (b).
    if (is.ObjectExpression(expr) && site.atBodyTopLevel) {
      const shape = matchDefinitionObject(expr, callNodes, locals);

      if (shape !== null && containedCalls.every(c => shape.directDefCalls.includes(c))) {
        contentSites.push({ site, wellFormed: true, ...shape });
        continue;
      }

      contentSites.push({ site, wellFormed: false, directDefCalls: containedCalls, referencedLocals });
      continue;
    }

    contentSites.push({ site, wellFormed: false, directDefCalls: containedCalls, referencedLocals });
  }

  const violations: Array<readonly [Node, MiddlewareShapeReason]> = [];
  const flagged = new Set<Node>();
  const flag = (node: Node, reason: MiddlewareShapeReason): void => {
    if (flagged.has(node)) return;
    flagged.add(node);
    violations.push([node, reason]);
  };

  const wellFormed = contentSites.filter(s => s.wellFormed);

  if (wellFormed.length > 1 || (wellFormed.length >= 1 && contentSites.length > wellFormed.length)) {
    // More than one definition-bearing return site (well-formed or not).
    for (const s of contentSites) {
      for (const call of s.directDefCalls) flag(call, s.wellFormed ? 'multiple-definition-returns' : 'malformed-return-object');
      for (const name of s.referencedLocals) flag(locals.get(name)!, s.wellFormed ? 'multiple-definition-returns' : 'malformed-return-object');
    }
    for (const call of directCalls) flag(call.node, 'not-a-return-site');

    return { definitionCalls: [], violations };
  }

  if (wellFormed.length === 1) {
    const winner = wellFormed[0]!;
    const allowed = new Set<Node>(winner.directDefCalls);

    for (const name of winner.referencedLocals) allowed.add(locals.get(name)!);

    for (const call of directCalls) {
      if (!allowed.has(call.node)) flag(call.node, 'not-a-return-site');
    }

    return { definitionCalls: [...allowed], violations };
  }

  // No well-formed definition return: every content site and stray call violates.
  for (const s of contentSites) {
    const reason: MiddlewareShapeReason = is.ObjectExpression(unwrapParens(s.site.expression!))
      ? 'malformed-return-object'
      : 'not-a-return-site';

    for (const call of s.directDefCalls) flag(call, reason);
    for (const name of s.referencedLocals) flag(locals.get(name)!, reason);
  }
  for (const call of directCalls) flag(call.node, 'not-a-return-site');

  return { definitionCalls: [], violations };
}

/**
 * Same-function const locals whose initializer is a direct defineMiddleware
 * call, restricted to the function body's TOP-LEVEL statements (definitions
 * inside conditionals/loops stay violations). Name → call node.
 */
function collectDefinitionLocals(fn: Node, callNodes: ReadonlySet<Node>): Map<string, Node> {
  const out = new Map<string, Node>();
  const body = (fn as Node & { body?: Node | null }).body;

  if (!body || !is.BlockStatement(body)) return out;

  for (const stmt of body.body) {
    if (!is.VariableDeclaration(stmt) || stmt.kind !== 'const') continue;

    for (const d of stmt.declarations) {
      if (!is.Identifier(d.id) || d.init === null || d.init === undefined) continue;

      const init = unwrapParens(d.init);

      if (is.CallExpression(init) && callNodes.has(init)) out.set(d.id.name, init);
    }
  }

  return out;
}

/**
 * Collects return sites lexically owned by `fn` (skipping nested functions).
 * `atBodyTopLevel` is true only for direct statements of the body block —
 * the position the single definition-bearing return must occupy.
 */
function collectOwnReturnSites(fn: Node): OwnReturnSite[] {
  const body = (fn as Node & { body?: Node | null }).body;

  if (!body) return [];

  // Arrow expression body — the implicit return site, always "top level".
  if (!is.BlockStatement(body)) {
    return [{ node: fn, expression: body, atBodyTopLevel: true }];
  }

  const sites: OwnReturnSite[] = [];
  const visit = (node: Node, topLevel: boolean): void => {
    if (is.ReturnStatement(node)) {
      sites.push({ node, expression: node.argument ?? null, atBodyTopLevel: topLevel });
      return;
    }
    if (isFunctionLike(node)) return; // nested function — not our return sites

    for (const child of nodeChildren(node)) {
      visit(child, false);
    }
  };

  for (const stmt of body.body) {
    if (is.ReturnStatement(stmt)) {
      sites.push({ node: stmt, expression: stmt.argument ?? null, atBodyTopLevel: true });
      continue;
    }
    if (isFunctionLike(stmt)) continue;

    for (const child of nodeChildren(stmt)) visit(child, false);
  }

  return sites;
}

/** Statement-level child nodes (objects with a `type` field), arrays flattened. */
function nodeChildren(node: Node): Node[] {
  const out: Node[] = [];

  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNodeLike(item)) out.push(item);
      }
    } else if (isNodeLike(value)) {
      out.push(value);
    }
  }

  return out;
}

function isNodeLike(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Identifiers within `expr` that name a definition const local. */
function collectLocalReferences(expr: Node, locals: ReadonlyMap<string, Node>): string[] {
  if (locals.size === 0) return [];

  const found = new Set<string>();

  walk(expr, {
    enter(node) {
      if (is.Identifier(node) && locals.has(node.name)) found.add(node.name);
    },
  });

  return [...found];
}

/**
 * Matches form (b): an object literal whose EVERY property is a non-computed,
 * non-spread `Property` valued by a direct defineMiddleware call or an
 * identifier of a definition const local. Returns `null` when the object does
 * not match (the caller decides whether that is malformed or merely
 * definition-free).
 */
function matchDefinitionObject(
  obj: Node,
  callNodes: ReadonlySet<Node>,
  locals: ReadonlyMap<string, Node>,
): { directDefCalls: readonly Node[]; referencedLocals: readonly string[] } | null {
  if (!is.ObjectExpression(obj)) return null;
  if (obj.properties.length === 0) return null;

  const directDefCalls: Node[] = [];
  const referencedLocals: string[] = [];

  for (const prop of obj.properties) {
    if (!is.Property(prop) || prop.computed) return null;

    const value = unwrapParens(prop.value);

    if (is.CallExpression(value) && callNodes.has(value)) {
      directDefCalls.push(value);
      continue;
    }

    if (is.Identifier(value) && locals.has(value.name)) {
      referencedLocals.push(value.name);
      continue;
    }

    return null;
  }

  return { directDefCalls, referencedLocals };
}
