import { isFunctionNode, walk, is } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';

import {
  findInnerHandler,
  readFirstIdentifierParam,
} from './context-operation-extractor';

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
  if (!isFunctionNode(factory)) return null;

  const handler = findInnerHandler(factory);

  if (!handler || !isFunctionNode(handler)) {
    return null;
  }

  const ctxParam = readFirstIdentifierParam(handler);

  if (!ctxParam) {
    return null;
  }

  const handlerBody = handler.body;

  if (!handlerBody || !is.BlockStatement(handlerBody)) {
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

  walk(body, {
    enter(node) {
      if (result) return;
      if (!is.VariableDeclaration(node)) return;
      for (const decl of node.declarations) {
        if (!is.Identifier(decl.id) || !decl.init) continue;

        const init = decl.init;
        if (!is.CallExpression(init)) continue;

        const callee = init.callee;
        if (!is.MemberExpression(callee) || callee.computed) continue;
        if (!is.Identifier(callee.object) || callee.object.name !== ctxParam) continue;
        if (!is.Identifier(callee.property) || callee.property.name !== 'to') continue;

        const arg = init.arguments[0];
        if (!arg || !is.Identifier(arg)) continue;

        result = { varName: decl.id.name, contextType: arg.name };
        return;
      }
    },
  });

  return result;
}

/**
 * Collects assignment expressions whose target is a member-access chain rooted
 * at `<varName>`. The full chain (excluding the root variable) is captured as
 * `path` — protocol-agnostic.
 */
function collectAssignments(body: AstNode, varName: string, out: PropAugment[]): void {
  walk(body, {
    enter(node) {
      if (is.AssignmentExpression(node) && node.operator === '=') {
        const augment = extractAssignment(node, varName);
        if (augment) out.push(augment);
      }
    },
  });
}

function extractAssignment(node: AstNode, varName: string): PropAugment | null {
  if (!is.AssignmentExpression(node)) return null;

  const left = node.left;

  if (!is.MemberExpression(left)) return null;

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
  if (!is.MemberExpression(node)) return null;

  const segments: string[] = [];
  let current: AstNode = node;

  while (is.MemberExpression(current)) {
    if (current.computed) return null;
    if (!is.Identifier(current.property)) return null;

    segments.unshift(current.property.name);
    current = current.object;
  }

  if (!is.Identifier(current) || current.name !== varName) return null;
  if (segments.length === 0) return null;

  return segments;
}

function extractRhs(expr: AstNode): AugmentRhs | null {
  if (is.NewExpression(expr)) {
    return extractClassRhs(expr);
  }

  if (is.ArrowFunctionExpression(expr) || is.FunctionExpression(expr)) {
    return extractMethodRhs(expr);
  }

  return null;
}

function extractClassRhs(expr: AstNode): AugmentRhs | null {
  if (!is.NewExpression(expr)) return null;
  if (!is.Identifier(expr.callee)) return null;

  return { kind: 'class', identifier: expr.callee.name };
}

function extractMethodRhs(expr: AstNode): AugmentRhs {
  const typeParams: string[] = [];

  if (is.ArrowFunctionExpression(expr) || is.FunctionExpression(expr)) {
    const tParams = expr.typeParameters;

    if (tParams) {
      for (const tp of tParams.params) {
        if (is.TSTypeParameter(tp) && is.Identifier(tp.name)) {
          typeParams.push(tp.name.name);
        }
      }
    }
  }

  const params: AugmentMethodParam[] = [];
  const exprParams = (is.ArrowFunctionExpression(expr) || is.FunctionExpression(expr))
    ? expr.params
    : [];

  for (const p of exprParams) {
    if (is.Identifier(p)) {
      params.push({
        name: p.name,
        type: extractTypeAnnotation(p.typeAnnotation),
      });
    }
  }

  const returnType = (is.ArrowFunctionExpression(expr) || is.FunctionExpression(expr))
    ? extractTypeAnnotation(expr.returnType)
    : null;

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
      const name = stringifyTypeName(node.typeName);

      if (!name) return null;

      const args = node.typeArguments;

      if (args && args.params && args.params.length > 0) {
        const argStrs = args.params.map(p => stringifyTSType(p)).filter((s): s is string => s !== null);

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
  if (is.Identifier(node)) {
    return node.name;
  }

  if (is.TSQualifiedName(node)) {
    const left = stringifyTypeName(node.left);
    const right = node.right.name;

    return left ? `${left}.${right}` : null;
  }

  return null;
}
