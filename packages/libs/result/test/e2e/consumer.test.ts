import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageRoot = join(import.meta.dir, '../..');
const bin = join(packageRoot, '../../../node_modules/.bin');

// Compiles only if isErr narrows both branches correctly (#53), err() fits a
// Result<T> without error data, and safe() maps the thrown value.
const consumerSource = `
import { err, isErr, safe, type Result, type ResultAsync } from '@zipbul/result';

interface Page { data: string[]; total: number }

const list = (fail: boolean): Result<Page, { code: 'X' }> =>
  fail ? err({ code: 'X' }) : { data: ['a'], total: 1 };

const describePage = (result: Result<Page, { code: 'X' }>): string =>
  isErr(result) ? result.data.code : String(result.total);

const load = (): Result<{ host: string }> => err();

const fetchPage = (): ResultAsync<Page, string> => safe(Promise.reject(new Error('down')), (e) => (e as Error).message);

const fetched = await fetchPage();

console.log(JSON.stringify([
  describePage(list(false)),
  describePage(list(true)),
  isErr(load()),
  isErr(fetched) ? fetched.data : 'ok',
]));
`;

const consumerTsconfig = {
  compilerOptions: {
    target: 'ESNext',
    module: 'Preserve',
    moduleResolution: 'bundler',
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: false,
    types: [],
    noEmit: true,
  },
  files: ['consumer.ts'],
};

describe('packed package consumed by a project', () => {
  let workDir: string | undefined;
  let consumerDir = '';

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zipbul-result-e2e-'));
    workDir = dir;
    const stageDir = join(dir, 'stage');
    consumerDir = join(dir, 'consumer');

    // Build and pack an isolated copy so the repo's dist/ is never touched.
    await $`${join(bin, 'tsgo')} -p tsconfig.build.json --outDir ${join(stageDir, 'dist')}`.cwd(packageRoot).quiet();
    for (const file of ['package.json', 'README.md', 'LICENSE']) {
      await cp(join(packageRoot, file), join(stageDir, file));
    }
    await $`bun pm pack --destination ${dir}`.cwd(stageDir).quiet();
    const tarball = (await readdir(dir)).find((name) => name.endsWith('.tgz'));

    await mkdir(consumerDir);
    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'consumer', type: 'module', dependencies: { '@zipbul/result': `file:${join(dir, tarball ?? '')}` } }),
    );
    await writeFile(join(consumerDir, 'tsconfig.json'), JSON.stringify(consumerTsconfig));
    await writeFile(join(consumerDir, 'consumer.ts'), consumerSource);
    await $`bun install`.cwd(consumerDir).quiet();
  }, 60_000);

  afterAll(async () => {
    if (workDir !== undefined) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test('typechecks against the published declarations', async () => {
    // Act
    const { exitCode, stdout } = await $`${join(bin, 'tsc')} -p tsconfig.json`.cwd(consumerDir).nothrow().quiet();
    // Assert
    expect({ exitCode, output: stdout.toString() }).toEqual({ exitCode: 0, output: '' });
  });

  test('runs against the published build', async () => {
    // Act
    const output = await $`bun consumer.ts`.cwd(consumerDir).text();
    // Assert
    expect(JSON.parse(output)).toEqual(['1', 'X', true, 'down']);
  });

  test('exposes exactly err, isErr and safe from the installed package', async () => {
    // Arrange
    const script = `import * as m from '@zipbul/result'; console.log(JSON.stringify(Object.keys(m).sort()));`;
    // Act
    const output = await $`bun -e ${script}`.cwd(consumerDir).text();
    // Assert
    expect(JSON.parse(output)).toEqual(['err', 'isErr', 'safe']);
  });
});
