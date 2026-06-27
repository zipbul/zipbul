import { isFunctionNode, walk, is } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';

type FunctionLike = AstNode & { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' };


/**
 * A single member-access chain rooted at the handler's context parameter.
 *
 * `path` is the full chain (excluding the root identifier). `isCall` indicates
 * whether the chain is the callee of a `CallExpression` — if so, `dtoIdentifier`
 * captures the first identifier argument (used for AOT validation wireup).
 *
 * Protocol-agnostic: this extractor records what was accessed without knowing
 * which segments correspond to adapter-registered augments. Matching usages
 * against the augment map is the caller's job.
 *
 * @example
 * `ctx.request.cookie.get('s')` →
 *   `{ path: ['request', 'cookie', 'get'], isCall: true, dtoIdentifier: null }`
 *
 * `ctx.request.getBody(CreateUserDto)` →
 *   `{ path: ['request', 'getBody'], isCall: true, dtoIdentifier: 'CreateUserDto' }`
 *
 * `ctx.request.cookie` (read-only) →
 *   `{ path: ['request', 'cookie'], isCall: false, dtoIdentifier: null }`
 */
export interface ContextUsage {
  readonly path: readonly string[];
  readonly isCall: boolean;
  readonly dtoIdentifier: string | null;
}

export interface HandlerContextUsageResult {
  readonly contextParam: string;
  readonly usages: readonly ContextUsage[];
}

/**
 * Extracts context member-access chains from a handler method body.
 *
 * @param funcNode - The handler method's function AST node.
 * @returns Usage list, or `null` if the handler has no first parameter or no body.
 */
export function extractHandlerContextUsages(funcNode: AstNode): HandlerContextUsageResult | null {
  if (!isFunctionNode(funcNode)) return null;

  const ctxParam = getFirstIdentParam(funcNode);

  if (!ctxParam) return null;

  const body = funcNode.body;

  if (!body) return null;

  const usages: ContextUsage[] = [];

  walk(body, {
    enter(node, parent) {
      visitMember(node, parent, ctxParam, usages);
    },
  });

  return { contextParam: ctxParam, usages: dedup(usages) };
}

function getFirstIdentParam(fn: FunctionLike): string | null {
  if (!fn.params || fn.params.length === 0) return null;

  const first = fn.params[0];

  if (first && is.Identifier(first)) return first.name;

  return null;
}

function visitMember(node: AstNode, parent: AstNode | null, ctxParam: string, out: ContextUsage[]): void {
  if (!is.MemberExpression(node)) return;

  const isInnerOfChain = parent !== null
    && is.MemberExpression(parent)
    && parent.object === node;

  if (isInnerOfChain) return;

  const path = collectMemberPath(node, ctxParam);

  if (!path) return;

  const isCall = parent !== null
    && is.CallExpression(parent)
    && parent.callee === node;

  let dtoIdentifier: string | null = null;

  if (isCall && parent !== null && is.CallExpression(parent)) {
    const firstArg = parent.arguments[0];

    if (firstArg && is.Identifier(firstArg)) {
      dtoIdentifier = firstArg.name;
    }
  }

  out.push({ path, isCall, dtoIdentifier });
}

function collectMemberPath(node: AstNode, ctxParam: string): readonly string[] | null {
  if (!is.MemberExpression(node)) return null;

  const segments: string[] = [];
  let current: AstNode = node;

  while (is.MemberExpression(current)) {
    if (current.computed) return null;
    if (!is.Identifier(current.property)) return null;

    segments.unshift(current.property.name);
    current = current.object;
  }

  if (!is.Identifier(current) || current.name !== ctxParam) return null;
  if (segments.length === 0) return null;

  return segments;
}

function dedup(usages: readonly ContextUsage[]): ContextUsage[] {
  const seen = new Set<string>();
  const out: ContextUsage[] = [];

  for (const u of usages) {
    const key = `${u.isCall ? 'c' : 'p'}:${u.path.join('.')}:${u.dtoIdentifier ?? ''}`;

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(u);
  }

  return out;
}
