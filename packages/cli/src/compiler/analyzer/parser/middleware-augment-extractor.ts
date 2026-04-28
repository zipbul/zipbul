import type { Node as AstNode } from '@zipbul/gildash';

import { walkChildren } from './ast-node-locator';
import {
  findInnerHandler,
  readFirstIdentifierParam,
} from './context-operation-extractor';

type FunctionLike = Extract<AstNode, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

function isFunctionLike(node: AstNode): node is FunctionLike {
  return node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression';
}

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
export function extractMiddlewareAugments(factory: AstNode): MiddlewareAugmentResult | null {
  if (!isFunctionLike(factory)) return null;

  const handler = findInnerHandler(factory);

  if (!handler || !isFunctionLike(handler)) {
    return null;
  }

  const ctxParam = readFirstIdentifierParam(handler);

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

  return {
    contextType: binding.contextType,
    augments,
  };
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

function extractAssignment(node: AstNode, varName: string): PropAugment | null {
  if (node.type !== 'AssignmentExpression') return null;

  const left = node.left as AstNode;

  if (left.type !== 'MemberExpression') return null;

  const path = extractMemberPath(left, varName);

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
function extractMemberPath(node: AstNode, varName: string): readonly string[] | null {
  if (node.type !== 'MemberExpression') return null;

  const segments: string[] = [];
  let current: AstNode = node;

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

function extractRhs(expr: AstNode): AugmentRhs | null {
  if (expr.type === 'NewExpression') {
    return extractClassRhs(expr);
  }

  if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
    return extractMethodRhs(expr);
  }

  return null;
}

function extractClassRhs(expr: AstNode): AugmentRhs | null {
  if (expr.type !== 'NewExpression') return null;
  if (expr.callee.type !== 'Identifier') return null;

  return { kind: 'class', identifier: expr.callee.name };
}

function extractMethodRhs(expr: AstNode): AugmentRhs {
  const typeParams: string[] = [];
  const tParams = (expr as unknown as { typeParameters?: { params?: Array<{ type: string; name?: { type: string; name: string } }> } }).typeParameters;

  if (tParams && tParams.params) {
    for (const tp of tParams.params) {
      if (tp.type === 'TSTypeParameter' && tp.name && tp.name.type === 'Identifier') {
        typeParams.push(tp.name.name);
      }
    }
  }

  const params: AugmentMethodParam[] = [];
  const exprParams = (expr as unknown as { params?: AstNode[] }).params ?? [];

  for (const p of exprParams) {
    if (p.type === 'Identifier') {
      params.push({
        name: p.name,
        type: extractTypeAnnotation((p as unknown as { typeAnnotation?: unknown }).typeAnnotation),
      });
    }
  }

  const returnType = extractTypeAnnotation((expr as unknown as { returnType?: unknown }).returnType);

  return { kind: 'method', typeParams, params, returnType };
}

function extractTypeAnnotation(annotation: unknown): string | null {
  if (!annotation || typeof annotation !== 'object') return null;

  const inner = (annotation as { typeAnnotation?: unknown }).typeAnnotation;

  if (!inner || typeof inner !== 'object') return null;

  return stringifyTSType(inner as AstNode);
}

/**
 * cli-side TypeScript type stringifier — Item 131 (β) decision.
 *
 * Walks oxc TS-* node variants exposed through gildash's `Node` union and
 * produces a textual form suitable for declaration merging IR emit.
 * gildash intentionally does not expose `TSType` (would push the library from
 * "indexer" toward "type-system aware tooling"); cli writes its own walker on
 * the gildash-exposed `Node` discriminants.
 */
function stringifyTSType(node: AstNode): string | null {
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
      const name = stringifyTypeName(node.typeName as AstNode);

      if (!name) return null;

      const args = node.typeArguments;

      if (args && args.params && args.params.length > 0) {
        const argStrs = args.params.map(p => stringifyTSType(p as AstNode)).filter((s): s is string => s !== null);

        return `${name}<${argStrs.join(', ')}>`;
      }

      return name;
    }
    case 'TSArrayType': {
      const elem = stringifyTSType(node.elementType as AstNode);

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
    const left = stringifyTypeName(node.left as AstNode);
    const right = (node.right as unknown as { name: string }).name;

    return left ? `${left}.${right}` : null;
  }

  return null;
}
