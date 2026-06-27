import type { Server, SocketAddress } from 'bun';

/**
 * Minimal `Bun.Server` stand-in for in-process HTTP injection.
 *
 * The production HTTP `fetch(req, server)` path reads a small fixed set of
 * `server.*` members (`requestIP`, `timeout`, `port`, `hostname`, `stop`,
 * `pendingRequests`, `pendingWebSockets`, `upgrade`, `reload`). This stub
 * implements exactly those, treating every call as a no-op or returning a
 * neutral value so the production code path runs unchanged.
 *
 * @internal
 */
export function createStubBunServer(): Server<unknown> {
  const noop = (): void => {
    /* in-process inject — no socket-bound action */
  };

  return {
    development: true,
    hostname: 'localhost',
    port: 0,
    id: '',
    pendingRequests: 0,
    pendingWebSockets: 0,
    url: new URL('http://localhost'),
    requestIP(_req: Request): SocketAddress | null {
      return null;
    },
    timeout(_req: Request, _seconds: number): void {
      // setTimeout on injected requests is meaningless without a socket.
      noop();
    },
    async stop(_force?: boolean): Promise<void> {
      noop();
    },
    upgrade<T = undefined>(_req: Request, _options?: unknown): boolean {
      // Upgrade is unsupported on the stub; tests that need WebSocket must
      // use the WS adapter's own test surface.
      void _options; void _req;
      return false as unknown as ReturnType<Server<T>['upgrade']> as boolean;
    },
    reload<T = unknown>(_options: unknown): Server<T> {
      // No-op reload; return the same stub typed for the requested adapter.
      return this as unknown as Server<T>;
    },
    publish(): number {
      return 0;
    },
    subscriberCount(): number {
      return 0;
    },
    ref(): void { noop(); },
    unref(): void { noop(); },
    fetch(_req: Request): Response {
      // The stub itself never re-enters fetch; the toolkit drives fetch directly
      // on the adapter's HttpServer instance.
      return new Response(null, { status: 500 });
    },
  } as unknown as Server<unknown>;
}
