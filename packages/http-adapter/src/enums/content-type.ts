/**
 * Default media types used by the response writer and serializer.
 *
 * Body parsing accepts a broader configurable allow-list; these defaults
 * cover the success path of `HttpResponse.serialize()`.
 */
export enum ContentType {
  Text = 'text/plain',
  Json = 'application/json',
}
