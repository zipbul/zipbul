import type {
  Node as AstNode,
  Function as OxcFunction,
  CallExpression,
  MemberExpression,
} from 'oxc-parser';

import { walkChildren } from './ast-node-locator';
import {
  extractContextOperations,
  findContextBindings,
  type ContextOperation,
} from './context-operation-extractor';

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
  /**
   * Producer/consumer operations on the context object — extracted from
   * `ctx.set(KEY, ...)` / `ctx.use(KEY)` / `ctx.get(KEY)` and equivalent
   * calls on `ctx.to(<Type>)` bindings.
   */
  readonly contextOps: readonly ContextOperation[];
}

/**
 * Extracts context member-access chains from a handler method body.
 *
 * @param funcNode - The handler method's function AST node.
 * @returns Usage list, or `null` if the handler has no first parameter or no body.
 */
export function extractHandlerContextUsages(funcNode: OxcFunction): HandlerContextUsageResult | null {
  const ctxParam = getFirstIdentParam(funcNode);

  if (!ctxParam) return null;

  const body = funcNode.body;

  if (!body) return null;

  const usages: ContextUsage[] = [];

  visit(body, null, ctxParam, usages);

  const bindings = findContextBindings(body, ctxParam);
  const contextOps = extractContextOperations(funcNode, new Set([ctxParam, ...bindings]));

  return { contextParam: ctxParam, usages: dedup(usages), contextOps };
}

function getFirstIdentParam(fn: OxcFunction): string | null {
  if (!fn.params || fn.params.length === 0) return null;

  const first = fn.params[0];

  if (first && first.type === 'Identifier') return first.name;

  return null;
}

function visit(node: AstNode, parent: AstNode | null, ctxParam: string, out: ContextUsage[]): void {
  if (node.type === 'MemberExpression') {
    const isInnerOfChain = parent !== null
      && parent.type === 'MemberExpression'
      && (parent as MemberExpression).object === node;

    if (!isInnerOfChain) {
      const path = collectMemberPath(node as MemberExpression, ctxParam);

      if (path) {
        const isCall = parent !== null
          && parent.type === 'CallExpression'
          && (parent as CallExpression).callee === node;

        let dtoIdentifier: string | null = null;

        if (isCall) {
          const firstArg = (parent as CallExpression).arguments[0];

          if (firstArg && firstArg.type === 'Identifier') {
            dtoIdentifier = firstArg.name;
          }
        }

        out.push({ path, isCall, dtoIdentifier });
      }
    }
  }

  walkChildren(node, (child) => visit(child, node, ctxParam, out));
}

function collectMemberPath(node: MemberExpression, ctxParam: string): readonly string[] | null {
  const segments: string[] = [];
  let current: AstNode = node;

  while (current.type === 'MemberExpression') {
    const m = current as MemberExpression;

    if (m.computed) return null;
    if (m.property.type !== 'Identifier') return null;

    segments.unshift(m.property.name);
    current = m.object as AstNode;
  }

  if (current.type !== 'Identifier' || (current as { name: string }).name !== ctxParam) return null;
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
