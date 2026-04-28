import { describe, expect, it } from 'bun:test';
import { parseSource, extractSymbols } from '@zipbul/gildash';
import type { Node, ParsedFile, ExtractedSymbol } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import {
  isAstNode,
  walkChildren,
  findVariableInitAstNode,
  extractFunctionSourceText,
  isAnonymousClassSymbol,
  findClassAstNode,
  findMethodBodyAstNode,
  findPropertyAstNode,
  getCalleeMethodName,
} from './ast-node-locator';

function parse(code: string, filePath = 'test.ts'): ParsedFile {
  const result = parseSource(filePath, code);

  if (isErr(result)) {
    throw new Error(`Parse failed: ${result.data.message}`);
  }

  return result;
}

function parseAndFindClass(code: string, className: string): Node {
  const parsed = parse(code);
  const classNode = findClassAstNode(parsed, className);

  if (classNode === null) {
    throw new Error(`Class '${className}' not found`);
  }

  return classNode;
}

function makeSymbol(name: string): ExtractedSymbol {
  const parsed = parse(`export class ${name} {}`);

  return extractSymbols(parsed)[0]!;
}

describe('isAstNode', () => {
  it('should return true for a valid AST node', () => {
    const parsed = parse('const x = 1;');
    const firstStmt = parsed.program.body[0]!;

    expect(isAstNode(firstStmt)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isAstNode(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAstNode(undefined)).toBe(false);
  });

  it('should return false for a plain string', () => {
    expect(isAstNode('hello')).toBe(false);
  });

  it('should return false for a number', () => {
    expect(isAstNode(42)).toBe(false);
  });

  it('should return false for an object without type property', () => {
    expect(isAstNode({ name: 'foo' })).toBe(false);
  });

  it('should return false for an object with non-string type property', () => {
    expect(isAstNode({ type: 123 })).toBe(false);
  });

  it('should return true for a plain object with string type property', () => {
    expect(isAstNode({ type: 'Identifier' })).toBe(true);
  });
});

describe('walkChildren', () => {
  it('should visit child nodes of a variable declaration', () => {
    const parsed = parse('const x = 1;');
    const stmt = parsed.program.body[0]!;
    const visited: string[] = [];

    walkChildren(stmt, (child) => {
      visited.push(child.type);
    });

    expect(visited.length).toBeGreaterThan(0);
    expect(visited).toContain('VariableDeclarator');
  });

  it('should visit children of a function declaration body', () => {
    const parsed = parse('function foo() { return 1; }');
    const stmt = parsed.program.body[0]!;
    const visited: string[] = [];

    walkChildren(stmt, (child) => {
      visited.push(child.type);
    });

    expect(visited.length).toBeGreaterThan(0);
  });

  it('should not call visitor when node has no visitor keys', () => {
    const fakeNode = { type: 'NonExistentNodeType', start: 0, end: 0 } as never;
    const visited: string[] = [];

    walkChildren(fakeNode, (child) => {
      visited.push(child.type);
    });

    expect(visited).toHaveLength(0);
  });

  it('should visit array children (e.g. body statements)', () => {
    const parsed = parse('{ const a = 1; const b = 2; }');
    const block = parsed.program.body[0]!;
    const visited: string[] = [];

    walkChildren(block, (child) => {
      visited.push(child.type);
    });

    expect(visited.filter((nodeType) => nodeType === 'VariableDeclaration')).toHaveLength(2);
  });
});

describe('findVariableInitAstNode', () => {
  it('should find variable initializer for a simple const declaration', () => {
    const code = 'const x = 42;';
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'x');

    expect(init).not.toBeNull();
    expect(init!.type).toBe('Literal');
  });

  it('should find variable initializer in exported const', () => {
    const code = "export const name = 'hello';";
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'name');

    expect(init).not.toBeNull();
    expect(init!.type).toBe('Literal');
  });

  it('should return null when variable name does not exist', () => {
    const code = 'const x = 1;';
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'y');

    expect(init).toBeNull();
  });

  it('should return null when variable has no initializer', () => {
    const code = 'let x: number;';
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'x');

    expect(init).toBeNull();
  });

  it('should find variable in export named declaration', () => {
    const code = 'export const arr = [1, 2, 3];';
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'arr');

    expect(init).not.toBeNull();
    expect(init!.type).toBe('ArrayExpression');
  });

  it('should skip non-variable statements', () => {
    const code = [
      'function foo() {}',
      'const target = true;',
    ].join('\n');
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'target');

    expect(init).not.toBeNull();
    expect(init!.type).toBe('Literal');
  });

  it('should handle destructured variable by returning null', () => {
    const code = 'const { a, b } = obj;';
    const parsed = parse(code);
    const init = findVariableInitAstNode(parsed, 'a');

    expect(init).toBeNull();
  });
});

describe('extractFunctionSourceText', () => {
  it('should extract source text of a named function declaration', () => {
    const code = 'function greet() { return "hi"; }';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'greet', code);

    expect(sourceText).toBe('function greet() { return "hi"; }');
  });

  it('should extract source text of an exported function declaration', () => {
    const code = 'export function sum(a: number, b: number) { return a + b; }';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'sum', code);

    expect(sourceText).toContain('return a + b');
  });

  it('should extract source text of an arrow function assigned to a variable', () => {
    const code = 'const greet = () => "hi";';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'greet', code);

    expect(sourceText).toBe('() => "hi"');
  });

  it('should extract source text of a function expression assigned to a variable', () => {
    const code = 'const greet = function() { return "hi"; };';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'greet', code);

    expect(sourceText).toContain('return "hi"');
  });

  it('should extract source text of exported arrow function variable', () => {
    const code = 'export const fn = (x: number) => x * 2;';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'fn', code);

    expect(sourceText).toContain('x * 2');
  });

  it('should return empty string when function name is not found', () => {
    const code = 'function foo() {}';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'bar', code);

    expect(sourceText).toBe('');
  });

  it('should return empty string when variable holds non-function expression', () => {
    const code = 'const val = 42;';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'val', code);

    expect(sourceText).toBe('');
  });

  it('should return empty string for empty source', () => {
    const code = '';
    const parsed = parse(code);
    const sourceText = extractFunctionSourceText(parsed, 'anything', code);

    expect(sourceText).toBe('');
  });
});

describe('isAnonymousClassSymbol', () => {
  it('should return true when file contains anonymous class', () => {
    const code = 'export default class {}';
    const parsed = parse(code);
    const symbols = extractSymbols(parsed);

    expect(isAnonymousClassSymbol(parsed, symbols[0]!)).toBe(true);
  });

  it('should return false when all classes are named', () => {
    const code = 'export class MyService {}';
    const parsed = parse(code);
    const symbols = extractSymbols(parsed);

    expect(isAnonymousClassSymbol(parsed, symbols[0]!)).toBe(false);
  });

  it('should return false for non-exported named class declaration', () => {
    const code = 'class InternalService {}';
    const parsed = parse(code);
    const symbol = makeSymbol('InternalService');

    expect(isAnonymousClassSymbol(parsed, symbol)).toBe(false);
  });

  it('should return false for export default named class', () => {
    const code = 'export default class NamedDefault {}';
    const parsed = parse(code);
    const symbol = makeSymbol('NamedDefault');

    expect(isAnonymousClassSymbol(parsed, symbol)).toBe(false);
  });

  it('should return false when file has no class declarations', () => {
    const code = 'const x = 1;';
    const parsed = parse(code);
    const symbol = makeSymbol('Dummy');

    expect(isAnonymousClassSymbol(parsed, symbol)).toBe(false);
  });
});

describe('findClassAstNode', () => {
  it('should find a plain class declaration', () => {
    const code = 'class Foo {}';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'Foo');

    expect(classNode).not.toBeNull();
    expect(classNode!.type).toBe('ClassDeclaration');
  });

  it('should find an exported named class', () => {
    const code = 'export class Bar {}';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'Bar');

    expect(classNode).not.toBeNull();
  });

  it('should find an export default named class', () => {
    const code = 'export default class Baz {}';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'Baz');

    expect(classNode).not.toBeNull();
  });

  it('should return null when class does not exist', () => {
    const code = 'class Foo {}';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'NonExistent');

    expect(classNode).toBeNull();
  });

  it('should return null for an empty file', () => {
    const parsed = parse('');
    const classNode = findClassAstNode(parsed, 'Any');

    expect(classNode).toBeNull();
  });

  it('should return null when only non-class statements exist', () => {
    const code = 'const x = 1; function foo() {}';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'x');

    expect(classNode).toBeNull();
  });

  it('should distinguish between two classes by name', () => {
    const code = 'class Alpha {} class Beta {}';
    const parsed = parse(code);

    expect(findClassAstNode(parsed, 'Alpha')).not.toBeNull();
    expect(findClassAstNode(parsed, 'Beta')).not.toBeNull();
    expect(findClassAstNode(parsed, 'Gamma')).toBeNull();
  });
});

describe('findMethodBodyAstNode', () => {
  it('should find method body by name', () => {
    const classNode = parseAndFindClass(
      'class Svc { handle() { return 1; } }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'handle');

    expect(methodBody).not.toBeNull();
    expect(methodBody!.type).toBe('FunctionExpression');
  });

  it('should return null for non-existent method', () => {
    const classNode = parseAndFindClass('class Svc { handle() {} }', 'Svc');
    const methodBody = findMethodBodyAstNode(classNode, 'missing');

    expect(methodBody).toBeNull();
  });

  it('should return null for an empty class', () => {
    const classNode = parseAndFindClass('class Empty {}', 'Empty');
    const methodBody = findMethodBodyAstNode(classNode, 'anything');

    expect(methodBody).toBeNull();
  });

  it('should not match constructor as a method', () => {
    const classNode = parseAndFindClass(
      'class Svc { constructor() {} }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'constructor');

    expect(methodBody).toBeNull();
  });

  it('should not match getter as a method', () => {
    const classNode = parseAndFindClass(
      'class Svc { get value() { return 1; } }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'value');

    expect(methodBody).toBeNull();
  });

  it('should not match setter as a method', () => {
    const classNode = parseAndFindClass(
      'class Svc { set value(v: number) {} }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'value');

    expect(methodBody).toBeNull();
  });

  it('should not match property definitions', () => {
    const classNode = parseAndFindClass(
      'class Svc { name = "foo"; }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'name');

    expect(methodBody).toBeNull();
  });

  it('should find method with string literal key', () => {
    const classNode = parseAndFindClass(
      'class Svc { "my-method"() { return true; } }',
      'Svc',
    );
    const methodBody = findMethodBodyAstNode(classNode, 'my-method');

    expect(methodBody).not.toBeNull();
  });
});

describe('findPropertyAstNode', () => {
  it('should find property by name', () => {
    const classNode = parseAndFindClass(
      'class Cfg { host = "localhost"; }',
      'Cfg',
    );
    const prop = findPropertyAstNode(classNode, 'host');

    expect(prop).not.toBeNull();
    expect(prop!.type).toBe('PropertyDefinition');
  });

  it('should return null for non-existent property', () => {
    const classNode = parseAndFindClass('class Cfg { host = "localhost"; }', 'Cfg');
    const prop = findPropertyAstNode(classNode, 'missing');

    expect(prop).toBeNull();
  });

  it('should return null for an empty class', () => {
    const classNode = parseAndFindClass('class Empty {}', 'Empty');
    const prop = findPropertyAstNode(classNode, 'anything');

    expect(prop).toBeNull();
  });

  it('should not match methods', () => {
    const classNode = parseAndFindClass(
      'class Svc { run() {} }',
      'Svc',
    );
    const prop = findPropertyAstNode(classNode, 'run');

    expect(prop).toBeNull();
  });

  it('should find private property', () => {
    const classNode = parseAndFindClass(
      'class Svc { #secret = 42; }',
      'Svc',
    );
    const prop = findPropertyAstNode(classNode, 'secret');

    expect(prop).not.toBeNull();
  });
});

// getMethodAstMeta 는 gildash 0.25 의 ExtractedSymbol.keyKind 도입 이후
// dead code 가 되어 제거됨. computed/private 메서드 감지는
// class-metadata-extractor 가 ExtractedSymbol.keyKind 를 직접 사용한다.

describe('getCalleeMethodName', () => {
  it('should extract method name from this.method() call', () => {
    const code = 'class Svc { run() { this.execute(); } }';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'Svc')!;
    const methodBody = findMethodBodyAstNode(classNode, 'run')!;
    const block = (methodBody as unknown as Record<string, unknown>).body as Record<string, unknown>;
    const exprStmt = (block.body as Array<Record<string, unknown>>)[0]!;
    const callExpr = exprStmt.expression as Node;

    expect(getCalleeMethodName(callExpr)).toBe('execute');
  });

  it('should return null for a plain function call', () => {
    const code = 'function test() { doSomething(); }';
    const parsed = parse(code);
    const funcDecl = parsed.program.body[0] as unknown as Record<string, unknown>;
    const body = funcDecl.body as Record<string, unknown>;
    const bodyStatements = body.body as Array<Record<string, unknown>>;
    const exprStmt = bodyStatements[0]!;
    const callExpr = exprStmt.expression as Node;

    expect(getCalleeMethodName(callExpr)).toBeNull();
  });

  it('should return null for computed member call', () => {
    const code = 'class Svc { run() { this["execute"](); } }';
    const parsed = parse(code);
    const classNode = findClassAstNode(parsed, 'Svc')!;
    const methodBody = findMethodBodyAstNode(classNode, 'run')!;
    const block = (methodBody as unknown as Record<string, unknown>).body as Record<string, unknown>;
    const exprStmt = (block.body as Array<Record<string, unknown>>)[0]!;
    const callExpr = exprStmt.expression as Node;

    expect(getCalleeMethodName(callExpr)).toBeNull();
  });
});
