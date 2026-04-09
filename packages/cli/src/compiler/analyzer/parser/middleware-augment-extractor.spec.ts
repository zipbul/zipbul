import { describe, expect, test } from 'bun:test';
import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { Function as OxcFunction, ArrowFunctionExpression, CallExpression } from 'oxc-parser';
import { extractMiddlewareAugments } from './middleware-augment-extractor';

function findDefineMiddlewareFactory(code: string): OxcFunction | ArrowFunctionExpression {
  const parseResult = parseSource('test.ts', code);

  if (isErr(parseResult)) throw new Error('parse failed');

  const parsed: ParsedFile = parseResult;
  const program = parsed.program;

  for (const stmt of program.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      for (const decl of stmt.declaration.declarations) {
        if (decl.init?.type === 'CallExpression') {
          const call = decl.init as CallExpression;
          const arg = call.arguments[0];

          if (arg && (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression')) {
            return arg as ArrowFunctionExpression | OxcFunction;
          }
        }
      }
    }
  }

  throw new Error('No factory found');
}

describe('extractMiddlewareAugments', () => {
  test('extracts class augments with full member path', () => {
    const code = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';
      import { RequestCookieJar, ResponseCookieJar } from './cookie-jars';

      export const cookieMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.cookie = new RequestCookieJar(http.request.headers);
        http.response.cookie = new ResponseCookieJar(http.response);
      });
    `;

    const factory = findDefineMiddlewareFactory(code);
    const result = extractMiddlewareAugments(factory);

    expect(result).not.toBeNull();
    expect(result?.contextType).toBe('HttpContext');
    expect(result?.augments).toHaveLength(2);

    const reqCookie = result?.augments.find(a => a.path[0] === 'request');

    expect(reqCookie?.path).toEqual(['request', 'cookie']);
    expect(reqCookie?.rhs).toEqual({ kind: 'class', identifier: 'RequestCookieJar' });

    const resCookie = result?.augments.find(a => a.path[0] === 'response');

    expect(resCookie?.path).toEqual(['response', 'cookie']);
    expect(resCookie?.rhs).toEqual({ kind: 'class', identifier: 'ResponseCookieJar' });
  });

  test('extracts method augments with generic signatures', () => {
    const code = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';

      export const queryParserMiddleware = defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.request.getQuery = <T>(dto: Class<T>): T => parsed as T;
      });
    `;

    const factory = findDefineMiddlewareFactory(code);
    const result = extractMiddlewareAugments(factory);

    expect(result).not.toBeNull();
    expect(result?.augments).toHaveLength(1);

    const aug = result?.augments[0];

    expect(aug?.path).toEqual(['request', 'getQuery']);

    if (aug?.rhs.kind !== 'method') {
      throw new Error('expected method rhs');
    }

    expect(aug.rhs.typeParams).toEqual(['T']);
    expect(aug.rhs.params).toHaveLength(1);
    expect(aug.rhs.params[0]?.name).toBe('dto');
    expect(aug.rhs.params[0]?.type).toBe('Class<T>');
    expect(aug.rhs.returnType).toBe('T');
  });

  test('handles flat augments with single-segment path', () => {
    const code = `
      import { defineMiddleware } from '@zipbul/common';
      import { CustomContext } from '@zipbul/custom';
      import { UserData } from './user-data';

      export const authMiddleware = defineMiddleware(() => (ctx) => {
        const c = ctx.to(CustomContext);
        c.user = new UserData(c);
      });
    `;

    const factory = findDefineMiddlewareFactory(code);
    const result = extractMiddlewareAugments(factory);

    expect(result?.contextType).toBe('CustomContext');
    expect(result?.augments).toHaveLength(1);
    expect(result?.augments[0]?.path).toEqual(['user']);
    expect(result?.augments[0]?.rhs).toEqual({ kind: 'class', identifier: 'UserData' });
  });

  test('returns null when no ctx.to() binding exists', () => {
    const code = `
      import { defineMiddleware } from '@zipbul/common';

      export const noopMiddleware = defineMiddleware(() => (ctx) => {
        // no ctx.to() call
      });
    `;

    const factory = findDefineMiddlewareFactory(code);
    const result = extractMiddlewareAugments(factory);

    expect(result).toBeNull();
  });

  test('handles factory with setup before return', () => {
    const code = `
      import { defineMiddleware } from '@zipbul/common';
      import { HttpContext } from '@zipbul/http-adapter';
      import { Logger } from '@zipbul/logger';
      import { CookieJar } from './cookie-jar';

      export const mw = defineMiddleware(() => {
        const logger = new Logger('mw');
        return (ctx) => {
          const http = ctx.to(HttpContext);
          http.request.cookie = new CookieJar(http.request.headers);
        };
      });
    `;

    const factory = findDefineMiddlewareFactory(code);
    const result = extractMiddlewareAugments(factory);

    expect(result).not.toBeNull();
    expect(result?.augments).toHaveLength(1);
    expect(result?.augments[0]?.path).toEqual(['request', 'cookie']);
  });
});
