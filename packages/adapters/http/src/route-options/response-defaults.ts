import type { HttpResponse } from '../http-response';
import type { HttpStatus } from '../enums';
import type { RedirectStatus } from '../types';

export function buildResponseDefaultsApplier(
  status: HttpStatus | undefined,
  contentType: string | undefined,
  headers: readonly (readonly [string, string])[],
  redirect: { readonly url: string; readonly status?: RedirectStatus } | undefined,
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
