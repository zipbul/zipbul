import { describe, expect, it } from 'bun:test';

import type { HttpRequest } from './http-request';

import { ContentType, HttpHeader, HttpMethod, HttpStatus } from './enums';
import { HttpResponse } from './http-response';

function makeRes(method: HttpMethod = HttpMethod.Get): HttpResponse {
  return new HttpResponse({ method } as unknown as HttpRequest);
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

/**
 * Serves an already-assembled wire `Response` and reads it back over a real
 * socket. An in-memory header read is not a wire assertion: Bun infers
 * `Content-Type` from a Blob-backed stream at send time, so what the process
 * holds in memory and what actually leaves the socket can disagree — only a
 * round trip settles which one is true.
 */
async function serve(wire: Response): Promise<Response> {
  const server = Bun.serve({ port: 0, fetch: () => wire });
  try {
    return await fetch(`http://localhost:${server.port}/`);
  } finally {
    server.stop(true);
  }
}

describe('status survives assembly into the wire response', () => {
  // A route's `@Status(201)` is applied before the handler runs. When the
  // handler then returns a stream, the framework wraps it — that wrapper must
  // carry the status the pipeline already committed to, or the wire ships
  // whatever the wrapper defaults to instead of what was asked for.
  it('keeps a status set before a streaming body was assigned', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setBody(streamOf('x'));

    expect(res.getStatus()).toBe(HttpStatus.Created);
    expect(res.end().status).toBe(HttpStatus.Created);
  });

  it('keeps a status set before a Blob body was assigned', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Accepted);
    res.setBody(new Blob(['x'], { type: 'text/plain' }));

    expect(res.getStatus()).toBe(HttpStatus.Accepted);
    expect(res.end().status).toBe(HttpStatus.Accepted);
  });

  // A Response the handler hands back is its own explicit choice, made after
  // whatever the pipeline set earlier — it wins, and that includes the wire,
  // not just an in-memory read.
  it('lets a handler-supplied Response keep its own status over an earlier setStatus', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setNativeResponse(new Response(streamOf('x'), { status: HttpStatus.PartialContent }));

    expect(res.getStatus()).toBe(HttpStatus.PartialContent);
    expect(res.end().status).toBe(HttpStatus.PartialContent);
  });

  // A native being discarded takes its status with it — the buffered status is
  // the framework's own model, and it is what both the reader and the wire
  // report once the native that briefly shadowed it is gone.
  it('does not inherit a discarded native’s status', () => {
    const res = makeRes();
    res.setNativeResponse(new Response('x', { status: HttpStatus.PartialContent }));
    res.setStatus(HttpStatus.Created);
    res.setBody(streamOf('x'));

    expect(res.getStatus()).toBe(HttpStatus.Created);
    expect(res.end().status).toBe(HttpStatus.Created);
  });
});

describe('a Response.error() (status 0) normalizes rather than reaching the wire as-is', () => {
  it('reports the status set before Response.error() was attached', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.ServiceUnavailable);
    res.setNativeResponse(Response.error());

    expect(res.getStatus()).toBe(HttpStatus.ServiceUnavailable);
    expect(res.end().status).toBe(HttpStatus.ServiceUnavailable);
  });

  // Status 0 is not a wire status. Assembling it must not throw while
  // building the response, and with no prior status to fall back to, it
  // normalizes to a generic server error rather than shipping unset.
  it('assembles without throwing and falls back to 500 when no status was set', () => {
    const res = makeRes();
    res.setNativeResponse(Response.error());

    let wire: Response | undefined;
    expect(() => {
      wire = res.end();
    }).not.toThrow();
    expect(wire!.status).toBe(HttpStatus.InternalServerError);
  });

  it('keeps the buffered status after a body swap', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.ServiceUnavailable);
    res.setNativeResponse(Response.error());

    res.replaceBodyStream(streamOf('x'));

    expect(res.getStatus()).toBe(HttpStatus.ServiceUnavailable);
    expect(res.end().status).toBe(HttpStatus.ServiceUnavailable);
  });
});

describe('replaceBodyStream with the response’s own stream', () => {
  // Handing back the very stream being replaced must not cancel it and then
  // try to reuse it — a middleware that decides mid-flight not to transform
  // would crash instead of being a no-op.
  it('does not throw when the replacement is the current body', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('x')));

    const current = res.getBodyStream();
    expect(() => res.replaceBodyStream(current!)).not.toThrow();
  });

  it('still delivers the body after such a no-op replacement', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('payload')));

    res.replaceBodyStream(res.getBodyStream()!);

    expect(await res.end().text()).toBe('payload');
  });

  // There is no longer a separate "no prior body" branch (the old
  // implementation special-cased an absent native response by falling back
  // to setBody) — replaceBodyStream is a single unified path regardless of
  // what the slot held before.
  it('delivers the replacement body from the initial, bodyless state', async () => {
    const res = makeRes();

    res.replaceBodyStream(streamOf('streamed'));

    expect(await res.end().text()).toBe('streamed');
  });
});

describe('Set-Cookie order across a body swap (last write wins)', () => {
  // A user agent keeps the LAST Set-Cookie for a given name. A cookie written
  // after the handler (e.g. a rotated session id) must still be last after a
  // middleware swaps the body — compression calls this on exactly the
  // streaming routes where a swapped order would bite.
  function withCookies(): HttpResponse {
    const res = makeRes();
    res.setNativeResponse(
      new Response(streamOf('x'), { headers: { 'set-cookie': 'sid=STALE; Path=/' } }),
    );
    res.appendHeader(HttpHeader.SetCookie, 'sid=ROTATED; Path=/; HttpOnly');
    return res;
  }

  it('keeps the rotated cookie last, as it is without a swap', () => {
    const noSwap = withCookies();
    expect(noSwap.end().headers.getSetCookie()).toEqual([
      'sid=STALE; Path=/',
      'sid=ROTATED; Path=/; HttpOnly',
    ]);

    const swapped = withCookies();
    swapped.replaceBodyStream(streamOf('y'));

    expect(swapped.end().headers.getSetCookie()).toEqual([
      'sid=STALE; Path=/',
      'sid=ROTATED; Path=/; HttpOnly',
    ]);
  });

  it('does not duplicate cookies across repeated swaps', () => {
    const res = withCookies();
    res.replaceBodyStream(streamOf('y'));
    res.replaceBodyStream(streamOf('z'));

    expect(res.end().headers.getSetCookie()).toEqual([
      'sid=STALE; Path=/',
      'sid=ROTATED; Path=/; HttpOnly',
    ]);
  });
});

describe('setNativeResponse folds every Set-Cookie the native response carries', () => {
  // The fold loop appends each of the native Response's own cookies in turn
  // (getSetCookie() returns however many it set) — a regression pin for N≥2,
  // since a single cookie alone doesn't exercise the loop.
  it('carries both cookies through, in order', () => {
    const res = makeRes();
    const native = new Response(streamOf('x'));
    native.headers.append(HttpHeader.SetCookie, 'sid=A; Path=/');
    native.headers.append(HttpHeader.SetCookie, 'csrf=B; Path=/');

    res.setNativeResponse(native);

    expect(res.end().headers.getSetCookie()).toEqual([
      'sid=A; Path=/',
      'csrf=B; Path=/',
    ]);
  });
});

describe('Vary unions with an existing value when a native response is decomposed', () => {
  // A middleware (e.g. cors) may set Vary before the handler runs. When the
  // handler's own Response is decomposed, its own Vary must union with, not
  // clobber, the earlier value (RFC 9110 §12.5.5) — losing either token lets
  // a shared cache mis-select the representation. A later body swap (e.g.
  // compression) must not disturb it either.
  it('unions the native response’s Vary with a Vary set before it, and keeps both after a body swap', () => {
    const res = makeRes();
    res.appendHeader(HttpHeader.Vary, 'Origin'); // e.g. cors, before the handler
    res.setNativeResponse(
      new Response(streamOf('original'), { headers: { [HttpHeader.Vary]: 'Accept-Language' } }),
    );
    res.replaceBodyStream(streamOf('compressed'));

    const vary = res.end().headers.get(HttpHeader.Vary) ?? '';
    const tokens = vary.split(',').map((t) => t.trim().toLowerCase());
    expect(tokens).toContain('origin');
    expect(tokens).toContain('accept-language');
  });
});

describe('Content-Type of a Blob body, as declared and as it reaches the socket', () => {
  it('ships the Blob’s own type and its own bytes when the caller set none', async () => {
    const res = makeRes();
    res.setBody(new Blob(['x'], { type: 'text/csv' }));

    expect(res.getContentType()).toBe('text/csv; charset=utf-8');

    const fetched = await serve(res.end());
    expect(fetched.headers.get(HttpHeader.ContentType)).toBe('text/csv; charset=utf-8');
    expect(await fetched.text()).toBe('x');
  });

  it('ships an explicitly-set type and the Blob’s bytes rather than the Blob’s own type', async () => {
    const res = makeRes();
    res.setContentType(ContentType.Json);
    res.setBody(new Blob(['{}'], { type: 'image/png' }));

    expect(res.getContentType()).toBe(`${ContentType.Json}; charset=utf-8`);

    const fetched = await serve(res.end());
    expect(fetched.headers.get(HttpHeader.ContentType)).toBe(`${ContentType.Json}; charset=utf-8`);
    expect(await fetched.text()).toBe('{}');
  });

  // `removeHeader` has to actually remove: Bun re-infers the type from the
  // Blob backing the body when the assembled response carries no Content-Type
  // of its own, and that inference happens at send time — deleting the header
  // in memory is not enough to stop it reaching the socket. The Blob's own
  // bytes must still ship — an untyped body is not the same claim as no body.
  it('ships no type at all once the caller removed it, defeating Bun’s send-time inference', async () => {
    const res = makeRes();
    res.setBody(new Blob(['x'], { type: 'image/png' }));
    res.removeHeader(HttpHeader.ContentType);

    expect(res.getContentType()).toBeNull();

    const fetched = await serve(res.end());
    expect(fetched.headers.get(HttpHeader.ContentType)).toBeNull();
    expect(await fetched.text()).toBe('x');
  });

  // Content-Type is declared, not derived from bytes. A native's own
  // declaration and an imperative setContentType are the same kind of fact —
  // whichever was declared last owns the header, and a later Blob only fills
  // an empty slot. The read and the wire must agree on which declaration won.
  it('is owned by the last declaration, not by the type of a Blob written after it', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response('x', { headers: { 'content-type': ContentType.Json } }));
    res.setBody(new Blob(['x'], { type: 'image/png' }));

    expect(res.getContentType()).toBe(ContentType.Json);
    expect((await serve(res.end())).headers.get(HttpHeader.ContentType)).toBe(ContentType.Json);
  });

  // A discarded native's declared Content-Type is a real declaration, not
  // bytes-derived metadata that should die with the representation it
  // labeled — it outlives the native and labels whatever is written next.
  it('outlives a discarded native and labels a later buffered body', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response('x', { headers: { 'content-type': 'text/csv' } }));
    res.setBody({ error: true });

    expect(res.getContentType()).toBe('text/csv');

    const fetched = await serve(res.end());
    expect(fetched.headers.get(HttpHeader.ContentType)).toBe('text/csv');
    expect(await fetched.text()).toBe('{"error":true}');
  });
});

describe('Content-Length reflects only the current body', () => {
  // A new body has a different length than the one before it — a length
  // computed for a previous representation must not survive to describe
  // bytes it no longer measures.
  it('clears a stale Content-Length when the body is replaced with something shorter', () => {
    const res = makeRes();
    res.setBody(new Blob([new Array(5000).fill('a').join('')]));
    res.setBody('short');

    expect(res.getHeader(HttpHeader.ContentLength)).toBeNull();
  });

  it('declares the Blob’s own size', () => {
    const res = makeRes();
    res.setBody(new Blob(['hello']));

    expect(res.getHeader(HttpHeader.ContentLength)).toBe('5');
  });

  it('declares 0 for an empty Blob', () => {
    const res = makeRes();
    res.setBody(new Blob([]));

    expect(res.getHeader(HttpHeader.ContentLength)).toBe('0');
  });
});

describe('Location is subordinate to status, not the other way around', () => {
  // RFC 9110 §10.2.2: the meaning of Location depends on the status. On a 2xx
  // (e.g. 201 Created) it names the created resource, it does not make the
  // response a redirect — the created resource's own body must still ship.
  it('keeps a 2xx status and its body when Location is present', async () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setHeader(HttpHeader.Location, '/users/42');
    res.setBody({ id: 42 });

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.Created);
    expect(wire.headers.get(HttpHeader.Location)).toBe('/users/42');
    expect(await wire.text()).toBe('{"id":42}');
  });

  it('keeps the same contract when the 2xx + Location + body comes from a handler-supplied Response', async () => {
    const res = makeRes();
    res.setNativeResponse(
      new Response('{"id":42}', {
        status: HttpStatus.Created,
        headers: { location: '/users/42' },
      }),
    );

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.Created);
    expect(wire.headers.get(HttpHeader.Location)).toBe('/users/42');
    expect(await wire.text()).toBe('{"id":42}');
  });

  // Dropping the body on a 3xx isn't an RFC MUST — it's framework policy,
  // matching modern conventions (Hono and other Fetch-based frameworks).
  it('drops the body on an explicitly-set 3xx redirect status', async () => {
    const res = makeRes();
    res.setStatus(HttpStatus.MovedPermanently);
    res.setHeader(HttpHeader.Location, '/next');
    res.setBody('x');

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.MovedPermanently);
    expect(wire.headers.get(HttpHeader.Location)).toBe('/next');
    expect(await wire.text()).toBe('');
  });

  it('defaults to 302 when no status was set before Location', async () => {
    const res = makeRes();
    res.setHeader(HttpHeader.Location, '/x');
    res.setBody('ignored');

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.Found);
    expect(await wire.text()).toBe('');
  });
});

describe('body slot observation contract', () => {
  it('auto-204s once the body is explicitly cleared', () => {
    const res = makeRes();
    res.setBody('x');
    res.setBody(undefined);

    expect(res.end().status).toBe(HttpStatus.NoContent);
  });

  it('ships 200 with an empty body for an explicit null body', async () => {
    const res = makeRes();
    res.setBody(null);

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.Ok);
    expect(await wire.text()).toBe('');
  });

  it('auto-204s from the initial, untouched state', () => {
    const res = makeRes();

    expect(res.end().status).toBe(HttpStatus.NoContent);
  });
});
