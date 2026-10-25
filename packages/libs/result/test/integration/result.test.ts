import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as entry from '../../index';
import { err, isErr, safe } from '../../index';
import type { Result } from '../../index';

const packageRoot = join(import.meta.dir, '../..');

interface Config {
  host: string;
}

const load = (raw: string): Result<Config> => (raw ? { host: raw } : err());

const find = (id: string): Result<Config, { code: 'NOT_FOUND' }> => (id ? { host: id } : err({ code: 'NOT_FOUND' }));

const connect = (id: string): Result<string, { code: 'NOT_FOUND' } | { code: 'REFUSED' }> => {
  const config = find(id);
  if (isErr(config)) {
    return config;
  }
  return config.host === 'down' ? err({ code: 'REFUSED' }) : `connected:${config.host}`;
};

const parseConfig = () =>
  safe(
    () => JSON.parse('{') as Config,
    () => 'PARSE' as const,
  );
const parseError = (result: ReturnType<typeof parseConfig>) => (isErr(result) ? result.data : undefined);

const fetchConfig = () => safe(Promise.resolve<Config>({ host: 'h' }));
const fetchedValue = (result: Awaited<ReturnType<typeof fetchConfig>>) => (isErr(result) ? undefined : result);

describe('public entry', () => {
  test('exports exactly err, isErr and safe at runtime', () => {
    // Act / Assert
    expect(Object.keys(entry).sort()).toEqual(['err', 'isErr', 'safe']);
  });
});

describe('err and isErr', () => {
  test('lets a Result<T> without error data return err()', () => {
    // Act
    const result = load('');
    // Assert
    expect(isErr(result)).toBe(true);
  });

  test('propagates an Err through a caller with a wider error type', () => {
    // Act
    const result = connect('');
    // Assert
    expect(result).toEqual(err({ code: 'NOT_FOUND' }));
  });
});

describe('safe and isErr', () => {
  test('narrows a failed sync call to the mapped error type', () => {
    // Act / Assert
    expectTypeOf(parseError).returns.toEqualTypeOf<'PARSE' | undefined>();
    expect(parseError(parseConfig())).toBe('PARSE');
  });

  test('narrows a resolved promise call to the success type', async () => {
    // Act / Assert
    expectTypeOf(fetchedValue).returns.toEqualTypeOf<Config | undefined>();
    expect(fetchedValue(await fetchConfig())).toEqual({ host: 'h' });
  });
});

describe('separate package copies', () => {
  let copy: typeof entry;
  let copyDir: string | undefined;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zipbul-result-copy-'));
    copyDir = dir;
    await cp(join(packageRoot, 'index.ts'), join(dir, 'index.ts'));
    await cp(join(packageRoot, 'src'), join(dir, 'src'), { recursive: true });
    copy = (await import(join(dir, 'index.ts'))) as typeof entry;
  });

  afterAll(async () => {
    if (copyDir !== undefined) {
      await rm(copyDir, { recursive: true, force: true });
    }
  });

  test('loads as a distinct module instance', () => {
    // Act / Assert
    expect(copy.isErr).not.toBe(isErr);
  });

  test('detects an Err created by the other copy', () => {
    // Act / Assert
    expect(isErr(copy.err('x'))).toBe(true);
  });

  test('has its Err detected by the other copy', () => {
    // Act / Assert
    expect(copy.isErr(err('x'))).toBe(true);
  });
});
