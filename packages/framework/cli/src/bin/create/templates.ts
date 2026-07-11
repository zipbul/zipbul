/**
 * Scaffold templates for `zb create middleware`. The generated files are held as
 * string literals (not on-disk template files) so they survive publishing — a
 * shipped `dist/` has no template directory to read from.
 *
 * Placeholders substituted per invocation:
 *   __NAME__    kebab-case package/dir name        (e.g. `my-thing`)
 *   __PASCAL__  PascalCase class prefix            (e.g. `MyThing`)
 *   __CAMEL__   camelCase factory prefix           (e.g. `myThing`)
 *   __CONST__   SCREAMING_SNAKE defaults const      (e.g. `MY_THING`)
 *   __V_*__     resolved dependency version ranges
 */

interface TemplateVersions {
  readonly baker: string;
  readonly result: string;
  readonly common: string;
  readonly httpAdapter: string;
}

interface NameParts {
  readonly name: string;
  readonly pascal: string;
  readonly camel: string;
  readonly constant: string;
}

const PACKAGE_JSON = `{
  "name": "__NAME__",
  "version": "0.1.0",
  "description": "A zipbul middleware.",
  "license": "MIT",
  "type": "module",
  "source": "index.ts",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "zb build middleware",
    "test": "bun test"
  },
  "dependencies": {
    "@zipbul/baker": "__V_BAKER__",
    "@zipbul/result": "__V_RESULT__"
  },
  "peerDependencies": {
    "@zipbul/common": "__V_COMMON__",
    "@zipbul/http-adapter": "__V_HTTP__"
  },
  "sideEffects": [
    "**/options.js"
  ],
  "zipbul": {
    "kind": "middleware"
  }
}
`;

// Self-contained tsconfig — a consumer package lives outside the zipbul monorepo,
// so it cannot `extends` the repo-root config the first-party packages use.
const TSCONFIG_JSON = `{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "exclude": ["dist"]
}
`;

// Build config for \`zb build middleware\` — tsgo emits JS + .d.ts from this.
// Extends the sibling tsconfig.json (same dir), then flips the emit flags the
// base leaves off. \`allowImportingTsExtensions\` MUST be false for emit.
const TSCONFIG_BUILD_JSON = `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": false,
    "stripInternal": true,
    "noEmitOnError": true,
    "allowImportingTsExtensions": false
  },
  "include": ["index.ts", "*.ts"],
  "exclude": ["**/*.spec.ts", "**/*.test.ts", "dist"]
}
`;

const INDEX_TS = `export { __CAMEL__Middleware } from './__NAME__';
export { __PASCAL__Options } from './options';
export type { Resolved__PASCAL__Options } from './options';
`;

const OPTIONS_TS = `import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { isBoolean } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { Result } from '@zipbul/result';

// Package-private baker. baker 5.x scopes \`@Recipe\` registration to an instance,
// so owning one here keeps this middleware's schema from colliding with the app
// baker or any other middleware's.
const __CAMEL__Baker = new Baker();

/**
 * Options for the middleware. baker validates the shape of whatever the caller
 * passes to the factory. Grow the schema by adding \`@Field\`-decorated
 * properties — each \`@Field\` runs its rules on the matching input value.
 */
@__CAMEL__Baker.Recipe
export class __PASCAL__Options {
  /** Example flag. \`optional\` lets callers omit it, in which case the default applies. */
  @Field(isBoolean, { optional: true })
  enabled?: boolean;
}

/** Fully-resolved options: every field present after defaults are applied. */
export interface Resolved__PASCAL__Options {
  enabled: boolean;
}

const __CONST___DEFAULTS: Resolved__PASCAL__Options = {
  enabled: true,
};

// baker requires \`seal()\` once, after every \`@Recipe\` class has been imported.
// Deferring to first use (rather than sealing at module load) lets the class
// import settle first; the guard makes repeat calls skip the redundant seal.
let isSealed = false;
function ensureSealed(): void {
  if (isSealed) {
    return;
  }
  __CAMEL__Baker.seal();
  isSealed = true;
}

/**
 * Validates caller options and merges defaults. Returns a \`Result\` — the
 * framework's value-or-error idiom — so the caller decides how to surface a bad
 * config. On success it returns the resolved options directly; on failure it
 * returns \`err(...)\`. (\`Result<T, E>\` is just \`T | Err<E>\`, no wrapper class.)
 */
export function resolve__PASCAL__Options(
  options?: __PASCAL__Options,
): Result<Resolved__PASCAL__Options, Error> {
  ensureSealed();

  const validation = __CAMEL__Baker.validateSync(__PASCAL__Options, options ?? {});
  if (isBakerIssueSet(validation)) {
    const [issue] = validation.errors;
    return err(new Error(\`invalid __NAME__ options: \${issue?.path ?? '?'} \${issue?.code ?? ''}\`.trim()));
  }

  return { ...__CONST___DEFAULTS, ...options };
}
`;

const MIDDLEWARE_TS = `import { defineMiddleware } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import type { MiddlewareDefinition } from '@zipbul/common';

import type { __PASCAL__Options } from './options';
import { resolve__PASCAL__Options } from './options';

/**
 * Creates the \`__NAME__\` middleware.
 *
 * Options are validated once, at registration time, so a bad config fails fast
 * at boot rather than per request. Register it declaratively on the HTTP
 * adapter's \`OnRequest\` phase in your module:
 *
 * \`\`\`ts
 * defineModule({
 *   name: 'App',
 *   adapters: [{
 *     adapter: HttpAdapter,
 *     middlewares: {
 *       [HttpAdapterPhase.OnRequest]: [__CAMEL__Middleware()],
 *     },
 *   }],
 * });
 * \`\`\`
 */
export function __CAMEL__Middleware(options?: __PASCAL__Options): MiddlewareDefinition {
  const resolved = resolve__PASCAL__Options(options);
  if (isErr(resolved)) {
    // \`isErr\` narrows to the error branch; \`.data\` is the Error from \`err(...)\`.
    throw resolved.data;
  }

  // Past the guard, \`resolved\` narrows to the success value.
  const config = resolved;

  return defineMiddleware([HttpAdapter], () => ctx => {
    if (!config.enabled) {
      return;
    }

    // Your middleware logic goes here. This demo sets a response header.
    const http = ctx.to(HttpContext);
    http.response.setHeader('X-__PASCAL__', 'hello from zipbul');
  });
}
`;

const SPEC_TS = `import { describe, expect, it } from 'bun:test';

import { __CAMEL__Middleware } from './__NAME__';

describe('__CAMEL__Middleware', () => {
  it('returns a middleware definition for the default config', () => {
    const middleware = __CAMEL__Middleware();

    expect(typeof middleware.factory).toBe('function');
  });

  it('accepts an explicit enabled flag', () => {
    const middleware = __CAMEL__Middleware({ enabled: false });

    expect(typeof middleware.factory).toBe('function');
  });

  it('throws at registration when an option is the wrong type', () => {
    // @ts-expect-error — intentionally invalid to show boot-time validation.
    expect(() => __CAMEL__Middleware({ enabled: 'yes' })).toThrow();
  });
});
`;

function toParts(name: string): NameParts {
  const segments = name.split('-').filter((s) => s.length > 0);
  const pascal = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  const constant = segments.map((s) => s.toUpperCase()).join('_');

  return { name, pascal, camel, constant };
}

/** The camelCase factory prefix for a kebab name (e.g. `my-thing` → `myThing`). */
function toCamelName(name: string): string {
  return toParts(name).camel;
}

function substitute(template: string, parts: NameParts, versions: TemplateVersions): string {
  return template
    .replaceAll('__NAME__', parts.name)
    .replaceAll('__PASCAL__', parts.pascal)
    .replaceAll('__CAMEL__', parts.camel)
    .replaceAll('__CONST__', parts.constant)
    .replaceAll('__V_BAKER__', versions.baker)
    .replaceAll('__V_RESULT__', versions.result)
    .replaceAll('__V_COMMON__', versions.common)
    .replaceAll('__V_HTTP__', versions.httpAdapter);
}

/**
 * Renders the scaffold files for a middleware named `name`. Returns a map of
 * relative filename → file contents; the caller writes them to disk. The set is
 * buildable as-is: `package.json` (source + zipbul.kind), the two tsconfigs
 * `zb build middleware` drives tsgo with, `index.ts` entry, and the source.
 */
function renderMiddlewareFiles(name: string, versions: TemplateVersions): Record<string, string> {
  const parts = toParts(name);

  return {
    'package.json': substitute(PACKAGE_JSON, parts, versions),
    'tsconfig.json': TSCONFIG_JSON,
    'tsconfig.build.json': TSCONFIG_BUILD_JSON,
    'index.ts': substitute(INDEX_TS, parts, versions),
    'options.ts': substitute(OPTIONS_TS, parts, versions),
    [`${name}.ts`]: substitute(MIDDLEWARE_TS, parts, versions),
    [`${name}.spec.ts`]: substitute(SPEC_TS, parts, versions),
  };
}

export { renderMiddlewareFiles, toCamelName };
export type { TemplateVersions };
