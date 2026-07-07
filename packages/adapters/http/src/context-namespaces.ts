import { HttpRequest } from './http-request';
import { HttpResponse } from './http-response';

/**
 * The HTTP context namespaces and the prototypes their augment members install
 * on. Single source of truth consumed by {@link HttpAdapter.namespacePrototypes}
 * (the adapter's declaration to core) and the `withAugments` test helper, so the
 * two never drift.
 */
export const HTTP_NAMESPACE_PROTOTYPES: Readonly<Record<string, object>> = {
  request: HttpRequest.prototype,
  response: HttpResponse.prototype,
};
