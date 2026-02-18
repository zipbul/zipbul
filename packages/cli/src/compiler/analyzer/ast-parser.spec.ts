import { describe, expect, it } from 'bun:test';

// MUST: MUST-1 (createApplication 식별)

import { AstParser } from './ast-parser';

describe('AstParser', () => {
  it('should collect createApplication calls when createApplication is imported from @zipbul/core', () => {
    const source = [
      "import { createApplication as ca } from '@zipbul/core';",
      "import * as zipbul from '@zipbul/core';",
      "import { createApplication } from 'other';",
      "import { AppModule } from './app.module';",
      '',
      'ca(AppModule);',
      'zipbul.createApplication(AppModule);',
      'createApplication(AppModule);',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['ca', 'zipbul.createApplication']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect createApplication calls when createApplication is called in variable initializers', () => {
    const source = [
      "import { createApplication } from '@zipbul/core';",
      "import { createApplication as alias } from '@zipbul/core';",
      "import { AppModule } from './app.module';",
      '',
      'const app = createApplication(AppModule);',
      'export const exportedApp = alias(AppModule);',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['createApplication', 'alias']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect defineModule calls when defineModule is imported from @zipbul/core', () => {
    const source = [
      "import { defineModule } from '@zipbul/core';",
      "import * as zipbul from '@zipbul/core';",
      '',
      'export const appModule = defineModule({});',
      'export const otherModule = zipbul.defineModule({});',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/__module__.ts', source);
    const calls = result.defineModuleCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['defineModule', 'zipbul.defineModule']);
    expect(calls.map(call => call.exportedName)).toEqual(['appModule', 'otherModule']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect inject calls when inject is imported from @zipbul/common', () => {
    const source = [
      "import { inject } from '@zipbul/common';",
      "import * as zipbul from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inject(TokenA);',
      'zipbul.inject(TokenA);',
      'inject(() => TokenA);',
      'inject(function () { return TokenA; });',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['inject', 'zipbul.inject', 'inject', 'inject']);
    expect(calls.map(call => call.tokenKind)).toEqual(['token', 'token', 'thunk', 'thunk']);
    expect(calls.every(call => call.importSource === '@zipbul/common')).toBe(true);
  });

  it('should mark inject call invalid when argument count is not 1', () => {
    const source = [
      "import { inject } from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inject(TokenA, TokenA);',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe('inject');
    expect(calls[0]?.tokenKind).toBe('invalid');
    expect(calls[0]?.token).toBeNull();
  });

  it('should parse Injectable decorator when class has Injectable decorator with options', () => {
    const source = [
      "import { Injectable } from '@zipbul/common';",
      '',
      "@Injectable({ visibility: 'module', scope: 'singleton' })",
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/service.ts', source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]?.className).toBe('MyService');
    expect(result.classes[0]?.decorators).toHaveLength(1);
    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should collect re-exports when export declarations re-export from other modules', () => {
    const source = [
      "export { MyService } from './services/my.service';",
      "export * from './utils';",
    ].join('\n');
    const parser = new AstParser();
    const result = parser.parse('/app/src/index.ts', source);

    expect(result.reExports).toHaveLength(2);
  });
});