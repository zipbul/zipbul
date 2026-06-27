import { test, expect, mock, spyOn, afterEach } from 'bun:test';

import { EntityManagerResolver } from '../context';
import { BaseRepository } from './base-repository';

afterEach(() => {
  mock.restore();
});

class User {
  id!: number;
}

function fakeRepo() {
  return {
    findAll: mock(function (this: unknown) {
      return { ok: true, boundTo: this };
    }),
    entityName: 'User',
  };
}

/** Stub the only external collaborator: the static resolver -> a fake EM -> a fake repo. */
function stubResolver(repo: ReturnType<typeof fakeRepo>) {
  const getRepository = mock(() => repo);
  const resolve = spyOn(EntityManagerResolver, 'resolve').mockReturnValue({
    getRepository,
  } as never);
  return { resolve, getRepository };
}

class UserRepository extends BaseRepository<User> {
  protected readonly entity = User;
}

class WithUserMethod extends BaseRepository<User> {
  protected readonly entity = User;
  byEmail() {
    return 'mine';
  }
}

// The SUT is a constructor-returned Proxy typed as EntityRepository<T>; assertions need
// to reach delegated/own members freely, so cast to a loose shape in the test harness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (r: unknown): any => r;

test('a user-defined method wins over delegation and does not consult the resolver', () => {
  const { resolve } = stubResolver(fakeRepo());
  const repo = new WithUserMethod();
  expect((repo as unknown as { byEmail(): string }).byEmail()).toBe('mine');
  expect(resolve).not.toHaveBeenCalled();
});

test('accessing the abstract entity returns the value from the subclass', () => {
  stubResolver(fakeRepo());
  const repo = new UserRepository();
  expect((repo as unknown as { entity: unknown }).entity).toBe(User);
});

test('a delegated method is invoked on the resolved repository (bound to it)', () => {
  const repo = fakeRepo();
  stubResolver(repo);
  const result = loose(new UserRepository()).findAll();
  expect(result.boundTo).toBe(repo);
});

test('a delegated non-function property passes through unwrapped', () => {
  const repo = fakeRepo();
  stubResolver(repo);
  expect(loose(new UserRepository()).entityName).toBe('User');
});

test('resolves the default connection when the subclass does not override it', () => {
  const { resolve } = stubResolver(fakeRepo());
  loose(new UserRepository()).findAll();
  expect(resolve).toHaveBeenCalledWith('default');
});

test('resolves the overridden connection name', () => {
  class AnalyticsRepo extends BaseRepository<User> {
    protected readonly entity = User;
    protected override readonly connection = 'analytics';
  }
  const { resolve } = stubResolver(fakeRepo());
  loose(new AnalyticsRepo()).findAll();
  expect(resolve).toHaveBeenCalledWith('analytics');
});

test('each delegated access resolves a fresh repository (no caching = per-request isolation)', () => {
  const { resolve } = stubResolver(fakeRepo());
  const sut = loose(new UserRepository());
  sut.findAll();
  sut.findAll();
  expect(resolve.mock.calls.length).toBe(2);
});

test('a delegated access propagates a resolver error', () => {
  spyOn(EntityManagerResolver, 'resolve').mockImplementation(() => {
    throw new Error('not registered');
  });
  expect(() => loose(new UserRepository()).findAll()).toThrow('not registered');
});

// RED (B1): merely awaiting a repository instance (or a DI async-factory returning it)
// must NOT trigger delegation. The Proxy currently delegates `then`, so `await repo`
// invokes EntityManagerResolver.resolve as an await side-effect — which throws at boot
// when no connection is registered yet.
test('awaiting a repository instance does not invoke the resolver', async () => {
  const { resolve } = stubResolver(fakeRepo());
  const repo = new UserRepository();
  await (repo as unknown as Promise<unknown>);
  expect(resolve).not.toHaveBeenCalled();
});
