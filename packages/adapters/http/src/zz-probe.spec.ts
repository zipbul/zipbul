import { describe, expect, it } from 'bun:test';

import type { HttpRequest } from './http-request';

import { HttpHeader, HttpStatus } from './enums';
import { HttpResponse } from './http-response';

function makeRes(method = 'GET'): HttpResponse {
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

/** Mirrors the send boundary: http-server.ts:343 */
function wire(res: HttpResponse): Response {
  return res.getNativeResponse() ?? res.end();
}

// ─────────────────────────────────────────────────────────────
// P1: replaceBodyStream — double swap, status 0, statusText, no native
// ─────────────────────────────────────────────────────────────

describe('P1 replaceBodyStream', () => {
  it('P1a: double swap — body survives, no cancelled-in-flight stream', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('hello'), { status: 200 }));

    const s1 = res.getBodyStream()!;
    res.replaceBodyStream(s1.pipeThrough(new TransformStream()));
    const s2 = res.getBodyStream()!;
    res.replaceBodyStream(s2.pipeThrough(new TransformStream()));

    const w = wire(res);
    console.log('P1a status=', w.status, 'body=', JSON.stringify(await w.text()));
  });

  it('P1b: statusText is preserved across a swap', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('x'), { status: 201, statusText: 'Created' }));
    res.replaceBodyStream(streamOf('y'));
    const w = wire(res);
    console.log('P1b status=', w.status, 'statusText=', JSON.stringify(w.statusText));
  });

  it('P1c: Response.error() (status 0) + buffered setStatus', async () => {
    const res = makeRes();
    res.setStatus(HttpStatus.ServiceUnavailable);
    const err = Response.error();
    console.log('P1c native status=', err.status, 'statusText=', JSON.stringify(err.statusText), 'body=', err.body);
    res.setNativeResponse(err);
    console.log('P1c getStatus BEFORE swap=', res.getStatus());
    res.replaceBodyStream(streamOf('z'));
    console.log('P1c getStatus AFTER swap=', res.getStatus());
    const w = wire(res);
    console.log('P1c WIRE status=', w.status);
  });

  it('P1d: no native set — replaceBodyStream falls back to setBody', async () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setHeader('x-mw', 'mw');
    res.replaceBodyStream(streamOf('body'));
    const w = wire(res);
    console.log('P1d status=', w.status, 'x-mw=', w.headers.get('x-mw'), 'body=', JSON.stringify(await w.text()));
  });

  it('P1e: leak check — old stream cancelled when NOT piped', async () => {
    let cancelled = false;
    const old = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    });
    const res = makeRes();
    res.setNativeResponse(new Response(old));
    res.replaceBodyStream(streamOf('new'));
    await Bun.sleep(5);
    console.log('P1e old stream cancelled =', cancelled);
  });

  it('P1f: the stream being installed is the one being cancelled (compression pattern)', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('payload-abc'), { status: 200 }));
    const src = res.getBodyStream()!;
    // compression does exactly this: transform(src) evaluated, THEN replaceBodyStream
    const transformed = src.pipeThrough(new TransformStream());
    res.replaceBodyStream(transformed);
    const w = wire(res);
    const text = await w.text();
    console.log('P1f body after swap =', JSON.stringify(text));
  });
});

// ─────────────────────────────────────────────────────────────
// P2: hoist collision — does the body swap change header precedence?
// ─────────────────────────────────────────────────────────────

describe('P2 hoist collision', () => {
  function build(swap: boolean): Response {
    const res = makeRes();
    res.setHeader('x-collide', 'mw');           // middleware, BEFORE handler
    res.setHeader(HttpHeader.ContentType, 'text/plain; charset=utf-8');
    res.setNativeResponse(new Response(streamOf('B'), {
      headers: { 'x-collide': 'native', 'content-type': 'application/octet-stream' },
    }));                                        // handler's native carries the same keys
    if (swap) res.replaceBodyStream(streamOf('B2'));
    return wire(res);
  }

  it('P2a: plain merge vs merge-after-swap must agree', () => {
    const plain = build(false);
    const swapped = build(true);
    console.log('P2 plain   x-collide=', plain.headers.get('x-collide'), 'ct=', plain.headers.get('content-type'));
    console.log('P2 swapped x-collide=', swapped.headers.get('x-collide'), 'ct=', swapped.headers.get('content-type'));
    expect(swapped.headers.get('x-collide')).toBe(plain.headers.get('x-collide')!);
  });

  it('P2b: middleware setHeader AFTER the swap (post-compression mw)', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('B'), { headers: { 'x-collide': 'native' } }));
    // no swap: a later middleware setHeader loses to native
    res.setHeader('x-collide', 'late-mw');
    console.log('P2b NO-swap  read=', res.getHeader('x-collide'), 'wire=', wire(res).headers.get('x-collide'));

    const res2 = makeRes();
    res2.setNativeResponse(new Response(streamOf('B'), { headers: { 'x-collide': 'native' } }));
    res2.replaceBodyStream(streamOf('B2'));
    res2.setHeader('x-collide', 'late-mw');
    console.log('P2b WITH-swap read=', res2.getHeader('x-collide'), 'wire=', wire(res2).headers.get('x-collide'));
  });
});

// ─────────────────────────────────────────────────────────────
// P3: Set-Cookie end to end
// ─────────────────────────────────────────────────────────────

describe('P3 Set-Cookie', () => {
  it('P3a: native cookie + mw cookie, both survive a swap, undoubled', () => {
    const res = makeRes();
    const native = new Response(streamOf('B'));
    native.headers.append(HttpHeader.SetCookie, 'a=1; Path=/');
    native.headers.append(HttpHeader.SetCookie, 'b=2; Path=/');
    res.setNativeResponse(native);
    res.appendHeader(HttpHeader.SetCookie, 'sid=xyz; HttpOnly'); // cookie middleware
    console.log('P3a NO-swap wire cookies=', wire(res).headers.getSetCookie());

    const res2 = makeRes();
    const native2 = new Response(streamOf('B'));
    native2.headers.append(HttpHeader.SetCookie, 'a=1; Path=/');
    native2.headers.append(HttpHeader.SetCookie, 'b=2; Path=/');
    res2.setNativeResponse(native2);
    res2.appendHeader(HttpHeader.SetCookie, 'sid=xyz; HttpOnly');
    res2.replaceBodyStream(streamOf('B2'));
    console.log('P3a WITH-swap wire cookies=', wire(res2).headers.getSetCookie());
  });

  it('P3b: DOUBLE swap — cookies duplicated?', () => {
    const res = makeRes();
    const native = new Response(streamOf('B'));
    native.headers.append(HttpHeader.SetCookie, 'a=1');
    res.setNativeResponse(native);
    res.appendHeader(HttpHeader.SetCookie, 'sid=xyz');
    res.replaceBodyStream(streamOf('B2'));
    res.replaceBodyStream(streamOf('B3'));
    console.log('P3b double-swap wire cookies=', wire(res).headers.getSetCookie());
  });

  it('P3c: getHeader(set-cookie) is null even when cookies exist', () => {
    const res = makeRes();
    res.appendHeader(HttpHeader.SetCookie, 'sid=xyz');
    console.log('P3c getHeader(set-cookie)=', res.getHeader('set-cookie'), '| wire=', wire(res).headers.getSetCookie());
  });
});

// ─────────────────────────────────────────────────────────────
// P5: @Status on the streaming path
// ─────────────────────────────────────────────────────────────

describe('P5 status vs stream', () => {
  it('P5a: setStatus(201) then a stream body', async () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created); // route @Status(201), applied BEFORE the handler
    res.setBody(streamOf('event'));    // handler returns a stream
    console.log('P5a getStatus()=', res.getStatus(), 'WIRE status=', wire(res).status);
  });

  it('P5b: setStatus(201) then setNativeResponse (SSE path)', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setNativeResponse(new Response(streamOf('data: 1\n\n'), {
      headers: { 'content-type': 'text/event-stream' },
    }));
    console.log('P5b getStatus()=', res.getStatus(), 'WIRE status=', wire(res).status);
  });

  it('P5c: setStatus AFTER a native is set (middleware wants to change status)', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('x')));
    res.setStatus(HttpStatus.ServiceUnavailable);
    console.log('P5c getStatus()=', res.getStatus(), 'WIRE status=', wire(res).status);
  });
});

// ─────────────────────────────────────────────────────────────
// P6: emergencyTeardown after a replaceBodyStream
// ─────────────────────────────────────────────────────────────

describe('P6 emergencyTeardown after swap', () => {
  it('P6a: 500 after compression swapped the body', async () => {
    const res = makeRes();
    res.setHeader('access-control-allow-origin', 'https://app.example'); // CORS mw
    res.setNativeResponse(new Response(streamOf('big-html'), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': '8',
        etag: '"v1"',
        'cache-control': 'max-age=60',
      },
    }));
    // compression stream path
    res.replaceBodyStream(streamOf('GZIPPED'))
      .setHeader(HttpHeader.ContentEncoding, 'gzip')
      .removeHeader(HttpHeader.ContentLength);

    // ...then an AfterResponse/post-step throws → emergencyTeardown
    res.setStatus(HttpStatus.InternalServerError);
    res.setContentType('text/plain');
    res.setBody('Internal Server Error');

    const w = wire(res);
    console.log('P6a WIRE status=', w.status);
    console.log('P6a WIRE headers=', [...w.headers.entries()]);
    console.log('P6a WIRE body=', JSON.stringify(await w.text()));
  });
});

// ─────────────────────────────────────────────────────────────
// P7: setBody(Blob) Content-Type
// ─────────────────────────────────────────────────────────────

describe('P7 Blob content-type', () => {
  it('P7a: blob with a type, user set none', async () => {
    const res = makeRes();
    res.setBody(new Blob(['abc'], { type: 'image/png' }));
    const w = wire(res);
    console.log('P7a read=', res.getContentType(), '| WIRE ct=', w.headers.get('content-type'), 'cl=', w.headers.get('content-length'));
  });

  it('P7b: blob with a type, user set one', async () => {
    const res = makeRes();
    res.setContentType('application/pdf');
    res.setBody(new Blob(['abc'], { type: 'image/png' }));
    const w = wire(res);
    console.log('P7b read=', res.getContentType(), '| WIRE ct=', w.headers.get('content-type'));
  });

  it('P7c: a PREVIOUS native had a CT — blob type lost?', async () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('{}'), { headers: { 'content-type': 'application/json' } }));
    res.setBody(new Blob(['\x89PNG'], { type: 'image/png' }));
    const w = wire(res);
    console.log('P7c read=', res.getContentType(), '| WIRE ct=', w.headers.get('content-type'), '| body=', JSON.stringify(await w.text()));
  });
});
