/**
 * Shared validator — `defineMiddleware / defineGuard / defineExceptionFilter /
 * defineAdapter / defineModule` calls MUST appear as the *direct initializer*
 * of a *top-level exported `const`* declaration. Every other position is a
 * CONTRACT error.
 *
 * Single normative rule, enforced uniformly by `zb build adapter`,
 * `zb build --lib`, and the user-app build (`zb build`). With this rule in
 * place, downstream extractors only need to scan top-level exported variable
 * initializers — every other shape is rejected at the gate.
 *
 * @public
 */
import { walk, is, buildLineOffsets, getLineColumn, extractRelations } from '@zipbul/gildash';
import type { Node, ParsedFile, CodeRelation } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../diagnostics';

/** Modules whose `defineX` exports are regulated. */
const REGULATED_SOURCES: ReadonlySet<string> = new Set(['@zipbul/common', '@zipbul/core']);

/**
 * Set of factory functions whose calls must follow the `export const X = factory(...)` shape.
 * @public
 */
export const REGULATED_DEFINE_CALLS: ReadonlySet<string> = new Set([
  'defineAdapter',
  'defineMiddleware',
  'defineGuard',
  'defineExceptionFilter',
  'defineModule',
]);

/** Minimal input shape — the validator only needs the parsed file + relative path. */
export interface DefineCallShapeInput {
  readonly filePath: string;
  readonly parsed: ParsedFile;
}

/**
 * Reason classification for a shape violation.
 *
 * - `not-top-level`: call is nested inside another expression (array literal,
 *   object property, function body, class member, conditional, etc.).
 * - `not-exported`: call is the initializer of a `const` declaration but the
 *   declaration is not exported.
 * - `not-const`: call is the initializer of a `let`/`var` declaration.
 *
 * @public
 */
export type DefineCallShapeReason = 'not-top-level' | 'not-exported' | 'not-const';

export interface DefineCallShapeViolation {
  readonly callee: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly reason: DefineCallShapeReason;
}

/**
 * Walks every parsed file and returns all violations of the
 * `export const NAME = defineX(...)` shape rule. Empty array on success.
 *
 * @public
 */
export function findDefineCallShapeViolations(
  files: readonly DefineCallShapeInput[],
): readonly DefineCallShapeViolation[] {
  const violations: DefineCallShapeViolation[] = [];

  for (const file of files) {
    classifyFile(file, violations);
  }

  return violations;
}

/**
 * Convenience: throw a single aggregated `DiagnosticError` if any violation
 * is detected. The message lists every offender with `file:line:column` +
 * the specific reason.
 *
 * @public
 */
export function validateDefineCallShape(files: readonly DefineCallShapeInput[]): void {
  const violations = findDefineCallShapeViolations(files);
  if (violations.length === 0) return;

  const formatted = violations
    .map(v => `  - ${v.filePath}:${v.line}:${v.column} \`${v.callee}(...)\` — ${describeReason(v.reason)}`)
    .join('\n');

  throw new DiagnosticError(buildDiagnostic({
    reason: `[CONTRACT] \`defineMiddleware / defineGuard / defineExceptionFilter / defineAdapter / defineModule\` calls must appear as the direct initializer of a top-level exported \`const\` declaration. Found ${violations.length} violation(s):\n${formatted}\n\nFix shape: \`export const myThing = defineMiddleware(...)\`.`,
  }));
}

function describeReason(reason: DefineCallShapeReason): string {
  switch (reason) {
    case 'not-top-level':
      return 'not at top level (nested inside another expression / function / class)';
    case 'not-exported':
      return 'top-level `const` is not exported';
    case 'not-const':
      return 'declared with `let`/`var` instead of `const`';
  }
}

/**
 * Per-file resolver: given the local identifier the call uses, return the
 * `defineX` original name when (and only when) the local binding traces back
 * to `@zipbul/common` or `@zipbul/core` via a static import. Captures:
 *   - `import { defineMiddleware } from '@zipbul/common'`            → 'defineMiddleware'
 *   - `import { defineMiddleware as mw } from '@zipbul/common'`      → mw → 'defineMiddleware'
 *   - `import * as zb from '@zipbul/common'; zb.defineMiddleware(…)` → namespace lookup
 */
interface CalleeResolver {
  /** Resolves a local `Identifier(name)` to the `defineX` original name, or null. */
  named(localName: string): string | null;
  /** Returns true if `objectName` is an `import * as` namespace from a regulated source. */
  isRegulatedNamespace(objectName: string): boolean;
}

function buildCalleeResolver(file: DefineCallShapeInput): CalleeResolver {
  const named = new Map<string, string>();           // localName → originalName
  const namespaces = new Set<string>();              // localName of `* as ns`

  const relations: readonly CodeRelation[] = extractRelations(file.parsed.program, file.filePath);
  for (const rel of relations) {
    if (rel.type !== 'imports') continue;
    const specifier = rel.specifier;
    if (specifier === undefined || !REGULATED_SOURCES.has(specifier)) continue;

    const local = rel.srcSymbolName;
    const imported = rel.dstSymbolName;
    if (local === null) continue;

    if (imported === '*') {
      namespaces.add(local);
      continue;
    }
    if (imported === null || imported === 'default') continue;

    if (REGULATED_DEFINE_CALLS.has(imported)) {
      named.set(local, imported);
    }
  }

  return {
    named: localName => named.get(localName) ?? null,
    isRegulatedNamespace: objectName => namespaces.has(objectName),
  };
}

function classifyFile(file: DefineCallShapeInput, out: DefineCallShapeViolation[]): void {
  const resolver = buildCalleeResolver(file);

  // Step 1 — collect the *legal* set: every CallExpression that sits in the
  // initializer slot of a top-level `export const NAME = <call>` statement.
  const allowed = new WeakSet<object>();
  for (const stmt of file.parsed.program.body as readonly Node[]) {
    visitTopLevelStatement(stmt, allowed, resolver);
  }

  const lineOffsets = buildLineOffsets(file.parsed.sourceText);

  // Step 2 — walk every CallExpression in the file. Anything resolving to a
  // regulated `defineX` *and not in `allowed`* is a violation.
  walk(file.parsed.program, {
    enter(node) {
      if (!is.CallExpression(node)) return;
      const calleeName = resolveRegulatedCallee(node, resolver);
      if (calleeName === null) return;
      if (allowed.has(node)) return;

      const { line, column } = getLineColumn(lineOffsets, node.start);
      out.push({
        callee: calleeName,
        filePath: file.filePath,
        line,
        column,
        reason: classifyReason(file.parsed.program, node),
      });
    },
  });
}

function visitTopLevelStatement(stmt: Node, allowed: WeakSet<object>, resolver: CalleeResolver): void {
  // `export const NAME = defineX(...)`
  if (is.ExportNamedDeclaration(stmt) && stmt.declaration && is.VariableDeclaration(stmt.declaration)) {
    if (stmt.declaration.kind !== 'const') return;
    for (const decl of stmt.declaration.declarations) {
      if (decl.init !== null && decl.init !== undefined && is.CallExpression(decl.init)) {
        if (resolveRegulatedCallee(decl.init, resolver) !== null) {
          allowed.add(decl.init);
        }
      }
    }
  }
}

/**
 * Resolves a CallExpression's callee to the regulated `defineX` original
 * name when the callee references one (via direct import, alias, or
 * namespace member access from `@zipbul/common` / `@zipbul/core`). Returns
 * `null` for any other call.
 */
function resolveRegulatedCallee(call: Node, resolver: CalleeResolver): string | null {
  if (!is.CallExpression(call)) return null;
  const callee = call.callee;

  if (is.Identifier(callee)) {
    return resolver.named(callee.name);
  }

  if (is.MemberExpression(callee) && !callee.computed && is.Identifier(callee.property) && is.Identifier(callee.object)) {
    if (!resolver.isRegulatedNamespace(callee.object.name)) return null;
    const propName = callee.property.name;
    return REGULATED_DEFINE_CALLS.has(propName) ? propName : null;
  }

  return null;
}

/**
 * Determines *why* a regulated call is not in the allowed set. Walks the
 * top-level statements again to detect non-exported / non-const cases; falls
 * back to `not-top-level` for everything else (nested inside any expression).
 */
function classifyReason(program: Node, target: Node): DefineCallShapeReason {
  for (const stmt of (program as Node & { body: readonly Node[] }).body) {
    if (is.ExportNamedDeclaration(stmt) && stmt.declaration && is.VariableDeclaration(stmt.declaration)) {
      if (stmt.declaration.kind !== 'const') {
        if (declarationContainsCall(stmt.declaration, target)) return 'not-const';
      }
      continue;
    }

    if (is.VariableDeclaration(stmt)) {
      if (declarationContainsCall(stmt, target)) {
        return stmt.kind === 'const' ? 'not-exported' : 'not-const';
      }
    }
  }

  return 'not-top-level';
}

function declarationContainsCall(varDecl: Node, target: Node): boolean {
  if (!is.VariableDeclaration(varDecl)) return false;
  for (const decl of varDecl.declarations) {
    if (decl.init === target) return true;
  }
  return false;
}
