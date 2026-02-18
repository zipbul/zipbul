import type { Doc, InternalRouter, ScalarRequest, ScalarSetupOptionsInput } from './interfaces';
import type {
  AdapterCollectionLike,
  AdapterGroupGetResult,
  AdapterGroupLike,
  AdapterGroupWithGet,
  ScalarInput,
  ScalarKeyedRecord,
} from './types';

import { resolveHttpNamesForDocuments, resolveHttpNamesForHosting } from './adapter-names';
import { buildDocsForHttpAdapters } from './docs';
import { indexResponse } from './index-html';
import { resolveDocFromPath } from './routing';
import { uiResponse } from './ui';

const ZIPBUL_HTTP_INTERNAL = Symbol.for('zipbul:http:internal');
const boundAdapters = new WeakSet<ScalarKeyedRecord>();

function isKeyedRecord(value: AdapterGroupGetResult): value is ScalarKeyedRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function hasAdapterGroupGet(value: AdapterGroupLike | undefined): value is AdapterGroupWithGet {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  if (!('get' in value)) {
    return false;
  }

  return typeof value.get === 'function';
}

function hasInternalRouter(value: ScalarInput | InternalRouter | undefined): value is InternalRouter {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  if (!('get' in value)) {
    return false;
  }

  return typeof value.get === 'function';
}

function jsonResponse(doc: Doc): Response {
  return new Response(JSON.stringify(doc.spec), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function registerInternalRoutes(internal: InternalRouter, docs: Doc[], docsById: Map<string, Doc>): void {
  internal.get('/api-docs', () => {
    if (docs.length === 1) {
      const onlyDoc = docs[0];

      if (onlyDoc) {
        return uiResponse(onlyDoc);
      }
    }

    return indexResponse(docs);
  });
  internal.get('/api-docs/*', (req: ScalarRequest) => {
    const path = typeof req.path === 'string' ? req.path : '';
    const resolved = resolveDocFromPath(path);

    if (!resolved) {
      return new Response('Not Found', { status: 404 });
    }

    const doc = docsById.get(resolved.docId);

    if (!doc) {
      return new Response('Not Found', { status: 404 });
    }

    return resolved.isJson ? jsonResponse(doc) : uiResponse(doc);
  });
}

export function setupScalar(adapters: AdapterCollectionLike, options?: ScalarSetupOptionsInput): void {
  if (options === undefined) {
    throw new Error('Scalar: options { documentTargets, httpTargets } is required.');
  }

  const { documentTargets, httpTargets, metadataRegistry } = options;

  if (documentTargets === undefined || httpTargets === undefined) {
    throw new Error('Scalar: options { documentTargets, httpTargets } is required.');
  }

  if (documentTargets !== 'all' && !Array.isArray(documentTargets)) {
    throw new Error('Scalar: documentTargets must be "all" or an array of targets.');
  }

  if (httpTargets !== 'all' && !Array.isArray(httpTargets)) {
    throw new Error('Scalar: httpTargets must be "all" or an array of names.');
  }

  const httpDocNames = resolveHttpNamesForDocuments(adapters, documentTargets);
  const docs = buildDocsForHttpAdapters(httpDocNames, metadataRegistry);
  const docsById = new Map(docs.map(d => [d.docId, d] as const));
  const httpHostNames = resolveHttpNamesForHosting(adapters, httpTargets);

  if (httpHostNames.length === 0) {
    throw new Error('Scalar: no HTTP adapter selected/found. Install/add @zipbul/http-adapter and register an http adapter.');
  }

  const httpGroup: AdapterGroupLike | undefined = adapters.http;

  if (!hasAdapterGroupGet(httpGroup)) {
    throw new Error('Scalar: selected http adapter group does not support lookup (missing .get).');
  }

  for (const name of httpHostNames) {
    const adapter = httpGroup.get(name);

    if (adapter === undefined || adapter === null) {
      throw new Error(`Scalar: selected http target not found: ${name}`);
    }

    if (!isKeyedRecord(adapter)) {
      throw new Error(`Scalar: selected http adapter is not an object: ${name}`);
    }

    if (boundAdapters.has(adapter)) {
      continue;
    }

    const internalValue: ScalarInput | InternalRouter = adapter[ZIPBUL_HTTP_INTERNAL];

    if (!hasInternalRouter(internalValue)) {
      throw new Error('Scalar: selected http adapter does not support internal route binding (upgrade http-adapter).');
    }

    registerInternalRoutes(internalValue, docs, docsById);
    boundAdapters.add(adapter);
  }
}
