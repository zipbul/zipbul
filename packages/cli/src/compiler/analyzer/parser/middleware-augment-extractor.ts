import type {
  Node as AstNode,
  Function as OxcFunction,
  Expression,
  AssignmentExpression,
  ArrowFunctionExpression,
  NewExpression,
  TSType,
} from 'oxc-parser';

import { walkChildren } from './ast-node-locator';
import {
  extractContextOperations,
  type ContextOperation,
} from './context-operation-extractor';

type FunctionExpression = OxcFunction;

/**
 * RHS shape of an augmenting assignment.
 *
 * - `class`: `new Foo(...)` — property holds an instance of class `Foo`
 * - `method`: `<T>(args): R => body` — property is a method, signature extracted from the arrow function
 */
export type AugmentRhs =
  | { readonly kind: 'class'; readonly identifier: string }
  | {
      readonly kind: 'method';
      readonly typeParams: readonly string[];
      readonly params: readonly AugmentMethodParam[];
      readonly returnType: string | null;
    };

export interface AugmentMethodParam {
  readonly name: string;
  readonly type: string | null;
}

/**
 * Generic property augmentation.
 *
 * `path` is the chain of property names from the context binding to the
 * assignment target — protocol-agnostic. For HTTP a typical path is
 * `['request', 'cookie']` or `['response', 'cookie']`; for other adapters
 * it could be `['client', 'id']`, `['userId']`, etc.
 *
 * Translating `path[0]` into a TypeScript interface (e.g. `request` →
 * `HttpRequest`) is the caller's responsibility, driven by adapter config.
 */
export interface PropAugment {
  readonly path: readonly string[];
  readonly rhs: AugmentRhs;
}

export interface MiddlewareAugmentResult {
  /** The class passed to `ctx.to(<Type>)` — used by the caller to look up adapter mapping. */
  readonly contextType: string;
  readonly augments: readonly PropAugment[];
  /**
   * Producer/consumer operations within the middleware factory body —
   * extracted from `ctx.set(KEY, ...)` / `ctx.use(KEY)` / `ctx.get(KEY)`
   * and equivalent calls on `ctx.to(<Type>)` bindings. Used for AOT
   * dependency validation (producer-consumer chain).
   */
  readonly contextOps: readonly ContextOperation[];
}

/**
 * Walks a `defineMiddleware()` factory function body and extracts the
 * property/method augmentations the middleware applies to the context binding
 * obtained via `ctx.to(<Type>)`.
 *
 * Recognized pattern (protocol-agnostic):
 * ```ts
 * defineMiddleware(() => (ctx) => {
 *   const bound = ctx.to(SomeContext);
 *   bound.foo.bar = new SomeClass(...);
 *   bound.baz = <T>(dto: Class<T>): T => parsed as T;
 * });
 * ```
 *
 * @param factory - The outer factory function passed to `defineMiddleware`.
 * @returns Extracted augmentations, or `null` if no `ctx.to(...)` binding is found.
 */
export function extractMiddlewareAugments(factory: OxcFunction | ArrowFunctionExpression): MiddlewareAugmentResult | null {
  const handler = findHandlerFunction(factory);

  if (!handler) {
    return null;
  }

  const ctxParam = getFirstParamName(handler);

  if (!ctxParam) {
    return null;
  }

  const handlerBody = handler.body;

  if (!handlerBody || handlerBody.type !== 'BlockStatement') {
    return null;
  }

  const binding = findContextBinding(handlerBody, ctxParam);

  if (!binding) {
    return null;
  }

  const augments: PropAugment[] = [];

  collectAssignments(handlerBody, binding.varName, augments);

  const contextOps = extractContextOperations(handler, new Set([ctxParam, binding.varName]));

  return {
    contextType: binding.contextType,
    augments,
    contextOps,
  };
}

/**
 * The factory passed to `defineMiddleware` is `() => (ctx) => { ... }`.
 * The outer function returns the handler. Find that returned function.
 */
function findHandlerFunction(factory: OxcFunction | ArrowFunctionExpression): OxcFunction | ArrowFunctionExpression | null {
  const body = factory.body;

  if (!body) {
    return null;
  }

  // Concise arrow body: `() => (ctx) => { ... }`
  if (body.type !== 'BlockStatement') {
    return isFunctionLike(body) ? body : null;
  }

  // Block body: walk statements looking for `return <fn>` or final expression
  for (const stmt of body.body) {
    if (stmt.type === 'ReturnStatement' && stmt.argument && isFunctionLike(stmt.argument)) {
      return stmt.argument;
    }
  }

  return null;
}

function isFunctionLike(node: AstNode): node is ArrowFunctionExpression | FunctionExpression {
  return node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';
}

function getFirstParamName(fn: ArrowFunctionExpression | OxcFunction): string | null {
  const params = fn.params;

  if (!params || params.length === 0) {
    return null;
  }

  const first = params[0];

  if (first && first.type === 'Identifier') {
    return first.name;
  }

  return null;
}

interface ContextBinding {
  readonly varName: string;
  readonly contextType: string;
}

/**
 * Finds `const <varName> = <ctxParam>.to(<ContextType>)` within the handler body.
 */
function findContextBinding(body: AstNode, ctxParam: string): ContextBinding | null {
  let result: ContextBinding | null = null;

  const visit = (node: AstNode): void => {
    if (result) return;

    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier' || !decl.init) continue;

        const init = decl.init;

        if (init.type !== 'CallExpression') continue;

        const callee = init.callee;

        if (callee.type !== 'MemberExpression' || callee.computed) continue;
        if (callee.object.type !== 'Identifier' || callee.object.name !== ctxParam) continue;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'to') continue;

        const arg = init.arguments[0];

        if (!arg || arg.type !== 'Identifier') continue;

        result = { varName: decl.id.name, contextType: arg.name };
        return;
      }
    }

    walkChildren(node, visit);
  };

  visit(body);

  return result;
}

/**
 * Collects assignment expressions whose target is a member-access chain rooted
 * at `<varName>`. The full chain (excluding the root variable) is captured as
 * `path` — protocol-agnostic.
 */
function collectAssignments(body: AstNode, varName: string, out: PropAugment[]): void {
  const visit = (node: AstNode): void => {
    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const augment = extractAssignment(node, varName);

      if (augment) {
        out.push(augment);
        return;
      }
    }

    walkChildren(node, visit);
  };

  visit(body);
}

function extractAssignment(node: AssignmentExpression, varName: string): PropAugment | null {
  // node.left is an AssignmentTarget; only MemberExpression targets are augments.
  const left = node.left as AstNode;

  if (left.type !== 'MemberExpression') return null;

  const path = extractMemberPath(left as Expression, varName);

  if (!path) return null;

  const rhs = extractRhs(node.right);

  if (!rhs) return null;

  return { path, rhs };
}

/**
 * Walks a member-access chain (`a.b.c.d`) and returns the segment names
 * `['b','c','d']` if the root identifier is `varName`. Returns `null` if the
 * chain has computed access, the root is wrong, or any non-identifier segment
 * is encountered.
 */
function extractMemberPath(node: Expression, varName: string): readonly string[] | null {
  const segments: string[] = [];
  let current: Expression = node;

  while (current.type === 'MemberExpression') {
    if (current.computed) return null;
    if (current.property.type !== 'Identifier') return null;

    segments.unshift(current.property.name);
    current = current.object;
  }

  if (current.type !== 'Identifier' || current.name !== varName) return null;
  if (segments.length === 0) return null;

  return segments;
}

function extractRhs(expr: Expression): AugmentRhs | null {
  if (expr.type === 'NewExpression') {
    return extractClassRhs(expr);
  }

  if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
    return extractMethodRhs(expr);
  }

  return null;
}

function extractClassRhs(expr: NewExpression): AugmentRhs | null {
  if (expr.callee.type !== 'Identifier') return null;

  return { kind: 'class', identifier: expr.callee.name };
}

function extractMethodRhs(expr: ArrowFunctionExpression | FunctionExpression): AugmentRhs {
  const typeParams: string[] = [];
  const tParams = (expr as ArrowFunctionExpression).typeParameters;

  if (tParams && tParams.params) {
    for (const tp of tParams.params) {
      if (tp.type === 'TSTypeParameter' && tp.name && tp.name.type === 'Identifier') {
        typeParams.push(tp.name.name);
      }
    }
  }

  const params: AugmentMethodParam[] = [];

  for (const p of expr.params) {
    if (p.type === 'Identifier') {
      params.push({
        name: p.name,
        type: extractTypeAnnotation(p.typeAnnotation),
      });
    }
  }

  const returnType = extractTypeAnnotation((expr as ArrowFunctionExpression).returnType);

  return { kind: 'method', typeParams, params, returnType };
}

function extractTypeAnnotation(annotation: unknown): string | null {
  if (!annotation || typeof annotation !== 'object') return null;

  const inner = (annotation as { typeAnnotation?: unknown }).typeAnnotation;

  if (!inner || typeof inner !== 'object') return null;

  return stringifyTSType(inner as TSType);
}

function stringifyTSType(node: TSType): string | null {
  switch (node.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSVoidKeyword': return 'void';
    case 'TSAnyKeyword': return 'any';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSNeverKeyword': return 'never';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSBigIntKeyword': return 'bigint';
    case 'TSSymbolKeyword': return 'symbol';
    case 'TSObjectKeyword': return 'object';
    case 'TSTypeReference': {
      const name = stringifyTypeName(node.typeName);

      if (!name) return null;

      const args = node.typeArguments;

      if (args && args.params && args.params.length > 0) {
        const argStrs = args.params.map(stringifyTSType).filter((s): s is string => s !== null);

        return `${name}<${argStrs.join(', ')}>`;
      }

      return name;
    }
    case 'TSArrayType': {
      const elem = stringifyTSType(node.elementType);

      return elem ? `${elem}[]` : null;
    }
    default:
      return null;
  }
}

function stringifyTypeName(node: AstNode): string | null {
  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type === 'TSQualifiedName') {
    const left = stringifyTypeName((node as { left: AstNode }).left);
    const right = (node as { right: { name: string } }).right.name;

    return left ? `${left}.${right}` : null;
  }

  return null;
}
