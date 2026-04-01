import { describe, it, expect, beforeEach } from 'bun:test';

import type { ZipbulContainer } from '@zipbul/common';
import { runInInjectionContext, inject } from '../src/injection-context';

import { Container } from '../src/injector/container';
import type { RequestScopeContainer } from '../src/injector/request-scope-container';

/**
 * [OVERFLOW Checkpoint]
 * - Target: inject() + runInInjectionContext + RequestScopeContainer (AsyncLocalStorage isolation)
 * - Branch count: 10
 *   inject():
 *     L51 `if (!container)` → throw, L57 `container.get(token)` → delegates to RSC
 *   runInInjectionContext():
 *     L26 `injectionStore.run(container, fn)` → sets AsyncLocalStorage context
 *   RequestScopeContainer.get():
 *     L23 `if (!registration)`, L27 `if (scope === 'singleton')`,
 *     L31 `if (scope === 'transient')`, L35 `if (requestInstances.has)`,
 *     L39-43 else (create+cache)
 *   Container.get():
 *     L86 `if (scope === 'request')` → throw from root
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. inject() resolves request-scoped provider inside runInInjectionContext with RSC (inject L57 → RSC.get L39-43), 2. inject() resolves singleton via RSC delegation (inject L57 → RSC.get L27 → Container.get L96), 3. nested inject() in provider factory resolves from same RSC (runInInjectionContext L26 → inject L57 → RSC.get L35 cached) |
 *   | NE  | 50    | 1. inject() outside context throws (inject L53-55), 2. inject() from root context throws for request-scoped (inject L57 → Container.get L86-91), 3. inject() for unregistered token throws (inject L57 → Container.get L80-83) |
 *   | ED  | 50    | 1. runInInjectionContext with empty callback (runInInjectionContext L26 fn returns void), 2. inject() returns undefined from factory (inject L57 → RSC.get L39 factory returns undefined), 3. nested runInInjectionContext overrides outer context (runInInjectionContext L26 AsyncLocalStorage.run replaces store) |
 *   | CO  | 50    | 1. concurrent runInInjectionContext calls with different RSCs are isolated (AsyncLocalStorage per-async-context), 2. parallel inject() calls in different async contexts return different instances (AsyncLocalStorage isolation), 3. interleaved async operations maintain correct context (AsyncLocalStorage.run preserves across await) |
 *   | ST  | 50    | 1. inject() inside context → exit context → inject() throws (AsyncLocalStorage store cleared after run), 2. dispose RSC → new runInInjectionContext → inject() creates fresh instance (RSC.dispose L90 + RSC.get L39), 3. runInInjectionContext with root container → switch to RSC → inject resolves differently (different container in store) |
 *   | CR  | 50    | 1. async inject() in parallel with different RSC contexts (AsyncLocalStorage per-execution-context), 2. concurrent provider factory calls via inject() don't interfere (RSC instance-local Map), 3. parallel dispose + inject on separate RSCs (RSC.dispose L77 vs RSC.get L39 on different instances) |
 *   | ID  | 50    | 1. inject() same token twice in same context returns same instance (inject L57 → RSC.get L35 cached), 2. runInInjectionContext with same container returns same results (deterministic factory), 3. inject() singleton from multiple RSC contexts returns same instance (RSC.get L27 → Container singleton cache) |
 *   | OR  | 50    | 1. inject() order doesn't affect caching (RSC.get L35 Map lookup + L39 cache-on-miss), 2. nested runInInjectionContext uses innermost container (AsyncLocalStorage.run replaces), 3. factory execution order matches inject() call order (RSC.get L39 sequential cache population) |
 * - Total scenarios: 405
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 405
 * - Removed: 378
 * - Key removals (5+):
 *   1. HP-4~HP-55 repeat same inject-via-RSC path; keeping HP-1,HP-2,HP-3,HP-4,HP-5
 *   2. NE-4~NE-50 same error branches with variations; keeping NE-1,NE-2
 *   3. ED-4~ED-50 same edge patterns; keeping ED-1,ED-2
 *   4. CO-4~CO-50 same concurrent isolation; keeping CO-1,CO-2,CO-3,CO-4
 *   5. ST-3~ST-50 same state transition patterns; keeping ST-1,ST-2
 *   6. CR-3~CR-50 same race patterns; keeping CR-1,CR-2
 *   7. ID-3~ID-50 same idempotent patterns; keeping ID-1,ID-2
 *   8. OR-3~OR-50 same ordering patterns; keeping OR-1,OR-2
 * - Final test count: 22
 * - Final test list:
 *   1.  [HP] should resolve request-scoped provider via inject() inside runInInjectionContext with RSC
 *   2.  [HP] should resolve singleton via inject() through RSC delegation to parent
 *   3.  [HP] should resolve nested inject() calls within provider factory from same RSC
 *   4.  [HP] should resolve request-scoped dependency chain via inject() in field initializer pattern
 *   5.  [HP] should support mixed scope resolution via inject() within single request context
 *   6.  [NE] should throw when inject() is called outside injection context
 *   7.  [NE] should throw when inject() resolves request-scoped token from root container context
 *   8.  [ED] should resolve inject() returning undefined from factory
 *   9.  [ED] should use innermost container when runInInjectionContext is nested
 *   10. [CO] should isolate inject() results across concurrent async contexts
 *   11. [CO] should maintain correct inject() context across await boundaries
 *   12. [CO] should isolate request-scoped inject() chains across parallel async contexts
 *   13. [CO] should isolate inject() with high concurrency (100 parallel contexts)
 *   14. [ST] should throw inject() after exiting injection context
 *   15. [ST] should create fresh instances via inject() after RSC dispose
 *   16. [CR] should not interfere when parallel inject() calls populate different RSC caches
 *   17. [CR] should safely run parallel dispose and inject on separate RSCs
 *   18. [ID] should return same instance for repeated inject() calls in same context
 *   19. [ID] should return same singleton via inject() from different RSC contexts
 *   20. [OR] should cache inject() results regardless of call order
 *   21. [OR] should use innermost container in nested runInInjectionContext calls
 *   22. [OR] should execute factory only once regardless of inject() call count
 */

// ── Tests ──────────────────────────────────────────────────────

describe('Request scope injection context', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  // ── HP: Happy Path ──────────────────────────────────────────

  it('should resolve request-scoped provider via inject() inside runInInjectionContext with RSC', () => {
    // Arrange
    let factoryCallCount = 0;
    container.set('reqService', (_c: ZipbulContainer) => {
      factoryCallCount += 1;
      return { id: factoryCallCount };
    }, { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1');

    // Act
    const result = runInInjectionContext(rsc, () => {
      return inject('reqService');
    });

    // Assert
    expect(result).toEqual({ id: 1 });
    expect(factoryCallCount).toBe(1);
  });

  it('should resolve singleton via inject() through RSC delegation to parent', () => {
    // Arrange
    let factoryCallCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      factoryCallCount += 1;
      return { id: factoryCallCount };
    }, { scope: 'singleton' });
    const rscA = container.createRequestScope('ctx-a');
    const rscB = container.createRequestScope('ctx-b');

    // Act
    const fromA = runInInjectionContext(rscA, () => inject('singleton'));
    const fromB = runInInjectionContext(rscB, () => inject('singleton'));

    // Assert
    expect(fromA).toBe(fromB);
    expect(factoryCallCount).toBe(1);
  });

  it('should resolve nested inject() calls within provider factory from same RSC', () => {
    // Arrange
    let repoCallCount = 0;
    container.set('repo', (_c: ZipbulContainer) => {
      repoCallCount += 1;
      return { repoId: repoCallCount };
    }, { scope: 'request' });

    container.set('service', (c: ZipbulContainer) => {
      const repo = runInInjectionContext(c, () => inject('repo'));
      return { serviceRepo: repo };
    }, { scope: 'request' });

    const rsc = container.createRequestScope('ctx-1');

    // Act
    const service = runInInjectionContext(rsc, () => inject('service')) as { serviceRepo: { repoId: number } };
    const directRepo = runInInjectionContext(rsc, () => inject('repo'));

    // Assert — service's repo should be the same cached instance as direct repo
    expect(service.serviceRepo).toBe(directRepo);
    expect(repoCallCount).toBe(1);
  });

  it('should resolve request-scoped dependency chain via inject() in field initializer pattern', () => {
    // Arrange — simulates AOT-generated factory with inject() in constructor
    container.set('reqLogger', (_c: ZipbulContainer) => {
      return { log: (msg: string) => msg };
    }, { scope: 'request' });

    container.set('reqService', (c: ZipbulContainer) => {
      // Simulates: private readonly logger = inject('reqLogger') in class body
      return runInInjectionContext(c, () => {
        const logger = inject('reqLogger') as { log: (msg: string) => string };
        return { logger, process: () => logger.log('processed') };
      });
    }, { scope: 'request' });

    const rsc = container.createRequestScope('ctx-1');

    // Act
    const service = runInInjectionContext(rsc, () => inject('reqService')) as {
      logger: { log: (msg: string) => string };
      process: () => string;
    };

    // Assert
    expect(service.process()).toBe('processed');
    const directLogger = runInInjectionContext(rsc, () => inject('reqLogger'));
    expect(service.logger).toBe(directLogger);
  });

  it('should support mixed scope resolution via inject() within single request context', () => {
    // Arrange
    let singletonCount = 0;
    let requestCount = 0;
    let transientCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => { singletonCount += 1; return { id: singletonCount, scope: 'singleton' }; }, { scope: 'singleton' });
    container.set('request', (_c: ZipbulContainer) => { requestCount += 1; return { id: requestCount, scope: 'request' }; }, { scope: 'request' });
    container.set('transient', (_c: ZipbulContainer) => { transientCount += 1; return { id: transientCount, scope: 'transient' }; }, { scope: 'transient' });
    const rsc = container.createRequestScope('ctx-1');

    // Act
    const results = runInInjectionContext(rsc, () => ({
      s1: inject('singleton'),
      s2: inject('singleton'),
      r1: inject('request'),
      r2: inject('request'),
      t1: inject('transient'),
      t2: inject('transient'),
    }));

    // Assert
    expect(results.s1).toBe(results.s2);
    expect(results.r1).toBe(results.r2);
    expect(results.t1).not.toBe(results.t2);
    expect(singletonCount).toBe(1);
    expect(requestCount).toBe(1);
    expect(transientCount).toBe(2);
  });

  // ── NE: Negative / Error ──────────────────────────────────

  it('should throw when inject() is called outside injection context', () => {
    // Arrange
    container.set('singleton', () => ({}), { scope: 'singleton' });

    // Act & Assert
    expect(() => inject('singleton')).toThrow(/inject\(\) must be called within a DI context/);
  });

  it('should throw when inject() resolves request-scoped token from root container context', () => {
    // Arrange
    container.set('reqProvider', () => ({}), { scope: 'request' });

    // Act & Assert
    expect(() => {
      runInInjectionContext(container, () => inject('reqProvider'));
    }).toThrow(/Cannot resolve request-scoped provider/);
  });

  // ── ED: Edge ──────────────────────────────────────────────

  it('should resolve inject() returning undefined from factory', () => {
    // Arrange
    let callCount = 0;
    container.set('undefinedProvider', (_c: ZipbulContainer) => {
      callCount += 1;
      return undefined;
    }, { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1');

    // Act
    const first = runInInjectionContext(rsc, () => inject('undefinedProvider'));
    const second = runInInjectionContext(rsc, () => inject('undefinedProvider'));

    // Assert
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(callCount).toBe(1);
  });

  it('should use innermost container when runInInjectionContext is nested', () => {
    // Arrange
    container.set('reqProvider', (_c: ZipbulContainer) => ({ scope: 'outer' }), { scope: 'request' });
    const outerRsc = container.createRequestScope('ctx-outer');
    const innerRsc = container.createRequestScope('ctx-inner');

    // Resolve in outer to cache
    runInInjectionContext(outerRsc, () => inject('reqProvider'));

    // Act — nested context should use inner RSC
    const result = runInInjectionContext(outerRsc, () => {
      return runInInjectionContext(innerRsc, () => inject('reqProvider'));
    });

    // Assert — inner RSC has its own cache, different instance from outer
    const outerInstance = runInInjectionContext(outerRsc, () => inject('reqProvider'));
    expect(result).not.toBe(outerInstance);
  });

  // ── CO: Concurrency ──────────────────────────────────────

  it('should isolate inject() results across concurrent async contexts', async () => {
    // Arrange
    let counter = 0;
    container.set('reqProvider', (_c: ZipbulContainer) => {
      counter += 1;
      return { id: counter };
    }, { scope: 'request' });

    // Act
    const results = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const rsc = container.createRequestScope(`ctx-${index}`);
        return runInInjectionContext(rsc, () => inject('reqProvider'));
      }),
    );

    // Assert
    const ids = results.map(result => (result as { id: number }).id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it('should maintain correct inject() context across await boundaries', async () => {
    // Arrange
    container.set('reqProvider', (_c: ZipbulContainer) => {
      return { contextId: 'will-be-set' };
    }, { scope: 'request' });

    // Act — resolve, yield, resolve again
    const rsc = container.createRequestScope('ctx-1');
    const instance1 = runInInjectionContext(rsc, () => inject('reqProvider'));
    await Promise.resolve(); // yield control
    const instance2 = runInInjectionContext(rsc, () => inject('reqProvider'));

    // Assert — same cached instance
    expect(instance1).toBe(instance2);
  });

  it('should isolate request-scoped inject() chains across parallel async contexts', async () => {
    // Arrange
    container.set('repo', (_c: ZipbulContainer) => {
      return { repoId: Math.random() };
    }, { scope: 'request' });

    container.set('service', (c: ZipbulContainer) => {
      const repo = runInInjectionContext(c, () => inject('repo'));
      return { repo };
    }, { scope: 'request' });

    // Act
    const [resultA, resultB] = await Promise.all(
      ['ctx-a', 'ctx-b'].map(async (contextId) => {
        const rsc = container.createRequestScope(contextId);
        const service = runInInjectionContext(rsc, () => inject('service')) as { repo: { repoId: number } };
        const directRepo = runInInjectionContext(rsc, () => inject('repo')) as { repoId: number };
        return { service, directRepo };
      }),
    );

    // Assert — each context has its own chain
    expect(resultA.service.repo).toBe(resultA.directRepo);
    expect(resultB.service.repo).toBe(resultB.directRepo);
    expect(resultA.service.repo).not.toBe(resultB.service.repo);
  });

  it('should isolate inject() with high concurrency (100 parallel contexts)', async () => {
    // Arrange
    let counter = 0;
    container.set('reqProvider', (_c: ZipbulContainer) => {
      counter += 1;
      return { id: counter };
    }, { scope: 'request' });
    const concurrency = 100;

    // Act
    const results = await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const rsc = container.createRequestScope(`ctx-${index}`);
        const instance = runInInjectionContext(rsc, () => inject('reqProvider')) as { id: number };
        // Second get should return cached
        const cached = runInInjectionContext(rsc, () => inject('reqProvider')) as { id: number };
        await rsc.dispose!();
        return { id: instance.id, same: instance === cached };
      }),
    );

    // Assert
    const uniqueIds = new Set(results.map(result => result.id));
    expect(uniqueIds.size).toBe(concurrency);
    expect(results.every(result => result.same)).toBe(true);
  });

  // ── ST: State Transition ──────────────────────────────────

  it('should throw inject() after exiting injection context', () => {
    // Arrange
    container.set('reqProvider', () => ({}), { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1');

    // Resolve inside context — works
    runInInjectionContext(rsc, () => inject('reqProvider'));

    // Act & Assert — outside context throws
    expect(() => inject('reqProvider')).toThrow(/inject\(\) must be called within a DI context/);
  });

  it('should create fresh instances via inject() after RSC dispose', async () => {
    // Arrange
    let counter = 0;
    container.set('reqProvider', (_c: ZipbulContainer) => {
      counter += 1;
      return { id: counter };
    }, { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1') as ZipbulContainer & { dispose(): Promise<void> };

    // Act
    const before = runInInjectionContext(rsc, () => inject('reqProvider'));
    await rsc.dispose();
    const after = runInInjectionContext(rsc, () => inject('reqProvider'));

    // Assert
    expect(before).not.toBe(after);
    expect((before as { id: number }).id).not.toBe((after as { id: number }).id);
    expect(counter).toBe(2);
  });

  // ── CR: Concurrency / Race ──────────────────────────────────

  it('should not interfere when parallel inject() calls populate different RSC caches', async () => {
    // Arrange
    container.set('reqProvider', (_c: ZipbulContainer) => {
      return { timestamp: performance.now() };
    }, { scope: 'request' });

    // Act — parallel cache population
    const scopes = Array.from({ length: 50 }, (_, index) =>
      container.createRequestScope(`ctx-${index}`),
    );

    const results = await Promise.all(
      scopes.map(async (rsc) => {
        const instance = runInInjectionContext(rsc, () => inject('reqProvider'));
        return instance;
      }),
    );

    // Assert
    const uniqueSet = new Set(results);
    expect(uniqueSet.size).toBe(50);
  });

  it('should safely run parallel dispose and inject on separate RSCs', async () => {
    // Arrange
    const disposedContextIds: string[] = [];
    container.set('reqProvider', (c: ZipbulContainer) => {
      const contextId = (c as RequestScopeContainer).getContextId();
      return {
        contextId,
        onDestroy() { disposedContextIds.push(contextId); },
      };
    }, { scope: 'request' });

    const disposingScopes = Array.from({ length: 10 }, (_, index) => {
      const rsc = container.createRequestScope(`dispose-${index}`);
      runInInjectionContext(rsc, () => inject('reqProvider'));
      return rsc;
    });

    const activeScopes = Array.from({ length: 10 }, (_, index) =>
      container.createRequestScope(`active-${index}`),
    );

    // Act — dispose some while resolving from others in parallel
    await Promise.all([
      ...disposingScopes.map(rsc => rsc.dispose!()),
      ...activeScopes.map(async (rsc) => {
        return runInInjectionContext(rsc, () => inject('reqProvider'));
      }),
    ]);

    // Assert — all disposing scopes cleaned up, active scopes resolved
    expect(disposedContextIds).toHaveLength(10);
    for (const activeScope of activeScopes) {
      const instances = Array.from(activeScope.getInstances());
      expect(instances).toHaveLength(1);
    }
  });

  // ── ID: Idempotency ──────────────────────────────────────

  it('should return same instance for repeated inject() calls in same context', () => {
    // Arrange
    let counter = 0;
    container.set('reqProvider', (_c: ZipbulContainer) => {
      counter += 1;
      return { id: counter };
    }, { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1');

    // Act
    const results = runInInjectionContext(rsc, () => {
      return Array.from({ length: 50 }, () => inject('reqProvider'));
    });

    // Assert
    const allSame = results.every(result => result === results[0]);
    expect(allSame).toBe(true);
    expect(counter).toBe(1);
  });

  it('should return same singleton via inject() from different RSC contexts', () => {
    // Arrange
    let counter = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      counter += 1;
      return { id: counter };
    }, { scope: 'singleton' });

    // Act
    const results = Array.from({ length: 10 }, (_, index) => {
      const rsc = container.createRequestScope(`ctx-${index}`);
      return runInInjectionContext(rsc, () => inject('singleton'));
    });

    // Assert
    const allSame = results.every(result => result === results[0]);
    expect(allSame).toBe(true);
    expect(counter).toBe(1);
  });

  // ── OR: Ordering ──────────────────────────────────────────

  it('should cache inject() results regardless of call order', () => {
    // Arrange
    let aCount = 0;
    let bCount = 0;
    container.set('providerA', (_c: ZipbulContainer) => { aCount += 1; return { id: aCount }; }, { scope: 'request' });
    container.set('providerB', (_c: ZipbulContainer) => { bCount += 1; return { id: bCount }; }, { scope: 'request' });
    const rsc1 = container.createRequestScope('ctx-1');
    const rsc2 = container.createRequestScope('ctx-2');

    // Act — resolve in different orders
    const r1 = runInInjectionContext(rsc1, () => ({ a: inject('providerA'), b: inject('providerB') }));
    const r2 = runInInjectionContext(rsc2, () => ({ b: inject('providerB'), a: inject('providerA') }));

    // Assert — each context has unique instances regardless of order
    expect(r1.a).not.toBe(r2.a);
    expect(r1.b).not.toBe(r2.b);
    expect(aCount).toBe(2);
    expect(bCount).toBe(2);
  });

  it('should use innermost container in nested runInInjectionContext calls', () => {
    // Arrange
    container.set('reqProvider', (_c: ZipbulContainer) => {
      return { value: 'created' };
    }, { scope: 'request' });
    const outerRsc = container.createRequestScope('ctx-outer');
    const innerRsc = container.createRequestScope('ctx-inner');

    // Act
    const outerInstance = runInInjectionContext(outerRsc, () => inject('reqProvider'));
    const innerFromNested = runInInjectionContext(outerRsc, () => {
      return runInInjectionContext(innerRsc, () => inject('reqProvider'));
    });
    const outerAgain = runInInjectionContext(outerRsc, () => inject('reqProvider'));

    // Assert — inner returned different instance, outer still cached
    expect(outerInstance).toBe(outerAgain);
    expect(innerFromNested).not.toBe(outerInstance);
  });

  it('should execute factory only once regardless of inject() call count', () => {
    // Arrange
    let factoryCallCount = 0;
    container.set('reqProvider', (_c: ZipbulContainer) => {
      factoryCallCount += 1;
      return { callNumber: factoryCallCount };
    }, { scope: 'request' });
    const rsc = container.createRequestScope('ctx-1');

    // Act — many inject() calls across multiple runInInjectionContext
    for (let iteration = 0; iteration < 20; iteration++) {
      runInInjectionContext(rsc, () => inject('reqProvider'));
    }

    // Assert
    expect(factoryCallCount).toBe(1);
  });
});
