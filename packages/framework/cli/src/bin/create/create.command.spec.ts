import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import { CreateError, createMiddleware } from './create.command';

// Scaffold into a throwaway dir under the CLI package so nothing leaks into the
// repo tree; each case dir is removed after its test and the root after the suite.
const TMP_ROOT = join(import.meta.dir, '__create_spec_tmp__');

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = join(TMP_ROOT, `case-${cleanup.length}-${Math.trunc(performance.now())}`);
  cleanup.push(dir);
  return dir;
};

describe('createMiddleware', () => {
  it('writes exactly the scaffold files', async () => {
    const cwd = scratch();

    const result = await createMiddleware('greeting', { cwd });

    expect(result.name).toBe('greeting');
    expect(result.camelName).toBe('greeting');
    expect([...result.files].sort()).toEqual(
      [
        'greeting.spec.ts',
        'greeting.ts',
        'index.ts',
        'options.ts',
        'package.json',
        'tsconfig.build.json',
        'tsconfig.json',
      ].sort(),
    );
    for (const file of result.files) {
      expect(existsSync(join(result.targetDir, file))).toBe(true);
    }
  });

  it('stamps zipbul.kind and derives class names from a multi-word kebab name', async () => {
    const cwd = scratch();

    const result = await createMiddleware('my-thing', { cwd });

    expect(result.camelName).toBe('myThing');
    const pkg = (await Bun.file(join(result.targetDir, 'package.json')).json()) as {
      name?: string;
      zipbul?: { kind?: string };
    };
    expect(pkg.name).toBe('my-thing');
    expect(pkg.zipbul?.kind).toBe('middleware');

    const middleware = await Bun.file(join(result.targetDir, 'my-thing.ts')).text();
    expect(middleware).toContain('export function myThingMiddleware(');
    expect(middleware).toContain("'X-MyThing'");
  });

  it('rejects a non-kebab-case name', async () => {
    const cwd = scratch();

    await expect(createMiddleware('MyThing', { cwd })).rejects.toBeInstanceOf(CreateError);
    await expect(createMiddleware('-bad', { cwd })).rejects.toBeInstanceOf(CreateError);
    await expect(createMiddleware('', { cwd })).rejects.toBeInstanceOf(CreateError);
  });

  it('refuses to overwrite an existing target', async () => {
    const cwd = scratch();

    await createMiddleware('greeting', { cwd });

    await expect(createMiddleware('greeting', { cwd })).rejects.toBeInstanceOf(CreateError);
  });

  it('wires the real zipbul APIs so the package is born green', async () => {
    // A runtime import cannot prove resolution here: the generated package.json
    // makes the dir a non-workspace island, so `@zipbul/*` (which resolve only as
    // workspace members) are unreachable without a real install. Instead assert the
    // templates wire the exact APIs a real zipbul app resolves; born-green is proven
    // end-to-end by the manual scaffold-into-a-workspace-member check (see PR notes).
    const cwd = scratch();

    const result = await createMiddleware('greeting', { cwd });

    const middleware = await Bun.file(join(result.targetDir, 'greeting.ts')).text();
    expect(middleware).toContain("import { defineMiddleware } from '@zipbul/common';");
    expect(middleware).toContain("import { isErr } from '@zipbul/result';");
    expect(middleware).toContain("import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';");
    expect(middleware).toContain('defineMiddleware([HttpAdapter], () =>');

    const options = await Bun.file(join(result.targetDir, 'options.ts')).text();
    expect(options).toContain("import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';");
    expect(options).toContain('@greetingBaker.Recipe');
    expect(options).toContain('greetingBaker.validateSync(GreetingOptions,');
    expect(options).toContain('return err(');

    const spec = await Bun.file(join(result.targetDir, 'greeting.spec.ts')).text();
    expect(spec).toContain("import { greetingMiddleware } from './greeting';");
  });
});
