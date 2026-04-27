import { describe, expect, test } from 'bun:test';
import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { Function as OxcFunction, ArrowFunctionExpression, CallExpression, MethodDefinition } from 'oxc-parser';
import { extractContextOperations, findContextBindings } from './context-operation-extractor';

function findHandlerInner(code: string): OxcFunction | ArrowFunctionExpression {
  const parseResult = parseSource('test.ts', code);
  if (isErr(parseResult)) throw new Error('parse failed');
  const parsed: ParsedFile = parseResult;

  for (const stmt of parsed.program.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      for (const decl of stmt.declaration.declarations) {
        if (decl.init?.type === 'CallExpression') {
          const call = decl.init as CallExpression;
          const factory = call.arguments[0];
          if (factory && (factory.type === 'ArrowFunctionExpression' || factory.type === 'FunctionExpression')) {
            // factory body is `(ctx) => { ... }` (concise) or `() => (ctx) => { ... }`
            const body = (factory as ArrowFunctionExpression).body;
            if (body && (body.type === 'ArrowFunctionExpression' || body.type === 'FunctionExpression')) {
              return body as ArrowFunctionExpression;
            }
            // Block body: find return
            if (body && body.type === 'BlockStatement') {
              for (const s of body.body) {
                if (s.type === 'ReturnStatement' && s.argument && (s.argument.type === 'ArrowFunctionExpression' || s.argument.type === 'FunctionExpression')) {
                  return s.argument as ArrowFunctionExpression;
                }
              }
            }
            return factory as ArrowFunctionExpression;
          }
        }
      }
    }
  }
  throw new Error('handler not found');
}

function findClassMethod(code: string, methodName: string): OxcFunction {
  const parseResult = parseSource('test.ts', code);
  if (isErr(parseResult)) throw new Error('parse failed');
  const parsed: ParsedFile = parseResult;

  for (const stmt of parsed.program.body) {
    let classNode: { body: { body: readonly MethodDefinition[] } } | null = null;
    if (stmt.type === 'ClassDeclaration') {
      classNode = stmt as unknown as { body: { body: readonly MethodDefinition[] } };
    } else if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'ClassDeclaration') {
      classNode = stmt.declaration as unknown as { body: { body: readonly MethodDefinition[] } };
    }
    if (!classNode) continue;

    for (const member of classNode.body.body) {
      if (member.type === 'MethodDefinition' && member.key.type === 'Identifier' && member.key.name === methodName) {
        return member.value as unknown as OxcFunction;
      }
    }
  }
  throw new Error(`method ${methodName} not found`);
}

describe('extractContextOperations', () => {
  test('records ctx.set as producer', () => {
    const code = `
      export const mw = defineMiddleware(() => (ctx) => {
        ctx.set(SessionKey, { userId: 1 });
      });
    `;
    const handler = findHandlerInner(code);
    const ops = extractContextOperations(handler, new Set(['ctx']));

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('set');
    expect(ops[0]?.keyIdentifier).toBe('SessionKey');
    expect(ops[0]?.start).toBeGreaterThanOrEqual(0);
  });

  test('records ctx.use as required consumer', () => {
    const code = `
      class C {
        m(ctx) {
          const session = ctx.use(SessionKey);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const ops = extractContextOperations(method, new Set(['ctx']));

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('use');
    expect(ops[0]?.keyIdentifier).toBe('SessionKey');
  });

  test('records ctx.get as optional consumer', () => {
    const code = `
      class C {
        m(ctx) {
          const maybe = ctx.get(OptionalKey);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const ops = extractContextOperations(method, new Set(['ctx']));

    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('get');
    expect(ops[0]?.keyIdentifier).toBe('OptionalKey');
  });

  test('records bound variable operations after ctx.to() narrowing', () => {
    const code = `
      class C {
        m(ctx) {
          const http = ctx.to(HttpContext);
          http.set(KeyA, 1);
          http.use(KeyB);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const bindings = findContextBindings(method.body!, 'ctx');
    const roots = new Set(['ctx', ...bindings]);
    const ops = extractContextOperations(method, roots);

    expect(bindings).toEqual(['http']);
    expect(ops).toHaveLength(2);
    expect(ops.map(o => `${o.kind}:${o.keyIdentifier}`)).toEqual(['set:KeyA', 'use:KeyB']);
  });

  test('non-Identifier first arg yields null keyIdentifier', () => {
    const code = `
      class C {
        m(ctx) {
          ctx.set('inline-string-key', 1);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const ops = extractContextOperations(method, new Set(['ctx']));

    expect(ops).toHaveLength(1);
    expect(ops[0]?.keyIdentifier).toBeNull();
  });

  test('ignores calls on unrelated variables', () => {
    const code = `
      class C {
        m(ctx) {
          const other = makeOther();
          other.set(SomeKey, 1);
          other.use(AnotherKey);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const ops = extractContextOperations(method, new Set(['ctx']));

    expect(ops).toHaveLength(0);
  });

  test('multiple operations in mixed order', () => {
    const code = `
      class C {
        m(ctx) {
          ctx.set(K1, 1);
          ctx.use(K2);
          ctx.get(K3);
          ctx.set(K4, 2);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const ops = extractContextOperations(method, new Set(['ctx']));

    expect(ops.map(o => `${o.kind}:${o.keyIdentifier}`)).toEqual([
      'set:K1', 'use:K2', 'get:K3', 'set:K4',
    ]);
  });
});

describe('findContextBindings', () => {
  test('finds single ctx.to() binding', () => {
    const code = `
      class C {
        m(ctx) {
          const http = ctx.to(HttpContext);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const bindings = findContextBindings(method.body!, 'ctx');
    expect(bindings).toEqual(['http']);
  });

  test('finds multiple ctx.to() bindings', () => {
    const code = `
      class C {
        m(ctx) {
          const a = ctx.to(TypeA);
          const b = ctx.to(TypeB);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const bindings = findContextBindings(method.body!, 'ctx');
    expect(bindings).toEqual(['a', 'b']);
  });

  test('ignores other ctx method calls', () => {
    const code = `
      class C {
        m(ctx) {
          const x = ctx.use(SomeKey);
          const y = ctx.get(OtherKey);
        }
      }
    `;
    const method = findClassMethod(code, 'm');
    const bindings = findContextBindings(method.body!, 'ctx');
    expect(bindings).toEqual([]);
  });
});
