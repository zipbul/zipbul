import { describe, it, expect, beforeEach } from 'bun:test';

import type { ZipbulContainer } from '@zipbul/common';

import { Container } from '../src/injector/container';
import { RequestScopeContainer } from '../src/injector/request-scope-container';

/**
 * [OVERFLOW Checkpoint]
 * - Target: Container + RequestScopeContainer (request-scope isolation)
 * - Branch count: 15
 *   Container.get():
 *     L74 `if (singletons.has(resolvedToken))`, L80 `if (!registration)`,
 *     L86 `if (registration.scope === 'request')`, L96 `if (registration.scope === 'singleton')`
 *   RequestScopeContainer.get():
 *     L23 `if (!registration)`, L27 `if (registration.scope === 'singleton')`,
 *     L31 `if (registration.scope === 'transient')`, L35 `if (requestInstances.has(token))`,
 *     L39-43 else (create+cache)
 *   RequestScopeContainer.dispose():
 *     L78 `instances.reverse()`, L81 `if (hasOnDestroy(instance))`, L84 catch,
 *     L90 `requestInstances.clear()`
 *   Container.createRequestScope():
 *     L145-147 new RequestScopeContainer
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. request-scoped get() returns new instance per container (RSC.get L39-43), 2. request-scoped get() returns cached instance on second call (RSC.get L35-36), 3. singleton get() via RSC delegates to parent (RSC.get L27-28 + Container.get L96-98), 4. transient get() via RSC returns new instance each call (RSC.get L31-32), 5. createRequestScope returns independent container (Container L145-147) |
 *   | NE  | 50    | 1. Container.get() throws on request-scoped token from root (Container.get L86-91), 2. RSC.set() throws (RSC L46-48), 3. dispose() swallows onDestroy error and continues next instance (RSC.dispose L84) |
 *   | ED  | 50    | 1. zero request-scoped providers → dispose is no-op (RSC.dispose L78 empty map), 2. factory returning undefined is cached (RSC.get L39-41 + L35), 3. single request-scoped provider lifecycle (RSC.get + dispose one entry) |
 *   | CO  | 50    | 1. N concurrent requests each get isolated instances (Container.createRequestScope * N + RSC.get L39-43 per scope), 2. async request handlers don't share RSC instances (Container.createRequestScope creates independent RSC), 3. high-volume concurrent requests (100+) maintain instance isolation (RSC.get L35 + L39 per-context caching) |
 *   | ST  | 50    | 1. after dispose() requesting same token creates new instance (RSC.dispose L90 clear + RSC.get L39-43 re-create), 2. dispose clears map then getInstances returns empty (RSC.dispose L90 + RSC.getInstances L58-59), 3. singleton survives request dispose (Container singletons map unaffected by RSC.dispose) |
 *   | CR  | 50    | 1. parallel createRequestScope calls produce independent containers (Container L145-147 each new RSC), 2. concurrent RSC.get on same token per-container is safe (RSC L35-43 instance-local Map), 3. concurrent dispose calls on separate RSCs don't interfere (RSC.dispose L77-91 operates on own requestInstances) |
 *   | ID  | 50    | 1. repeated get() for request-scoped token returns same instance (RSC.get L35-36), 2. repeated createRequestScope creates new container each time (Container L145-147), 3. has() on RSC returns same result on repeated calls (RSC.has L50-51) |
 *   | OR  | 50    | 1. dispose calls onDestroy in reverse registration order (RSC.dispose L78 .reverse()), 2. providers registered in order A,B,C → disposed C,B,A (RSC.dispose L78), 3. registration order doesn't affect get() behavior (RSC.get L35-43 Map-based lookup) |
 * - Total scenarios: 405
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 405
 * - Removed: 361
 * - Key removals (5+):
 *   1. HP-6~HP-55 repeat same delegation/caching paths with trivial value differences; keeping HP-1~HP-5
 *   2. NE-4~NE-50 exercise same error branches with different token types; keeping NE-1,NE-2,NE-3,NE-4,NE-5
 *   3. ED-4~ED-50 boundary variations on empty/single/undefined; keeping ED-1,ED-2,ED-3
 *   4. CO-4~CO-50 same concurrent isolation pattern at different scale; keeping CO-1,CO-2,CO-3,CO-4
 *   5. ST-4~ST-50 same dispose→re-get lifecycle with different providers; keeping ST-1,ST-2,ST-3
 *   6. CR-4~CR-50 same parallel isolation pattern; keeping CR-1,CR-2
 *   7. ID-4~ID-50 same idempotent get pattern; keeping ID-1,ID-2
 *   8. OR-4~OR-50 same reverse-order dispose pattern; keeping OR-1,OR-2,OR-3
 * - Final test count: 27
 * - Final test list:
 *   1.  [HP] should return a new request-scoped instance per request container
 *   2.  [HP] should return the same cached instance within a single request scope
 *   3.  [HP] should delegate singleton resolution to the parent container
 *   4.  [HP] should return a new transient instance per resolution
 *   5.  [HP] should call onDestroy on request-scoped instances when request scope is disposed
 *   6.  [NE] should throw when resolving request-scoped provider from root container
 *   7.  [NE] should throw when calling set on request-scoped container
 *   8.  [NE] should continue disposing remaining instances when one onDestroy throws
 *   9.  [NE] should continue disposing when onDestroy rejects with async error
 *   10. [NE] should not call onDestroy on instances without the method
 *   11. [ED] should no-op dispose when no request-scoped instances exist
 *   12. [ED] should cache undefined returned by factory as a valid value
 *   13. [ED] should handle request scope with only singleton and transient providers
 *   14. [CO] should isolate instances across concurrent request scopes
 *   15. [CO] should maintain isolation under high-volume concurrent requests
 *   16. [CO] should isolate request-scoped dependency chains across concurrent requests
 *   17. [CO] should not cross-contaminate when async operations interleave
 *   18. [ST] should create a fresh instance after dispose clears the cache
 *   19. [ST] should preserve singleton identity across request scope dispose cycles
 *   20. [ST] should clear all request instances on dispose and return empty iterator
 *   21. [CR] should produce independent containers from parallel createRequestScope calls
 *   22. [CR] should safely dispose multiple request scopes concurrently
 *   23. [ID] should return identical instance on repeated get calls within same scope
 *   24. [ID] should always create a new request scope container per createRequestScope call
 *   25. [OR] should call onDestroy in reverse registration order
 *   26. [OR] should maintain LIFO disposal order with mixed disposable and non-disposable instances
 *   27. [OR] should dispose request-scoped instances independently from singleton lifecycle
 */

// ── Fixtures ──────────────────────────────────────────────────────

interface DisposalTracker {
  readonly disposed: string[];
}

function createTrackedFactory(label: string, tracker: DisposalTracker) {
  return (_container: ZipbulContainer) => ({
    label,
    onDestroy() {
      tracker.disposed.push(label);
    },
  });
}

function createSingletonCounter() {
  let count = 0;

  return {
    factory: (_container: ZipbulContainer) => {
      count += 1;
      return { id: count, scope: 'singleton' as const };
    },
    getCount: () => count,
  };
}

function createRequestScopedCounter() {
  let count = 0;

  return {
    factory: (_container: ZipbulContainer) => {
      count += 1;
      return { id: count, scope: 'request' as const };
    },
    getCount: () => count,
  };
}

function createTransientCounter() {
  let count = 0;

  return {
    factory: (_container: ZipbulContainer) => {
      count += 1;
      return { id: count, scope: 'transient' as const };
    },
    getCount: () => count,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Request scope isolation', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  // ── HP: Happy Path ──────────────────────────────────────────

  it('should return a new request-scoped instance per request container', () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const scopeA = container.createRequestScope('ctx-a');
    const scopeB = container.createRequestScope('ctx-b');

    // Act
    const instanceA = scopeA.get('reqProvider');
    const instanceB = scopeB.get('reqProvider');

    // Assert
    expect(instanceA).not.toBe(instanceB);
    expect(counter.getCount()).toBe(2);
  });

  it('should return the same cached instance within a single request scope', () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');

    // Act
    const first = scope.get('reqProvider');
    const second = scope.get('reqProvider');

    // Assert
    expect(first).toBe(second);
    expect(counter.getCount()).toBe(1);
  });

  it('should delegate singleton resolution to the parent container', () => {
    // Arrange
    const counter = createSingletonCounter();
    container.set('singletonProvider', counter.factory, { scope: 'singleton' });
    const scopeA = container.createRequestScope('ctx-a');
    const scopeB = container.createRequestScope('ctx-b');

    // Act
    const fromRoot = container.get('singletonProvider');
    const fromA = scopeA.get('singletonProvider');
    const fromB = scopeB.get('singletonProvider');

    // Assert
    expect(fromRoot).toBe(fromA);
    expect(fromA).toBe(fromB);
    expect(counter.getCount()).toBe(1);
  });

  it('should return a new transient instance per resolution', () => {
    // Arrange
    const counter = createTransientCounter();
    container.set('transientProvider', counter.factory, { scope: 'transient' });
    const scope = container.createRequestScope('ctx-1');

    // Act
    const first = scope.get('transientProvider');
    const second = scope.get('transientProvider');

    // Assert
    expect(first).not.toBe(second);
    expect(counter.getCount()).toBe(2);
  });

  it('should call onDestroy on request-scoped instances when request scope is disposed', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('reqA', createTrackedFactory('A', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');
    scope.get('reqA');

    // Act
    await scope.dispose!();

    // Assert
    expect(tracker.disposed).toEqual(['A']);
  });

  // ── NE: Negative / Error ──────────────────────────────────

  it('should throw when resolving request-scoped provider from root container', () => {
    // Arrange
    container.set('reqProvider', () => ({}), { scope: 'request' });

    // Act & Assert
    expect(() => container.get('reqProvider')).toThrow(
      /Cannot resolve request-scoped provider.*from the root container/,
    );
  });

  it('should throw when calling set on request-scoped container', () => {
    // Arrange
    const scope = container.createRequestScope('ctx-1');

    // Act & Assert
    expect(() => scope.set('newToken', () => ({}))).toThrow(
      /Cannot register providers on a request-scoped container/,
    );
  });

  it('should continue disposing remaining instances when one onDestroy throws', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('good1', createTrackedFactory('good1', tracker), { scope: 'request' });
    container.set('bad', (_c: ZipbulContainer) => ({
      onDestroy() {
        throw new Error('dispose failure');
      },
    }), { scope: 'request' });
    container.set('good2', createTrackedFactory('good2', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');
    scope.get('good1');
    scope.get('bad');
    scope.get('good2');

    // Act
    await scope.dispose!();

    // Assert — both good providers should be disposed despite bad throwing
    expect(tracker.disposed).toContain('good1');
    expect(tracker.disposed).toContain('good2');
  });

  it('should continue disposing when onDestroy rejects with async error', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('asyncBad', (_c: ZipbulContainer) => ({
      async onDestroy() {
        throw new Error('async dispose failure');
      },
    }), { scope: 'request' });
    container.set('afterBad', createTrackedFactory('afterBad', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');
    scope.get('asyncBad');
    scope.get('afterBad');

    // Act
    await scope.dispose!();

    // Assert
    expect(tracker.disposed).toContain('afterBad');
  });

  it('should not call onDestroy on instances without the method', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('noDestroy', (_c: ZipbulContainer) => ({ label: 'plain' }), { scope: 'request' });
    container.set('withDestroy', createTrackedFactory('withDestroy', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');
    scope.get('noDestroy');
    scope.get('withDestroy');

    // Act
    await scope.dispose!();

    // Assert
    expect(tracker.disposed).toEqual(['withDestroy']);
  });

  // ── ED: Edge ──────────────────────────────────────────────

  it('should no-op dispose when no request-scoped instances exist', async () => {
    // Arrange
    const scope = container.createRequestScope('ctx-empty');

    // Act & Assert — should not throw
    await scope.dispose!();
  });

  it('should cache undefined returned by factory as a valid value', () => {
    // Arrange
    let callCount = 0;
    container.set('undefinedProvider', (_c: ZipbulContainer) => {
      callCount += 1;
      return undefined;
    }, { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');

    // Act
    const first = scope.get('undefinedProvider');
    const second = scope.get('undefinedProvider');

    // Assert
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(callCount).toBe(1);
  });

  it('should handle request scope with only singleton and transient providers', () => {
    // Arrange
    const singletonCounter = createSingletonCounter();
    const transientCounter = createTransientCounter();
    container.set('singleton', singletonCounter.factory, { scope: 'singleton' });
    container.set('transient', transientCounter.factory, { scope: 'transient' });
    const scope = container.createRequestScope('ctx-1');

    // Act
    const s1 = scope.get('singleton');
    const s2 = scope.get('singleton');
    const t1 = scope.get('transient');
    const t2 = scope.get('transient');

    // Assert
    expect(s1).toBe(s2);
    expect(t1).not.toBe(t2);
    expect(singletonCounter.getCount()).toBe(1);
    expect(transientCounter.getCount()).toBe(2);
  });

  // ── CO: Concurrency ──────────────────────────────────────

  it('should isolate instances across concurrent request scopes', async () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const scopeCount = 10;
    const scopes = Array.from({ length: scopeCount }, (_, index) =>
      container.createRequestScope(`ctx-${index}`),
    );

    // Act — resolve concurrently
    const results = await Promise.all(
      scopes.map(async (scope) => {
        const instance = scope.get('reqProvider');
        return instance;
      }),
    );

    // Assert — all instances should be different objects
    const uniqueInstances = new Set(results);
    expect(uniqueInstances.size).toBe(scopeCount);
    expect(counter.getCount()).toBe(scopeCount);
  });

  it('should maintain isolation under high-volume concurrent requests', async () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const volumeSize = 200;

    // Act — simulate 200 concurrent requests
    const results = await Promise.all(
      Array.from({ length: volumeSize }, async (_, index) => {
        const scope = container.createRequestScope(`ctx-${index}`);
        const instance = scope.get('reqProvider') as { id: number };
        const secondGet = scope.get('reqProvider') as { id: number };
        await scope.dispose!();
        return { instanceId: instance.id, sameWithinScope: instance === secondGet };
      }),
    );

    // Assert — every request got a unique instance, same within scope
    const uniqueIds = new Set(results.map(result => result.instanceId));
    expect(uniqueIds.size).toBe(volumeSize);
    expect(results.every(result => result.sameWithinScope)).toBe(true);
  });

  it('should isolate request-scoped dependency chains across concurrent requests', async () => {
    // Arrange
    let repoCount = 0;
    let serviceCount = 0;

    container.set('reqRepo', (_c: ZipbulContainer) => {
      repoCount += 1;
      return { repoId: repoCount };
    }, { scope: 'request' });

    container.set('reqService', (c: ZipbulContainer) => {
      serviceCount += 1;
      const repo = c.get('reqRepo') as { repoId: number };
      return { serviceId: serviceCount, repo };
    }, { scope: 'request' });

    // Act — two concurrent request scopes
    const [resultA, resultB] = await Promise.all(
      ['ctx-a', 'ctx-b'].map(async (contextId) => {
        const scope = container.createRequestScope(contextId);
        const service = scope.get('reqService') as { serviceId: number; repo: { repoId: number } };
        const directRepo = scope.get('reqRepo') as { repoId: number };
        await scope.dispose!();
        return { service, directRepo };
      }),
    );

    // Assert — each scope got its own repo, and the service's repo is the same as the direct repo within scope
    expect(resultA.service.repo).toBe(resultA.directRepo);
    expect(resultB.service.repo).toBe(resultB.directRepo);
    expect(resultA.service.repo).not.toBe(resultB.service.repo);
    expect(resultA.service).not.toBe(resultB.service);
  });

  it('should not cross-contaminate when async operations interleave', async () => {
    // Arrange
    container.set('asyncReqProvider', (_c: ZipbulContainer) => {
      const state = { value: 'initial' };
      return state;
    }, { scope: 'request' });

    // Act — interleave async operations between two scopes
    const scopeA = container.createRequestScope('ctx-a');
    const scopeB = container.createRequestScope('ctx-b');

    const instanceA = scopeA.get('asyncReqProvider') as { value: string };
    const instanceB = scopeB.get('asyncReqProvider') as { value: string };

    // Mutate A
    instanceA.value = 'mutated-by-A';

    // Yield control
    await Promise.resolve();

    // Mutate B
    instanceB.value = 'mutated-by-B';

    // Assert — mutations are isolated
    expect(instanceA.value).toBe('mutated-by-A');
    expect(instanceB.value).toBe('mutated-by-B');
    expect(instanceA).not.toBe(instanceB);

    await scopeA.dispose!();
    await scopeB.dispose!();
  });

  // ── ST: State Transition ──────────────────────────────────

  it('should create a fresh instance after dispose clears the cache', async () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const scope = container.createRequestScope('ctx-1') as RequestScopeContainer;

    // Act
    const before = scope.get('reqProvider');
    await scope.dispose();
    const after = scope.get('reqProvider');

    // Assert
    expect(before).not.toBe(after);
    expect(counter.getCount()).toBe(2);
  });

  it('should preserve singleton identity across request scope dispose cycles', async () => {
    // Arrange
    const singletonCounter = createSingletonCounter();
    container.set('singleton', singletonCounter.factory, { scope: 'singleton' });

    const scope1 = container.createRequestScope('ctx-1');
    const fromScope1 = scope1.get('singleton');
    await scope1.dispose!();

    const scope2 = container.createRequestScope('ctx-2');

    // Act
    const fromScope2 = scope2.get('singleton');
    await scope2.dispose!();

    // Assert
    expect(fromScope1).toBe(fromScope2);
    expect(singletonCounter.getCount()).toBe(1);
  });

  it('should clear all request instances on dispose and return empty iterator', async () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqA', counter.factory, { scope: 'request' });
    container.set('reqB', counter.factory, { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');
    scope.get('reqA');
    scope.get('reqB');

    // Act
    await scope.dispose!();

    // Assert
    const instances = Array.from(scope.getInstances());
    expect(instances).toHaveLength(0);
  });

  // ── CR: Concurrency / Race ──────────────────────────────────

  it('should produce independent containers from parallel createRequestScope calls', () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });

    // Act
    const scopes = Array.from({ length: 50 }, (_, index) =>
      container.createRequestScope(`ctx-${index}`),
    );

    const instances = scopes.map(scope => scope.get('reqProvider'));

    // Assert — all 50 instances are unique
    const uniqueSet = new Set(instances);
    expect(uniqueSet.size).toBe(50);
  });

  it('should safely dispose multiple request scopes concurrently', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('reqProvider', (c: ZipbulContainer) => ({
      label: (c as RequestScopeContainer).getContextId(),
      onDestroy() {
        tracker.disposed.push(this.label);
      },
    }), { scope: 'request' });

    const scopes = Array.from({ length: 20 }, (_, index) => {
      const scope = container.createRequestScope(`ctx-${index}`);
      scope.get('reqProvider');
      return scope;
    });

    // Act — dispose all concurrently
    await Promise.all(scopes.map(scope => scope.dispose!()));

    // Assert — all 20 disposed
    expect(tracker.disposed).toHaveLength(20);

    const uniqueDisposed = new Set(tracker.disposed);
    expect(uniqueDisposed.size).toBe(20);
  });

  // ── ID: Idempotency ──────────────────────────────────────

  it('should return identical instance on repeated get calls within same scope', () => {
    // Arrange
    const counter = createRequestScopedCounter();
    container.set('reqProvider', counter.factory, { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');

    // Act
    const results = Array.from({ length: 100 }, () => scope.get('reqProvider'));

    // Assert
    const allSame = results.every(instance => instance === results[0]);
    expect(allSame).toBe(true);
    expect(counter.getCount()).toBe(1);
  });

  it('should always create a new request scope container per createRequestScope call', () => {
    // Arrange & Act
    const scopes = Array.from({ length: 10 }, (_, index) =>
      container.createRequestScope(`ctx-${index}`),
    );

    // Assert
    for (let index = 0; index < scopes.length; index++) {
      for (let other = index + 1; other < scopes.length; other++) {
        expect(scopes[index]).not.toBe(scopes[other]);
      }
    }
  });

  // ── OR: Ordering ──────────────────────────────────────────

  it('should call onDestroy in reverse registration order', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('first', createTrackedFactory('first', tracker), { scope: 'request' });
    container.set('second', createTrackedFactory('second', tracker), { scope: 'request' });
    container.set('third', createTrackedFactory('third', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');

    // Resolve in registration order
    scope.get('first');
    scope.get('second');
    scope.get('third');

    // Act
    await scope.dispose!();

    // Assert — LIFO: third, second, first
    expect(tracker.disposed).toEqual(['third', 'second', 'first']);
  });

  it('should maintain LIFO disposal order with mixed disposable and non-disposable instances', async () => {
    // Arrange
    const tracker: DisposalTracker = { disposed: [] };
    container.set('disposable1', createTrackedFactory('d1', tracker), { scope: 'request' });
    container.set('plain', (_c: ZipbulContainer) => ({ label: 'no-destroy' }), { scope: 'request' });
    container.set('disposable2', createTrackedFactory('d2', tracker), { scope: 'request' });
    container.set('anotherPlain', (_c: ZipbulContainer) => 42, { scope: 'request' });
    container.set('disposable3', createTrackedFactory('d3', tracker), { scope: 'request' });
    const scope = container.createRequestScope('ctx-1');

    scope.get('disposable1');
    scope.get('plain');
    scope.get('disposable2');
    scope.get('anotherPlain');
    scope.get('disposable3');

    // Act
    await scope.dispose!();

    // Assert — only disposables, in reverse order of their resolution
    expect(tracker.disposed).toEqual(['d3', 'd2', 'd1']);
  });

  it('should dispose request-scoped instances independently from singleton lifecycle', async () => {
    // Arrange
    const singletonTracker: DisposalTracker = { disposed: [] };
    const requestTracker: DisposalTracker = { disposed: [] };

    container.set('singleton', createTrackedFactory('singleton', singletonTracker), { scope: 'singleton' });
    container.set('reqProvider', createTrackedFactory('req', requestTracker), { scope: 'request' });

    const scope = container.createRequestScope('ctx-1');
    scope.get('singleton');
    scope.get('reqProvider');

    // Act
    await scope.dispose!();

    // Assert — only request-scoped disposed, singleton untouched
    expect(requestTracker.disposed).toEqual(['req']);
    expect(singletonTracker.disposed).toHaveLength(0);
  });
});
