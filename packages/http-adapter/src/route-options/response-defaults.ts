import type { HttpResponse } from '../http-response';
import type { HttpStatus } from '../types';

export function buildResponseDefaultsApplier(
  status: HttpStatus | undefined,
  contentType: string | undefined,
  headers: readonly (readonly [string, string])[],
  redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined,
): ((response: HttpResponse) => void) | undefined {
  if (status === undefined && contentType === undefined && headers.length === 0 && redirect === undefined) {
    return undefined;
  }

  return (response: HttpResponse): void => {
    if (status !== undefined) {
      response.setStatus(status);
    }

    if (contentType !== undefined) {
      response.setContentType(contentType);
    }

    for (const [name, value] of headers) {
      response.setHeader(name, value);
    }

    if (redirect !== undefined) {
      response.redirect(redirect.url, redirect.status);
    }
  };
}
