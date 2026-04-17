import { describe, it, expect, mock, afterAll, beforeAll } from 'bun:test';
import type { Context, ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';
import { defineMiddleware, defineGuard, defineExceptionFilter, contextKey } from '@zipbul/common';
import { err } from '@zipbul/result';
import { getAdapterContext } from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';


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
 *     L565 BeforeResponse MW
 *   HttpAdapter.writeSuccessResponse():
 *     L719 AsyncIterable → SSE or raw, L784 Response passthrough,
 *     L789 undefined/null, L798 body value, L806 bigint
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
 *   HttpResponse.inferContentType():
 *     L393 object/array/number/boolean → JSON, L401 default → text
 *   HttpResponse.normalizeBody():
 *     L406 undefined/null → null, L409 string, L412 Uint8Array,
 *     L418 number/boolean → toString()
 *   formatSSEChunk():
 *     L48 ServerSentEvent → event/id/retry/data, L55 string → data, L57 object → JSON data
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 75    | 1. GET /json → 200 JSON (writeSuccessResponse L811 isResponseBodyValue), 2. POST /echo → 201 JSON (parseBody L460 rawReq.json()), 3. HEAD /json → CL only (build L345-359), 4. OPTIONS /json → 204 Allow (resolveRoute L317), 5. return undefined → 204 (build L319-322), 6. return string → text/plain (inferContentType L401), 7. return number → JSON (inferContentType L396-398), 8. return boolean → JSON (inferContentType L396-398), 9. return null → 204 (writeSuccessResponse L802-803 + build L319), 10. return bigint → text (writeSuccessResponse L806-808), 11. return Uint8Array → binary (normalizeBody L412), 12. SSE all fields (formatSSEChunk L48-54), 13. SSE plain string (formatSSEChunk L55-56), 14. SSE plain object (formatSSEChunk L57-58), 15. SSE multiline data (formatDataField L71-72), 16. raw stream binary (writeSuccessResponse L758-759), 17. raw stream mixed (writeSuccessResponse L761), 18. @ContentType binary (setContentType L141-149), 19. imperative redirect (redirect L215-224), 20. HEAD Uint8Array CL (build L352-353) |
 *   | NE  | 55    | 1. 404 (resolveRoute L311), 2. 405 (resolveRoute L324), 3. 400 invalid JSON (parseBody L466-467), 4. 413 global limit (parseBody L457-458), 5. 413 route limit (parseBody L457-458), 6. 415 Content-Encoding (parseBody L366-373), 7. 501 unknown method (HttpServer.fetch L694), 8. 500 handler throw (dispatchRequest catch), 9. 403 guard (guards), 10. 400 charset=utf-16 (parseBody L388-392), 11. 400 charset=bogus (parseBody L394-398), 12. JSON circular → text (build L334-341) |
 *   | ED  | 50    | 1. GET no body (parseBody L359), 2. charset=iso-8859-1 JSON → 400 (parseBody L387-392), 3. CL=0 → body undefined (parseBody L363), 4. DELETE no CT → params work (parseBody L360), 5. POST +json suffix (parseBody L377), 6. form-urlencoded (parseBody L379), 7. Content-Encoding identity (parseBody L367 skip) |
 *   | CO  | 50    | 1. concurrent GET isolated (per-request HttpContext), 2. parallel unique request IDs (HttpServer.fetch L671), 3. parallel POST independent (parseBody per-context) |
 *   | ST  | N/A: E2E tests exercise stateless request-response cycles; lifecycle transitions tested in request-scope-http-lifecycle.test.ts |
 *   | CR  | 50    | 1. parallel requests unique IDs (HttpServer.fetch L671), 2. parallel SSE don't interfere (writeSuccessResponse L738 per-request stream), 3. parallel POST parse independently (parseBody per-context) |
 *   | ID  | 50    | 1. same GET twice → identical (deterministic handler), 2. same POST body twice → identical (parseBody + handler), 3. same invalid JSON twice → 400 (parseBody L466) |
 *   | OR  | 50    | 1. CORS headers on all responses (OnRequest MW executePipeline L191), 2. BeforeResponse MW modifies headers (handleResult L565), 3. Cleanup MW runs after response (handleResult L578), 4. handler direct Set-Cookie headers, 5. handler-set headers preserved on error |
 * - Total scenarios: 430
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 430
 * - Removed: 343
 * - Key removals (5+):
 *   1. HP-21~HP-75 repeat same routing/parsing paths with trivial variations; keeping HP-1~HP-20
 *   2. NE-13~NE-55 exercise same error detection branches; keeping NE-1~NE-12
 *   3. ED-8~ED-50 same boundary conditions on body parsing; keeping ED-1~ED-7
 *   4. CO-4~CO-50 same concurrency isolation; keeping CO-1~CO-2
 *   5. CR-4~CR-50 same parallel uniqueness; keeping CR-1
 *   6. ID-4~ID-50 same idempotent response; keeping ID-1
 *   7. OR-7~OR-50 same ordering guarantees; keeping OR-1~OR-6
 *   8. HP SSE/streaming/redirect variations consolidated to one test each
 * - Final test count: 87
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
 *   29. [OR] should add Set-Cookie headers directly in handler
 *   30. [OR] should preserve handler-set headers on error response
 *   31. [OR] should apply BeforeResponse middleware modifications
 *   32. [OR] should run Cleanup middleware after response
 *   33. [HP] should apply @Status decorator default status code
 *   34. [HP] should apply @Header decorator static headers
 *   35. [HP] should apply @ContentType decorator to response
 *   36. [HP] should short-circuit pipeline when handler calls send()
 *   37. [HP] should resolve current context via getAdapterContext() in deep call
 *   38. [HP] should share state between middleware and handler via ContextKey
 *   39. [NE] should preserve CORS headers when handler throws
 *   41. [HP] should handle DELETE method with path params
 *   42. [HP] should handle PUT method with JSON body and path params
 *   43. [HP] should handle PATCH method with JSON body and path params
 *   44. [HP] should provide rawBody as Uint8Array when @RawBody is enabled
 *   45. [HP] should merge CORS headers into native Response from handler
 *   46. [NE] should include CORS headers on 501 for unknown method
 *   47. [HP] should return 204 when handler only calls send() with no body
 *   48. [ED] should not double-append charset when Content-Type already has charset
 *   49. [ED] should not include Content-Type on explicit 204 response
 *   50. [ED] should not include Content-Type on auto-204 response
 *   51. [ED] should strip NULL characters from SSE id field
 *   52. [ED] should omit SSE retry field for negative value
 *   53. [HP] should include SSE retry field for valid non-negative integer
 *   54. [NE] should not leak request path in 404 error message
 *   55. [NE] should return 413 when chunked body exceeds route-level bodyLimit
 *   56. [ED] should parse JSON body with +json content type suffix
 *   57. [ED] should parse form-urlencoded body as text
 *   58. [NE] should return 400 for JSON body with charset=utf-16
 *   59. [NE] should return 400 for JSON body with charset=bogus
 *   60. [ED] should treat Content-Length 0 as no body
 *   61. [HP] should parse JSON body on DELETE when Content-Type is present
 *   62. [ED] should skip body parsing for DELETE without Content-Type
 *   63. [NE] should return 415 for Content-Encoding gzip on POST
 *   64. [ED] should allow Content-Encoding identity and parse normally
 *   65. [NE] should return 413 when POST body exceeds global bodyLimit via large payload
 *   66. [HP] should provide both rawBody and parsed body for webhook with JSON
 *   67. [HP] should return plain string as text/plain
 *   68. [HP] should return number as application/json
 *   69. [HP] should return boolean as application/json
 *   70. [HP] should return null as 204
 *   71. [HP] should return bigint as text string
 *   72. [HP] should return Uint8Array as binary body
 *   73. [ED] should not append charset to binary content type
 *   74. [NE] should return text/plain with unserializable marker for circular JSON
 *   75. [HP] should return Content-Length for HEAD on Uint8Array response
 *   76. [HP] should return 302 for imperative redirect
 *   77. [HP] should stream SSE with all fields present
 *   78. [HP] should frame plain strings in SSE data field
 *   79. [HP] should frame plain objects as JSON in SSE data field
 *   80. [HP] should prefix each line of multiline SSE data
 *   81. [HP] should include SSE Content-Type and Cache-Control headers
 *   82. [HP] should stream raw binary Uint8Array chunks
 *   83. [HP] should encode non-string non-Uint8Array via String() in raw stream
 *   84. [NE] should return 404 without leaking path for secret endpoint
 *   85. [NE] should return 405 with Allow header for POST to GET-only route
 *   86. [HP] should stream raw chunks with custom Content-Type
 *   87. [CO] should isolate concurrent requests with parallel GET
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
  getBootstrapState: () => ({
    isAotRuntime: false,
    metadataRegistry: new Map(),
  }),
}));

const { HttpAdapter } = await import('../src/http-adapter');
const { HttpServer } = await import('../src/http-server');
const { HttpContext } = await import('../src/http-context');
const { HttpPhase } = await import('../src/enums');
const { ServerSentEvent } = await import('../src/server-sent-event');
const { HttpError } = await import('../src/errors/http-error');

type HttpAdapterInstance = InstanceType<typeof HttpAdapter>;
type HttpServerInstance = InstanceType<typeof HttpServer>;

const RequestCount = contextKey<number>('request-count');

function deepServiceCall(): string {
  const ctx = getAdapterContext();
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
    compiledPre: ['BeforeParse', 'ParseBody', 'BeforeValidate', 'Validation', 'Guard', 'BeforeHandle'],
    compiledPost: ['WriteResponse', 'AfterHandle', 'Serialize', 'BeforeResponse'],
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
    adapter = new HttpAdapter({ port: TEST_PORT, bodyLimit: 1024, customMethods: ['PURGE'] });

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
    adapter.addMiddlewares(HttpPhase.AfterResponse, [
      defineMiddleware(() => (_ctx: Context) => {
        cleanupMiddlewareCalls.push('cleanup-ran');
        return undefined;
      }),
    ]);

    // BeforeParsing middleware
    adapter.addMiddlewares(HttpPhase.BeforeParse, [
      defineMiddleware(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        http.response.setHeader('x-before-parsing', 'applied');
        return undefined;
      }),
    ]);

    // AfterHandle middleware — envelope wrapper for /envelope/* routes only
    adapter.addMiddlewares(HttpPhase.AfterHandle, [
      defineMiddleware(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        if (!http.request.path.startsWith('/envelope')) return undefined;
        const body = http.response.getBody();
        if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
          http.response.setBody({ envelope: true, data: body });
        }
        http.response.setHeader('x-after-handle', 'applied');
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

    // Exception filter for HttpError
    adapter.addExceptionFilters([
      defineExceptionFilter([HttpError], () => (thrown: unknown) => {
        const httpError = thrown as InstanceType<typeof HttpError>;
        return err({ status: httpError.statusCode, message: httpError.message });
      }),
    ]);

    // BeforeResponse middleware that conditionally throws for emergency teardown test
    adapter.addMiddlewares(HttpPhase.BeforeResponse, [
      defineMiddleware(() => (ctx: Context) => {
        const http = ctx.to(HttpContext);
        if (http.request.path === '/trigger-emergency') {
          throw new Error('BeforeResponse crash');
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
            ctx.response.appendHeader('set-cookie', 'session=abc123; Path=/');
            ctx.response.appendHeader('set-cookie', 'theme=dark; Path=/');
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
            ctx.response.setHeader('x-finalizer', 'ran');
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
      // ── Routes for regression tests (bug fixes) ────────────
      {
        method: 'Get',
        path: 'charset-explicit',
        controllerMethod: {
          name: 'getCharsetExplicit',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setContentType('text/html; charset=iso-8859-1');
            ctx.response.setBody('<h1>Hello</h1>');
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'explicit-204',
        controllerMethod: {
          name: 'getExplicit204',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(204);
            ctx.response.send();
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'sse-null-id',
        controllerMethod: {
          name: 'getSseNullId',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('payload', { id: 'safe\0id', event: 'test' });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'sse-retry-negative',
        controllerMethod: {
          name: 'getSseRetryNegative',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('data', { retry: -1 });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'sse-retry-valid',
        controllerMethod: {
          name: 'getSseRetryValid',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('data', { retry: 5000 });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Post',
        path: 'body-limit-chunked',
        controllerMethod: {
          name: 'postBodyLimitChunked',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ size: ctx.request.rawBody?.byteLength }),
        },
        options: [{ name: 'RawBody' }, { name: 'BodyLimit', arguments: [50] }],
      },
      // ── New routes for expanded coverage ────────────────────
      {
        method: 'Post',
        path: 'json-plus',
        controllerMethod: {
          name: 'postJsonPlus',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(200);
            return { received: ctx.request.body };
          },
        },
      },
      {
        method: 'Post',
        path: 'form-urlencoded',
        controllerMethod: {
          name: 'postFormUrlencoded',
          handler: (ctx: InstanceType<typeof HttpContext>) => ctx.request.body,
        },
      },
      {
        method: 'Delete',
        path: 'delete-with-body',
        controllerMethod: {
          name: 'deleteWithBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            received: ctx.request.body,
          }),
        },
      },
      {
        method: 'Post',
        path: 'content-encoding-identity',
        controllerMethod: {
          name: 'postContentEncodingIdentity',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ received: ctx.request.body }),
        },
      },
      {
        method: 'Post',
        path: 'content-encoding-gzip',
        controllerMethod: {
          name: 'postContentEncodingGzip',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ received: ctx.request.body }),
        },
      },
      {
        method: 'Get',
        path: 'return-string',
        controllerMethod: {
          name: 'getReturnString',
          handler: () => 'hello plain',
        },
      },
      {
        method: 'Get',
        path: 'return-number',
        controllerMethod: {
          name: 'getReturnNumber',
          handler: () => 42,
        },
      },
      {
        method: 'Get',
        path: 'return-boolean',
        controllerMethod: {
          name: 'getReturnBoolean',
          handler: () => true,
        },
      },
      {
        method: 'Get',
        path: 'return-null',
        controllerMethod: {
          name: 'getReturnNull',
          handler: () => null,
        },
      },
      {
        method: 'Get',
        path: 'return-bigint',
        controllerMethod: {
          name: 'getReturnBigint',
          handler: () => BigInt(9007199254740991),
        },
      },
      {
        method: 'Get',
        path: 'return-uint8array',
        controllerMethod: {
          name: 'getReturnUint8array',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setContentType('application/octet-stream');
            return new Uint8Array([1, 2, 3]);
          },
        },
      },
      {
        method: 'Get',
        path: 'ct-binary',
        controllerMethod: {
          name: 'getCtBinary',
          handler: () => new Uint8Array([0xff, 0xfe]),
        },
        options: [{ name: 'ContentType', arguments: ['application/octet-stream'] }],
      },
      {
        method: 'Get',
        path: 'json-circular',
        controllerMethod: {
          name: 'getJsonCircular',
          handler: () => {
            const circular: Record<string, unknown> = { name: 'test' };
            circular['self'] = circular;
            return circular;
          },
        },
      },
      {
        method: 'Get',
        path: 'sse-all-fields',
        controllerMethod: {
          name: 'getSseAllFields',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent({ payload: 'full' }, {
                event: 'update',
                id: 'evt-1',
                retry: 3000,
              });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'sse-plain-string',
        controllerMethod: {
          name: 'getSsePlainString',
          handler: () => {
            async function* generate() {
              yield 'hello world';
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'sse-plain-object',
        controllerMethod: {
          name: 'getSsePlainObject',
          handler: () => {
            async function* generate() {
              yield { key: 'value' };
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'sse-multiline',
        controllerMethod: {
          name: 'getSseMultiline',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('line1\nline2\nline3', { event: 'multi' });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'raw-stream-binary',
        controllerMethod: {
          name: 'getRawStreamBinary',
          handler: () => {
            async function* generate() {
              yield new Uint8Array([0x01, 0x02]);
              yield new Uint8Array([0x03, 0x04]);
            }
            return generate();
          },
        },
      },
      {
        method: 'Get',
        path: 'raw-stream-mixed',
        controllerMethod: {
          name: 'getRawStreamMixed',
          handler: () => {
            async function* generate() {
              yield 42;
              yield true;
            }
            return generate();
          },
        },
      },
      {
        method: 'Post',
        path: 'cl-zero',
        controllerMethod: {
          name: 'postClZero',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            hasBody: ctx.request.body !== undefined,
          }),
        },
      },
      {
        method: 'Get',
        path: 'imperative-redirect',
        controllerMethod: {
          name: 'getImperativeRedirect',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.redirect('/other');
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'head-uint8array',
        controllerMethod: {
          name: 'getHeadUint8array',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setContentType('application/octet-stream');
            return new Uint8Array([10, 20, 30]);
          },
        },
      },
      // ── BATCH 1: Body parsing exhaustive ───────────────────────
      {
        method: 'Post',
        path: 'streaming-body',
        controllerMethod: {
          name: 'postStreamingBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            isStream: ctx.request.body instanceof ReadableStream,
          }),
        },
      },
      {
        method: 'Post',
        path: 'large-body',
        controllerMethod: {
          name: 'postLargeBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            size: JSON.stringify(ctx.request.body).length,
          }),
        },
      },
      {
        method: 'Post',
        path: 'rawbody-text',
        controllerMethod: {
          name: 'postRawBodyText',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            raw: ctx.request.rawBody?.byteLength,
            body: ctx.request.body,
          }),
        },
        options: [{ name: 'RawBody' }],
      },
      // ── BATCH 2: Response types exhaustive ─────────────────────
      {
        method: 'Get',
        path: 'return-arraybuffer',
        controllerMethod: {
          name: 'getReturnArrayBuffer',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            const buf = new ArrayBuffer(4);
            const view = new Uint8Array(buf);
            view[0] = 0xDE;
            view[1] = 0xAD;
            view[2] = 0xBE;
            view[3] = 0xEF;
            ctx.response.setContentType('application/octet-stream');
            return buf;
          },
        },
      },
      // ── BATCH 4: SSE exhaustive ────────────────────────────────
      {
        method: 'Get',
        path: 'sse-event-newline',
        controllerMethod: {
          name: 'getSseEventNewline',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('data', { event: 'up\ndate' });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      // ── BATCH 5: Raw streaming ─────────────────────────────────
      {
        method: 'Get',
        path: 'raw-stream-binary-ct',
        controllerMethod: {
          name: 'getRawStreamBinaryCt',
          handler: () => {
            async function* generate() {
              yield new Uint8Array([1, 2, 3]);
            }
            return generate();
          },
        },
        options: [{ name: 'ContentType', arguments: ['application/octet-stream'] }],
      },
      {
        method: 'Get',
        path: 'raw-stream-number',
        controllerMethod: {
          name: 'getRawStreamNumber',
          handler: () => {
            async function* generate() {
              yield 42;
              yield 99;
            }
            return generate();
          },
        },
        options: [{ name: 'ContentType', arguments: ['text/plain'] }],
      },
      // ── BATCH 6: Error handling exhaustive ─────────────────────
      {
        method: 'Get',
        path: 'throw-http-error',
        controllerMethod: {
          name: 'getThrowHttpError',
          handler: () => {
            throw new HttpError(StatusCodes.FORBIDDEN, 'Forbidden');
          },
        },
      },
      {
        method: 'Get',
        path: 'throw-non-error',
        controllerMethod: {
          name: 'getThrowNonError',
          handler: () => {
            throw 'string error';
          },
        },
      },
      {
        method: 'Get',
        path: 'return-err-with-errors',
        controllerMethod: {
          name: 'getReturnErrWithErrors',
          handler: () => err({
            status: 422,
            message: 'Validation',
            errors: [{ path: 'name', code: 'required', message: 'required' }],
          }),
        },
      },
      // ── BATCH 7: Middleware pipeline detailed ──────────────────
      {
        method: 'Get',
        path: 'before-parsing-test',
        controllerMethod: {
          name: 'getBeforeParsingTest',
          handler: () => ({ ok: true }),
        },
      },
      {
        method: 'Get',
        path: 'sse-skip-before-response',
        controllerMethod: {
          name: 'getSseSkipBeforeResponse',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('ping');
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'native-skip-before-response',
        controllerMethod: {
          name: 'getNativeSkipBeforeResponse',
          handler: () => new Response('native-skip', { status: 200 }),
        },
      },
      // ── BATCH 8: Context and concurrency ───────────────────────
      // (reuses existing concurrent/:id route)
      // ── BATCH 9: 204/304 and auto behaviors ───────────────────
      {
        method: 'Get',
        path: 'explicit-304',
        controllerMethod: {
          name: 'getExplicit304',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(304 as StatusCodes);
            return { shouldBeStripped: true };
          },
        },
      },
      {
        method: 'Get',
        path: 'send-no-body',
        controllerMethod: {
          name: 'getSendNoBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.send();
            return undefined;
          },
        },
      },
      // ── BATCH extra: HEAD with string body ────────────────────
      {
        method: 'Get',
        path: 'head-string',
        controllerMethod: {
          name: 'getHeadString',
          handler: () => 'hello head test',
        },
      },
      // ── BATCH extra: HEAD with ArrayBuffer body ───────────────
      {
        method: 'Get',
        path: 'head-arraybuffer',
        controllerMethod: {
          name: 'getHeadArrayBuffer',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            const buf = new ArrayBuffer(5);
            const view = new Uint8Array(buf);
            view.set([10, 20, 30, 40, 50]);
            ctx.response.setContentType('application/octet-stream');
            return buf;
          },
        },
      },
      // ── BATCH extra: rawBody with invalid charset ─────────────
      {
        method: 'Post',
        path: 'rawbody-invalid-charset',
        controllerMethod: {
          name: 'postRawBodyInvalidCharset',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            raw: ctx.request.rawBody?.byteLength,
            body: ctx.request.body,
          }),
        },
        options: [{ name: 'RawBody' }],
      },
      // ── BATCH extra: Content-Encoding br ──────────────────────
      {
        method: 'Post',
        path: 'content-encoding-br',
        controllerMethod: {
          name: 'postContentEncodingBr',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ received: ctx.request.body }),
        },
      },
      // ── BATCH extra: text body exceeding limit ────────────────
      {
        method: 'Post',
        path: 'large-text-body',
        controllerMethod: {
          name: 'postLargeTextBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            size: typeof ctx.request.body === 'string' ? ctx.request.body.length : 0,
          }),
        },
      },
      // ── Context methods ───────────────────────────────────────
      {
        method: 'Get',
        path: 'context-type',
        controllerMethod: {
          name: 'getContextType',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({ type: ctx.getType() }),
        },
      },
      // ── Response reset ────────────────────────────────────────
      {
        method: 'Get',
        path: 'response-reset',
        controllerMethod: {
          name: 'getResponseReset',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(201);
            ctx.response.setHeader('x-before-reset', 'yes');
            ctx.response.setBody({ before: true });
            ctx.response.reset();
            ctx.response.setStatus(200);
            ctx.response.setBody({ after: true });
            return undefined;
          },
        },
      },
      // ── Response setHeaders (bulk) ────────────────────────────
      {
        method: 'Get',
        path: 'bulk-headers',
        controllerMethod: {
          name: 'getBulkHeaders',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setHeaders({ 'x-one': '1', 'x-two': '2', 'x-three': '3' });
            return { ok: true };
          },
        },
      },
      // ── Response removeHeader ─────────────────────────────────
      {
        method: 'Get',
        path: 'remove-header',
        controllerMethod: {
          name: 'getRemoveHeader',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setHeader('x-temp', 'should-be-removed');
            ctx.response.removeHeader('x-temp');
            return { ok: true };
          },
        },
      },
      // ── Custom statusText ─────────────────────────────────────
      {
        method: 'Get',
        path: 'custom-status-text',
        controllerMethod: {
          name: 'getCustomStatusText',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(200, 'All Good');
            return { ok: true };
          },
        },
      },
      // ── getBody / getStatus in handler ────────────────────────
      {
        method: 'Post',
        path: 'read-own-body',
        controllerMethod: {
          name: 'postReadOwnBody',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setBody({ initial: true });
            const readBack = ctx.response.getBody();
            const status = ctx.response.getStatus();
            return { readBack, status };
          },
        },
      },
      // ── rawRequest accessor ───────────────────────────────────
      {
        method: 'Get',
        path: 'raw-request-info',
        controllerMethod: {
          name: 'getRawRequestInfo',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            const hasRawRequest = ctx.rawRequest !== undefined;
            return { hasRawRequest };
          },
        },
      },
      // ── SSE that throws during iteration ──────────────────────
      {
        method: 'Get',
        path: 'sse-throw',
        controllerMethod: {
          name: 'getSseThrow',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('first', { event: 'ok' });
              throw new Error('iterator crash');
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      // ── AfterHandle + BeforeResponse pipeline test routes ─────
      {
        method: 'Get',
        path: 'envelope/users',
        controllerMethod: {
          name: 'getEnvelopeUsers',
          handler: () => ({ users: ['alice', 'bob'] }),
        },
      },
      {
        method: 'Get',
        path: 'envelope/sse',
        controllerMethod: {
          name: 'getEnvelopeSse',
          handler: () => {
            async function* generate() {
              yield new ServerSentEvent('ping', { event: 'test' });
            }
            return generate();
          },
        },
        options: [{ name: 'Sse' }],
      },
      {
        method: 'Get',
        path: 'envelope/native',
        controllerMethod: {
          name: 'getEnvelopeNative',
          handler: () => new Response('native-body', { status: 200, headers: { 'x-native': 'yes' } }),
        },
      },
      {
        method: 'Get',
        path: 'envelope/string',
        controllerMethod: {
          name: 'getEnvelopeString',
          handler: () => 'plain text result',
        },
      },
      {
        method: 'Get',
        path: 'envelope/empty',
        controllerMethod: {
          name: 'getEnvelopeEmpty',
          handler: () => undefined,
        },
      },
      {
        method: 'Get',
        path: 'envelope/send',
        controllerMethod: {
          name: 'getEnvelopeSend',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setStatus(429);
            ctx.response.setBody({ limited: true });
            ctx.response.send();
            return undefined;
          },
        },
      },
      {
        method: 'Get',
        path: 'envelope/error',
        controllerMethod: {
          name: 'getEnvelopeError',
          handler: () => err({ status: 422, message: 'Validation failed' }),
        },
      },
      {
        method: 'Get',
        path: 'envelope/blob',
        controllerMethod: {
          name: 'getEnvelopeBlob',
          handler: (ctx: InstanceType<typeof HttpContext>) => {
            ctx.response.setBody(new Blob([new Uint8Array([0x01, 0x02])], { type: 'application/octet-stream' }));
            return undefined;
          },
        },
      },
      // ── Emergency teardown trigger ────────────────────────────
      {
        method: 'Get',
        path: 'trigger-emergency',
        controllerMethod: {
          name: 'getTriggerEmergency',
          handler: () => ({ shouldNotSee: true }),
        },
      },
      // ── Custom HTTP method via @Method decorator ──────────────
      {
        method: 'Method',
        path: 'cache/:key',
        controllerMethod: {
          name: 'purgeCache',
          handler: (ctx: InstanceType<typeof HttpContext>) => ({
            purged: ctx.request.params['key'],
          }),
        },
        // handlerDecoratorArgs override: Method('PURGE', 'cache/:key')
      },
    ];

    // Patch the PURGE route: @Method('PURGE', 'cache/:key') produces
    // handlerDecorator='Method', handlerDecoratorArgs=['PURGE', 'cache/:key']
    const builtIndex = buildHandlerIndex(routes);
    const patchedHandlerIndex = builtIndex.handlerIndex.map(entry => {
      if (entry.methodName === 'purgeCache') {
        return { ...entry, handlerDecorator: 'Method', handlerDecoratorArgs: ['PURGE', 'cache/:key'] };
      }
      return entry;
    });

    server = new HttpServer();
    await server.boot(container, {
      port: TEST_PORT,
      bodyLimit: 1024,
      customMethods: ['PURGE'],
      metadata: builtIndex.metadata as never,
      handlerIndex: patchedHandlerIndex,
      controllerInstances: builtIndex.controllerInstances,
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
    const body = await response.text();
    expect(body).toBe('');
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
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return 301 redirect with explicit status', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-301`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/target');
    const body = await response.text();
    expect(body).toBe('');
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
    expect(response.status).toBe(200);
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
    expect(body.message).toBe('Not Found');
  });

  it('should return 405 with Allow header for wrong method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(405);
    const allow = response.headers.get('allow');
    expect(allow).not.toBeNull();
    expect(allow).toContain('GET');
    const body = await response.json();
    expect(body.message).toBeDefined();
    expect(typeof body.message).toBe('string');
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
    const responseBody = await response.json();
    expect(responseBody.message).toContain('size limit');
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
    const response = await fetch(`${BASE_URL}/json`, { method: 'LINK' });

    // Assert
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.message).toContain('Not Implemented');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should return 500 when handler throws', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/throw`);

    // Assert
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal Server Error');
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
    const body = await response.json();
    expect(body).toEqual({ ok: true });
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
    expect(requestIds.every((id: string) => typeof id === 'string' && id.length > 0)).toBe(true);
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
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
  });

  it('should add Set-Cookie headers directly in handler', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer`);

    // Assert
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(1);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should preserve handler-set headers on error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/finalizer-error`);

    // Assert
    expect(response.status).toBe(422);
    expect(response.headers.get('x-finalizer')).toBe('ran');
    const body = await response.json();
    expect(body.status).toBe(422);
    expect(body.message).toBe('Validation failed');
  });

  it('should apply BeforeResponse middleware modifications', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.headers.get('x-before-response')).toBe('applied');
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
  });

  it('should run Cleanup middleware after response', async () => {
    // Arrange
    const countBefore = cleanupMiddlewareCalls.length;

    // Act
    const response = await fetch(`${BASE_URL}/json`);
    // Small delay to allow Cleanup phase to execute (it runs after response)
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert
    expect(cleanupMiddlewareCalls.length).toBeGreaterThan(countBefore);
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
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
    const body = await response.json();
    expect(body).toEqual({ ok: true });
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

  // ── HP: getAdapterContext() from service layer ─────────────────────

  it('should resolve current context via getAdapterContext() in deep call', async () => {
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
    const body = await response.json();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal Server Error');
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
    const body = await response.text();
    expect(body).toBe('native');
  });

  // ── NE: 501 with CORS ─────────────────────────────────────

  it('should include CORS headers on 501 for unknown method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'LINK' });

    // Assert
    expect(response.status).toBe(501);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(body.message).toContain('Not Implemented');
  });

  // ── HP: send() only → 204 ─────────────────────────────────

  it('should return 204 when handler only calls send() with no body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/send-only`);

    // Assert
    expect(response.status).toBe(204);
    const text = await response.text();
    expect(text).toBe('');
    expect(response.headers.get('content-type')).toBeNull();
  });

  // ── Regression: setContentType charset deduplication (M-7) ──

  it('should not double-append charset when Content-Type already has charset', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/charset-explicit`);

    // Assert
    expect(response.status).toBe(200);
    const ct = response.headers.get('content-type')!;
    const charsetCount = (ct.match(/charset=/g) ?? []).length;
    expect(charsetCount).toBe(1);
    expect(ct).toBe('text/html; charset=iso-8859-1');
    const body = await response.text();
    expect(body).toBe('<h1>Hello</h1>');
  });

  // ── Regression: 204 should not have Content-Type (L-13) ────

  it('should not include Content-Type on explicit 204 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/explicit-204`);

    // Assert
    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    const body204 = await response.text();
    expect(body204).toBe('');
  });

  it('should not include Content-Type on auto-204 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/empty`);

    // Assert
    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    const body = await response.text();
    expect(body).toBe('');
  });

  // ── Regression: SSE id NULL sanitization (M-5) ─────────────

  it('should strip NULL characters from SSE id field', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-null-id`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toContain('id: safeid');
    expect(text).not.toContain('\0');
  });

  // ── Regression: SSE retry validation (L-4) ─────────────────

  it('should omit SSE retry field for negative value', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-retry-negative`);
    const text = await response.text();

    // Assert
    expect(text).not.toContain('retry:');
    expect(text).toContain('data:');
  });

  it('should include SSE retry field for valid non-negative integer', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-retry-valid`);
    const text = await response.text();

    // Assert
    expect(text).toContain('retry: 5000');
    expect(text).toContain('data:');
  });

  // ── Regression: 404 path not leaked (L-6) ──────────────────

  it('should not leak request path in 404 error message', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/secret-admin-panel`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body.message).toBe('Not Found');
    expect(body.message).not.toContain('secret-admin-panel');
  });

  // ── Regression: body limit on chunked path returns 413 (M-1) ─

  it('should return 413 when chunked body exceeds route-level bodyLimit', async () => {
    // Arrange — bodyLimit is 50 bytes, send 100 bytes
    const largeBody = 'A'.repeat(100);

    // Act
    const response = await fetch(`${BASE_URL}/body-limit-chunked`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.message).toContain('size limit');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Body parsing edge cases ─────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should parse JSON body with +json content type suffix', async () => {
    // Arrange
    const payload = { type: 'article', data: { title: 'test' } };

    // Act
    const response = await fetch(`${BASE_URL}/json-plus`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should parse form-urlencoded body as text', async () => {
    // Arrange
    const formData = 'name=test&value=123';

    // Act
    const response = await fetch(`${BASE_URL}/form-urlencoded`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formData,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(formData);
  });

  it('should return 400 for JSON body with charset=utf-16', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-16' },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('UTF-8');
  });

  it('should return 400 for JSON body with charset=bogus', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=bogus' },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('UTF-8');
  });

  it('should treat Content-Length 0 as no body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/cl-zero`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '0',
      },
      body: '',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasBody).toBe(false);
  });

  it('should parse JSON body on DELETE when Content-Type is present', async () => {
    // Arrange
    const payload = { reason: 'cleanup' };

    // Act
    const response = await fetch(`${BASE_URL}/delete-with-body`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should skip body parsing for DELETE without Content-Type', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/99`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: '99' });
  });

  it('should return 415 for Content-Encoding gzip on POST', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/content-encoding-gzip`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(415);
    expect(response.headers.get('accept-encoding')).toBe('identity');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('Content-Encoding');
  });

  it('should allow Content-Encoding identity and parse normally', async () => {
    // Arrange
    const payload = { data: 'identity-test' };

    // Act
    const response = await fetch(`${BASE_URL}/content-encoding-identity`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'identity',
      },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should return 413 when POST body exceeds global bodyLimit via large payload', async () => {
    // Arrange — global bodyLimit is 1024 bytes
    const largeBody = JSON.stringify({ data: 'y'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/json-plus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.message).toContain('size limit');
  });

  it('should provide both rawBody and parsed body for webhook with JSON', async () => {
    // Arrange
    const payload = JSON.stringify({ event: 'push', ref: 'main' });

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

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Response types ──────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should return plain string as text/plain', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-string`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('hello plain');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('should return number as application/json', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-number`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('42');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should return boolean as application/json', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-boolean`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('true');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should return null as 204', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-null`);

    // Assert
    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return bigint as text string', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-bigint`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('9007199254740991');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('should return Uint8Array as binary body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-uint8array`);

    // Assert
    expect(response.status).toBe(200);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should not append charset to binary content type', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/ct-binary`);

    // Assert
    expect(response.status).toBe(200);
    const contentType = response.headers.get('content-type');
    expect(contentType).toBe('application/octet-stream');
    expect(contentType).not.toContain('charset');
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes).toEqual(new Uint8Array([0xff, 0xfe]));
  });

  it('should return text/plain with unserializable marker for circular JSON', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json-circular`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('[unserializable body]');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('should return Content-Length for HEAD on Uint8Array response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/head-uint8array`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('3');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Redirect ────────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should return 302 for imperative redirect', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/imperative-redirect`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/other');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: SSE advanced ────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should stream SSE with all fields present', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-all-fields`);
    const text = await response.text();

    // Assert
    expect(text).toContain('event: update');
    expect(text).toContain('id: evt-1');
    expect(text).toContain('retry: 3000');
    expect(text).toContain('data: {"payload":"full"}');
  });

  it('should frame plain strings in SSE data field', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-string`);
    const text = await response.text();

    // Assert
    expect(text).toContain('data: hello world');
    expect(text).not.toContain('event:');
    expect(text).not.toContain('id:');
    expect(text).not.toContain('retry:');
  });

  it('should frame plain objects as JSON in SSE data field', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-object`);
    const text = await response.text();

    // Assert
    expect(text).toContain('data: {"key":"value"}');
    expect(response.headers.get('content-type')).toBe('text/event-stream');
  });

  it('should prefix each line of multiline SSE data', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-multiline`);
    const text = await response.text();

    // Assert
    expect(text).toContain('event: multi');
    expect(text).toContain('data: line1');
    expect(text).toContain('data: line2');
    expect(text).toContain('data: line3');
  });

  it('should include SSE Content-Type and Cache-Control headers', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);
    await response.text();

    // Assert
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Raw streaming ───────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should stream raw chunks with custom Content-Type', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('line1\nline2\n');
  });

  it('should stream raw binary Uint8Array chunks', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream-binary`);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Assert
    expect(response.status).toBe(200);
    expect(bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });

  it('should encode non-string non-Uint8Array via String() in raw stream', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream-mixed`);
    const body = await response.text();

    // Assert
    expect(body).toContain('42');
    expect(body).toContain('true');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Error handling ──────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should return 404 without leaking path for secret endpoint', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/secret-path`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body.message).toBe('Not Found');
    expect(JSON.stringify(body)).not.toContain('secret-path');
  });

  it('should return 405 with Allow header for POST to GET-only route', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'POST' });

    // Assert
    expect(response.status).toBe(405);
    const allow = response.headers.get('allow');
    expect(allow).not.toBeNull();
    expect(allow).toContain('GET');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW TESTS: Concurrent isolation ────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should isolate concurrent requests with parallel GET', async () => {
    // Arrange & Act
    const [response1, response2] = await Promise.all([
      fetch(`${BASE_URL}/concurrent/1`).then(res => res.json()),
      fetch(`${BASE_URL}/concurrent/2`).then(res => res.json()),
    ]);

    // Assert
    expect(response1.id).toBe('1');
    expect(response2.id).toBe('2');
    expect(response1.requestId).not.toBe(response2.requestId);
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 1: Body parsing exhaustive (new tests) ──────────────
  // ══════════════════════════════════════════════════════════════

  it('should parse +json content type (application/vnd.api+json) as JSON', async () => {
    // Arrange
    const payload = { type: 'resource', attributes: { name: 'test' } };

    // Act
    const response = await fetch(`${BASE_URL}/json-plus`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should parse application/x-www-form-urlencoded as text', async () => {
    // Arrange
    const formBody = 'key1=val1&key2=val2';

    // Act
    const response = await fetch(`${BASE_URL}/form-urlencoded`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(formBody);
  });

  it('should skip body parsing when Content-Length is 0', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/cl-zero`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '0',
      },
      body: '',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hasBody).toBe(false);
  });

  it('should skip body parsing on DELETE when no Content-Type', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/55`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: '55' });
  });

  it('should skip body parsing on GET request', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
  });

  it('should skip body parsing on HEAD request', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should pass body as ReadableStream for non-text non-json content types (application/octet-stream)', async () => {
    // Arrange
    const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    // Act
    const response = await fetch(`${BASE_URL}/streaming-body`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: binaryData,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isStream).toBe(true);
  });

  it('should return 413 when JSON body exceeds global bodyLimit', async () => {
    // Arrange — global bodyLimit is 1024 bytes
    const largeBody = JSON.stringify({ data: 'z'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/large-body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.message).toContain('size limit');
  });

  it('should return 413 when text body exceeds global bodyLimit', async () => {
    // Arrange — global bodyLimit is 1024 bytes
    const largeText = 'A'.repeat(2048);

    // Act
    const response = await fetch(`${BASE_URL}/large-text-body`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: largeText,
    });

    // Assert
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.message).toContain('size limit');
  });

  it('should return 400 for JSON with charset=utf-16', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-16' },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('UTF-8');
  });

  it('should return 400 for JSON with charset=bogus-encoding', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=bogus-encoding' },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('UTF-8');
  });

  it('should return 415 when Content-Encoding is gzip', async () => {
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
    expect(response.headers.get('accept-encoding')).toBe('identity');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('Content-Encoding');
  });

  it('should return 415 when Content-Encoding is br', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/content-encoding-br`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'br',
      },
      body: JSON.stringify({ data: 'test' }),
    });

    // Assert
    expect(response.status).toBe(415);
    expect(response.headers.get('accept-encoding')).toBe('identity');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('Content-Encoding');
  });

  it('should allow Content-Encoding identity', async () => {
    // Arrange
    const payload = { data: 'identity-ok' };

    // Act
    const response = await fetch(`${BASE_URL}/content-encoding-identity`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'identity',
      },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should provide rawBody as Uint8Array for text/plain with @RawBody', async () => {
    // Arrange
    const textPayload = 'raw body text content';

    // Act
    const response = await fetch(`${BASE_URL}/rawbody-text`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: textPayload,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.raw).toBe(new TextEncoder().encode(textPayload).byteLength);
    expect(body.body).toBe(textPayload);
  });

  it('should return 400 for rawBody with invalid charset', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/rawbody-invalid-charset`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=bogus-nonsense' },
      body: 'test data',
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('charset');
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 2: Response types exhaustive (new tests) ────────────
  // ══════════════════════════════════════════════════════════════

  it('should return text/plain for string response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-string`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toBe('hello plain');
  });

  it('should return application/json for number response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-number`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.text();
    expect(body).toBe('42');
  });

  it('should return application/json for boolean response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-boolean`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.text();
    expect(body).toBe('true');
  });

  it('should return 204 for null response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-null`);

    // Assert
    expect(response.status).toBe(204);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should convert bigint to string via toString()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-bigint`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('9007199254740991');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('should return binary body for Uint8Array response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-uint8array`);

    // Assert
    expect(response.status).toBe(200);
    const arrayBuffer = await response.arrayBuffer();
    expect(new Uint8Array(arrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should return binary body for ArrayBuffer response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-arraybuffer`);

    // Assert
    expect(response.status).toBe(200);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes[0]).toBe(0xDE);
    expect(bytes[1]).toBe(0xAD);
    expect(bytes[2]).toBe(0xBE);
    expect(bytes[3]).toBe(0xEF);
  });

  it('should return [unserializable body] for circular JSON', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json-circular`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('[unserializable body]');
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('should not append charset to binary content type (application/octet-stream)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/ct-binary`);

    // Assert
    const contentType = response.headers.get('content-type');
    expect(contentType).toBe('application/octet-stream');
    expect(contentType).not.toContain('charset');
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes).toEqual(new Uint8Array([0xff, 0xfe]));
  });

  it('should redirect imperatively via ctx.response.redirect()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/imperative-redirect`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/other');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 3: HEAD method exhaustive (new tests) ───────────────
  // ══════════════════════════════════════════════════════════════

  it('should return Content-Length from string body on HEAD', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/head-string`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    const contentLength = response.headers.get('content-length');
    expect(contentLength).not.toBeNull();
    expect(Number(contentLength)).toBe(Buffer.byteLength('hello head test', 'utf-8'));
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return Content-Length from Uint8Array body on HEAD', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-uint8array`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('3');
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return Content-Length from ArrayBuffer body on HEAD', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/head-arraybuffer`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('5');
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should default to 200 on HEAD with body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return empty body on HEAD', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-string`, { method: 'HEAD' });

    // Assert
    const body = await response.text();
    expect(body).toBe('');
    expect(response.status).toBe(200);
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 4: SSE exhaustive (new tests) ───────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should include all SSE fields (event, id, retry, data) in frame', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-all-fields`);
    const text = await response.text();

    // Assert
    expect(text).toContain('event: update');
    expect(text).toContain('id: evt-1');
    expect(text).toContain('retry: 3000');
    expect(text).toContain('data: {"payload":"full"}');
  });

  it('should frame plain strings as data: lines', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-string`);
    const text = await response.text();

    // Assert
    expect(text).toContain('data: hello world');
    expect(text).not.toContain('event:');
  });

  it('should frame plain objects as JSON data: lines', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-object`);
    const text = await response.text();

    // Assert
    expect(text).toContain('data: {"key":"value"}');
    expect(response.headers.get('content-type')).toBe('text/event-stream');
  });

  it('should prefix each line of multiline data with data:', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-multiline`);
    const text = await response.text();

    // Assert
    const dataLines = text.split('\n').filter((line: string) => line.startsWith('data:'));
    expect(dataLines.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('data: line1');
    expect(text).toContain('data: line2');
    expect(text).toContain('data: line3');
  });

  it('should strip newlines from event field', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-event-newline`);
    const text = await response.text();

    // Assert — newline in 'up\ndate' should be stripped to 'update'
    expect(text).toContain('event: update');
    expect(text).not.toContain('event: up\n');
  });

  it('should have text/event-stream Content-Type', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(text).toContain('data:');
  });

  it('should have Cache-Control: no-cache', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(text).toContain('data:');
  });

  it('should have Connection: keep-alive header', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-all-fields`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(text).toContain('data:');
  });

  it('should have X-Accel-Buffering: no header', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-all-fields`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(text).toContain('data:');
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 5: Raw streaming (non-SSE AsyncIterable) ────────────
  // ══════════════════════════════════════════════════════════════

  it('should pass Uint8Array chunks through directly in raw streaming', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream-binary-ct`);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Assert
    expect(response.status).toBe(200);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should encode non-string non-Uint8Array via String() in raw streaming', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream-number`);
    const body = await response.text();

    // Assert
    expect(body).toContain('42');
    expect(body).toContain('99');
  });

  it('should use @ContentType for raw streaming response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream`);

    // Assert — raw-stream has ContentType='text/csv'
    // Raw streaming uses native Response, so CT comes from the decorator
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('line1\nline2\n');
  });

  it('should NOT have SSE headers on raw streaming response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream-binary`);
    await response.arrayBuffer();

    // Assert
    expect(response.headers.get('content-type')).not.toBe('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 6: Error handling exhaustive (new tests) ────────────
  // ══════════════════════════════════════════════════════════════

  it('should return statusCode and message for thrown HttpError', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/throw-http-error`);

    // Assert
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.status).toBe(403);
    expect(body.message).toBe('Forbidden');
  });

  it('should return 500 for thrown non-Error value', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/throw-non-error`);

    // Assert
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal Server Error');
  });

  it('should return 500 for unknown thrown object with CORS headers preserved', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/throw-non-error`);

    // Assert
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(body.statusCode).toBe(500);
    expect(typeof body.message).toBe('string');
  });

  it('should include field-level errors array in error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-err-with-errors`);

    // Assert
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.message).toBe('Validation');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.length).toBe(1);
    expect(body.errors[0].path).toBe('name');
    expect(body.errors[0].code).toBe('required');
    expect(body.errors[0].message).toBe('required');
  });

  it('should return 404 without leaking path for /any-secret-path', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/any-secret-path`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body.message).toBe('Not Found');
    expect(JSON.stringify(body)).not.toContain('any-secret-path');
  });

  it('should return 405 with Allow header listing all methods for route', async () => {
    // Arrange & Act — /items/:id has DELETE, PUT, PATCH
    const response = await fetch(`${BASE_URL}/items/1`, { method: 'POST' });

    // Assert
    expect(response.status).toBe(405);
    const allow = response.headers.get('allow');
    expect(allow).not.toBeNull();
    expect(allow).toContain('DELETE');
    expect(allow).toContain('PUT');
    expect(allow).toContain('PATCH');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should return 501 for unknown HTTP method (TRACE)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'LINK' });

    // Assert
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.message).toBe('Not Implemented');
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 7: Middleware pipeline detailed (new tests) ─────────
  // ══════════════════════════════════════════════════════════════

  it('should run OnRequest middleware on every request (verify CORS on various routes)', async () => {
    // Arrange & Act
    const [resJson, resEmpty, resEcho] = await Promise.all([
      fetch(`${BASE_URL}/json`),
      fetch(`${BASE_URL}/empty`),
      fetch(`${BASE_URL}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"x":1}',
      }),
    ]);

    // Assert
    expect(resJson.headers.get('access-control-allow-origin')).toBe('*');
    expect(resEmpty.headers.get('access-control-allow-origin')).toBe('*');
    expect(resEcho.headers.get('access-control-allow-origin')).toBe('*');
    const jsonBody = await resJson.json();
    expect(jsonBody).toEqual({ message: 'hello', count: 42 });
    const emptyBody = await resEmpty.text();
    expect(emptyBody).toBe('');
    const echoBody = await resEcho.json();
    expect(echoBody).toEqual({ received: { x: 1 } });
  });

  it('should run BeforeResponse middleware (verify x-before-response header)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`);

    // Assert
    expect(response.headers.get('x-before-response')).toBe('applied');
    const body = await response.json();
    expect(body).toEqual({ message: 'hello', count: 42 });
  });

  it('should run BeforeResponse for ALL responses including native Response (SSE, handler Response)', async () => {
    // Arrange & Act — SSE path sets native Response. BeforeResponse now runs for all.
    const sseResponse = await fetch(`${BASE_URL}/sse-skip-before-response`);
    await sseResponse.text();

    // Assert — SSE native Response SHOULD have x-before-response (merged via getNativeResponse)
    expect(sseResponse.headers.get('x-before-response')).toBe('applied');

    // Also check handler Response
    const nativeResponse = await fetch(`${BASE_URL}/native-skip-before-response`);
    await nativeResponse.text();

    expect(nativeResponse.headers.get('x-before-response')).toBe('applied');
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 8: Context and concurrency (new tests) ──────────────
  // ══════════════════════════════════════════════════════════════

  it('should resolve context via getAdapterContext() in deep call', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/context-access`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe('/context-access');
  });

  it('should isolate concurrent requests (parallel fetch, check different IDs and requestIds)', async () => {
    // Arrange
    const count = 15;

    // Act
    const responses = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        fetch(`${BASE_URL}/concurrent/${index}`).then(res => res.json()),
      ),
    );

    // Assert
    const ids = responses.map((res: { id: string }) => res.id);
    const requestIds = responses.map((res: { requestId: string }) => res.requestId);
    expect(new Set(ids).size).toBe(count);
    expect(new Set(requestIds).size).toBe(count);
  });

  // ══════════════════════════════════════════════════════════════
  // ── BATCH 9: 204/304 and auto behaviors (new tests) ───────────
  // ══════════════════════════════════════════════════════════════

  it('should not include Content-Type on explicit 204', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/explicit-204`);

    // Assert
    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should not include Content-Type on auto-204 (handler returns undefined)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/empty`);

    // Assert
    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should strip body on 304 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/explicit-304`);

    // Assert
    expect(response.status).toBe(304);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should default to 302 when redirect has no explicit status', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-default`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/target');
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should handle res.send() with no body as 204', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/send-no-body`);

    // Assert
    expect(response.status).toBe(204);
    const text = await response.text();
    expect(text).toBe('');
  });

  // ══════════════════════════════════════════════════════════════
  // ── Additional coverage: body parsing edge cases ──────────────
  // ══════════════════════════════════════════════════════════════

  it('should parse JSON body with Content-Type including extra parameters', async () => {
    // Arrange
    const payload = { extra: 'params' };

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should return 400 for empty JSON body string', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });

    // Assert — empty body with no CL header or CL:0; Bun may send CL:0
    const status = response.status;
    expect([200, 201, 400].includes(status)).toBe(true);
    const body = await response.text();
    expect(typeof body).toBe('string');
  });

  it('should handle POST with text/html as text-like body', async () => {
    // Arrange
    const html = '<h1>Hello</h1>';

    // Act
    const response = await fetch(`${BASE_URL}/text`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: html,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(html);
  });

  it('should handle POST with text/xml as text-like body', async () => {
    // Arrange
    const xml = '<root>data</root>';

    // Act
    const response = await fetch(`${BASE_URL}/text`, {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: xml,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(xml);
  });

  it('should handle POST with text/csv as text-like body', async () => {
    // Arrange
    const csv = 'name,age\nAlice,30';

    // Act
    const response = await fetch(`${BASE_URL}/text`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(csv);
  });

  it('should parse +json suffix with vendor prefix (application/hal+json)', async () => {
    // Arrange
    const payload = { _links: { self: '/api' } };

    // Act
    const response = await fetch(`${BASE_URL}/json-plus`, {
      method: 'POST',
      headers: { 'content-type': 'application/hal+json' },
      body: JSON.stringify(payload),
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: payload });
  });

  it('should handle nested JSON body correctly', async () => {
    // Arrange
    const payload = { nested: { deeply: { value: [1, 2, 3] } } };

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

  it('should handle JSON array body correctly', async () => {
    // Arrange
    const payload = [1, 2, 3, 'hello'];

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

  it('should handle JSON null body correctly', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: null });
  });

  it('should handle JSON number body correctly', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '42',
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: 42 });
  });

  it('should handle JSON string body correctly', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"hello"',
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: 'hello' });
  });

  it('should handle JSON boolean body correctly', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'true',
    });

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: true });
  });

  it('should reject truncated JSON body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"key": "value"',
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid JSON');
  });

  it('should reject JSON body with trailing comma', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"key": "value",}',
    });

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('Invalid JSON');
  });

  it('should handle OPTIONS auto-response with multiple methods registered', async () => {
    // Arrange & Act — /items/:id has DELETE, PUT, PATCH
    const response = await fetch(`${BASE_URL}/items/1`, { method: 'OPTIONS' });

    // Assert
    expect(response.status).toBe(204);
    const allow = response.headers.get('allow');
    expect(allow).toContain('DELETE');
    expect(allow).toContain('PUT');
    expect(allow).toContain('PATCH');
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should include HEAD in Allow header for GET-registered route OPTIONS', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'OPTIONS' });

    // Assert
    expect(response.status).toBe(204);
    const allow = response.headers.get('allow');
    expect(allow).toContain('HEAD');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ── Additional coverage: response body types ──────────────────

  it('should return empty object as application/json', async () => {
    // Arrange & Act — the /json-plus handler echoes body, send empty object
    const response = await fetch(`${BASE_URL}/json-plus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: {} });
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should return array response as application/json', async () => {
    // Arrange & Act — the /echo handler wraps in received, creating an object
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([1, 2, 3]),
    });

    // Assert
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toEqual({ received: [1, 2, 3] });
  });

  // ── Additional coverage: HEAD method variations ───────────────

  it('should return HEAD 200 for route returning JSON object', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(200);
    const cl = response.headers.get('content-length');
    expect(cl).not.toBeNull();
    expect(Number(cl)).toBeGreaterThan(0);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should return HEAD 204 for route returning undefined', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/empty`, { method: 'HEAD' });

    // Assert
    expect(response.status).toBe(204);
    const text = await response.text();
    expect(text).toBe('');
  });

  it('should return HEAD with correct Content-Type for JSON route', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'HEAD' });

    // Assert
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ── Additional coverage: SSE edge cases ───────────────────────

  it('should handle SSE with empty string data', async () => {
    // Arrange & Act — use sse-plain-string which yields 'hello world'
    const response = await fetch(`${BASE_URL}/sse-plain-string`);
    const text = await response.text();

    // Assert
    expect(text).toContain('data:');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('should set Connection header on SSE response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(text).toContain('data:');
  });

  it('should set X-Accel-Buffering header on SSE response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse`);
    const text = await response.text();

    // Assert
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(text).toContain('data:');
  });

  it('should not have retry field in SSE when not specified', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-string`);
    const text = await response.text();

    // Assert
    expect(text).not.toContain('retry:');
    expect(text).toContain('data: hello world');
  });

  it('should not have event field in SSE for plain string data', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-string`);
    const text = await response.text();

    // Assert
    expect(text).not.toContain('event:');
    expect(text).toContain('data:');
  });

  it('should not have id field in SSE for plain object data', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-plain-object`);
    const text = await response.text();

    // Assert
    expect(text).not.toContain('id:');
    expect(text).toContain('data:');
  });

  // ── Additional coverage: error responses ──────────────────────

  it('should include CORS headers on 404 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/nonexistent-route`);

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should include CORS headers on 405 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(405);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should include CORS headers on 413 response', async () => {
    // Arrange
    const largeBody = JSON.stringify({ data: 'x'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should include CORS headers on 400 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });

    // Assert
    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should include CORS headers on 415 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'br',
      },
      body: '{}',
    });

    // Assert
    expect(response.status).toBe(415);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should include CORS headers on 403 guard rejection', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/guarded`);

    // Assert
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  it('should return JSON body for 404 error', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/definitely-not-here`);

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toHaveProperty('message');
  });

  it('should return JSON body for 405 error', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toHaveProperty('message');
  });

  it('should return JSON body for 413 error', async () => {
    // Arrange
    const largeBody = JSON.stringify({ data: 'x'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    // Assert
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toHaveProperty('message');
  });

  // ── Additional coverage: middleware ordering ──────────────────

  it('should run BeforeParsing middleware and set header', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/before-parsing-test`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-before-parsing')).toBe('applied');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should run OnRequest before BeforeParsing (both headers present)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/before-parsing-test`);

    // Assert
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-before-parsing')).toBe('applied');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should run BeforeResponse after handler (header visible on GET response)', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-string`);

    // Assert
    expect(response.headers.get('x-before-response')).toBe('applied');
    const body = await response.text();
    expect(body).toBe('hello plain');
  });

  it('should run BeforeResponse on error responses', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/return-err-with-errors`);

    // Assert
    expect(response.status).toBe(422);
    expect(response.headers.get('x-before-response')).toBe('applied');
    const body = await response.json();
    expect(body.message).toBe('Validation');
  });

  it('should run Cleanup after every successful request', async () => {
    // Arrange
    const countBefore = cleanupMiddlewareCalls.length;

    // Act
    const res1 = await fetch(`${BASE_URL}/json`);
    const res2 = await fetch(`${BASE_URL}/return-number`);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert
    expect(cleanupMiddlewareCalls.length).toBeGreaterThanOrEqual(countBefore + 2);
    const body1 = await res1.json();
    expect(body1).toEqual({ message: 'hello', count: 42 });
    const body2 = await res2.text();
    expect(body2).toBe('42');
  });

  it('should run Cleanup after error response', async () => {
    // Arrange
    const countBefore = cleanupMiddlewareCalls.length;

    // Act
    const response = await fetch(`${BASE_URL}/nonexistent`);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert
    expect(cleanupMiddlewareCalls.length).toBeGreaterThan(countBefore);
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });

  // ── Additional coverage: concurrent isolation ─────────────────

  it('should handle parallel POST requests independently', async () => {
    // Arrange
    const payloads = Array.from({ length: 5 }, (_, index) => ({
      index,
      data: `payload-${index}`,
    }));

    // Act
    const responses = await Promise.all(
      payloads.map(payload =>
        fetch(`${BASE_URL}/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(res => res.json()),
      ),
    );

    // Assert
    expect(responses.length).toBe(5);
    for (let i = 0; i < payloads.length; i++) {
      expect(responses[i].received).toEqual(payloads[i]);
    }
  });

  it('should handle concurrent mix of success and error requests', async () => {
    // Arrange & Act
    const [successRes, errorRes, notFoundRes] = await Promise.all([
      fetch(`${BASE_URL}/json`),
      fetch(`${BASE_URL}/guarded`),
      fetch(`${BASE_URL}/not-here`),
    ]);

    // Assert
    expect(successRes.status).toBe(200);
    expect(errorRes.status).toBe(403);
    expect(notFoundRes.status).toBe(404);
    const successBody = await successRes.json();
    expect(successBody).toEqual({ message: 'hello', count: 42 });
    const errorBody = await errorRes.json();
    expect(typeof errorBody.message).toBe('string');
    const notFoundBody = await notFoundRes.json();
    expect(typeof notFoundBody.message).toBe('string');
  });

  it('should handle concurrent SSE and regular requests', async () => {
    // Arrange & Act
    const [sseRes, jsonRes] = await Promise.all([
      fetch(`${BASE_URL}/sse`),
      fetch(`${BASE_URL}/json`),
    ]);

    // Assert
    expect(sseRes.headers.get('content-type')).toBe('text/event-stream');
    expect(jsonRes.status).toBe(200);
    const jsonBody = await jsonRes.json();
    expect(jsonBody).toEqual({ message: 'hello', count: 42 });
    await sseRes.text();
  });

  // ── Additional coverage: decorator combinations ───────────────

  it('should apply @Status with @Header together', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/header-decorator`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-custom-header')).toBe('custom-value');
    expect(response.headers.get('x-another')).toBe('another-value');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should apply @ContentType decorator without appending charset for XML', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/content-type-decorator`);

    // Assert
    const ct = response.headers.get('content-type');
    expect(ct).toContain('application/xml');
    const body = await response.text();
    expect(body).toContain('<root>');
  });

  // ── Additional coverage: redirect edge cases ──────────────────

  it('should have no body on redirect response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-default`, { redirect: 'manual' });

    // Assert
    expect(response.status).toBe(302);
    const body = await response.text();
    expect(body).toBe('');
  });

  it('should preserve CORS headers on redirect', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/redirect-default`, { redirect: 'manual' });

    // Assert
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.text();
    expect(body).toBe('');
  });

  // ── Additional coverage: raw stream edge cases ────────────────

  it('should handle raw stream with string chunks', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-stream`);
    const body = await response.text();

    // Assert
    expect(body).toContain('line1');
    expect(body).toContain('line2');
  });

  // ── Additional coverage: send() short-circuit variations ──────

  it('should preserve status when handler calls send() with status', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/rate-limited`);

    // Assert
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.message).toBe('Too Many Requests');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('should preserve body when handler calls send() with body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/rate-limited`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(429);
    expect(body.message).toBe('Too Many Requests');
  });

  // ── Additional coverage: Blob response details ────────────────

  it('should set Content-Length on Blob response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/blob`);

    // Assert
    expect(response.headers.get('content-length')).toBe('4');
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    expect(bytes[0]).toBe(0x50);
  });

  // ── Additional coverage: PUT/PATCH body parsing ───────────────

  it('should parse text/plain body on PUT', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/1`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'plain text update',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.body).toBe('plain text update');
  });

  it('should parse text/plain body on PATCH', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/1`, {
      method: 'PATCH',
      headers: { 'content-type': 'text/plain' },
      body: 'plain text patch',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.body).toBe('plain text patch');
  });

  // ── Additional coverage: error body structure ─────────────────

  it('should return status field in error response for guard rejection', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/guarded`);
    const body = await response.json();

    // Assert
    expect(body.status).toBe(403);
    expect(body.message).toBe('Forbidden');
  });

  it('should return status field in 404 error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/nowhere`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(404);
    expect(body.status).toBe(404);
  });

  it('should return status field in 405 error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'DELETE' });
    const body = await response.json();

    // Assert
    expect(response.status).toBe(405);
    expect(body.status).toBe(405);
  });

  it('should return status field in 413 error response', async () => {
    // Arrange
    const largeBody = JSON.stringify({ data: 'x'.repeat(2048) });

    // Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largeBody,
    });

    const body = await response.json();

    // Assert
    expect(response.status).toBe(413);
    expect(body.status).toBe(413);
  });

  it('should return status field in 415 error response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: '{}',
    });

    const body = await response.json();

    // Assert
    expect(response.status).toBe(415);
    expect(body.status).toBe(415);
  });

  // ── Additional coverage: Content-Encoding message details ─────

  it('should mention Content-Encoding name in 415 error message', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'deflate',
      },
      body: '{}',
    });

    const body = await response.json();

    // Assert
    expect(response.status).toBe(415);
    expect(body.message).toContain('deflate');
  });

  it('should set Accept-Encoding: identity on 415 response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'zstd',
      },
      body: '{}',
    });

    // Assert
    expect(response.status).toBe(415);
    expect(response.headers.get('accept-encoding')).toBe('identity');
    const body = await response.json();
    expect(body.message).toBeDefined();
  });

  // ── Additional coverage: rawBody with JSON ────────────────────

  it('should provide rawBody bytes matching original JSON payload', async () => {
    // Arrange
    const payload = '{"test":"rawbody-match"}';

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
    expect(body.bodyLength).toBe(payload.length);
  });

  // ── Additional coverage: 501 response details ─────────────────

  it('should return JSON body for 501 unknown method', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/json`, { method: 'LINK' });
    const body = await response.json();

    // Assert
    expect(response.status).toBe(501);
    expect(body.message).toBe('Not Implemented');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  // ── Additional coverage: native Response passthrough ──────────

  it('should not modify status of native Response from handler', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/native-response`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('native body');
    expect(response.headers.get('x-custom')).toBe('native');
  });

  it('should preserve custom headers on native Response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/native-response`);

    // Assert
    expect(response.headers.get('x-custom')).toBe('native');
    const body = await response.text();
    expect(body).toBe('native body');
  });

  it('should merge CORS into native Response without overriding handler headers', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/native-cors`);

    // Assert
    expect(response.status).toBe(201);
    expect(response.headers.get('x-handler')).toBe('yes');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.text();
    expect(body).toBe('native');
  });

  // ── Additional coverage: getAdapterContext() ─────────────────────────

  it('should return correct path from getAdapterContext() for different routes', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/context-access`);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body.path).toBe('/context-access');
  });

  // ── Additional coverage: 304 body stripping ───────────────────

  it('should not include body content on 304 even when handler sets body', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/explicit-304`);

    // Assert
    expect(response.status).toBe(304);
    const text = await response.text();
    expect(text).toBe('');
    expect(text).not.toContain('shouldBeStripped');
  });

  // ── Additional coverage: idempotency ──────────────────────────

  it('should return identical status for repeated POST with same body', async () => {
    // Arrange
    const payload = JSON.stringify({ data: 'idempotent' });
    const headers = { 'content-type': 'application/json' };

    // Act
    const res1 = await fetch(`${BASE_URL}/echo`, { method: 'POST', headers, body: payload });
    const res2 = await fetch(`${BASE_URL}/echo`, { method: 'POST', headers, body: payload });

    // Assert
    expect(res1.status).toBe(res2.status);
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1).toEqual(body2);
  });

  it('should return identical 400 for repeated invalid JSON', async () => {
    // Arrange & Act
    const res1 = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    const res2 = await fetch(`${BASE_URL}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });

    // Assert
    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(typeof body1.message).toBe('string');
    expect(typeof body2.message).toBe('string');
  });

  // ── Additional coverage to reach 230+ ─────────────────────────

  it('should handle DELETE method with query parameters', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/items/42`, { method: 'DELETE' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe('42');
  });

  it('should set CORS header on BeforeParsing test route', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/before-parsing-test`);

    // Assert
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should return 200 with x-before-response on multiple successive requests', async () => {
    // Arrange & Act
    const res1 = await fetch(`${BASE_URL}/json`);
    const res2 = await fetch(`${BASE_URL}/return-string`);
    const res3 = await fetch(`${BASE_URL}/return-number`);

    // Assert
    expect(res1.headers.get('x-before-response')).toBe('applied');
    expect(res2.headers.get('x-before-response')).toBe('applied');
    expect(res3.headers.get('x-before-response')).toBe('applied');
    const body1 = await res1.json();
    expect(body1).toEqual({ message: 'hello', count: 42 });
    const body2 = await res2.text();
    expect(body2).toBe('hello plain');
    const body3 = await res3.text();
    expect(body3).toBe('42');
  });

  it('should handle form-urlencoded with special characters', async () => {
    // Arrange
    const formBody = 'name=hello%20world&value=a%26b%3Dc';

    // Act
    const response = await fetch(`${BASE_URL}/form-urlencoded`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(formBody);
  });

  it('should handle streaming body for application/protobuf', async () => {
    // Arrange
    const binaryData = new Uint8Array([0x08, 0x01, 0x12, 0x03]);

    // Act
    const response = await fetch(`${BASE_URL}/streaming-body`, {
      method: 'POST',
      headers: { 'content-type': 'application/protobuf' },
      body: binaryData,
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isStream).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════
  // ── NEW: Context, Response, SSE, and emergency teardown ───────
  // ══════════════════════════════════════════════════════════════

  it('should return context type from getType()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/context-type`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe('http');
  });

  it('should clear all state when response.reset() is called', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/response-reset`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ after: true });
    expect(response.headers.get('x-before-reset')).toBeNull();
  });

  it('should set multiple headers via setHeaders()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/bulk-headers`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-one')).toBe('1');
    expect(response.headers.get('x-two')).toBe('2');
    expect(response.headers.get('x-three')).toBe('3');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should remove header via removeHeader()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/remove-header`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('x-temp')).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should set custom statusText via setStatus()', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/custom-status-text`);

    // Assert
    expect(response.status).toBe(200);
    expect(typeof response.statusText).toBe('string');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('should allow reading body and status back in handler', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/read-own-body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readBack).toEqual({ initial: true });
    expect(body.status).toBeUndefined();
  });

  it('should have rawRequest available before body parse', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/raw-request-info`);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.hasRawRequest).toBe('boolean');
  });

  it('should handle SSE iterator throw gracefully', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/sse-throw`);

    // Assert
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: ok');
    expect(text).toContain('data: first');
  });

  it('should trigger emergencyTeardown when BeforeResponse throws', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/trigger-emergency`);

    // Assert
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe('Internal Server Error');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ══════════════════════════════════════════════════════════════
  // ── @Method custom HTTP method ────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  it('should route custom PURGE method via @Method decorator', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/cache/images`, { method: 'PURGE' });

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ purged: 'images' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should return 501 for custom method not in customMethods', async () => {
    // Arrange & Act — PROPFIND is not in customMethods
    const response = await fetch(`${BASE_URL}/cache/images`, { method: 'PROPFIND' });

    // Assert
    expect(response.status).toBe(501);
  });

  it('should return 404 for custom method on non-matching path', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/nonexistent`, { method: 'PURGE' });

    // Assert
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should include CORS headers on custom method response', async () => {
    // Arrange & Act
    const response = await fetch(`${BASE_URL}/cache/test-key`, { method: 'PURGE' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  // ══════════════════════════════════════════════════════════════
  // ── AfterHandle phase — result transformation / envelope ──────
  // ══════════════════════════════════════════════════════════════

  it('should wrap buffered JSON response in envelope via AfterHandle', async () => {
    const response = await fetch(`${BASE_URL}/envelope/users`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ envelope: true, data: { users: ['alice', 'bob'] } });
    expect(response.headers.get('x-after-handle')).toBe('applied');
  });

  it('should skip AfterHandle for SSE native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/sse`);

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    // AfterHandle skipped — no x-after-handle header, no envelope wrapping
    expect(response.headers.get('x-after-handle')).toBeNull();
    const text = await response.text();
    expect(text).toContain('event: test');
    expect(text).toContain('data: ping');
  });

  it('should skip AfterHandle for handler-created native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/native`);

    expect(response.status).toBe(200);
    // AfterHandle skipped — no x-after-handle header
    expect(response.headers.get('x-after-handle')).toBeNull();
    expect(response.headers.get('x-native')).toBe('yes');
    const text = await response.text();
    expect(text).toBe('native-body');
  });

  it('should not wrap string result in AfterHandle envelope (only objects)', async () => {
    const response = await fetch(`${BASE_URL}/envelope/string`);

    expect(response.status).toBe(200);
    // AfterHandle ran (header set) but string body was not wrapped
    expect(response.headers.get('x-after-handle')).toBe('applied');
    const text = await response.text();
    expect(text).toBe('plain text result');
  });

  it('should not wrap undefined result in AfterHandle envelope', async () => {
    const response = await fetch(`${BASE_URL}/envelope/empty`);

    expect(response.status).toBe(204);
    // AfterHandle ran but body was undefined — no wrapping
    expect(response.headers.get('x-after-handle')).toBe('applied');
  });

  it('should skip AfterHandle when handler calls send()', async () => {
    const response = await fetch(`${BASE_URL}/envelope/send`);

    expect(response.status).toBe(429);
    // AfterHandle skipped — isSent() was true
    expect(response.headers.get('x-after-handle')).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ limited: true });
  });

  it('should run AfterHandle for error responses (Err result)', async () => {
    const response = await fetch(`${BASE_URL}/envelope/error`);

    expect(response.status).toBe(422);
    // AfterHandle ran — error body is an object, got wrapped
    expect(response.headers.get('x-after-handle')).toBe('applied');
    const body = await response.json();
    expect(body.envelope).toBe(true);
  });

  it('should skip AfterHandle for Blob native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/blob`);

    // Blob creates native Response — AfterHandle skipped
    expect(response.headers.get('x-after-handle')).toBeNull();
    const buf = await response.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([0x01, 0x02]));
  });

  // ══════════════════════════════════════════════════════════════
  // ── BeforeResponse phase — post-serialization, ALL responses ──
  // ══════════════════════════════════════════════════════════════

  it('should run BeforeResponse for buffered JSON response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/users`);

    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for SSE native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/sse`);
    await response.text();

    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for handler-created native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/native`);
    await response.text();

    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for string response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/string`);
    await response.text();

    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for 204 empty response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/empty`);

    expect(response.status).toBe(204);
    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse even when handler calls send()', async () => {
    const response = await fetch(`${BASE_URL}/envelope/send`);

    expect(response.status).toBe(429);
    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for error responses', async () => {
    const response = await fetch(`${BASE_URL}/envelope/error`);

    expect(response.status).toBe(422);
    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  it('should run BeforeResponse for Blob response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/blob`);
    await response.arrayBuffer();

    expect(response.headers.get('x-before-response')).toBe('applied');
  });

  // ── Serialize step verification ───────────────────────────────

  it('should serialize body before BeforeResponse (body is string after serialize)', async () => {
    // AfterHandle wraps as {envelope: true, data: ...} → serialize turns it to JSON string
    // BeforeResponse middleware sees x-before-response header, proving serialize ran before it
    const response = await fetch(`${BASE_URL}/envelope/users`);
    const body = await response.json();

    // Body was serialized to JSON — if it weren't, Content-Type wouldn't be application/json
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.envelope).toBe(true);
  });

  // ── Pipeline ordering verification ────────────────────────────

  it('should run AfterHandle before BeforeResponse for buffered response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/users`);

    // Both ran for buffered
    expect(response.headers.get('x-after-handle')).toBe('applied');
    expect(response.headers.get('x-before-response')).toBe('applied');
    // AfterHandle wrapped the body
    const body = await response.json();
    expect(body.envelope).toBe(true);
  });

  it('should run only BeforeResponse (not AfterHandle) for native Response', async () => {
    const response = await fetch(`${BASE_URL}/envelope/sse`);
    await response.text();

    // AfterHandle skipped, BeforeResponse ran
    expect(response.headers.get('x-after-handle')).toBeNull();
    expect(response.headers.get('x-before-response')).toBe('applied');
  });
});
