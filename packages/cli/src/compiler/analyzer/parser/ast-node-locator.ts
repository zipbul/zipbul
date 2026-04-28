import { visitorKeys } from '@zipbul/gildash';
import type { Node, ParsedFile, ExtractedSymbol } from '@zipbul/gildash';

/**
 * Checks whether a value is an AST node (object with a string `type` field).
 */
export function isAstNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value
    && typeof (value as Record<string, unknown>).type === 'string';
}

/**
 * Walks child AST nodes of a parent node using gildash-exported `visitorKeys`.
 *
 * Only traverses keys known to contain AST children — avoiding structural fields
 * like `type`, `start`, `end`, `parent`.
 */
export function walkChildren(node: Node, visitor: (child: Node) => void): void {
  const keys = visitorKeys[node.type];

  if (!keys) {
    return;
  }

  for (const key of keys) {
    const child = (node as unknown as Record<string, unknown>)[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) {
          visitor(item);
        }
      }
    } else if (isAstNode(child)) {
      visitor(child);
    }
  }
}

/**
 * Extracts the string key name from a class member key node.
 * Handles `Identifier`, `PrivateIdentifier`, and string `Literal` keys.
 */
function getPropertyKeyName(key: Node): string | null {
  if (key.type === 'Identifier') {
    return key.name;
  }

  if (key.type === 'PrivateIdentifier') {
    return key.name;
  }

  if (key.type === 'Literal' && typeof key.value === 'string') {
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
  if (node.type !== 'CallExpression') {
    return null;
  }

  const callee = node.callee;

  if (callee.type === 'MemberExpression' && !callee.computed) {
    if (callee.property.type === 'Identifier') {
      return callee.property.name;
    }

    if (callee.property.type === 'PrivateIdentifier') {
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
  if (stmt.type === 'VariableDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl && (decl as Node).type === 'VariableDeclaration') {
      return decl as Node;
    }
  }

  return null;
}

/**
 * Extracts a function declaration node from a statement, unwrapping export wrappers.
 * Returns the function node (FunctionDeclaration), or `null`.
 */
function extractFunctionDeclaration(stmt: Node): Node | null {
  if (stmt.type === 'FunctionDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl && (decl as Node).type === 'FunctionDeclaration') {
      return decl as Node;
    }
  }

  return null;
}

/**
 * Extracts a class declaration node from a statement, unwrapping export wrappers.
 * Returns the class node, or `null`.
 */
function extractClassFromStatement(stmt: Node): Node | null {
  if (stmt.type === 'ClassDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl && (decl as Node).type === 'ClassDeclaration') {
      return decl as Node;
    }
  }

  return null;
}

/**
 * Iterates declarators of a `VariableDeclaration` node.
 */
function* iterDeclarators(varDecl: Node): IterableIterator<{ name: string | null; init: Node | null }> {
  if (varDecl.type !== 'VariableDeclaration') {
    return;
  }

  for (const decl of varDecl.declarations) {
    const id = decl.id as Node;
    const declName = id.type === 'Identifier' ? id.name : null;
    const init = (decl.init ?? null) as Node | null;

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
      if (funcDecl.type === 'FunctionDeclaration' && funcDecl.id?.name === functionName) {
        return code.slice(funcDecl.start, funcDecl.end);
      }

      continue;
    }

    const varDecl = extractVariableDeclaration(stmt);

    if (varDecl !== null) {
      for (const { name, init } of iterDeclarators(varDecl)) {
        if (name === functionName && init !== null) {
          if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
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

    if (classNode.type === 'ClassDeclaration' && classNode.id === null) {
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
    if (stmt.type === 'ClassDeclaration') {
      if (stmt.id?.name === className) {
        return stmt;
      }
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const declaration = stmt.declaration;

      if (declaration && (declaration as Node).type === 'ClassDeclaration') {
        const classDecl = declaration as Node;

        if (classDecl.type === 'ClassDeclaration' && classDecl.id?.name === className) {
          return classDecl;
        }
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
  if (classNode.type !== 'ClassDeclaration' && classNode.type !== 'ClassExpression') {
    return null;
  }

  for (const member of classNode.body.body as readonly Node[]) {
    if (member.type !== 'MethodDefinition') {
      continue;
    }

    if (member.kind !== 'method') {
      continue;
    }

    const name = getPropertyKeyName(member.key as Node);

    if (name === methodName) {
      return member.value as Node;
    }
  }

  return null;
}

/**
 * Finds a `PropertyDefinition` node for a named property in a class node.
 */
export function findPropertyAstNode(classNode: Node, propName: string): Node | null {
  if (classNode.type !== 'ClassDeclaration' && classNode.type !== 'ClassExpression') {
    return null;
  }

  for (const member of classNode.body.body as readonly Node[]) {
    if (member.type !== 'PropertyDefinition') {
      continue;
    }

    const name = getPropertyKeyName(member.key as Node);

    if (name === propName) {
      return member;
    }
  }

  return null;
}
