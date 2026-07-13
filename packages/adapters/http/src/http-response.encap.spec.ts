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

describe('encapsulated read model — read equals wire', () => {
  it('getStatus reports the native status (wire-true), not the shadow default', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('x'), { status: HttpStatus.PartialContent }));

    // Final assembly always ships the native status, so the public read must agree —
    // otherwise a middleware gate (e.g. compression skipping 206) reads 200 and acts wrongly.
    expect(res.getStatus()).toBe(HttpStatus.PartialContent);
  });

  it('getStatus falls back to the buffered status when there is no native response', () => {
    const res = makeRes();
    res.setStatus(HttpStatus.Created);

    expect(res.getStatus()).toBe(HttpStatus.Created);
  });

  it('getHeader sees headers the handler set on the native response', () => {
    const res = makeRes();
    res.setNativeResponse(
      new Response(streamOf('x'), { headers: { [HttpHeader.ContentEncoding]: 'gzip' } }),
    );

    expect(res.getHeader(HttpHeader.ContentEncoding)).toBe('gzip');
  });

  it('getHeader keeps native-wins precedence, matching the final merge', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('x'), { headers: { 'x-source': 'native' } }));
    res.setHeader('x-source', 'middleware');

    expect(res.getHeader('x-source')).toBe('native');
  });

  it('getHeader unions Vary tokens across both stores (RFC 9110 §12.5.5)', () => {
    const res = makeRes();
    res.setNativeResponse(
      new Response(streamOf('x'), { headers: { [HttpHeader.Vary]: 'Accept-Language' } }),
    );
    res.appendHeader(HttpHeader.Vary, 'Accept-Encoding');

    const vary = res.getHeader(HttpHeader.Vary) ?? '';
    const tokens = vary.split(',').map((t) => t.trim().toLowerCase());
    expect(tokens).toContain('accept-language');
    expect(tokens).toContain('accept-encoding');
  });

  it('getBodyStream exposes the native body without handing out the Response', () => {
    const res = makeRes();
    res.setNativeResponse(new Response(streamOf('hello')));

    const stream = res.getBodyStream();
    expect(stream).not.toBeNull();
  });

  it('getBodyStream is null for a buffered body', () => {
    const res = makeRes();
    res.setBody('buffered');

    expect(res.getBodyStream()).toBeNull();
  });
});

describe('replaceBodyStream — body swap with header hoist', () => {
  it('hoists native headers so a later removeHeader actually reaches the wire', async () => {
    const res = makeRes();
    res.setNativeResponse(
      new Response(streamOf('original'), {
        headers: { [HttpHeader.ContentLength]: '5000', [HttpHeader.ETag]: '"v1"' },
      }),
    );

    // Compression's flow: swap the body, then strip content-coupled metadata.
    res.replaceBodyStream(streamOf('compressed'));
    res.removeHeader(HttpHeader.ContentLength);
    res.setHeader(HttpHeader.ContentEncoding, 'gzip');

    const wire = res.getNativeResponse();
    // A stale Content-Length on a re-encoded body corrupts framing — it must be gone.
    expect(wire?.headers.get(HttpHeader.ContentLength)).toBeNull();
    expect(wire?.headers.get(HttpHeader.ContentEncoding)).toBe('gzip');
    // Headers the handler set and nobody removed must survive the swap.
    expect(wire?.headers.get(HttpHeader.ETag)).toBe('"v1"');
    expect(await wire?.text()).toBe('compressed');
  });

  it('lets a later setHeader override a hoisted native value (ETag weakening)', () => {
    const res = makeRes();
    res.setNativeResponse(
      new Response(streamOf('original'), { headers: { [HttpHeader.ETag]: '"v1"' } }),
    );

    res.replaceBodyStream(streamOf('compressed'));
    res.setHeader(HttpHeader.ETag, 'W/"v1"');

    expect(res.getNativeResponse()?.headers.get(HttpHeader.ETag)).toBe('W/"v1"');
  });

  it('preserves status and multi-value Set-Cookie across the swap', () => {
    const res = makeRes();
    const native = new Response(streamOf('original'), { status: HttpStatus.Created });
    native.headers.append(HttpHeader.SetCookie, 'a=1');
    native.headers.append(HttpHeader.SetCookie, 'b=2');
    res.setNativeResponse(native);

    res.replaceBodyStream(streamOf('compressed'));

    const wire = res.getNativeResponse();
    expect(wire?.status).toBe(HttpStatus.Created);
    expect(wire?.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });

  it('unions Vary when hoisting, so an earlier middleware Vary is not clobbered', () => {
    const res = makeRes();
    res.appendHeader(HttpHeader.Vary, 'Origin'); // e.g. cors, before the handler
    res.setNativeResponse(
      new Response(streamOf('original'), { headers: { [HttpHeader.Vary]: 'Accept-Language' } }),
    );

    res.replaceBodyStream(streamOf('compressed'));

    const vary = res.getNativeResponse()?.headers.get(HttpHeader.Vary) ?? '';
    const tokens = vary.split(',').map((t) => t.trim().toLowerCase());
    expect(tokens).toContain('origin');
    expect(tokens).toContain('accept-language');
  });

  it('falls back to setBody when there is no native response', async () => {
    const res = makeRes();
    res.replaceBodyStream(streamOf('streamed'));

    expect(await res.getNativeResponse()?.text()).toBe('streamed');
  });
});
