import { describe, expect, test } from 'bun:test';
import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { Function as OxcFunction, MethodDefinition } from 'oxc-parser';
import { extractHandlerContextUsages } from './handler-context-usage-extractor';

function findHandlerMethod(code: string, methodName: string): OxcFunction {
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

describe('extractHandlerContextUsages', () => {
  test('records full chain for ctx.request.cookie.get()', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const session = ctx.request.cookie.get('session');
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.contextParam).toBe('ctx');
    expect(result?.usages).toEqual([
      { path: ['request', 'cookie', 'get'], isCall: true, dtoIdentifier: null },
    ]);
  });

  test('captures DTO identifier from getBody call', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const body = ctx.request.getBody(CreateUserDto);
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toEqual([
      { path: ['request', 'getBody'], isCall: true, dtoIdentifier: 'CreateUserDto' },
    ]);
  });

  test('records non-call property reads', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const id = ctx.requestId;
          const cookie = ctx.request.cookie;
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toContainEqual({ path: ['requestId'], isCall: false, dtoIdentifier: null });
    expect(result?.usages).toContainEqual({ path: ['request', 'cookie'], isCall: false, dtoIdentifier: null });
  });

  test('combines body, params, query method calls and cookie usages', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const body = ctx.request.getBody(UpdateUserDto);
          const params = ctx.request.getParams(UserParams);
          const query = ctx.request.getQuery(UpdateQuery);
          const session = ctx.request.cookie.get('session');
          ctx.response.cookie.set('updated', 'true');
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toContainEqual({ path: ['request', 'getBody'], isCall: true, dtoIdentifier: 'UpdateUserDto' });
    expect(result?.usages).toContainEqual({ path: ['request', 'getParams'], isCall: true, dtoIdentifier: 'UserParams' });
    expect(result?.usages).toContainEqual({ path: ['request', 'getQuery'], isCall: true, dtoIdentifier: 'UpdateQuery' });
    expect(result?.usages).toContainEqual({ path: ['request', 'cookie', 'get'], isCall: true, dtoIdentifier: null });
    expect(result?.usages).toContainEqual({ path: ['response', 'cookie', 'set'], isCall: true, dtoIdentifier: null });
  });

  test('deduplicates identical chains', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const a = ctx.request.cookie.get('a');
          const b = ctx.request.cookie.get('b');
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toHaveLength(1);
  });

  test('returns null when handler has no parameters', () => {
    const code = `
      class C {
        m() { return 1; }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result).toBeNull();
  });

  test('ignores accesses on objects other than the context param', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const other = { request: { cookie: 'fake' } };
          const v = other.request.cookie;
          const real = ctx.request.cookie.get('s');
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toHaveLength(1);
    expect(result?.usages[0]?.path).toEqual(['request', 'cookie', 'get']);
  });

  test('flat single-segment chain (ctx.foo)', () => {
    const code = `
      class C {
        m(ctx: HttpContext) {
          const t = ctx.requestId;
        }
      }
    `;

    const result = extractHandlerContextUsages(findHandlerMethod(code, 'm'));

    expect(result?.usages).toEqual([
      { path: ['requestId'], isCall: false, dtoIdentifier: null },
    ]);
  });
});
