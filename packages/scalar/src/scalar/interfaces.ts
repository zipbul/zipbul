import type { ZipbulRecord } from '@zipbul/common';

import type { OpenApiDocument } from '../openapi';
import type { DocumentTarget, DocumentTargets, HttpTargets, ScalarMetadataRegistry } from './types';

export interface ScalarSetupOptions extends ZipbulRecord {
  documentTargets: DocumentTargets;
  httpTargets: HttpTargets;
}

export interface Doc {
  docId: string;
  spec: OpenApiDocument;
}

export interface ResolvedDocPath {
  docId: string;
  isJson: boolean;
}

export interface ScalarRequest {
  path?: string;
}

export type InternalRouteHandler = (req: ScalarRequest) => Response;

export interface InternalRouter {
  get: (path: string, handler: InternalRouteHandler) => void;
}

export interface ScalarOptionsWithRegistry {
  metadataRegistry?: ScalarMetadataRegistry;
}

export interface ScalarSetupOptionsInput extends ScalarOptionsWithRegistry {
  documentTargets?: string | DocumentTarget[];
  httpTargets?: string | string[] | undefined;
}
