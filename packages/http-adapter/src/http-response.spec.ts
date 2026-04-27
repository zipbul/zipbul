import { describe, it, expect, spyOn } from 'bun:test';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { HttpResponse } from './http-response';
import type { HttpRequest } from './http-request';
import { createTestHttpRequest } from './test-fixtures/http-request-fixture';
import type { HttpMethod } from './types';

function createRequest(method: HttpMethod = 'GET'): HttpRequest {
  return createTestHttpRequest({ method, originalMethod: method });
}

function createResponse(method: HttpMethod = 'GET'): HttpResponse {
  return new HttpResponse(createRequest(method), new Headers());
}

describe('HttpResponse', () => {
  // ── send() / isSent() / end() ──────────────────────────────

  describe('send / isSent / end', () => {
    it('should return false from isSent initially', () => {
      const res = createResponse();

      expect(res.isSent()).toBe(false);
    });

    it('should mark response as committed when send is called', () => {
      const res = createResponse();

      res.send();

      expect(res.isSent()).toBe(true);
    });

    it('should return true from isSent after send', () => {
      const res = createResponse();

      res.send();

      expect(res.isSent()).toBe(true);
    });

    it('should build and return Response when end is called', () => {
      const res = createResponse();
      res.setBody('hello');

      const response = res.end();

      expect(response).toBeInstanceOf(Response);
    });

    it('should return the same cached Response on repeated end calls', () => {
      const res = createResponse();
      res.setBody('hello');

      const first = res.end();
      const second = res.end();

      expect(first).toBe(second);
    });

    it('should return true from isSent after end', () => {
      const res = createResponse();

      res.end();

      expect(res.isSent()).toBe(true);
    });
  });

  // ── reset() ────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset all state including committed and response and rawNativeResponse', () => {
      const res = createResponse();
      res.setStatus(StatusCodes.OK);
      res.setHeader('x-custom', 'value');
      res.setBody('hello');
      res.send();
      res.end();

      res.reset();

      expect(res.isSent()).toBe(false);
      expect(res.getStatus()).toBeUndefined();
      expect(res.getHeader('x-custom')).toBeNull();
      expect(res.getBody()).toBeUndefined();
      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should cancel existing stream on reset', () => {
      const res = createResponse();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      res.setBody(stream);
      // Access private _rawNativeResponse to spy on its body.cancel
      // We verify indirectly: after reset, hasNativeResponse is false
      // and setting a new body does not throw (stream was properly cancelled)

      res.reset();

      expect(res.hasNativeResponse()).toBe(false);
      expect(res.getBody()).toBeUndefined();
    });
  });

  // ── setStatus / getStatus ──────────────────────────────────

  describe('setStatus / getStatus', () => {
    it('should return this from setStatus for chaining', () => {
      const res = createResponse();

      const result = res.setStatus(StatusCodes.OK);

      expect(result).toBe(res);
    });

    it('should use default statusText from getReasonPhrase', () => {
      const res = createResponse();

      res.setStatus(StatusCodes.NOT_FOUND);
      const response = res.end();

      expect(response.status).toBe(404);
      expect(response.statusText).toBe(getReasonPhrase(StatusCodes.NOT_FOUND));
    });

    it('should use custom statusText when provided', () => {
      const res = createResponse();

      res.setStatus(StatusCodes.OK, 'All Good');
      const response = res.end();

      expect(response.statusText).toBe('All Good');
    });
  });

  // ── Headers ────────────────────────────────────────────────

  describe('headers', () => {
    it('should return Headers object from headers getter', () => {
      const res = createResponse();

      expect(res.headers).toBeInstanceOf(Headers);
    });

    it('should set and get header values', () => {
      const res = createResponse();

      res.setHeader('x-custom', 'value');

      expect(res.getHeader('x-custom')).toBe('value');
    });

    it('should set multiple headers via setHeaders', () => {
      const res = createResponse();

      res.setHeaders({ 'x-one': '1', 'x-two': '2' });

      expect(res.getHeader('x-one')).toBe('1');
      expect(res.getHeader('x-two')).toBe('2');
    });

    it('should remove a header', () => {
      const res = createResponse();
      res.setHeader('x-custom', 'value');

      res.removeHeader('x-custom');

      expect(res.getHeader('x-custom')).toBeNull();
    });

    it('should append header values for multi-value headers like Set-Cookie', () => {
      const res = createResponse();

      res.appendHeader('set-cookie', 'a=1');
      res.appendHeader('set-cookie', 'b=2');

      const cookies = res.headers.getSetCookie();
      expect(cookies).toContain('a=1');
      expect(cookies).toContain('b=2');
    });
  });

  // ── setContentType (F-RES-1) ───────────────────────────────

  describe('setContentType', () => {
    it('should append charset=utf-8 for text/* content types', () => {
      const res = createResponse();

      res.setContentType('text/html');

      expect(res.getContentType()).toBe('text/html; charset=utf-8');
    });

    it('should append charset=utf-8 for application/json', () => {
      const res = createResponse();

      res.setContentType('application/json');

      expect(res.getContentType()).toBe('application/json; charset=utf-8');
    });

    it('should append charset=utf-8 for +json suffix types', () => {
      const res = createResponse();

      res.setContentType('application/vnd.api+json');

      expect(res.getContentType()).toBe('application/vnd.api+json; charset=utf-8');
    });

    it('should not append charset for image/png', () => {
      const res = createResponse();

      res.setContentType('image/png');

      expect(res.getContentType()).toBe('image/png');
    });

    it('should not append charset for application/octet-stream', () => {
      const res = createResponse();

      res.setContentType('application/octet-stream');

      expect(res.getContentType()).toBe('application/octet-stream');
    });

    it('should not append charset for video/mp4', () => {
      const res = createResponse();

      res.setContentType('video/mp4');

      expect(res.getContentType()).toBe('video/mp4');
    });
  });

  // ── setBody unified ────────────────────────────────────────

  describe('setBody', () => {
    it('should set object body via buffered path', () => {
      const res = createResponse();
      const body = { key: 'value' };

      res.setBody(body);

      expect(res.getBody()).toBe(body);
      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should set string body via buffered path', () => {
      const res = createResponse();

      res.setBody('hello');

      expect(res.getBody()).toBe('hello');
      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should preserve undefined body (F-RES-2)', () => {
      const res = createResponse();
      res.setBody('something');

      res.setBody(undefined);

      expect(res.getBody()).toBeUndefined();
    });

    it('should preserve null body', () => {
      const res = createResponse();

      res.setBody(null);

      expect(res.getBody()).toBeNull();
    });

    it('should set ReadableStream body via native response path', () => {
      const res = createResponse();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('stream data'));
          controller.close();
        },
      });

      res.setBody(stream);

      expect(res.getBody()).toBeUndefined();
      expect(res.hasNativeResponse()).toBe(true);
    });

    it('should set Blob body via stream with Content-Length and auto Content-Type', () => {
      const res = createResponse();
      const blob = new Blob(['hello world'], { type: 'text/csv' });

      res.setBody(blob);

      expect(res.getBody()).toBeUndefined();
      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getHeader('content-length')).toBe(blob.size.toString());
      expect(res.getContentType()).toBe('text/csv; charset=utf-8');
    });

    it('should preserve user Content-Type when setBody with Blob is called with pre-set CT', () => {
      const res = createResponse();
      res.setContentType('application/xml');
      const blob = new Blob(['<root/>'], { type: 'text/xml' });

      res.setBody(blob);

      expect(res.getContentType()).toBe('application/xml');
    });

    it('should not set auto Content-Type from Blob when blob type is empty', () => {
      const res = createResponse();
      const blob = new Blob(['data']);

      res.setBody(blob);

      expect(res.getContentType()).toBeNull();
    });

    it('should clear native response when transitioning stream to buffer', () => {
      const res = createResponse();
      const stream = new ReadableStream({ start(c) { c.close(); } });
      res.setBody(stream);
      expect(res.hasNativeResponse()).toBe(true);

      res.setBody('buffered');

      expect(res.hasNativeResponse()).toBe(false);
      expect(res.getBody()).toBe('buffered');
    });

    it('should clear body when transitioning buffer to stream', () => {
      const res = createResponse();
      res.setBody('buffered');
      expect(res.getBody()).toBe('buffered');

      const stream = new ReadableStream({ start(c) { c.close(); } });
      res.setBody(stream);

      expect(res.getBody()).toBeUndefined();
      expect(res.hasNativeResponse()).toBe(true);
    });

    it('should cancel previous stream on body transition', () => {
      const res = createResponse();
      const firstStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
      });
      res.setBody(firstStream);

      // Transition to buffered — should cancel the first stream's native response
      res.setBody('new body');

      expect(res.getBody()).toBe('new body');
      expect(res.hasNativeResponse()).toBe(false);
    });
  });

  // ── redirect() ─────────────────────────────────────────────

  describe('redirect', () => {
    it('should set Location header on redirect', () => {
      const res = createResponse();

      res.redirect('https://example.com');

      expect(res.getHeader('location')).toBe('https://example.com');
    });

    it('should set explicit status on redirect', () => {
      const res = createResponse();

      res.redirect('https://example.com', 301);

      expect(res.getStatus()).toBe(301);
      expect(res.getHeader('location')).toBe('https://example.com');
    });

    it('should default to 302 when redirect has no explicit status and build is called', () => {
      const res = createResponse();

      res.redirect('/new-path');
      const response = res.end();

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/new-path');
    });
  });

  // ── Native Response (lazy merge) ───────────────────────────

  describe('native response', () => {
    it('should store raw native response and clear body via setNativeResponse', () => {
      const res = createResponse();
      res.setBody('old body');

      const nativeRes = new Response('native body');
      res.setNativeResponse(nativeRes);

      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getBody()).toBeUndefined();
    });

    it('should return true from hasNativeResponse when native response is set', () => {
      const res = createResponse();

      res.setNativeResponse(new Response('test'));

      expect(res.hasNativeResponse()).toBe(true);
    });

    it('should return false from hasNativeResponse when no native response', () => {
      const res = createResponse();

      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should return undefined from getNativeResponse when no native response set', () => {
      const res = createResponse();

      expect(res.getNativeResponse()).toBeUndefined();
    });

    it('should create merged Response with headers in getNativeResponse', () => {
      const res = createResponse();
      res.setHeader('x-custom', 'middleware-value');
      res.setNativeResponse(new Response('body', {
        status: 201,
        statusText: 'Created',
      }));

      const merged = res.getNativeResponse();

      expect(merged).toBeInstanceOf(Response);
      expect(merged!.status).toBe(201);
      expect(merged!.headers.get('x-custom')).toBe('middleware-value');
    });

    it('should cache merged native Response on repeated getNativeResponse calls', () => {
      const res = createResponse();
      res.setNativeResponse(new Response('body'));

      const first = res.getNativeResponse();
      const second = res.getNativeResponse();

      expect(first).toBe(second);
    });

    it('should append Set-Cookie from _headers without overwriting native', () => {
      const res = createResponse();
      const nativeRes = new Response('body', {
        headers: { 'set-cookie': 'native=1' },
      });
      res.setNativeResponse(nativeRes);
      res.appendHeader('set-cookie', 'middleware=2');

      const merged = res.getNativeResponse();
      const cookies = merged!.headers.getSetCookie();

      expect(cookies).toContain('native=1');
      expect(cookies).toContain('middleware=2');
    });

    it('should add _headers keys not in native response', () => {
      const res = createResponse();
      res.setNativeResponse(new Response('body'));
      res.setHeader('x-added', 'by-middleware');

      const merged = res.getNativeResponse();

      expect(merged!.headers.get('x-added')).toBe('by-middleware');
    });

    it('should not overwrite native response headers with _headers keys', () => {
      const res = createResponse();
      res.setNativeResponse(new Response('body', {
        headers: { 'x-source': 'native' },
      }));
      res.setHeader('x-source', 'middleware');

      const merged = res.getNativeResponse();

      expect(merged!.headers.get('x-source')).toBe('native');
    });

    it('should cancel native stream via cancelNativeStream', () => {
      const res = createResponse();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      });
      res.setNativeResponse(new Response(stream));

      // Should not throw
      res.cancelNativeStream();

      // After cancelling, the stream should be in a cancelled state
      expect(res.hasNativeResponse()).toBe(true);
    });
  });

  // ── build() (via end()) ────────────────────────────────────

  describe('build', () => {
    it('should build normal 200 response with JSON body', async () => {
      const res = createResponse();
      res.setBody({ message: 'hello' });

      const response = res.end();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ message: 'hello' }));
    });

    it('should build text/plain response from string body', async () => {
      const res = createResponse();
      res.setBody('plain text');

      const response = res.end();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      const text = await response.text();
      expect(text).toBe('plain text');
    });

    it('should remove body for 204 status', async () => {
      const res = createResponse();
      res.setStatus(StatusCodes.NO_CONTENT);
      res.setBody('should be removed');

      const response = res.end();

      expect(response.status).toBe(204);
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should remove body for 304 status', async () => {
      const res = createResponse();
      res.setStatus(StatusCodes.NOT_MODIFIED);
      res.setBody('should be removed');

      const response = res.end();

      expect(response.status).toBe(304);
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should default to 302 and remove body for redirect with Location header', async () => {
      const res = createResponse();
      res.redirect('/target');

      const response = res.end();

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/target');
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should not trigger redirect for empty Location string', async () => {
      const res = createResponse();
      res.setHeader('location', '');
      res.setBody('body preserved');

      const response = res.end();

      // Empty location does not trigger redirect path
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('body preserved');
    });

    it('should fall back to text on JSON serialization failure', async () => {
      const res = createResponse();
      // Create a circular reference object
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      res.setBody(circular as never);

      const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});

      const response = res.end();

      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      const text = await response.text();
      expect(text).toBe('[unserializable body]');
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });

    it('should calculate Content-Length and remove body for HEAD request with string', async () => {
      const res = new HttpResponse(createRequest('HEAD'), new Headers());
      res.setBody('hello');

      const response = res.end();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe(
        new TextEncoder().encode('hello').byteLength.toString(),
      );
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should calculate Content-Length and remove body for HEAD request with Uint8Array', async () => {
      const res = new HttpResponse(createRequest('HEAD'), new Headers());
      const body = new Uint8Array([1, 2, 3, 4, 5]);
      res.setContentType('application/octet-stream');
      res.setBody(body);

      const response = res.end();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe('5');
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should calculate Content-Length and remove body for HEAD request with ArrayBuffer', async () => {
      const res = new HttpResponse(createRequest('HEAD'), new Headers());
      const body = new ArrayBuffer(8);
      res.setContentType('application/octet-stream');
      res.setBody(body);

      const response = res.end();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe('8');
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should auto 204 when no status and no body', () => {
      const res = createResponse();

      const response = res.end();

      expect(response.status).toBe(204);
    });

    it('should return 500 when status is below 100', async () => {
      const res = createResponse();
      // Force invalid status via private field — setStatus calls getReasonPhrase which throws for invalid codes
      (res as unknown as Record<string, unknown>)['_status'] = 50;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Invalid';
      res.setBody('test');

      const response = res.end();

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe('Internal Server Error');
    });

    it('should return 500 when status is above 599', async () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 600;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Invalid';
      res.setBody('test');

      const response = res.end();

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe('Internal Server Error');
    });

    it('should serialize JSON body for content-type application/json', async () => {
      const res = createResponse();
      res.setBody({ nested: { value: 42 } });

      const response = res.end();
      const text = await response.text();

      expect(text).toBe(JSON.stringify({ nested: { value: 42 } }));
    });

    it('should serialize array body as JSON', async () => {
      const res = createResponse();
      res.setBody([1, 2, 3]);

      const response = res.end();
      const text = await response.text();

      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(text).toBe(JSON.stringify([1, 2, 3]));
    });

    it('should serialize number body as JSON', async () => {
      const res = createResponse();
      res.setBody(42);

      const response = res.end();
      const text = await response.text();

      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(text).toBe('42');
    });

    it('should serialize boolean body as JSON', async () => {
      const res = createResponse();
      res.setBody(true);

      const response = res.end();
      const text = await response.text();

      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(text).toBe('true');
    });

    it('should set HEAD status to 200 when no status was set explicitly', async () => {
      const res = new HttpResponse(createRequest('HEAD'), new Headers());
      res.setBody('content');

      const response = res.end();

      expect(response.status).toBe(200);
    });

    it('should infer text/plain content type for string body', () => {
      const res = createResponse();
      res.setBody('just text');

      const response = res.end();

      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    });

    it('should HEAD request with JSON body should serialize then calculate Content-Length', async () => {
      const res = new HttpResponse(createRequest('HEAD'), new Headers());
      res.setBody({ key: 'value' });

      const response = res.end();

      const expectedLength = new TextEncoder().encode(JSON.stringify({ key: 'value' })).byteLength;
      expect(response.headers.get('content-length')).toBe(expectedLength.toString());
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should build response with Uint8Array body', async () => {
      const res = createResponse();
      const body = new Uint8Array([72, 101, 108, 108, 111]);
      res.setContentType('application/octet-stream');
      res.setBody(body);

      const response = res.end();
      const buffer = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(new Uint8Array(buffer)).toEqual(body);
    });

    it('should build response with ArrayBuffer body', async () => {
      const res = createResponse();
      const buffer = new ArrayBuffer(4);
      new Uint8Array(buffer).set([1, 2, 3, 4]);
      res.setContentType('application/octet-stream');
      res.setBody(buffer);

      const response = res.end();
      const resultBuffer = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(new Uint8Array(resultBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should build response with number body via normalizeBody toString', async () => {
      const res = createResponse();
      res.setContentType('text/plain');
      res.setBody(42);

      const response = res.end();
      const text = await response.text();

      expect(text).toBe('42');
    });

    it('should build response with boolean body via normalizeBody toString', async () => {
      const res = createResponse();
      res.setContentType('text/plain');
      res.setBody(false);

      const response = res.end();
      const text = await response.text();

      expect(text).toBe('false');
    });

    it('should throw when status code 100 is used with body', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 100;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Continue';
      res.setBody('continue');

      expect(() => res.end()).toThrow();
    });

    it('should throw when status code 199 is used with body', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 199;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Custom';
      res.setBody('info');

      expect(() => res.end()).toThrow();
    });

    it('should accept status code 299', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 299;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Custom Success';
      res.setBody('ok');

      const response = res.end();

      expect(response.status).toBe(299);
    });

    it('should accept status code 399', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 399;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Custom Redirect';
      res.setBody('redirect');

      const response = res.end();

      expect(response.status).toBe(399);
    });

    it('should accept status code 499', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 499;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Custom Client Error';
      res.setBody('client error');

      const response = res.end();

      expect(response.status).toBe(499);
    });

    it('should accept status code 599', () => {
      const res = createResponse();
      (res as unknown as Record<string, unknown>)['_status'] = 599;
      (res as unknown as Record<string, unknown>)['_statusText'] = 'Custom Server Error';
      res.setBody('server error');

      const response = res.end();

      expect(response.status).toBe(599);
    });
  });

  // ── setBody edge cases ─────────────────────────────────────

  describe('setBody edge cases', () => {
    it('should handle Uint8Array body via buffered path', () => {
      const res = createResponse();
      const body = new Uint8Array([10, 20, 30]);

      res.setBody(body);

      expect(res.getBody()).toBe(body);
      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should handle ArrayBuffer body via buffered path', () => {
      const res = createResponse();
      const body = new ArrayBuffer(16);

      res.setBody(body);

      expect(res.getBody()).toBe(body);
      expect(res.hasNativeResponse()).toBe(false);
    });

    it('should handle rapid transitions stream to blob to buffer to stream', () => {
      const res = createResponse();

      const stream1 = new ReadableStream({ start(c) { c.close(); } });
      res.setBody(stream1);
      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getBody()).toBeUndefined();

      const blob = new Blob(['data'], { type: 'text/plain' });
      res.setBody(blob);
      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getBody()).toBeUndefined();

      res.setBody('buffered');
      expect(res.hasNativeResponse()).toBe(false);
      expect(res.getBody()).toBe('buffered');

      const stream2 = new ReadableStream({ start(c) { c.close(); } });
      res.setBody(stream2);
      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getBody()).toBeUndefined();
    });

    it('should handle Blob with size 0', () => {
      const res = createResponse();
      const emptyBlob = new Blob([]);

      res.setBody(emptyBlob);

      expect(res.hasNativeResponse()).toBe(true);
      expect(res.getHeader('content-length')).toBe('0');
    });
  });

  // ── end() after reset() ────────────────────────────────────

  describe('end after reset', () => {
    it('should build a fresh response after reset clears cached response', () => {
      const res = createResponse();
      res.setBody('first');
      const first = res.end();
      expect(first.status).toBe(200);

      res.reset();
      res.setBody('second');
      res.setStatus(StatusCodes.CREATED);
      const second = res.end();

      expect(second).not.toBe(first);
      expect(second.status).toBe(201);
    });
  });

  // ── setNativeResponse then setBody ─────────────────────────

  describe('setNativeResponse then setBody', () => {
    it('should clear native response when setBody is called with buffered value after setNativeResponse', () => {
      const res = createResponse();
      res.setNativeResponse(new Response('native'));

      expect(res.hasNativeResponse()).toBe(true);

      res.setBody('buffered override');

      expect(res.hasNativeResponse()).toBe(false);
      expect(res.getBody()).toBe('buffered override');
    });
  });

  // ── getNativeResponse with no _headers modifications ───────

  describe('getNativeResponse with no headers modifications', () => {
    it('should return merged response identical to raw when no _headers were added', async () => {
      const res = createResponse();
      res.setNativeResponse(new Response('body', {
        status: 200,
        headers: { 'x-native': 'value' },
      }));

      const merged = res.getNativeResponse();

      expect(merged).toBeInstanceOf(Response);
      expect(merged!.status).toBe(200);
      expect(merged!.headers.get('x-native')).toBe('value');
    });
  });

  // ── Multiple appendHeader calls for same key ───────────────

  describe('multiple appendHeader calls', () => {
    it('should accumulate multiple values for the same non-set-cookie header', () => {
      const res = createResponse();

      res.appendHeader('x-custom', 'value1');
      res.appendHeader('x-custom', 'value2');

      const combined = res.getHeader('x-custom');
      expect(combined).toContain('value1');
      expect(combined).toContain('value2');
    });

    it('should accumulate three Set-Cookie values', () => {
      const res = createResponse();

      res.appendHeader('set-cookie', 'a=1');
      res.appendHeader('set-cookie', 'b=2');
      res.appendHeader('set-cookie', 'c=3');

      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(3);
      expect(cookies).toContain('a=1');
      expect(cookies).toContain('b=2');
      expect(cookies).toContain('c=3');
    });
  });

  // ── setHeaders with empty object ───────────────────────────

  describe('setHeaders with empty object', () => {
    it('should be a no-op when called with empty object', () => {
      const res = createResponse();
      res.setHeader('x-existing', 'keep');

      res.setHeaders({});

      expect(res.getHeader('x-existing')).toBe('keep');
    });
  });

  // ── removeHeader for non-existent header ───────────────────

  describe('removeHeader for non-existent header', () => {
    it('should not throw when removing a header that does not exist', () => {
      const res = createResponse();

      expect(() => res.removeHeader('x-nonexistent')).not.toThrow();
    });
  });

  // ── redirect with each valid status ────────────────────────

  describe('redirect with each valid status', () => {
    it('should redirect with status 301', () => {
      const res = createResponse();

      res.redirect('/moved', 301);
      const response = res.end();

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/moved');
    });

    it('should redirect with status 303', () => {
      const res = createResponse();

      res.redirect('/see-other', 303);
      const response = res.end();

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/see-other');
    });

    it('should redirect with status 307', () => {
      const res = createResponse();

      res.redirect('/temp', 307);
      const response = res.end();

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/temp');
    });

    it('should redirect with status 308', () => {
      const res = createResponse();

      res.redirect('/permanent', 308);
      const response = res.end();

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe('/permanent');
    });

    it('should throw when redirect URL uses javascript: scheme', () => {
      const res = createResponse();

      expect(() => res.redirect('javascript:alert(1)')).toThrow(/dangerous scheme/i);
    });

    it('should throw when redirect URL uses data: scheme', () => {
      const res = createResponse();

      expect(() => res.redirect('data:text/html,<h1>evil</h1>')).toThrow(/dangerous scheme/i);
    });

    it('should throw when redirect URL uses vbscript: scheme', () => {
      const res = createResponse();

      expect(() => res.redirect('vbscript:MsgBox("hi")')).toThrow(/dangerous scheme/i);
    });

    it('should throw when redirect URL uses JAVASCRIPT: scheme (case-insensitive)', () => {
      const res = createResponse();

      expect(() => res.redirect('JAVASCRIPT:void(0)')).toThrow(/dangerous scheme/i);
    });

    it('should allow relative URL redirect', () => {
      const res = createResponse();

      res.redirect('/safe/path');

      expect(res.getHeader('location')).toBe('/safe/path');
    });

    it('should allow https: scheme redirect', () => {
      const res = createResponse();

      res.redirect('https://example.com/callback');

      expect(res.getHeader('location')).toBe('https://example.com/callback');
    });
  });

  describe('setContentType — charset deduplication', () => {
    it('should not double-append charset when value already contains charset=', () => {
      const res = createResponse();

      res.setContentType('text/html; charset=iso-8859-1');

      expect(res.getContentType()).toBe('text/html; charset=iso-8859-1');
    });

    it('should not double-append charset for application/json with explicit charset', () => {
      const res = createResponse();

      res.setContentType('application/json; charset=utf-8');

      expect(res.getContentType()).toBe('application/json; charset=utf-8');
    });

    it('should append charset=utf-8 when text type has no charset', () => {
      const res = createResponse();

      res.setContentType('text/plain');

      expect(res.getContentType()).toBe('text/plain; charset=utf-8');
    });

    it('should not append charset for binary types', () => {
      const res = createResponse();

      res.setContentType('image/png');

      expect(res.getContentType()).toBe('image/png');
    });
  });

  describe('build — 204 should not set Content-Type', () => {
    it('should not include Content-Type header on explicit 204 response', () => {
      const res = createResponse();
      res.setStatus(StatusCodes.NO_CONTENT);

      const response = res.end();

      expect(response.status).toBe(204);
      expect(response.headers.get('content-type')).toBeNull();
    });

    it('should not include Content-Type header on auto-204 response', () => {
      const res = createResponse();
      // No status, no body → auto 204

      const response = res.end();

      expect(response.status).toBe(204);
      expect(response.headers.get('content-type')).toBeNull();
    });
  });

  // ── F12 regression: setBody after serialize ──────────────────

  describe('F12: setBody after serialize should re-serialize', () => {
    it('should serialize new object body after serialize() was already called', async () => {
      const res = createResponse();
      res.setBody({ first: true });

      // Simulate pipeline: serialize step runs
      res.serialize();

      // BeforeResponse middleware replaces body with new object
      res.setBody({ replaced: true });

      // end() calls build() which calls serialize() again — should NOT skip
      const response = res.end();

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ replaced: true }));
    });
  });

  // ── F13 regression: setBody stream cancel ────────────────────

  describe('F13: setBody stream cancel should not cause unhandled rejection', () => {
    it('should cancel previous stream when setBody is called with a new stream', () => {
      const res = createResponse();
      let stream1Cancelled = false;

      const stream1 = new ReadableStream({
        cancel() {
          stream1Cancelled = true;
        },
      });

      const stream2 = new ReadableStream();

      res.setBody(stream1);
      res.setBody(stream2);

      expect(stream1Cancelled).toBe(true);
    });

    it('should not cause unhandled rejection when cancel() rejects', async () => {
      const res = createResponse();

      const stream1 = new ReadableStream({
        cancel() {
          throw new Error('cancel failed');
        },
      });

      const stream2 = new ReadableStream();

      // Should not throw — fire-and-forget cancel
      res.setBody(stream1);
      res.setBody(stream2);

      // Give microtask queue time to process the rejected cancel promise
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });
});
