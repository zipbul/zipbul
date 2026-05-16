import { is } from '@zipbul/gildash';
import type { Node, ParsedFile, ExtractedSymbol } from '@zipbul/gildash';

/**
 * Extracts the string key name from a class member key node.
 * Handles `Identifier`, `PrivateIdentifier`, and string `Literal` keys.
 */
function getPropertyKeyName(key: Node): string | null {
  if (is.Identifier(key)) {
    return key.name;
  }

  if (is.PrivateIdentifier(key)) {
    return key.name;
  }

  if (is.Literal(key) && typeof key.value === 'string') {
    return key.value;
  }

  return null;
}

/**
 * Extracts the method name from a `CallExpression` callee that is a
 * static `MemberExpression` (e.g., `this.addMiddlewares(...)`).
 *
 * Returns `null` if `node` is not a `CallExpression` or its callee is not
 * a static member expression.
 */
export function getCalleeMethodName(node: Node): string | null {
  if (!is.CallExpression(node)) {
    return null;
  }

  const callee = node.callee;

  if (is.MemberExpression(callee) && !callee.computed) {
    if (is.Identifier(callee.property)) {
      return callee.property.name;
    }

    if (is.PrivateIdentifier(callee.property)) {
      return callee.property.name;
    }
  }

  return null;
}

/**
 * Extracts a `VariableDeclaration` from a statement, unwrapping export wrappers.
 * Returns the variable declaration node, or `null` if the statement is not one.
 */
function extractVariableDeclaration(stmt: Node): Node | null {
  if (is.VariableDeclaration(stmt)) {
    return stmt;
  }

  if (is.ExportNamedDeclaration(stmt) || is.ExportDefaultDeclaration(stmt)) {
    const decl = stmt.declaration;

    if (decl && is.VariableDeclaration(decl)) {
      return decl;
    }
  }

  return null;
}

/**
 * Extracts a function declaration node from a statement, unwrapping export wrappers.
 * Returns the function node (FunctionDeclaration), or `null`.
 */
function extractFunctionDeclaration(stmt: Node): Node | null {
  if (is.FunctionDeclaration(stmt)) {
    return stmt;
  }

  if (is.ExportNamedDeclaration(stmt) || is.ExportDefaultDeclaration(stmt)) {
    const decl = stmt.declaration;

    if (decl && is.FunctionDeclaration(decl)) {
      return decl;
    }
  }

  return null;
}

/**
 * Extracts a class declaration node from a statement, unwrapping export wrappers.
 * Returns the class node, or `null`.
 */
function extractClassFromStatement(stmt: Node): Node | null {
  if (is.ClassDeclaration(stmt)) {
    return stmt;
  }

  if (is.ExportNamedDeclaration(stmt) || is.ExportDefaultDeclaration(stmt)) {
    const decl = stmt.declaration;

    if (decl && is.ClassDeclaration(decl)) {
      return decl;
    }
  }

  return null;
}

/**
 * Iterates declarators of a `VariableDeclaration` node.
 */
function* iterDeclarators(varDecl: Node): IterableIterator<{ name: string | null; init: Node | null }> {
  if (!is.VariableDeclaration(varDecl)) {
    return;
  }

  for (const decl of varDecl.declarations) {
    const declName = is.Identifier(decl.id) ? decl.id.name : null;
    const init = decl.init ?? null;

    yield { name: declName, init };
  }
}

/**
 * Finds the initializer expression of a named variable declaration in a parsed file.
 *
 * Iterates all top-level statements, unwrapping export declarations, and returns
 * the `init` expression for the first variable declarator matching `variableName`.
 */
export function findVariableInitAstNode(parsed: ParsedFile, variableName: string): Node | null {
  for (const stmt of parsed.program.body as readonly Node[]) {
    const varDecl = extractVariableDeclaration(stmt);

    if (varDecl === null) {
      continue;
    }

    for (const { name, init } of iterDeclarators(varDecl)) {
      if (name === variableName && init !== null) {
        return init;
      }
    }
  }

  return null;
}

/**
 * Extracts the source text of a function declaration (or arrow function variable)
 * by name from the raw AST.
 */
export function extractFunctionSourceText(parsed: ParsedFile, functionName: string, code: string): string {
  for (const stmt of parsed.program.body as readonly Node[]) {
    const funcDecl = extractFunctionDeclaration(stmt);

    if (funcDecl !== null) {
      if (is.FunctionDeclaration(funcDecl) && funcDecl.id?.name === functionName) {
        return code.slice(funcDecl.start, funcDecl.end);
      }

      continue;
    }

    const varDecl = extractVariableDeclaration(stmt);

    if (varDecl !== null) {
      for (const { name, init } of iterDeclarators(varDecl)) {
        if (name === functionName && init !== null) {
          if (is.ArrowFunctionExpression(init) || is.FunctionExpression(init)) {
            return code.slice(init.start, init.end);
          }
        }
      }
    }
  }

  return '';
}

/**
 * Checks whether a parsed file contains an anonymous class declaration.
 */
export function isAnonymousClassSymbol(parsed: ParsedFile, _symbol: ExtractedSymbol): boolean {
  for (const stmt of parsed.program.body as readonly Node[]) {
    const classNode = extractClassFromStatement(stmt);

    if (classNode === null) {
      continue;
    }

    if (is.ClassDeclaration(classNode) && classNode.id === null) {
      return true;
    }
  }

  return false;
}

/**
 * Finds the raw class declaration node for a given class name in a parsed file.
 *
 * Searches top-level statements including those wrapped in export declarations.
 */
export function findClassAstNode(parsed: ParsedFile, className: string): Node | null {
  for (const stmt of parsed.program.body as readonly Node[]) {
    if (is.ClassDeclaration(stmt)) {
      if (stmt.id?.name === className) {
        return stmt;
      }
    }

    if (is.ExportNamedDeclaration(stmt) || is.ExportDefaultDeclaration(stmt)) {
      const declaration = stmt.declaration;

      if (declaration && is.ClassDeclaration(declaration) && declaration.id?.name === className) {
        return declaration;
      }
    }
  }

  return null;
}

/**
 * Finds the function-value node for a named method in a class node.
 *
 * `classNode` must be a `ClassDeclaration` or `ClassExpression`. Returns the
 * method's `value` (a `FunctionExpression`-like node), or `null`.
 */
export function findMethodBodyAstNode(classNode: Node, methodName: string): Node | null {
  if (!is.ClassDeclaration(classNode) && !is.ClassExpression(classNode)) {
    return null;
  }

  for (const member of classNode.body.body as readonly Node[]) {
    if (!is.MethodDefinition(member)) {
      continue;
    }

    if (member.kind !== 'method') {
      continue;
    }

    const name = getPropertyKeyName(member.key);

    if (name === methodName) {
      return member.value;
    }
  }

  return null;
}

/**
 * Finds a `PropertyDefinition` node for a named property in a class node.
 */
export function findPropertyAstNode(classNode: Node, propName: string): Node | null {
  if (!is.ClassDeclaration(classNode) && !is.ClassExpression(classNode)) {
    return null;
  }

  for (const member of classNode.body.body as readonly Node[]) {
    if (!is.PropertyDefinition(member)) {
      continue;
    }

    const name = getPropertyKeyName(member.key);

    if (name === propName) {
      return member;
    }
  }

  return null;
}
