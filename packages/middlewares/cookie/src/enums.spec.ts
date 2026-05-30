import { describe, expect, it } from 'bun:test';

import { CookieErrorReason } from './enums';

describe('enums', () => {
  describe('CookieErrorReason', () => {
    it('should map every member to its exact literal wire value with no extra keys', () => {
      // Cast the spread to a plain record so the literal expectation type-checks; this single
      // assertion locks BOTH the member set (no missing / no extra keys) and each wire string.
      expect({ ...CookieErrorReason } as Record<string, string>).toEqual({
        EmptySecrets: 'empty-secrets',
        InvalidSecret: 'invalid-secret',
        InvalidSignature: 'invalid-signature',
        SignatureVerificationFailed: 'signature-verification-failed',
        InvalidEncryptionSecret: 'invalid-encryption-secret',
        InvalidCiphertext: 'invalid-ciphertext',
        DecryptionFailed: 'decryption-failed',
        SecurePrefixRequiresSecure: 'secure-prefix-requires-secure',
        HostPrefixRequiresSecure: 'host-prefix-requires-secure',
        HostPrefixForbidsDomain: 'host-prefix-forbids-domain',
        HostPrefixRequiresRootPath: 'host-prefix-requires-root-path',
        SigningNotConfigured: 'signing-not-configured',
        EncryptionKeyExhausted: 'encryption-key-exhausted',
        EncryptionNotConfigured: 'encryption-not-configured',
        InvalidAlgorithm: 'invalid-algorithm',
        InvalidCookieName: 'invalid-cookie-name',
        CookieTooLarge: 'cookie-too-large',
        AttributeTooLarge: 'attribute-too-large',
        SameSiteNoneRequiresSecure: 'samesite-none-requires-secure',
        PartitionedRequiresSecure: 'partitioned-requires-secure',
        InvalidDomain: 'invalid-domain',
        InvalidPath: 'invalid-path',
        InvalidPriority: 'invalid-priority',
        WeakSecret: 'weak-secret',
        InvalidMaxAge: 'invalid-max-age',
        InvalidExpires: 'invalid-expires',
        InvalidCookieValue: 'invalid-cookie-value',
        InvalidAttribute: 'invalid-attribute',
        CookieParserError: 'cookie-parser-error',
      });
    });
  });
});
