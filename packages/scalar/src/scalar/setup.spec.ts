import type { AdapterCollection } from '@zipbul/common';

import { describe, expect, it } from 'bun:test';

import type { ScalarSetupOptionsInput } from './interfaces';
import type {
  HttpAdapter,
  HttpAdapterInternal,
  HttpAdapterSpy,
  InternalRouteCall,
  InternalRouteHandler,
  InternalRouteHandlerParams,
} from './setup.spec.types';

import { setupScalar } from './setup';

const ZIPBUL_HTTP_INTERNAL = Symbol.for('zipbul:http:internal');

function createHttpAdapterSpy(): HttpAdapterSpy {
  const calls: InternalRouteCall[] = [];
  const internalAdapter: HttpAdapterInternal = {
    get: (path: string, handler: InternalRouteHandler) => {
      calls.push({ path, handler });
    },
  };
  const adapter: HttpAdapter = {
    [ZIPBUL_HTTP_INTERNAL]: internalAdapter,
    start: async () => {},
    stop: async () => {},
  };

  return { adapter, calls };
}

function getInternalRouteHandler(params: InternalRouteHandlerParams): InternalRouteHandler {
  const { calls, path } = params;
  const match = calls.find(call => call.path === path);

  if (!match) {
    throw new Error(`Expected route to be registered: ${path}`);
  }

  return match.handler;
}

function createHttpAdapters(entries: Array<[string, HttpAdapter]>): AdapterCollection {
  const map = new Map(entries);
  const http = {
    get: (name: string): HttpAdapter | undefined => map.get(name),
    all: (): HttpAdapter[] => Array.from(map.values()),
    forEach: (callback: (adapter: HttpAdapter) => void): void => {
      map.forEach((adapter, name) => {
        const handler = callback as (adapter: HttpAdapter, name: string) => void;

        handler(adapter, name);
      });
    },
  };

  return { http };
}

describe('setup', () => {
  // Removed global beforeEach/afterEach for AOT/Strict-Immutable compliance.
  // Instead, we inject a mock registry to each setupScalar call where needed.

  it('should throw when options are missing', () => {
    // Arrange
    const adapters = createHttpAdapters([]);

    // Act
    const act = () => {
      setupScalar(adapters, undefined);
    };

    // Assert
    expect(act).toThrow(/documentTargets/i);
  });

  it('should throw when documentTargets is neither "all" nor an array', () => {
    // Arrange
    const adapters = createHttpAdapters([]);

    // Act
    const act = () => {
      const options: ScalarSetupOptionsInput = {
        documentTargets: 'invalid',
        httpTargets: [],
        metadataRegistry: new Map(),
      };

      setupScalar(adapters, options);
    };

    // Assert
    expect(act).toThrow(/documentTargets must be/i);
  });

  it('should throw when httpTargets is undefined', () => {
    // Arrange
    const adapters = createHttpAdapters([]);

    // Act
    const act = () => {
      const options: ScalarSetupOptionsInput = {
        documentTargets: 'all',
        httpTargets: undefined,
        metadataRegistry: new Map(),
      };

      setupScalar(adapters, options);
    };

    // Assert
    expect(act).toThrow(/options \{ documentTargets, httpTargets \} is required/i);
  });

  it('should throw when httpTargets is neither "all" nor an array', () => {
    // Arrange
    const adapters = createHttpAdapters([]);

    // Act
    const act = () => {
      const options: ScalarSetupOptionsInput = {
        documentTargets: 'all',
        httpTargets: 'invalid',
        metadataRegistry: new Map(),
      };

      setupScalar(adapters, options);
    };

    // Assert
    expect(act).toThrow(/httpTargets must be/i);
  });

  it('should throw when no HTTP adapter is selected for hosting', () => {
    // Arrange
    const adapters = createHttpAdapters([]);

    // Act
    const act = () => {
      setupScalar(adapters, {
        documentTargets: 'all',
        httpTargets: [],
        metadataRegistry: new Map(),
      });
    };

    // Assert
    expect(act).toThrow(/no HTTP adapter selected/i);
  });

  it('should throw when the http adapter group does not support lookup', () => {
    // Arrange
    const adapters: AdapterCollection = {
      http: {
        get: () => undefined,
        all: () => [],
        forEach: callback => {
          const adapter: HttpAdapter = {
            start: async () => {},
            stop: async () => {},
          };

          callback(adapter);
        },
      },
    };

    // Act
    const act = () => {
      setupScalar(adapters, {
        documentTargets: 'all',
        httpTargets: ['http-server'],
        metadataRegistry: new Map(),
      });
    };

    // Assert
    expect(act).toThrow(/does not support lookup/i);
  });

  it('should throw when selected httpTargets do not exist', () => {
    // Arrange
    const { adapter } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    const act = () => {
      setupScalar(adapters, {
        documentTargets: 'all',
        httpTargets: ['missing'],
        metadataRegistry: new Map(),
      });
    };

    // Assert
    expect(act).toThrow(/httpTargets not found/i);
  });

  it('should register exactly the two internal routes when an adapter supports internal binding', () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    // Assert
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.path)).toEqual(['/api-docs', '/api-docs/*']);
  });

  it('should not register routes twice when setupScalar is invoked twice', () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, { documentTargets: 'all', httpTargets: ['http-server'], metadataRegistry: new Map() });
    setupScalar(adapters, { documentTargets: 'all', httpTargets: ['http-server'], metadataRegistry: new Map() });

    // Assert
    expect(calls).toHaveLength(2);
  });

  it('should serve Scalar UI at /api-docs when exactly one document exists', async () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls, path: '/api-docs' });
    const response = handler();
    const text = await response.text();

    // Assert
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(text).toContain('api-reference');
  });

  it('should serve an index at /api-docs when multiple documents exist', async () => {
    // Arrange
    const adapterSpyA = createHttpAdapterSpy();
    const adapterSpyB = createHttpAdapterSpy();
    const adapters = createHttpAdapters([
      ['http-a', adapterSpyA.adapter],
      ['http-b', adapterSpyB.adapter],
    ]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-a'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls: adapterSpyA.calls, path: '/api-docs' });
    const response = handler();
    const text = await response.text();

    // Assert
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(text).toContain('<ul>');
    expect(text).toContain('openapi:http:http-a');
    expect(text).toContain('openapi:http:http-b');
    expect(text).not.toContain('api-reference');
  });

  it('should serve JSON from /api-docs/* when a .json document path is requested', async () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls, path: '/api-docs/*' });
    const response = handler({ path: '/api-docs/openapi:http:http-server.json' });
    const text = await response.text();

    // Assert
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(text).toContain('"openapi":"3.0.0"');
  });

  it('should serve UI from /api-docs/* when a non-.json document path is requested', async () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls, path: '/api-docs/*' });
    const response = handler({ path: '/api-docs/openapi:http:http-server' });
    const text = await response.text();

    // Assert
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(text).toContain('api-reference');
  });

  it('should return 404 from /api-docs/* when the request path is missing', () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls, path: '/api-docs/*' });
    const response = handler({});

    // Assert
    expect(response.status).toBe(404);
  });

  it('should return 404 from /api-docs/* when the document does not exist', () => {
    // Arrange
    const { adapter, calls } = createHttpAdapterSpy();
    const adapters = createHttpAdapters([['http-server', adapter]]);

    // Act
    setupScalar(adapters, {
      documentTargets: 'all',
      httpTargets: ['http-server'],
      metadataRegistry: new Map(),
    });

    const handler = getInternalRouteHandler({ calls, path: '/api-docs/*' });
    const response = handler({ path: '/api-docs/nope.json' });

    // Assert
    expect(response.status).toBe(404);
  });
});
