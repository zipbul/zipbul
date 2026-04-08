import { visitorKeys } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol } from '@zipbul/gildash';
import type {
  Node as AstNode, Directive, Statement, Expression,
  Class, PropertyDefinition,
  VariableDeclaration,
  CallExpression,
  Function as OxcFunction,
} from 'oxc-parser';

/**
 * Checks whether a value is an oxc-parser AST node.
 *
 * @param value - The value to test
 * @returns `true` if the value is an object with a string `type` property
 */
export function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value
    && typeof (value as Record<string, unknown>).type === 'string';
}

/**
 * Walks child AST nodes of a parent node using oxc-parser's `visitorKeys`.
 *
 * Unlike manual `Object.keys()` enumeration, this only traverses keys that
 * are known to contain AST children -- avoiding structural fields like `type`,
 * `start`, `end`, and `parent`.
 *
 * @param node - The parent AST node whose children should be visited
 * @param visitor - Callback invoked for each child AST node
 */
export function walkChildren(node: AstNode, visitor: (child: AstNode) => void): void {
  const keys = visitorKeys[node.type];

  if (!keys) {
    return;
  }

  for (const key of keys) {
    const child = (node as Record<string, unknown>)[key];

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
 * Extracts the string key name from a class member key AST node.
 *
 * Handles `Identifier`, `PrivateIdentifier`, and string `Literal` keys.
 * Returns `null` for computed or non-string keys.
 *
 * @param key - The property key AST node
 * @returns The resolved key name, or `null` if unresolvable
 */
function getPropertyKeyName(key: AstNode): string | null {
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
 * @param node - The call expression AST node
 * @returns The property name string, or `null` if not a static member call
 */
export function getCalleeMethodName(node: CallExpression): string | null {
  const callee = node.callee;

  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.name;
  }

  return null;
}

/**
 * Extracts a `VariableDeclaration` from a statement, unwrapping export wrappers.
 *
 * @param stmt - A top-level statement or directive
 * @returns The `VariableDeclaration` node, or `null` if the statement is not one
 */
function extractVariableDeclaration(stmt: Directive | Statement): VariableDeclaration | null {
  if (stmt.type === 'VariableDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl?.type === 'VariableDeclaration') {
      return decl;
    }
  }

  return null;
}

/**
 * Extracts a `FunctionDeclaration` from a statement, unwrapping export wrappers.
 *
 * @param stmt - A top-level statement or directive
 * @returns The function AST node, or `null` if the statement is not a function declaration
 */
function extractFunctionDeclaration(stmt: Directive | Statement): OxcFunction | null {
  if (stmt.type === 'FunctionDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl?.type === 'FunctionDeclaration') {
      return decl;
    }
  }

  return null;
}

/**
 * Extracts a `Class` node from a statement, unwrapping export wrappers.
 *
 * @param stmt - A top-level statement or directive
 * @returns The class AST node, or `null` if the statement is not a class declaration
 */
function extractClassFromStatement(stmt: Directive | Statement): Class | null {
  if (stmt.type === 'ClassDeclaration') {
    return stmt;
  }

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;

    if (decl?.type === 'ClassDeclaration') {
      return decl;
    }
  }

  return null;
}

/**
 * Finds the initializer expression of a named variable declaration in a parsed file.
 *
 * Iterates all top-level statements, unwrapping export declarations, and returns
 * the `init` expression for the first variable declarator matching `variableName`.
 *
 * @param parsed - The parsed file AST
 * @param variableName - Name of the variable to locate
 * @returns The init AST node or `null`
 */
export function findVariableInitAstNode(parsed: ParsedFile, variableName: string): Expression | null {
  for (const stmt of parsed.program.body) {
    const varDecl = extractVariableDeclaration(stmt);

    if (varDecl === null) {
      continue;
    }

    for (const decl of varDecl.declarations) {
      const declName = decl.id.type === 'Identifier' ? decl.id.name : null;

      if (declName === variableName && decl.init !== null) {
        return decl.init;
      }
    }
  }

  return null;
}

/**
 * Extracts the source text of a function declaration by name from the raw AST.
 *
 * Used for gildash `kind: 'function'` symbols that don't have an initializer
 * (standalone function declarations vs arrow function variables).
 *
 * @param parsed - Parsed file AST
 * @param functionName - Name of the function
 * @param code - The full source code string used for slicing
 * @returns Source text of the function body, or empty string
 */
export function extractFunctionSourceText(parsed: ParsedFile, functionName: string, code: string): string {
  for (const stmt of parsed.program.body) {
    const funcDecl = extractFunctionDeclaration(stmt);

    if (funcDecl !== null) {
      if (funcDecl.id?.name === functionName) {
        return code.slice(funcDecl.start, funcDecl.end);
      }

      continue;
    }

    // Arrow function assigned to variable: const name = () => ...
    const varDecl = extractVariableDeclaration(stmt);

    if (varDecl !== null) {
      for (const decl of varDecl.declarations) {
        const declName = decl.id.type === 'Identifier' ? decl.id.name : null;

        if (declName === functionName && decl.init !== null) {
          const initNode = decl.init;

          if (initNode.type === 'ArrowFunctionExpression' || initNode.type === 'FunctionExpression') {
            return code.slice(initNode.start, initNode.end);
          }
        }
      }
    }
  }

  return '';
}

/**
 * Checks whether a parsed file contains an anonymous class declaration.
 *
 * @param parsed - The parsed file AST
 * @param _symbol - The extracted symbol (reserved for future use)
 * @returns `true` if any top-level class declaration has no identifier
 */
export function isAnonymousClassSymbol(parsed: ParsedFile, _symbol: ExtractedSymbol): boolean {
  for (const stmt of parsed.program.body) {
    const classNode = extractClassFromStatement(stmt);

    if (classNode === null) {
      continue;
    }

    if (classNode.id === null) {
      return true;
    }
  }

  return false;
}

/**
 * Finds the raw `Class` AST node for a given class name in a parsed file.
 *
 * Searches top-level statements including those wrapped in export declarations.
 *
 * @param parsed - The parsed file AST
 * @param className - Name of the class to find
 * @returns The `Class` AST node, or `null` if not found
 */
export function findClassAstNode(parsed: ParsedFile, className: string): Class | null {
  for (const stmt of parsed.program.body) {
    if (stmt.type === 'ClassDeclaration') {
      if (stmt.id?.name === className) {
        return stmt;
      }
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const declaration = stmt.declaration;

      if (declaration?.type === 'ClassDeclaration' && declaration.id?.name === className) {
        return declaration;
      }
    }
  }

  return null;
}

/**
 * Finds the function body AST node for a named method in a class.
 *
 * @param classNode - The `Class` AST node to search within
 * @param methodName - Name of the method
 * @returns The method's function value node (containing body), or `null`
 */
export function findMethodBodyAstNode(classNode: Class, methodName: string): OxcFunction | null {
  for (const member of classNode.body.body) {
    if (member.type !== 'MethodDefinition') {
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
 * Finds a `PropertyDefinition` AST node for a named property in a class.
 *
 * @param classNode - The `Class` AST node to search within
 * @param propName - Name of the property
 * @returns The `PropertyDefinition` node, or `null`
 */
export function findPropertyAstNode(classNode: Class, propName: string): PropertyDefinition | null {
  for (const member of classNode.body.body) {
    if (member.type !== 'PropertyDefinition') {
      continue;
    }

    const name = getPropertyKeyName(member.key);

    if (name === propName) {
      return member;
    }
  }

  return null;
}

/** Return type for {@link getMethodAstMeta}. */
interface MethodAstMeta {
  readonly isComputed: boolean;
  readonly isPrivateName: boolean;
  readonly start: number;
}

/**
 * Gets computed/private/static metadata for a method from the raw AST.
 *
 * @param classNode - The `Class` AST node to search within
 * @param methodName - Method name to look up
 * @returns Object with `isComputed`, `isPrivateName`, and `start`, or `null` if not found
 */
export function getMethodAstMeta(
  classNode: Class,
  methodName: string,
): MethodAstMeta | null {
  for (const member of classNode.body.body) {
    if (member.type !== 'MethodDefinition') {
      continue;
    }

    if (member.kind !== 'method') {
      continue;
    }

    const isComputed = member.computed;
    const isPrivateName = member.key.type === 'PrivateIdentifier';
    const name = getPropertyKeyName(member.key);

    if (name === methodName) {
      return { isComputed, isPrivateName, start: member.start };
    }

    // gildash gives "unknown" for computed methods -- match by checking
    // if this is a computed/unresolvable method and the requested name
    // is also "unknown"
    if (methodName === 'unknown' && name === null && (isComputed || isPrivateName)) {
      return { isComputed, isPrivateName, start: member.start };
    }
  }

  return null;
}
