import { describe, it, expect, mock, afterAll, beforeAll } from 'bun:test';
import type { Context, ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';
import { defineMiddleware, defineGuard, err, getContext, contextKey } from '@zipbul/common';


/**
 * [OVERFLOW Checkpoint]
 * - Target: HttpAdapter + HttpServer full E2E (boot → real HTTP request → response)
 * - Branch count: 30+
 *   HttpServer.fetch():
 *     L662 socketIp normalization, L668 evaluateTrustProxy, L671 createHttpRequest,
 *     L681 bad-request invalid-url, L694 not-implemented, L697 bad-request,
 *     L701 dispatchRequest, L703 getNativeResponse ?? end(), L704 catch
 *   HttpAdapter.executePipeline():
 *     L191 OnRequest MW, L196 isSent(), L199 pipelineError,
 *     L203 resolveRoute, L206 isSent(), L213 BeforeParsing MW,
 *     L220 parseBody, L226 BeforeValidation MW, L232 validations,
 *     L237 guards, L242 BeforeHandler MW, L249 scoped MW,
 *     L256 route guards, L268 handler call
 *   HttpAdapter.handleResult():
 *     L557 isErr → writeErrorResponse, L560 writeSuccessResponse,
 *     L565 BeforeResponse MW, L578 runResponseFinalizers
 *   HttpAdapter.writeSuccessResponse():
 *     L719 AsyncIterable → SSE or raw, L784 Response passthrough,
 *     L789 undefined/null, L798 body value
 *   HttpAdapter.parseBody():
 *     L349 consumeRawRequest, L350 GET/HEAD, L351 DELETE/OPTIONS no CT,
 *     L356 CL=0, L360 Content-Encoding, L377 JSON charset,
 *     L395 rawBody + buffer, L421 buffer no rawBody, L469 streaming
 *   HttpAdapter.resolveRoute():
 *     L309 matchRoute, L311 not-found, L316 method-not-allowed,
 *     L317 OPTIONS auto-response, L324 405 Allow header
 *   HttpResponse.build():
 *     L298 redirect, L307 CT inference, L312 204/304, L319 JSON serialize,
 *     L333 HEAD CL, L351 auto 204
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. GET /json → 200 JSON (HttpAdapter.writeSuccessResponse L798 + HttpResponse.build L319), 2. POST /json → 201 JSON body parsed (HttpAdapter.parseBody L451 rawReq.json()), 3. HEAD /json → headers only with Content-Length (HttpResponse.build L333-348), 4. OPTIONS /json → 204 with Allow header (HttpAdapter.resolveRoute L317-319), 5. handler returns undefined → 204 (HttpResponse.build L351) |
 *   | NE  | 55    | 1. GET /nonexistent → 404 (HttpAdapter.resolveRoute L311-312), 2. POST /json with invalid JSON → 400 (HttpAdapter.parseBody L456-458), 3. PUT to GET-only route → 405 with Allow (HttpAdapter.resolveRoute L324-325), 4. handler throws → 500 (Adapter.dispatchRequest L284 catch), 5. body exceeds bodyLimit → 413 (HttpAdapter.parseBody L448-449) |
 *   | ED  | 50    | 1. GET with empty body → no body parsing (HttpAdapter.parseBody L350), 2. JSON body with non-UTF-8 charset → 400 (HttpAdapter.parseBody L377-389), 3. POST with Content-Encoding gzip → 415 (HttpAdapter.parseBody L360-364) |
 *   | CO  | 50    | 1. concurrent GET requests return independent responses (HttpServer.fetch L689 per-request context), 2. concurrent POST requests with different bodies are isolated (HttpContext constructor per-call), 3. concurrent requests with middleware state isolation (HttpContext.store per-instance) |
 *   | ST  | N/A: E2E tests exercise stateless request-response cycles; lifecycle transitions tested in request-scope-http-lifecycle.test.ts |
 *   | CR  | 50    | 1. parallel requests each get unique request IDs (HttpServer.fetch L671 createHttpRequest), 2. parallel requests with SSE don't interfere (writeSuccessResponse L726 per-request stream), 3. parallel POST requests parse bodies independently (parseBody per-context) |
 *   | ID  | 50    | 1. same GET request twice yields identical JSON (deterministic handler), 2. same POST body twice yields identical response (parseBody + handler deterministic), 3. same invalid JSON twice yields 400 both times (parseBody L456) |
 *   | OR  | 50    | 1. OnRequest MW headers appear before handler response (executePipeline L191 → L268), 2. response finalizer runs after response writing (handleResult L578), 3. BeforeResponse MW can modify headers before send (handleResult L566-569) |
 * - Total scenarios: 410
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 410
 * - Removed: 375
 * - Key removals (5+):
 *   1. HP-6~HP-55 repeat same routing/parsing paths with trivial variations; keeping HP-1~HP-12
 *   2. NE-6~NE-55 exercise same error detection branches; keeping NE-1~NE-9
 *   3. ED-4~ED-50 same boundary conditions on body parsing; keeping ED-1~ED-3
 *   4. CO-4~CO-50 same concurrency isolation; keeping CO-1
 *   5. CR-4~CR-50 same parallel uniqueness; keeping CR-1
 *   6. ID-4~ID-50 same idempotent response; keeping ID-1
 *   7. OR-4~OR-50 same ordering guarantees; keeping OR-1~OR-3
 *   8. HP SSE/streaming/Blob/Response/redirect variations consolidated to one test each
 * - Final test count: 35
 * - Final test list:
 *   1.  [HP] should return 200 JSON for GET request
 *   2.  [HP] should return 201 with parsed JSON body for POST request
 *   3.  [HP] should return text body for POST with text/plain
 *   4.  [HP] should return headers only with Content-Length for HEAD request
 *   5.  [HP] should return 204 with Allow header for OPTIONS request
 *   6.  [HP] should return 204 when handler returns undefined
 *   7.  [HP] should return 302 redirect with Location header
 *   8.  [HP] should return 301 redirect with explicit status
 *   9.  [HP] should passthrough native Response from handler
 *   10. [HP] should stream SSE events with @Sse flag
 *   11. [HP] should stream raw chunks without @Sse flag
 *   12. [HP] should return Blob as file download with Content-Disposition
 *   13. [NE] should return 404 for nonexistent route
 *   14. [NE] should return 405 with Allow header for wrong method
 *   15. [NE] should return 400 for invalid JSON body
 *   16. [NE] should return 413 when body exceeds global bodyLimit
 *   17. [NE] should return 413 when body exceeds route-level bodyLimit
 *   18. [NE] should return 415 for Content-Encoding other than identity
 *   19. [NE] should return 501 for unknown HTTP method
 *   20. [NE] should return 500 when handler throws
 *   21. [NE] should return 403 when guard rejects
 *   22. [ED] should handle GET with no body gracefully
 *   23. [ED] should return 400 for JSON body with non-UTF-8 charset
 *   24. [ED] should handle multiple Set-Cookie headers without comma-joining
 *   25. [CO] should isolate concurrent requests
 *   26. [CR] should assign unique request IDs to parallel requests
 *   27. [ID] should return identical response for repeated identical request
 *   28. [OR] should apply OnRequest middleware CORS headers to response
 *   29. [OR] should run response finalizer and add Set-Cookie to response
 *   30. [OR] should preserve finalizer headers on error response
 *   31. [OR] should apply BeforeResponse middleware modifications
 *   32. [OR] should run Cleanup middleware after response
 *   33. [HP] should apply @Status decorator default status code
 *   34. [HP] should apply @Header decorator static headers
 *   35. [HP] should apply @ContentType decorator to response
 */

// ── Logger mock ───────────────────────────────────────────────

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() {
      return { debug() {}, info() {}, warn() {}, error() {} };
    }
    static runScoped(_logger: unknown, fn: () => unknown) { return fn(); }
    constructor() {
      return { debug() {}, info() {}, warn() {}, error() {} } as never;
    }
  },
}));

mock.module('@zipbul/core', () => ({
  ClusterManager: class {},
  getRuntimeContext: () => ({
    isAotRuntime: false,
    metadataRegistry: new Map(),
  }),
}));

const { HttpAdapter } = await import('../src/http-adapter');
const { HttpServer } = await import('../src/http-server');
const { HttpContext } = await import('../src/http-context');
const { HttpPhase } = await import('../src/enums');
const { ServerSentEvent } = await import('../src/server-sent-event');

type HttpAdapterInstance = InstanceType<typeof HttpAdapter>;
type HttpServerInstance = InstanceType<typeof HttpServer>;

const RequestCount = contextKey<number>('request-count');

function deepServiceCall(): string {
  const ctx = getContext();
  const http = ctx.to(HttpContext);
  return http.request.path;
}

// ── Helpers ──────────────────────────────────────────────────

const TEST_PORT = 50000 + Math.floor(Math.random() * 10000);
const BASE_URL = `http://localhost:${TEST_PORT}`;

function createMockContainer(): ZipbulContainer {
  return {
    get: () => undefined,
    set: () => {},
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  } as unknown as ZipbulContainer;
}

/**
 * Controller class stub registered in the metadata registry.
 * The class name must match the controllerKey in handlerIndex entries.
 */
class TestController {
  [key: string]: unknown;
}

interface ControllerMethod {
  readonly name: string;
  readonly handler: (ctx: InstanceType<typeof HttpContext>) => unknown;
}

interface RouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly controllerMethod: ControllerMethod;
  readonly options?: ReadonlyArray<{ readonly name: string; readonly arguments?: readonly unknown[] }>;
}

function buildHandlerIndex(routes: readonly RouteDefinition[]): {
  readonly handlerIndex: readonly CompiledHandlerEntry[];
  readonly controllerInstances: Map<string, unknown>;
  readonly metadata: Map<new (...args: readonly unknown[]) => unknown, { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }>;
} {
  const controllerInstance: Record<string, unknown> = {};
  const controllerInstances = new Map<string, unknown>();

  for (const route of routes) {
    controllerInstance[route.controllerMethod.name] = route.controllerMethod.handler;
  }

  controllerInstances.set('TestController', controllerInstance);

  const handlerIndex: CompiledHandlerEntry[] = routes.map((route) => ({
    id: `HttpAdapter:TestController.${route.controllerMethod.name}`,
    adapterId: 'HttpAdapter',
    controllerKey: 'TestController',
    methodName: route.controllerMethod.name,
    handlerDecorator: route.method,
    handlerDecoratorArgs: [route.path],
    options: route.options as CompiledHandlerEntry['options'],
  }));

  const metadata = new Map<
    new (...args: readonly unknown[]) => unknown,
    { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }
  >();
  metadata.set(TestController, {
    className: 'TestController',
    decorators: [{ name: 'RestController', arguments: [] }],
  });

  return { handlerIndex, controllerInstances, metadata };
}

// ── E2E Test Suite ──────────────────────────────────────────

describe('HttpAdapter E2E', () => {
  let adapter: HttpAdapterInstance;
  let server: HttpServerInstance;
  const cleanupMiddlewareCalls: string[] = [];

  beforeAll(async () => {
    adapter = new HttpAdapter({ port: TEST_PORT, bodyLimit: 1024 });

    // OnRequest CORS middleware
    adapter.addMiddlewares(HttpPhase.OnRequest, [
      defineMiddleware(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        http.response.setHeader('access-control-allow-origin', '*');
        return undefined;
      }),
      defineMiddleware(() => (ctx: Context) => {
        ctx.set(RequestCount, 42);
        return undefined;
      }),
    ]);

    // BeforeResponse middleware
    adapter.addMiddlewares(HttpPhase.BeforeResponse, [
      defineMiddleware(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        http.response.setHeader('x-before-response', 'applied');
        return undefined;
      }),
    ]);

    // Cleanup middleware
    adapter.addMiddlewares(HttpPhase.Cleanup, [
      defineMiddleware(() => (_ctx: Context) => {
        cleanupMiddlewareCalls.push('cleanup-ran');
        return undefined;
      }),
    ]);

    // Global guard that rejects /guarded path
    adapter.addGuards([
      defineGuard(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        if (http.request.path === '/guarded') {
          return err({ status: 403, message: 'Forbidden' });
        }
        return undefined;
      }),
    ]);

    const container = createMockContainer();
    adapter.initializePipeline(container);

    const routes: RouteDefinition[] = [
      {
        method: 'Get',
        path: 'json',
        controllerMethod: {
          name: 'getJson',
          handler: () => ({ message: 'hello', count: 42 }),
        },
      },
      {
        method: 'Post',
        path: 'echo',
        controllerMethod: {
          name: 'postEcho',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(201);
            return { received: ctx.request.body };
          },
        },
      },
      {
        method: 'Post',
        path: 'text',
        controllerMethod: {
          name: 'postText',
          handler: (ctx: InstanceType<typeof HttpContext>) => ctx.request.body,
        },
      },
      {
        method: 'Get',
        path: 'empty',
        controllerMethod: {
          name: 'getEmpty',
          handler: () => undefined,
        },
      },
      {
        method: 'Get',
        path: 'redirect-default',
        controllerMethod: {
          name: 'getRedirectDefault',
          handler: () => undefined,
        },
        options: [{ name: 'Redirect', arguments: ['/target'] }],
      },
      {
        method: 'Get',
        path: 'redirect-301',
        controllerMethod: {
          name: 'getRedirect301',
          handler: () => undefined,
        },
        options: [{ name: 'Redirect', arguments: ['/target', 301] }],
      },
      {
        method: 'Get',
        path: 'native-response',
        controllerMethod: {
          name: 'getNativeResponse',
          handler: () => new Response('native body', {
            status: 200,
            headers: { 'x-custom': 'native' },
          }),
        },
      },
      {
        method: 'Get',
        path: 'sse',
        controllerMethod: {
          name: 'getSse',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent({ value: 1 }, { event: 'tick' });
              yield new ServerSentEvent({ value: 2 }, { event: 'tick', id: 'msg-2' });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'raw-stream',
        controllerMethod: {
          name: 'getRawStream',
          handler: () => {
            async function* generate() {
              yield 'line1\n';
              yield 'line2\n';
            }
            return generate();
          },
        },
        options: [{ name: 'ContentType', arguments: ['text/csv'] }],
      },
      {
        method: 'Get',
        path: 'blob',
        controllerMethod: {
          name: 'getBlob',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
            ctx.response.setHeader('content-disposition', 'attachment; filename="test.zip"');
            ctx.response.setBody(new Blob([data], { type: 'application/zip' }));
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'throw',
        controllerMethod: {
          name: 'getThrow',
          handler: () => { throw new Error('handler crash'); },
        },
      },
      {
        method: 'Get',
        path: 'guarded',
        controllerMethod: {
          name: 'getGuarded',
          handler: () => ({ data: 'secret' }),
        },
      },
      {
        method: 'Post',
        path: 'small-body',
        controllerMethod: {
          name: 'postSmallBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ received: ctx.request.body }),
        },
        options: [{ name: 'BodyLimit', arguments: [32] }],
      },
      {
        method: 'Get',
        path: 'finalizer',
        controllerMethod: {
          name: 'getFinalizer',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.addResponseFinalizer('set-cookie', () => {
              ctx.response.appendHeader('set-cookie', 'session=abc123; Path=/');
              ctx.response.appendHeader('set-cookie', 'theme=dark; Path=/');
            });
            return { ok: true };
          },
        },
      },
      {
        method: 'Get',
        path: 'finalizer-error',
        controllerMethod: {
          name: 'getFinalizerError',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.addResponseFinalizer('add-header', () => {
              ctx.response.setHeader('x-finalizer', 'ran');
            });
            return err({ status: 422, message: 'Validation failed' });
          },
        },
      },
      {
        method: 'Get',
        path: 'concurrent/:id',
        controllerMethod: {
          name: 'getConcurrent',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            id: ctx.request.params['id'],
            requestId: ctx.request.requestId,
          }),
        },
      },
      {
        method: 'Get',
        path: 'status-decorator',
        controllerMethod: {
          name: 'getStatusDecorator',
          handler: () => ({ created: true }),
        },
        options: [{ name: 'Status', arguments: [201] }],
      },
      {
        method: 'Get',
        path: 'header-decorator',
        controllerMethod: {
          name: 'getHeaderDecorator',
          handler: () => ({ ok: true }),
        },
        options: [
          { name: 'Header', arguments: ['x-custom-header', 'custom-value'] },
          { name: 'Header', arguments: ['x-another', 'another-value'] },
        ],
      },
      {
        method: 'Get',
        path: 'content-type-decorator',
        controllerMethod: {
          name: 'getContentTypeDecorator',
          handler: () => '<root><msg>hello</msg></root>',
        },
        options: [{ name: 'ContentType', arguments: ['application/xml'] }],
      },
      {
        method: 'Get',
        path: 'rate-limited',
        controllerMethod: {
          name: 'getRateLimited',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(429);
            ctx.response.setBody({ message: 'Too Many Requests' });
            ctx.response.send();
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'context-access',
        controllerMethod: {
          name: 'getContextAccess',
          handler: () => ({ path: deepServiceCall() }),
        },
      },
      {
        method: 'Get',
        path: 'context-key',
        controllerMethod: {
          name: 'getContextKey',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ count: ctx.get(RequestCount) }),
        },
      },
      {
        method: 'Get',
        path: 'emergency',
        controllerMethod: {
          name: 'getEmergency',
          handler: () => { throw new Error('boom'); },
        },
      },
      {
        method: 'Get',
        path: 'finalizer-throw',
        controllerMethod: {
          name: 'getFinalizerThrow',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.addResponseFinalizer('f1', () => {
              ctx.response.setHeader('x-f1', 'yes');
            });
            ctx.addResponseFinalizer('f2', () => {
              throw new Error('finalizer crash');
            });
            ctx.addResponseFinalizer('f3', () => {
              ctx.response.setHeader('x-f3', 'yes');
            });
            return { ok: true };
          },
        },
      },
      {
        method: 'Delete',
        path: 'items/:id',
        controllerMethod: {
          name: 'deleteItem',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            deleted: ctx.request.params['id'],
          }),
        },
      },
      {
        method: 'Put',
        path: 'items/:id',
        controllerMethod: {
          name: 'putItem',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            updated: ctx.request.params['id'],
            body: ctx.request.body,
          }),
        },
      },
      {
        method: 'Patch',
        path: 'items/:id',
        controllerMethod: {
          name: 'patchItem',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            patched: ctx.request.params['id'],
            body: ctx.request.body,
          }),
        },
      },
      {
        method: 'Post',
        path: 'webhook',
        controllerMethod: {
          name: 'postWebhook',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            hasRawBody: ctx.request.rawBody instanceof Uint8Array,
            bodyLength: ctx.request.rawBody?.byteLength,
          }),
        },
        options: [{ name: 'RawBody' }],
      },
      {
        method: 'Get',
        path: 'native-cors',
        controllerMethod: {
          name: 'getNativeCors',
          handler: () => new Response('native', {
            status: 201,
            headers: { 'x-handler': 'yes' },
          }),
        },
      },
      {
        method: 'Get',
        path: 'send-only',
        controllerMethod: {
          name: 'getSendOnly',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.send();
            return undefined;
          },
        },
      },
    ];

    const { handlerIndex, controllerInstances, metadata } = buildHandlerIndex(routes);

    server = new HttpServer();
    await server.boot(container, {
      port: TEST_PORT,
      bodyLimit: 1024,
      metadata: metadata as never,
      handlerIndex,
      controllerInstances,
    }, adapter as never);
  });

  afterAll(() => {
    server.stop();
  });

  // ── HP: Happy Path ─────────────────────────────────────────

  it('should return 200 JSON for GET request', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should return 201 with parsed JSON body for POST request', async () => {
    // Arrange
    const payload = { name: 'test', value: 123 };

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should return text body for POST with text/plain', async () => {
    // Arrange
    const text = 'Hello, plain text!';

    // Act
    const response = await fetch(`${BASE_URL}/text`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: text,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(text);
  });

  it('should return headers only with Content-Length for HEAD request', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    const contentLength = response.headers.get('content-length');
    expect(contentLength).not.toBeNull();
    expect(Number(contentLength)).toBeGreaterThan(0);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return 204 with Allow header for OPTIONS request', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'OPTIONS' });

    // Assert
    expect(response.status).toBe(204);
    const allow = response.headers.get('allow');
    expect(allow).not.toBeNull();
    expect(allow).toContain('GET');
    expect(allow).toContain('HEAD');
  });

  it('should return 204 when handler returns undefined', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/empty`);

    // Assert
    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return 302 redirect with Location header', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-default`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/target');
  });

  it('should return 301 redirect with explicit status', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-301`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/target');
  });

  it('should passthrough native Response from handler', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/native-response`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('native body');
    expect(response.headers.get('x-custom')).toBe('native');
  });

  it('should stream SSE events with @Sse flag', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);

    // Assert
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const body = await response.text();
    expect(body).toContain('event: tick');
    expect(body).toContain('data: {"value":1}');
    expect(body).toContain('data: {"value":2}');
    expect(body).toContain('id: msg-2');
  });

  it('should stream raw chunks without @Sse flag', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream`);

    // Assert
    const body = await response.text();
    expect(body).toBe('line1\nline2\n');
  });

  it('should return Blob as file download with Content-Disposition', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/blob`);

    // Assert
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('test.zip');
    const contentLength = response.headers.get('content-length');
    expect(contentLength).toBe('4');
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  // ── NE: Negative / Error ───────────────────────────────────

  it('should return 404 for nonexistent route', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/nonexistent`);

    // Assert
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toContain('Route not found');
  });

  it('should return 405 with Allow header for wrong method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(405);
    const allow = response.headers.get('allow');
    expect(allow).not.toBeNull();
    expect(allow).toContain('GET');
  });

  it('should return 400 for invalid JSON body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid json!!!}',
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid JSON');
  });

  it('should return 413 when body exceeds global bodyLimit', async () => {
    // Arrange — global bodyLimit is 1024 bytes
    const largeBody = JSON.stringify({ data: 'x'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.message).toContain('size limit');
  });

  it('should return 413 when body exceeds route-level bodyLimit', async () => {
    // Arrange — route bodyLimit is 32 bytes
    const body = JSON.stringify({ data: 'x'.repeat(100) });

    // Act
    const response = await fetch(`${BASE_URL}/small-body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Assert
    expect(response.status).toBe(413);
  });

  it('should return 415 for Content-Encoding other than identity', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.message).toContain('Content-Encoding');
    expect(response.headers.get('accept-encoding')).toBe('identity');
  });

  it('should return 501 for unknown HTTP method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'PURGE' });

    // Assert
    expect(response.status).toBe(501);
  });

  it('should return 500 when handler throws', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/throw`);

    // Assert
    expect(response.status).toBe(500);
  });

  it('should return 403 when guard rejects', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/guarded`);

    // Assert
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toBe('Forbidden');
  });

  // ── ED: Edge Cases ─────────────────────────────────────────

  it('should handle GET with no body gracefully', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, {
      method: 'GET',
      headers: { 'content-length': '0' },
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
  });

  it('should return 400 for JSON body with non-UTF-8 charset', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=iso-8859-1' },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('UTF-8');
  });

  it('should handle multiple Set-Cookie headers without comma-joining', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer`);

    // Assert
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(2);
    expect(setCookies.some(cookie => cookie.includes('session=abc123'))).toBe(true);
    expect(setCookies.some(cookie => cookie.includes('theme=dark'))).toBe(true);
  });

  // ── CO: Concurrency ────────────────────────────────────────

  it('should isolate concurrent requests', async () => {
    // Arrange
    const ids = Array.from({ length: 10 }, (_, index) => String(index));

    // Act
    const responses = await Promise.all(
      ids.map(id => fetch(`${BASE_URL}/concurrent/${id}`).then(res => res.json())),
    );

    // Assert
    const returnedIds = responses.map((res: { id: string }) => res.id);
    expect(new Set(returnedIds).size).toBe(10);
    for (const id of ids) {
      expect(returnedIds).toContain(id);
    }
  });

  // ── CR: Concurrency / Race ─────────────────────────────────

  it('should assign unique request IDs to parallel requests', async () => {
    // Arrange & Act
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        fetch(`${BASE_URL}/concurrent/${index}`).then(res => res.json()),
      ),
    );

    // Assert
    const requestIds = responses.map((res: { requestId: string }) => res.requestId);
    const uniqueIds = new Set(requestIds);
    expect(uniqueIds.size).toBe(20);
  });

  // ── ID: Idempotency ────────────────────────────────────────

  it('should return identical response for repeated identical request', async () => {
    // Arrange & Act
    const response1 = await fetch(`${BASE_URL}/json`);
    const response2 = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response1.status).toBe(response2.status);
    const body1 = await response1.json();
    const body2 = await response2.json();
    expect(body1).toEqual(body2);
  });

  // ── OR: Ordering ───────────────────────────────────────────

  it('should apply OnRequest middleware CORS headers to response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should run response finalizer and add Set-Cookie to response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer`);

    // Assert
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(1);
  });

  it('should preserve finalizer headers on error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer-error`);

    // Assert
    expect(response.status).toBe(422);
    expect(response.headers.get('x-finalizer')).toBe('ran');
  });

  it('should apply BeforeResponse middleware modifications', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run Cleanup middleware after response', async () => {
    // Arrange
    const countBefore = cleanupMiddlewareCalls.length;

    // Act
    await fetch(`${BASE_URL}/json`);
    // Small delay to allow Cleanup phase to execute (it runs after response)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert
    expect(cleanupMiddlewareCalls.length).toBeGreaterThan(countBefore);
  });

  // ── HP: Decorator metadata ─────────────────────────────────

  it('should apply @Status decorator default status code', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/status-decorator`);

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ created: true });
  });

  it('should apply @Header decorator static headers', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/header-decorator`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-custom-header')).toBe('custom-value');
    expect(response.headers.get('x-another')).toBe('another-value');
  });

  it('should apply @ContentType decorator to response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/content-type-decorator`);

    // Assert
    expect(response.status).toBe(200);
    const contentType = response.headers.get('content-type');
    expect(contentType).toContain('application/xml');
    const body = await response.text();
    expect(body).toContain('<root>');
  });

  // ── HP: send() short-circuit ───────────────────────────────

  it('should short-circuit pipeline when handler calls send()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/rate-limited`);

    // Assert
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toEqual({ message: 'Too Many Requests' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ── HP: getContext() from service layer ─────────────────────

  it('should resolve current context via getContext() in deep call', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/context-access`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ path: '/context-access' });
  });

  // ── HP: ContextKey middleware state sharing ─────────────────

  it('should share state between middleware and handler via ContextKey', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/context-key`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ count: 42 });
  });

  // ── NE: CORS headers preserved on handler throw ────────────

  it('should preserve CORS headers when handler throws', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/emergency`);

    // Assert
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ── OR: Finalizer throw isolation ──────────────────────────

  it('should isolate finalizer throw and run remaining finalizers', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer-throw`);

    // Assert — LIFO: F3 runs first, then F2 throws, then F1 runs
    expect(response.status).toBe(200);
    expect(response.headers.get('x-f1')).toBe('yes');
    expect(response.headers.get('x-f3')).toBe('yes');
  });

  // ── HP: DELETE method ──────────────────────────────────────

  it('should handle DELETE method with path params', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/42`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: '42' });
  });

  // ── HP: PUT method ─────────────────────────────────────────

  it('should handle PUT method with JSON body and path params', async () => {
    // Arrange
    const payload = { name: 'updated' };

    // Act
    const response = await fetch(`${BASE_URL}/items/7`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ updated: '7', body: payload });
  });

  // ── HP: PATCH method ───────────────────────────────────────

  it('should handle PATCH method with JSON body and path params', async () => {
    // Arrange
    const payload = { status: 'active' };

    // Act
    const response = await fetch(`${BASE_URL}/items/3`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ patched: '3', body: payload });
  });

  // ── HP: @RawBody decorator ─────────────────────────────────

  it('should provide rawBody as Uint8Array when @RawBody is enabled', async () => {
    // Arrange
    const payload = JSON.stringify({ webhook: 'data' });

    // Act
    const response = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasRawBody).toBe(true);
    expect(body.bodyLength).toBe(new TextEncoder().encode(payload).byteLength);
  });

  // ── HP: Native Response + CORS lazy merge ──────────────────

  it('should merge CORS headers into native Response from handler', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/native-cors`);

    // Assert
    expect(response.status).toBe(201);
    expect(response.headers.get('x-handler')).toBe('yes');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ── NE: 501 with CORS ─────────────────────────────────────

  it('should include CORS headers on 501 for unknown method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'PURGE' });

    // Assert
    expect(response.status).toBe(501);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ── HP: send() only → 204 ─────────────────────────────────

  it('should return 204 when handler only calls send() with no body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/send-only`);

    // Assert
    expect(response.status).toBe(204);
  });
});
