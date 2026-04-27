import type {
  Node as AstNode,
  Function as OxcFunction,
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  MemberExpression,
} from 'oxc-parser';

import { walkChildren } from './ast-node-locator';

/**
 * 단일 ctx 작업 호출 — `<rootVar>.set(KEY, ...)` / `<rootVar>.use(KEY)` / `<rootVar>.get(KEY)`.
 *
 * `kind` — 작업 분류:
 *  - `set`: producer (미들웨어가 컨텍스트 키를 채움)
 *  - `use`: required consumer (없으면 throws)
 *  - `get`: optional consumer (반환 `T | undefined`)
 *
 * `keyIdentifier` — 첫 번째 인자의 Identifier 이름. `contextKey<T>(...)` 결과를 참조해야 한다.
 *  비-Identifier (literal, expression 등) 는 `null` 으로 기록 — 검증 대상에서 제외된다.
 *
 * `start` — 진단 메시지용 source byte offset (oxc-parser 의 `start`).
 *  파일 내용과 결합하여 1-based 라인/컬럼 변환 가능. 추출 실패 시 `null`.
 */
export interface ContextOperation {
  readonly kind: 'set' | 'use' | 'get';
  readonly keyIdentifier: string | null;
  readonly start: number | null;
}

/**
 * 함수 본문에서 ctx 작업을 추출한다.
 *
 * `rootVarNames` — 추적 대상 변수 이름 집합. 일반적으로 `ctx` 파라미터 이름 +
 * `const bound = ctx.to(...)` 의 binding 변수 이름들을 포함한다.
 *
 * 인식 패턴 (protocol-agnostic):
 * ```ts
 * ctx.set(SessionKey, session);             // producer
 * ctx.use(RequestId);                        // required consumer
 * ctx.get(OptionalKey);                      // optional consumer
 * const http = ctx.to(HttpContext);
 * http.set(AnotherKey, ...);                 // bound producer
 * ```
 */
export function extractContextOperations(
  funcNode: OxcFunction | ArrowFunctionExpression,
  rootVarNames: ReadonlySet<string>,
): ContextOperation[] {
  const body = funcNode.body;
  if (!body) return [];

  const ops: ContextOperation[] = [];
  visitNode(body, rootVarNames, ops);
  return ops;
}

/**
 * 핸들러 메서드 본문에서 ctx 작업을 추출한다.
 *
 * 첫 번째 파라미터를 ctx 로 간주, `const bound = ctx.to(<Type>)` 로 만든
 * binding 변수까지 root 에 포함하여 set/use/get 호출을 모두 수집한다.
 */
export function extractHandlerContextOps(
  funcNode: OxcFunction | ArrowFunctionExpression,
): readonly ContextOperation[] {
  const ctxParam = readFirstIdentifierParam(funcNode);
  if (ctxParam === null) return [];

  const body = funcNode.body;
  if (!body) return [];

  const roots = new Set<string>([ctxParam]);
  if (body.type === 'BlockStatement') {
    for (const binding of findContextBindings(body, ctxParam)) {
      roots.add(binding);
    }
  }

  return extractContextOperations(funcNode, roots);
}

/**
 * `defineMiddleware()` factory 본문에서 inner handler 의 ctx 작업을 추출한다.
 *
 * factory 형태: `() => (ctx) => { ... }` 또는 `() => { return (ctx) => {...}; }`.
 * inner handler 의 첫 번째 파라미터 + `ctx.to(<Type>)` binding 들을 root 로 수집.
 */
export function extractMiddlewareContextOps(
  factory: OxcFunction | ArrowFunctionExpression,
): readonly ContextOperation[] {
  const inner = findInnerHandler(factory);
  if (inner === null) return [];

  return extractHandlerContextOps(inner);
}

/**
 * `defineMiddleware()` factory 본문에서 inner handler 함수 노드를 찾는다.
 *
 * - Concise arrow: `() => (ctx) => {...}` → 바로 inner 반환
 * - Block body: `() => { return (ctx) => {...}; }` → return 문 인수에서 inner 추출
 *
 * augment 추출과 ops 추출 양쪽에서 동일 로직이 필요하므로 단일 소스로 export.
 */
export function findInnerHandler(
  factory: OxcFunction | ArrowFunctionExpression,
): OxcFunction | ArrowFunctionExpression | null {
  const body = factory.body;
  if (!body) return null;

  if (body.type !== 'BlockStatement') {
    return body.type === 'ArrowFunctionExpression' || body.type === 'FunctionExpression'
      ? (body as ArrowFunctionExpression | OxcFunction)
      : null;
  }

  for (const stmt of body.body) {
    if (
      stmt.type === 'ReturnStatement'
      && stmt.argument
      && (stmt.argument.type === 'ArrowFunctionExpression' || stmt.argument.type === 'FunctionExpression')
    ) {
      return stmt.argument as ArrowFunctionExpression | OxcFunction;
    }
  }
  return null;
}

/**
 * 함수의 첫 번째 파라미터가 단순 Identifier 일 때 그 이름을 반환.
 * 비어있거나 destructuring/rest 등이면 `null`.
 */
export function readFirstIdentifierParam(
  fn: OxcFunction | ArrowFunctionExpression,
): string | null {
  const params = fn.params;
  if (!params || params.length === 0) return null;
  const first = params[0];
  if (!first || first.type !== 'Identifier') return null;
  return (first as { name: string }).name;
}

/**
 * `defineMiddleware()` factory 의 inner handler 본문을 분석할 때,
 * `const bound = ctx.to(<Type>)` 형태로 만들어진 binding 변수 이름까지 추적 대상에 포함한다.
 */
export function findContextBindings(
  body: AstNode,
  ctxParam: string,
): readonly string[] {
  const bindings: string[] = [];

  const visit = (node: AstNode): void => {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier' || !decl.init) continue;

        const init = decl.init;
        if (init.type !== 'CallExpression') continue;

        const callee = init.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) continue;
        if (callee.object.type !== 'Identifier' || callee.object.name !== ctxParam) continue;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'to') continue;

        bindings.push(decl.id.name);
      }
    }

    walkChildren(node, visit);
  };

  visit(body);
  return bindings;
}

const TRACKED_METHODS = new Set<'set' | 'use' | 'get'>(['set', 'use', 'get']);

function visitNode(node: AstNode, roots: ReadonlySet<string>, out: ContextOperation[]): void {
  if (node.type === 'CallExpression') {
    const op = tryExtractOperation(node as CallExpression, roots);
    if (op !== null) {
      out.push(op);
    }
  }

  walkChildren(node, (child) => visitNode(child, roots, out));
}

function tryExtractOperation(
  call: CallExpression,
  roots: ReadonlySet<string>,
): ContextOperation | null {
  const callee = call.callee;
  if (callee.type !== 'MemberExpression') return null;

  const member = callee as MemberExpression;
  if (member.computed) return null;
  if (member.property.type !== 'Identifier') return null;

  const methodName = (member.property as { name: string }).name;
  if (!isTrackedMethod(methodName)) return null;

  if (member.object.type !== 'Identifier') return null;
  const rootName = (member.object as { name: string }).name;
  if (!roots.has(rootName)) return null;

  const firstArg = call.arguments[0] as Expression | undefined;
  const keyIdentifier =
    firstArg !== undefined && firstArg.type === 'Identifier'
      ? (firstArg as { name: string }).name
      : null;

  const start = readStart(call);

  return { kind: methodName, keyIdentifier, start };
}

function isTrackedMethod(name: string): name is 'set' | 'use' | 'get' {
  return TRACKED_METHODS.has(name as 'set' | 'use' | 'get');
}

function readStart(node: AstNode): number | null {
  const start = (node as { start?: number }).start;
  return typeof start === 'number' ? start : null;
}

