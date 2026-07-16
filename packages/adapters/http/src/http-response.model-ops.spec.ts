import { describe, expect, it } from 'bun:test';

import type { HttpRequest } from './http-request';

import { ContentType, HttpHeader, HttpMethod, HttpStatus, ResponseBodyKind } from './enums';
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

describe('bodyKind reflects the body slot as it moves through the model', () => {
  // The single BodySlot union is the whole point of the redesign — this walks
  // every transition the slot supports in one sequence: unassigned, a value
  // the framework shapes, a body it doesn't shape, and back to unassigned.
  it('moves None -> Buffered -> Stream -> None as the body is reassigned', () => {
    const res = makeRes();
    expect(res.bodyKind).toBe(ResponseBodyKind.None);

    res.setBody({ id: 1 });
    expect(res.bodyKind).toBe(ResponseBodyKind.Buffered);

    res.setBody(streamOf('x'));
    expect(res.bodyKind).toBe(ResponseBodyKind.Stream);

    res.setBody(undefined);
    expect(res.bodyKind).toBe(ResponseBodyKind.None);
  });
});

describe('getBodyStream reflects the body slot', () => {
  it('is null when the body is buffered, not a stream', () => {
    const res = makeRes();
    res.setBody('buffered');

    expect(res.getBodyStream()).toBeNull();
  });
});

describe('replaceRepresentation discards the metadata of the representation it replaced', () => {
  it('removes Content-Encoding, ETag, Cache-Control, Last-Modified, Content-Digest, and Repr-Digest', () => {
    const res = makeRes();
    res.setHeader(HttpHeader.ContentEncoding, 'gzip');
    res.setHeader(HttpHeader.ETag, '"v1"');
    res.setHeader(HttpHeader.CacheControl, 'max-age=60');
    res.setHeader(HttpHeader.LastModified, 'Wed, 21 Oct 2015 07:28:00 GMT');
    res.setHeader(HttpHeader.ContentDigest, 'sha-256=:abc:');
    res.setHeader(HttpHeader.ReprDigest, 'sha-256=:abc:');

    res.replaceRepresentation('new representation');

    expect(res.getHeader(HttpHeader.ContentEncoding)).toBeNull();
    expect(res.getHeader(HttpHeader.ETag)).toBeNull();
    expect(res.getHeader(HttpHeader.CacheControl)).toBeNull();
    expect(res.getHeader(HttpHeader.LastModified)).toBeNull();
    expect(res.getHeader(HttpHeader.ContentDigest)).toBeNull();
    expect(res.getHeader(HttpHeader.ReprDigest)).toBeNull();
  });

  // These describe the exchange (CORS negotiation, session state, cache
  // variance), not the body — dropping them would, for example, turn a
  // readable error response into an opaque network error in the browser.
  it('keeps exchange headers: CORS, Set-Cookie, and Vary', () => {
    const res = makeRes();
    res.setHeader(HttpHeader.AccessControlAllowOrigin, 'https://app.example');
    res.appendHeader(HttpHeader.SetCookie, 'sid=1; Path=/');
    res.setHeader(HttpHeader.Vary, 'Accept-Encoding');

    res.replaceRepresentation('new representation');

    expect(res.getHeader(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example');
    expect(res.end().headers.getSetCookie()).toEqual(['sid=1; Path=/']);
    expect(res.getHeader(HttpHeader.Vary)).toBe('Accept-Encoding');
  });

  // Routed through setBody internally — a stale length describing the old
  // representation's byte count must not survive to label the new one.
  it('clears a stale Content-Length via the same path setBody uses', () => {
    const res = makeRes();
    res.setBody(new Blob(['a very long previous representation']));

    res.replaceRepresentation('short');

    expect(res.getHeader(HttpHeader.ContentLength)).toBeNull();
  });

  it('assigns the given value as the new buffered body', () => {
    const res = makeRes();
    res.setBody('old');

    res.replaceRepresentation('replacement');

    expect(res.getBody()).toBe('replacement');
    expect(res.bodyKind).toBe(ResponseBodyKind.Buffered);
  });
});

describe('serialize() is idempotent', () => {
  it('produces the same JSON on a second call as on the first', () => {
    const res = makeRes();
    res.setBody({ id: 1, name: 'a' });

    res.serialize();
    const first = res.getBody();
    res.serialize();
    const second = res.getBody();

    expect(second).toBe(first);
    expect(second).toBe('{"id":1,"name":"a"}');
  });
});

describe('serialize() never stringifies a binary body', () => {
  it('leaves a Uint8Array body untouched', () => {
    const res = makeRes();
    const bytes = new Uint8Array([1, 2, 3]);
    res.setBody(bytes);

    res.serialize();

    expect(res.getBody()).toBe(bytes);
  });

  it('leaves an ArrayBuffer body untouched', () => {
    const res = makeRes();
    const buffer = new Uint8Array([4, 5, 6]).buffer;
    res.setBody(buffer);

    res.serialize();

    expect(res.getBody()).toBe(buffer);
  });
});

describe('an explicit null body serializes to an empty body, not the text "null"', () => {
  it('leaves the body as null and infers a text Content-Type', () => {
    const res = makeRes();
    res.setBody(null);

    res.serialize();

    expect(res.getBody()).toBeNull();
    expect(res.getContentType()).toBe('text/plain; charset=utf-8');
  });
});

describe('setNativeResponse drops stale representation metadata when normalizing Response.error()', () => {
  // Response.error() replaces whatever representation a prior step described
  // with a generic error — the ETag/Cache-Control/Content-Length describing
  // the old representation are now false and must not label the 500.
  // Exchange headers (CORS) are not about the body and survive.
  it('clears ETag, Cache-Control, and Content-Length but keeps exchange headers, on the normalized 500', () => {
    const res = makeRes();
    res.setHeader(HttpHeader.ETag, '"v1"');
    res.setHeader(HttpHeader.CacheControl, 'max-age=60');
    res.setHeader(HttpHeader.ContentLength, '5000');
    res.setHeader(HttpHeader.AccessControlAllowOrigin, 'https://app.example');

    res.setNativeResponse(Response.error());

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.InternalServerError);
    expect(wire.headers.get(HttpHeader.ETag)).toBeNull();
    expect(wire.headers.get(HttpHeader.CacheControl)).toBeNull();
    expect(wire.headers.get(HttpHeader.ContentLength)).toBeNull();
    expect(wire.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example');
  });
});

describe('the out-of-range-status fallback declares its own Content-Type', () => {
  // replaceRepresentation deliberately leaves Content-Type alone (§9: CT is
  // declared, not derived from bytes) — so the substituted plain-text 500
  // body must not ship under a stale label an earlier step declared.
  it('ships text/plain on the substituted body, not the stale label set before the fallback', async () => {
    const res = makeRes();
    res.setStatus(999 as HttpStatus);
    res.setContentType(ContentType.Json);
    res.setBody('x');

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.InternalServerError);
    expect(wire.headers.get(HttpHeader.ContentType)).toBe(`${ContentType.Text}; charset=utf-8`);
    expect(await wire.text()).toBe('Internal Server Error');
  });

  // The out-of-range normalization must happen before the HEAD branch runs,
  // not after (inside createResponse) — otherwise HEAD's own discardBody()
  // would run first, and the fallback would re-inject a body afterward,
  // shipping "Internal Server Error" on a response that must never carry one.
  it('still ships no body on HEAD, with Content-Length reflecting the substituted representation', async () => {
    const res = makeRes(HttpMethod.Head);
    res.setStatus(600 as HttpStatus);
    res.setBody('ok');

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.InternalServerError);
    expect(wire.body).toBeNull();
    expect(wire.headers.get(HttpHeader.ContentType)).toBe(`${ContentType.Text}; charset=utf-8`);
    expect(wire.headers.get(HttpHeader.ContentLength)).toBe(
      new TextEncoder().encode('Internal Server Error').byteLength.toString(),
    );
  });
});

describe('101 Switching Protocols never carries a body', () => {
  // RFC 9110 §15.2.2: 101 has no representation — a body set before the
  // protocol switch must not ship on the wire.
  it('drops a body set before the 101 status', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.SwitchingProtocols);
    res.setBody('x');

    const wire = res.end();
    expect(wire.status).toBe(HttpStatus.SwitchingProtocols);
    expect(wire.body).toBeNull();
  });
});

describe('reset() returns the response to a fresh, reusable state', () => {
  it('clears headers, status, and body so a new representation can be built from scratch', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);
    res.setHeader(HttpHeader.ETag, '"v1"');
    res.setBody({ stale: true });

    res.reset();

    expect(res.getStatus()).toBeUndefined();
    expect(res.getHeader(HttpHeader.ETag)).toBeNull();
    expect(res.bodyKind).toBe(ResponseBodyKind.None);

    res.setStatus(HttpStatus.Accepted);
    res.setBody({ fresh: true });

    expect(res.getStatus()).toBe(HttpStatus.Accepted);
    expect(res.getBody()).toEqual({ fresh: true });
  });
});
