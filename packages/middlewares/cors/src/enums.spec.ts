import { describe, expect, it } from 'bun:test';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';

describe('CorsAction enum', () => {
  it('should map every member to its exact literal wire value with no extra keys', () => {
    expect({ ...CorsAction }).toEqual({
      Continue: CorsAction.Continue,
      RespondPreflight: CorsAction.RespondPreflight,
      Reject: CorsAction.Reject,
    });
    expect(CorsAction.Continue).toBe('continue' as CorsAction.Continue);
    expect(CorsAction.RespondPreflight).toBe('respond_preflight' as CorsAction.RespondPreflight);
    expect(CorsAction.Reject).toBe('reject' as CorsAction.Reject);
  });
});

describe('CorsRejectionReason enum', () => {
  it('should map every member to its exact literal wire value with no extra keys', () => {
    expect({ ...CorsRejectionReason }).toEqual({
      NoOrigin: CorsRejectionReason.NoOrigin,
      OriginNotAllowed: CorsRejectionReason.OriginNotAllowed,
      MethodNotAllowed: CorsRejectionReason.MethodNotAllowed,
      HeaderNotAllowed: CorsRejectionReason.HeaderNotAllowed,
    });
    expect(CorsRejectionReason.NoOrigin).toBe('no_origin' as CorsRejectionReason.NoOrigin);
    expect(CorsRejectionReason.OriginNotAllowed).toBe('origin_not_allowed' as CorsRejectionReason.OriginNotAllowed);
    expect(CorsRejectionReason.MethodNotAllowed).toBe('method_not_allowed' as CorsRejectionReason.MethodNotAllowed);
    expect(CorsRejectionReason.HeaderNotAllowed).toBe('header_not_allowed' as CorsRejectionReason.HeaderNotAllowed);
  });
});

describe('CorsErrorReason enum', () => {
  it('should map every member to its exact literal wire value with no extra keys', () => {
    expect({ ...CorsErrorReason }).toEqual({
      CredentialsWithWildcardOrigin: CorsErrorReason.CredentialsWithWildcardOrigin,
      InvalidMaxAge: CorsErrorReason.InvalidMaxAge,
      InvalidStatusCode: CorsErrorReason.InvalidStatusCode,
      OriginFunctionError: CorsErrorReason.OriginFunctionError,
      InvalidOrigin: CorsErrorReason.InvalidOrigin,
      InvalidMethods: CorsErrorReason.InvalidMethods,
      InvalidAllowedHeaders: CorsErrorReason.InvalidAllowedHeaders,
      InvalidExposedHeaders: CorsErrorReason.InvalidExposedHeaders,
    });
    expect(CorsErrorReason.CredentialsWithWildcardOrigin).toBe(
      'credentials_with_wildcard_origin' as CorsErrorReason.CredentialsWithWildcardOrigin,
    );
    expect(CorsErrorReason.InvalidMaxAge).toBe('invalid_max_age' as CorsErrorReason.InvalidMaxAge);
    expect(CorsErrorReason.InvalidStatusCode).toBe('invalid_status_code' as CorsErrorReason.InvalidStatusCode);
    expect(CorsErrorReason.OriginFunctionError).toBe('origin_function_error' as CorsErrorReason.OriginFunctionError);
    expect(CorsErrorReason.InvalidOrigin).toBe('invalid_origin' as CorsErrorReason.InvalidOrigin);
    expect(CorsErrorReason.InvalidMethods).toBe('invalid_methods' as CorsErrorReason.InvalidMethods);
    expect(CorsErrorReason.InvalidAllowedHeaders).toBe('invalid_allowed_headers' as CorsErrorReason.InvalidAllowedHeaders);
    expect(CorsErrorReason.InvalidExposedHeaders).toBe('invalid_exposed_headers' as CorsErrorReason.InvalidExposedHeaders);
  });
});
