import type {
  Node as AstNode,
  Function as OxcFunction,
} from 'oxc-parser';
import type { Result } from '@zipbul/result';
import { err } from '@zipbul/result';

import type { ClassMetadata } from '../interfaces';
import type { FactoryDependency } from '../types';
import type { Diagnostic } from '../../../diagnostics';
import { buildDiagnostic } from '../../../diagnostics';
import { isNonEmptyString } from '../type-guards';
import { walkChildren, getCalleeMethodName } from './ast-node-locator';


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
export function extractExceptionFiltersFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['exceptionFilters'], Diagnostic> {
  const exceptionFilters: ClassMetadata['exceptionFilters'] = [];

  if (funcNode.body === null) {
    return exceptionFilters;
  }

  const error = (): never => {
    throw new Error('[Zipbul AOT] addErrorFilters only supports literal arrays and Identifiers.');
  };

  const visit = (node: AstNode): void => {
    if (node.type === 'CallExpression') {
      const methodName = getCalleeMethodName(node);

      if (methodName === 'addErrorFilters') {
        const args = node.arguments;
        const arrayArg = args.length > 0 ? args[0] : null;

        if (!arrayArg || arrayArg.type !== 'ArrayExpression') {
          return error();
        }

        for (let index = 0; index < arrayArg.elements.length; index += 1) {
          const el = arrayArg.elements[index];

          if (el === null || el === undefined || el.type === 'SpreadElement') {
            return error();
          }

          if (el.type === 'Identifier') {
            if (!isNonEmptyString(el.name)) {
              return error();
            }

            exceptionFilters.push({ name: el.name, index });

            continue;
          }

          return error();
        }

        return;
      }
    }

    walkChildren(node, visit);
  };

  try {
    visit(funcNode.body);
  } catch {
    return err(buildDiagnostic({
      reason: 'addErrorFilters only supports literal arrays and Identifiers.',
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
export function extractMiddlewaresFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['middlewares'], Diagnostic> {
  const middlewares: ClassMetadata['middlewares'] = [];

  if (funcNode.body === null) {
    return middlewares;
  }

  const error = (): never => {
    throw new Error('[Zipbul AOT] addMiddlewares only supports literal arrays and Identifier/withOptions.');
  };

  const visit = (node: AstNode): void => {
    if (node.type === 'CallExpression') {
      const methodName = getCalleeMethodName(node);

      if (methodName === 'addMiddlewares') {
        const args = node.arguments;
        const lifecycleArg = args.length > 0 ? args[0] : null;
        const lifecycle = lifecycleArg?.type === 'Identifier' ? lifecycleArg.name : undefined;
        const arrayArg = args.length > 1 ? args[1] : null;

        if (!arrayArg || arrayArg.type !== 'ArrayExpression') {
          return error();
        }

        for (let index = 0; index < arrayArg.elements.length; index += 1) {
          const el = arrayArg.elements[index];

          if (el === null || el === undefined || el.type === 'SpreadElement') {
            return error();
          }

          if (el.type === 'Identifier') {
            if (!isNonEmptyString(el.name)) {
              return error();
            }

            if (isNonEmptyString(lifecycle)) {
              middlewares.push({ name: el.name, lifecycle, index });
            } else {
              middlewares.push({ name: el.name, index });
            }

            continue;
          }

          if (el.type === 'CallExpression') {
            const innerCallee = el.callee;

            if (innerCallee.type === 'MemberExpression' && !innerCallee.computed) {
              const propName = innerCallee.property.name;

              if (innerCallee.object.type === 'Identifier' && propName === 'withOptions') {
                if (!isNonEmptyString(innerCallee.object.name)) {
                  return error();
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

          return error();
        }

        return;
      }
    }

    walkChildren(node, visit);
  };

  try {
    visit(funcNode.body);
  } catch {
    return err(buildDiagnostic({
      reason: 'addMiddlewares only supports literal arrays and Identifier/withOptions.',
    }));
  }

  return middlewares;
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

  const visit = (node: AstNode): void => {
    if (node.type === 'Identifier') {
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

    if (node.type === 'FunctionExpression') {
      for (const param of node.params) {
        if (param.type === 'Identifier') {
          if (isNonEmptyString(param.name)) {
            defined.add(param.name);
          }
        }
      }

      if (node.body !== null) {
        visit(node.body);
      }

      return;
    }

    walkChildren(node, visit);
  };

  if (funcExpression.type === 'ArrowFunctionExpression' || funcExpression.type === 'FunctionExpression') {
    if (funcExpression.body !== null) {
      visit(funcExpression.body);
    }
  } else {
    visit(funcExpression);
  }

  return deps;
}
