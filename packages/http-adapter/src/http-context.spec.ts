import { describe, it, expect } from 'bun:test';

import type { ZipbulContainer } from '@zipbul/common';

import { HttpContext } from './http-context';
import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';

function createStubRequest(): HttpRequest {
  return {
    requestId: 'stub-request-id',
    httpMethod: 'GET',
    url: 'http://localhost/',
    path: '/',
    headers: new Headers(),
    protocol: 'http',
    host: 'localhost',
    hostname: 'localhost',
    port: null,
    queryString: null,
    cookies: {} as HttpRequest['cookies'],
    contentType: null,
    contentLength: null,
    charset: null,
    params: {},
    body: null,
    ip: null,
    ips: [],
    isTrustedProxy: false,
    subdomains: [],
    query: {},
    method: 'GET',
  } as HttpRequest;
}

function createStubResponse(): HttpResponse {
  return {
    isSent: () => false,
    getStatus: () => 0,
    getBody: () => undefined,
  } as unknown as HttpResponse;
}

function createStubContainer(): ZipbulContainer {
  return {
    get: () => undefined as never,
    set: () => undefined,
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  } satisfies ZipbulContainer;
}

describe('HttpContext', () => {
  it('should return undefined container when not provided in constructor', () => {
    const request = createStubRequest();
    const response = createStubResponse();

    const context = new HttpContext(request, response);

    expect(context.container).toBeUndefined();
  });

  it('should return provided container via getter', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);

    expect(context.container).toBe(container);
  });

  it('should resolve to HttpContext via to() when container is present', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);
    const resolved = context.to(HttpContext);

    expect(resolved).toBe(context);
  });

  it('should expose request and response alongside container', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);

    expect(context.request).toBe(request);
    expect(context.response).toBe(response);
    expect(context.container).toBe(container);
  });
});
