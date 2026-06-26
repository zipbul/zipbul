export enum SameSite {
  Strict = 'strict',
  Lax = 'lax',
  None = 'none',
}

export enum CookiePriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum SigningAlgorithm {
  Sha256 = 'sha256',
  Sha384 = 'sha384',
  Sha512 = 'sha512',
}

export enum CookieErrorReason {
  EmptySecrets = 'empty-secrets',
  InvalidSecret = 'invalid-secret',
  InvalidSignature = 'invalid-signature',
  SignatureVerificationFailed = 'signature-verification-failed',
  InvalidEncryptionSecret = 'invalid-encryption-secret',
  InvalidCiphertext = 'invalid-ciphertext',
  DecryptionFailed = 'decryption-failed',
  SecurePrefixRequiresSecure = 'secure-prefix-requires-secure',
  HostPrefixRequiresSecure = 'host-prefix-requires-secure',
  HostPrefixForbidsDomain = 'host-prefix-forbids-domain',
  HostPrefixRequiresRootPath = 'host-prefix-requires-root-path',
  SigningNotConfigured = 'signing-not-configured',
  EncryptionNotConfigured = 'encryption-not-configured',
  InvalidAlgorithm = 'invalid-algorithm',
  InvalidCookieName = 'invalid-cookie-name',
  CookieTooLarge = 'cookie-too-large',
  AttributeTooLarge = 'attribute-too-large',
  SameSiteNoneRequiresSecure = 'samesite-none-requires-secure',
  PartitionedRequiresSecure = 'partitioned-requires-secure',
  InvalidDomain = 'invalid-domain',
  InvalidPath = 'invalid-path',
  InvalidPriority = 'invalid-priority',
  InvalidMaxAge = 'invalid-max-age',
  InvalidExpires = 'invalid-expires',
  InvalidSameSite = 'invalid-same-site',
  InvalidSecure = 'invalid-secure',
  InvalidHttpOnly = 'invalid-http-only',
  InvalidPartitioned = 'invalid-partitioned',
  InvalidPrefixValidation = 'invalid-prefix-validation',
  InvalidKdfSalt = 'invalid-kdf-salt',
  InvalidMaxInboundCookieBytes = 'invalid-max-inbound-cookie-bytes',
  InvalidAttribute = 'invalid-attribute',
}
