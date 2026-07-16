import { describe, expect, it } from 'bun:test';

import type { AdapterContext } from '@zipbul/common';
import type { MatchedRouteMetadata } from './interfaces';

import { ContentType, HttpHeader, HttpMethod, HttpStatus } from './enums';
import { HttpAdapter } from './http-adapter';
import { HttpContext } from './http-context';
import { HttpResponse } from './http-response';
import { writeErrorResponse } from './response-writer';
import { createTestHttpRequest } from './test-fixtures/http-request-fixture';

class TestAdapter extends HttpAdapter {
  public testTeardown(ctx: AdapterContext, err: unknown): void {
    this.emergencyTeardown(ctx, err);
  }
}

function buildContext(sse = false, method: HttpMethod = HttpMethod.Get): {
  ctx: AdapterContext;
  http: HttpContext;
  response: HttpResponse;
} {
  const request = createTestHttpRequest({ method });
  const response = new HttpResponse(request, new Headers());
  const http = new HttpContext(request, response);
  if (sse) {
    http.matchedRoute = { sse: true } as unknown as MatchedRouteMetadata;
  }
  return { ctx: http as unknown as AdapterContext, http, response };
}

async function* stringChunks(): AsyncIterable<unknown> {
  yield 'chunk';
}

describe('emergencyTeardown replaces the representation', () => {
  // Teardown fires on any throw inside the pipeline — including BeforeResponse, i.e.
  // after compression has already encoded the body and stamped its metadata. The 500
  // body it substitutes is a different representation, so the metadata describing the
  // old one must not ride along: a `Content-Encoding: gzip` over plain text is
  // ERR_CONTENT_DECODING_FAILED at the client, and the old ETag/Cache-Control let a
  // cache store the error page under the resource's identity.
  it('drops the metadata of the representation it discarded', () => {
    const { ctx, response } = buildContext();
    response.setStatus(HttpStatus.Ok);
    response.setHeader(HttpHeader.ContentEncoding, 'gzip');
    response.setHeader(HttpHeader.ETag, '"v1"');
    response.setHeader(HttpHeader.CacheControl, 'max-age=60');
    response.setHeader(HttpHeader.ContentDigest, 'sha-256=:abc:');
    response.setHeader(HttpHeader.LastModified, 'Wed, 21 Oct 2015 07:28:00 GMT');

    new TestAdapter().testTeardown(ctx, new Error('boom'));

    const wire = response.end();
    expect(wire.status).toBe(HttpStatus.InternalServerError);
    expect(wire.headers.get(HttpHeader.ContentEncoding)).toBeNull();
    expect(wire.headers.get(HttpHeader.ETag)).toBeNull();
    expect(wire.headers.get(HttpHeader.CacheControl)).toBeNull();
    expect(wire.headers.get(HttpHeader.ContentDigest)).toBeNull();
    expect(wire.headers.get(HttpHeader.LastModified)).toBeNull();
  });

  // Headers that describe the *exchange* rather than the representation stay: dropping
  // CORS would turn a readable 500 into an opaque network error in the browser, and the
  // security headers are exactly the ones an error page still needs.
  it('keeps the headers that are not about the body', () => {
    const { ctx, response } = buildContext();
    response.setHeader(HttpHeader.AccessControlAllowOrigin, 'https://app.example');
    response.setHeader(HttpHeader.XContentTypeOptions, 'nosniff');
    response.appendHeader(HttpHeader.SetCookie, 'sid=1; Path=/');

    new TestAdapter().testTeardown(ctx, new Error('boom'));

    const wire = response.end();
    expect(wire.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example');
    expect(wire.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
    expect(wire.headers.getSetCookie()).toEqual(['sid=1; Path=/']);
  });

  it('serves the plain-text 500 it substituted', async () => {
    const { ctx, response } = buildContext();
    response.setHeader(HttpHeader.ContentEncoding, 'gzip');

    new TestAdapter().testTeardown(ctx, new Error('boom'));

    const wire = response.end();
    expect(wire.headers.get(HttpHeader.ContentType)).toBe('text/plain; charset=utf-8');
    expect(await wire.text()).toBe('Internal Server Error');
  });
});

describe('a streaming route carries its own status', () => {
  // `@Status(201)` is applied to the response before the handler runs. The stream the
  // handler returns is wrapped by the adapter, not by the handler — so the wrapper is
  // ours to stamp, and dropping the status here ships 200 for a route that asked for 201.
  it('keeps the status set before a raw stream was written', () => {
    const { http, response } = buildContext();
    response.setStatus(HttpStatus.Created);

    new TestAdapter().writeStreamingResponse(http, stringChunks());

    expect(response.getStatus()).toBe(HttpStatus.Created);
    expect(response.end().status).toBe(HttpStatus.Created);
  });

  it('keeps the status set before an SSE stream was written, with the SSE headers', () => {
    const { http, response } = buildContext(true);
    response.setStatus(HttpStatus.Accepted);

    new TestAdapter().writeStreamingResponse(http, stringChunks());

    const wire = response.end();
    expect(wire.status).toBe(HttpStatus.Accepted);
    expect(wire.headers.get(HttpHeader.ContentType)).toBe('text/event-stream');
    expect(wire.headers.get(HttpHeader.CacheControl)).toBe('no-cache');
  });
});

describe('WriteResponse serializes an error body regardless of a leftover Content-Type label', () => {
  // `@ContentType('text/html')` stamps a label on the response before the
  // handler runs. A guard rejection is written by the same step as a success
  // body — whether that body gets serialized cannot depend on a label the
  // error writer had no say in, or the wire receives a raw object it cannot
  // send.
  it('serializes and ships the error body even though a non-JSON Content-Type was set first', async () => {
    const { response } = buildContext();
    response.setContentType('text/html'); // @ContentType('text/html') simulation

    writeErrorResponse(response, { status: HttpStatus.Forbidden, message: 'Forbidden' });
    response.serialize();

    let wire: Response | undefined;
    expect(() => {
      wire = response.end();
    }).not.toThrow();

    expect(wire!.status).toBe(HttpStatus.Forbidden);
    // The error representation declares its own Content-Type — the writer
    // owns the label for the body it produced, independent of the label the
    // success path had left behind.
    expect(wire!.headers.get(HttpHeader.ContentType)).toBe(`${ContentType.Json}; charset=utf-8`);
    expect(JSON.parse(await wire!.text())).toEqual({
      status: HttpStatus.Forbidden,
      message: 'Forbidden',
    });
  });
});

describe('writeErrorResponse replaces the representation', () => {
  // The error body is a different representation than whatever the success
  // path had already produced — a validator/cache header set before a guard
  // rejected the request describes a representation that no longer exists.
  it('drops representation metadata but keeps headers that describe the exchange', () => {
    const { response } = buildContext();
    response.setHeader(HttpHeader.ETag, '"v1"');
    response.setHeader(HttpHeader.ContentEncoding, 'gzip');
    response.setHeader(HttpHeader.CacheControl, 'max-age=60');
    response.setHeader(HttpHeader.AccessControlAllowOrigin, 'https://app.example');
    response.appendHeader(HttpHeader.SetCookie, 'sid=1; Path=/');

    writeErrorResponse(response, { status: HttpStatus.NotFound, message: 'Not Found' });

    const wire = response.end();
    expect(wire.headers.get(HttpHeader.ETag)).toBeNull();
    expect(wire.headers.get(HttpHeader.ContentEncoding)).toBeNull();
    expect(wire.headers.get(HttpHeader.CacheControl)).toBeNull();
    expect(wire.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example');
    expect(wire.headers.getSetCookie()).toEqual(['sid=1; Path=/']);
  });
});

describe('a HEAD-aliased streaming route still cancels the handler generator', () => {
  async function* streamWithFinally(flag: { ran: boolean }): AsyncGenerator<string> {
    try {
      yield 'chunk';
    } finally {
      flag.ran = true;
    }
  }

  // Every GET route is also registered under HEAD. Bun does not send a body
  // for a HEAD response, but that must not be the reason a handler's cleanup
  // (a DB cursor, a file descriptor) never runs — the stream's own `cancel()`
  // is the only hook that runs it.
  it('runs the generator’s finally once the HEAD response is assembled', async () => {
    const flag = { ran: false };
    const { http, response } = buildContext(false, HttpMethod.Head);

    new TestAdapter().writeStreamingResponse(http, streamWithFinally(flag));

    // A macrotask fully drains the stream's first pull before assembly, so
    // cancel finds the generator cleanly suspended at its yield.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wire = response.end();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(flag.ran).toBe(true);
    expect(wire.body).toBeNull();
  });

  it('runs the generator’s finally for an SSE route the same way', async () => {
    const flag = { ran: false };
    const { http, response } = buildContext(true, HttpMethod.Head);

    new TestAdapter().writeStreamingResponse(http, streamWithFinally(flag));

    // See the comment on the previous test — same reproduction of the real
    // pipeline's timing between WriteResponse and final assembly.
    await new Promise((resolve) => setTimeout(resolve, 0));
    response.end();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(flag.ran).toBe(true);
  });
});
