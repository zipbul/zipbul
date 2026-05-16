import { isFunctionNode, walk, is } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';
import type { Result } from '@zipbul/result';
import { err } from '@zipbul/result';

import type { ClassMetadata } from '../interfaces';
import type { FactoryDependency } from '../types';
import type { Diagnostic } from '../../../diagnostics';
import { buildDiagnostic } from '../../../diagnostics';
import { isNonEmptyString } from '../type-guards';
import { getCalleeMethodName } from './ast-node-locator';


/**
 * Parses a `configure()` method body for `addErrorFilters([...])` calls and
 * extracts exception filter registrations.
 *
 * Each element in the array argument must be an `Identifier`; spread elements
 * and non-identifier expressions produce a diagnostic error.
 *
 * @param funcNode - The `configure()` method's function AST node.
 * @returns Array of exception filter metadata, or a diagnostic on invalid syntax.
 */
export function extractExceptionFiltersFromConfigure(funcNode: AstNode, filePath: string): Result<ClassMetadata['exceptionFilters'], Diagnostic> {
  const exceptionFilters: ClassMetadata['exceptionFilters'] = [];

  const body = getFunctionBody(funcNode);

  if (body === null) {
    return exceptionFilters;
  }

  const error = (): never => {
    throw new Error('addErrorFilters only supports literal arrays and Identifiers.');
  };

  try {
    walk(body, {
      enter(node) {
        if (!is.CallExpression(node)) return;

        const methodName = getCalleeMethodName(node);
        if (methodName !== 'addErrorFilters') return;

        const args = node.arguments;
        const arrayArg = args.length > 0 ? args[0] : null;

        if (!arrayArg || !is.ArrayExpression(arrayArg)) {
          error();
          return;
        }

        for (let index = 0; index < arrayArg.elements.length; index += 1) {
          const el = arrayArg.elements[index];

          if (el === null || el === undefined || is.SpreadElement(el)) {
            error();
            return;
          }

          if (is.Identifier(el)) {
            if (!isNonEmptyString(el.name)) {
              error();
              return;
            }

            exceptionFilters.push({ name: el.name, index });
            continue;
          }

          error();
          return;
        }
      },
    });
  } catch {
    return err(buildDiagnostic({
      reason: 'addErrorFilters only supports literal arrays and Identifiers.',
      file: filePath,
      how: 'Pass identifiers directly: `cfg.addErrorFilters([MyFilter, OtherFilter])`. Spreads, calls, and inline expressions are not supported.',
    }));
  }

  return exceptionFilters;
}

/**
 * Parses a `configure()` method body for `addMiddlewares(lifecycle, [...])` calls
 * and extracts middleware registrations.
 *
 * Each array element must be an `Identifier` or a `Identifier.withOptions(...)` call.
 * Spread elements and other expression types produce a diagnostic error.
 *
 * @param funcNode - The `configure()` method's function AST node.
 * @returns Array of middleware metadata, or a diagnostic on invalid syntax.
 */
export function extractMiddlewaresFromConfigure(funcNode: AstNode, filePath: string): Result<ClassMetadata['middlewares'], Diagnostic> {
  const middlewares: ClassMetadata['middlewares'] = [];

  const body = getFunctionBody(funcNode);

  if (body === null) {
    return middlewares;
  }

  const error = (): never => {
    throw new Error('addMiddlewares only supports literal arrays and Identifier/withOptions.');
  };

  try {
    walk(body, {
      enter(node) {
        if (!is.CallExpression(node)) return;

        const methodName = getCalleeMethodName(node);
        if (methodName !== 'addMiddlewares') return;

        const args = node.arguments;
        const lifecycleArg = args.length > 0 ? args[0] : null;
        const lifecycle = lifecycleArg && is.Identifier(lifecycleArg) ? lifecycleArg.name : undefined;
        const arrayArg = args.length > 1 ? args[1] : null;

        if (!arrayArg || !is.ArrayExpression(arrayArg)) {
          error();
          return;
        }

        for (let index = 0; index < arrayArg.elements.length; index += 1) {
          const el = arrayArg.elements[index];

          if (el === null || el === undefined || is.SpreadElement(el)) {
            error();
            return;
          }

          if (is.Identifier(el)) {
            if (!isNonEmptyString(el.name)) {
              error();
              return;
            }

            if (isNonEmptyString(lifecycle)) {
              middlewares.push({ name: el.name, lifecycle, index });
            } else {
              middlewares.push({ name: el.name, index });
            }
            continue;
          }

          if (is.CallExpression(el)) {
            const innerCallee = el.callee;

            if (is.MemberExpression(innerCallee) && !innerCallee.computed) {
              const propName = is.Identifier(innerCallee.property) ? innerCallee.property.name : null;

              if (is.Identifier(innerCallee.object) && propName === 'withOptions') {
                if (!isNonEmptyString(innerCallee.object.name)) {
                  error();
                  return;
                }

                const name = innerCallee.object.name;

                if (isNonEmptyString(lifecycle)) {
                  middlewares.push({ name, lifecycle, index });
                } else {
                  middlewares.push({ name, index });
                }
                continue;
              }
            }
          }

          error();
          return;
        }
      },
    });
  } catch {
    return err(buildDiagnostic({
      reason: 'addMiddlewares only supports literal arrays and Identifier/withOptions.',
      file: filePath,
      how: 'Use one of the supported forms: `cfg.addMiddlewares(LIFECYCLE, [Mw1, Mw2])` or `cfg.addMiddlewares(LIFECYCLE, [Mw1.withOptions({...})])`. Spreads, calls, and inline expressions are not supported.',
    }));
  }

  return middlewares;
}

/**
 * Returns the body of a function-like node (`FunctionDeclaration`,
 * `FunctionExpression`, `ArrowFunctionExpression`), or `null` if the node is
 * not a function or the body is missing.
 */
function getFunctionBody(node: AstNode): AstNode | null {
  if (!isFunctionNode(node)) {
    return null;
  }

  return node.body ?? null;
}

/**
 * Extracts factory function dependencies by walking the function body and
 * collecting identifiers that match known imports.
 *
 * Function parameter names are tracked as locally-defined bindings and excluded
 * from the dependency list. Each dependency records the original (pre-alias) name
 * and its import path, along with byte offsets relative to the given `offset`.
 *
 * @param funcExpression - The factory function's AST expression node.
 * @param offset - Byte offset to subtract from node positions (for code slicing).
 * @param currentImports - Map of local import names to their resolved file paths.
 * @param currentOriginalNames - Map of local alias names to their original exported names.
 * @returns Array of factory dependencies found in the function body.
 */
export function extractDependencies(
  funcExpression: AstNode,
  offset: number,
  currentImports: Record<string, string>,
  currentOriginalNames: Record<string, string>,
): FactoryDependency[] {
  const deps: FactoryDependency[] = [];
  const defined = new Set<string>();

  const resolveOriginalName = (localName: string): string => {
    return currentOriginalNames[localName] ?? localName;
  };

  const root = (is.ArrowFunctionExpression(funcExpression) || is.FunctionExpression(funcExpression))
    ? funcExpression.body
    : funcExpression;

  if (root === null || root === undefined) return deps;

  walk(root, {
    enter(node) {
      if (is.FunctionExpression(node)) {
        for (const param of node.params) {
          if (is.Identifier(param) && isNonEmptyString(param.name)) {
            defined.add(param.name);
          }
        }
        return;
      }

      if (is.Identifier(node)) {
        const name = node.name;
        const path = isNonEmptyString(name) ? currentImports[name] : undefined;

        if (isNonEmptyString(name) && isNonEmptyString(path) && !defined.has(name)) {
          deps.push({
            name: resolveOriginalName(name),
            path,
            start: node.start - offset,
            end: node.end - offset,
          });
        }
      }
    },
  });

  return deps;
}
