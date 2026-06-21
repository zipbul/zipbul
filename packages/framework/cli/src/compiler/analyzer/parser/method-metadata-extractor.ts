import { walk, is } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';

import type { FactoryDependency } from '../types';
import { isNonEmptyString } from '../type-guards';


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
