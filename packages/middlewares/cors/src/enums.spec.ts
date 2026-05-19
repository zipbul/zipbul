import { describe, expect, it } from 'bun:test';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';

describe('CorsAction enum', () => {
  it('should map every member to its exact literal wire value', () => {
    expect(CorsAction).toMatchObject({
      Continue: 'continue',
      RespondPreflight: 'respond_preflight',
      Reject: 'reject',
    });
  });
});

describe('CorsRejectionReason enum', () => {
  it('should map every member to its exact literal wire value', () => {
    expect(CorsRejectionReason).toMatchObject({
      NoOrigin: 'no_origin',
      OriginNotAllowed: 'origin_not_allowed',
      MethodNotAllowed: 'method_not_allowed',
      HeaderNotAllowed: 'header_not_allowed',
    });
  });
});

describe('CorsErrorReason enum', () => {
  it('should map every member to its exact literal wire value', () => {
    expect(CorsErrorReason).toMatchObject({
      CredentialsWithWildcardOrigin: 'credentials_with_wildcard_origin',
      InvalidMaxAge: 'invalid_max_age',
      InvalidStatusCode: 'invalid_status_code',
      OriginFunctionError: 'origin_function_error',
      InvalidOrigin: 'invalid_origin',
      InvalidMethods: 'invalid_methods',
      InvalidAllowedHeaders: 'invalid_allowed_headers',
      InvalidExposedHeaders: 'invalid_exposed_headers',
      UnsafeRegExp: 'unsafe_regexp',
    });
  });
});
