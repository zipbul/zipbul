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
    expect(CorsAction.RespondPreflight).toBe('respond-preflight' as CorsAction.RespondPreflight);
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
    expect(CorsRejectionReason.NoOrigin).toBe('no-origin' as CorsRejectionReason.NoOrigin);
    expect(CorsRejectionReason.OriginNotAllowed).toBe('origin-not-allowed' as CorsRejectionReason.OriginNotAllowed);
    expect(CorsRejectionReason.MethodNotAllowed).toBe('method-not-allowed' as CorsRejectionReason.MethodNotAllowed);
    expect(CorsRejectionReason.HeaderNotAllowed).toBe('header-not-allowed' as CorsRejectionReason.HeaderNotAllowed);
  });
});

describe('CorsErrorReason enum', () => {
  it('should map every member to its exact literal wire value with no extra keys', () => {
    expect({ ...CorsErrorReason }).toEqual({
      CredentialsWithWildcardOrigin: CorsErrorReason.CredentialsWithWildcardOrigin,
      CredentialsWithWildcardMethods: CorsErrorReason.CredentialsWithWildcardMethods,
      InvalidMaxAge: CorsErrorReason.InvalidMaxAge,
      InvalidStatusCode: CorsErrorReason.InvalidStatusCode,
      OriginFunctionError: CorsErrorReason.OriginFunctionError,
      InvalidOrigin: CorsErrorReason.InvalidOrigin,
      InvalidMethods: CorsErrorReason.InvalidMethods,
      InvalidAllowedHeaders: CorsErrorReason.InvalidAllowedHeaders,
      InvalidExposedHeaders: CorsErrorReason.InvalidExposedHeaders,
    });
    expect(CorsErrorReason.CredentialsWithWildcardOrigin).toBe(
      'credentials-with-wildcard-origin' as CorsErrorReason.CredentialsWithWildcardOrigin,
    );
    expect(CorsErrorReason.CredentialsWithWildcardMethods).toBe(
      'credentials-with-wildcard-methods' as CorsErrorReason.CredentialsWithWildcardMethods,
    );
    expect(CorsErrorReason.InvalidMaxAge).toBe('invalid-max-age' as CorsErrorReason.InvalidMaxAge);
    expect(CorsErrorReason.InvalidStatusCode).toBe('invalid-status-code' as CorsErrorReason.InvalidStatusCode);
    expect(CorsErrorReason.OriginFunctionError).toBe('origin-function-error' as CorsErrorReason.OriginFunctionError);
    expect(CorsErrorReason.InvalidOrigin).toBe('invalid-origin' as CorsErrorReason.InvalidOrigin);
    expect(CorsErrorReason.InvalidMethods).toBe('invalid-methods' as CorsErrorReason.InvalidMethods);
    expect(CorsErrorReason.InvalidAllowedHeaders).toBe('invalid-allowed-headers' as CorsErrorReason.InvalidAllowedHeaders);
    expect(CorsErrorReason.InvalidExposedHeaders).toBe('invalid-exposed-headers' as CorsErrorReason.InvalidExposedHeaders);
  });
});
