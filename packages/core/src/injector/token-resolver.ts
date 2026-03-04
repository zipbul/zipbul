import type { ProviderToken } from '@zipbul/common';

import type { DecoratorArgument, Token, TokenRecord } from './types';

/**
 * Normalizes a token to a stable string key for container lookup.
 *
 * @param token - The token to normalize (string, symbol, function, or TokenRecord)
 * @returns A stable string representation, or undefined if the token cannot be normalized
 * @public
 */
export function normalizeToken(token: Token | TokenRecord | undefined): string | undefined {
  if (token === null || token === undefined) {
    return undefined;
  }

  if (typeof token === 'string') {
    return token;
  }

  if (typeof token === 'symbol') {
    return token.description ?? token.toString();
  }

  if (typeof token === 'function') {
    const tokenName = token.name;

    if (tokenName.length > 0) {
      return tokenName;
    }
  }

  if (isTokenRecord(token)) {
    const ref = token.__zipbul_ref;
    const lazyRef = token.__zipbul_lazy_ref;

    if (typeof ref === 'string') {
      return ref;
    }

    if (typeof lazyRef === 'string') {
      return lazyRef;
    }

    const tokenName = token.name;

    if (typeof tokenName === 'string' && tokenName.length > 0) {
      return tokenName;
    }
  }

  return undefined;
}

/**
 * Formats a token into a human-readable label for error messages.
 *
 * @param token - The token to format
 * @param normalized - An already-normalized string, used as shortcut if present
 * @returns A human-readable string label
 * @public
 */
export function formatToken(token: Token | TokenRecord | undefined, normalized?: string): string {
  if (typeof normalized === 'string' && normalized.length > 0) {
    return normalized;
  }

  if (typeof token === 'string') {
    return token;
  }

  if (typeof token === 'symbol') {
    return token.description ?? token.toString();
  }

  if (typeof token === 'function') {
    return token.name.length > 0 ? token.name : 'AnonymousToken';
  }

  if (isTokenRecord(token)) {
    const tokenName = token.name;

    return typeof tokenName === 'string' && tokenName.length > 0 ? tokenName : 'TokenRecord';
  }

  return 'UnknownToken';
}

/**
 * Coerces a decorator argument into a Token or TokenRecord if possible.
 *
 * @param value - The decorator argument to coerce
 * @returns A Token, TokenRecord, or undefined if coercion is not possible
 * @public
 */
export function coerceToken(value: DecoratorArgument | undefined): Token | TokenRecord | undefined {
  if (isProviderToken(value) || isTokenRecord(value)) {
    return value;
  }

  return undefined;
}

/**
 * Checks whether a value is a valid ProviderToken (string, symbol, or function).
 *
 * @param value - The value to check
 * @returns True if the value is a ProviderToken
 * @public
 */
export function isProviderToken(value: DecoratorArgument | Token | TokenRecord | ProviderToken | undefined): value is Token {
  return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
}

/**
 * Checks whether a value is a TokenRecord (has __zipbul_ref, __zipbul_lazy_ref, or name).
 *
 * @param value - The value to check
 * @returns True if the value is a TokenRecord
 * @public
 */
export function isTokenRecord(value: DecoratorArgument | Token | TokenRecord | ProviderToken | undefined): value is TokenRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if ('__zipbul_ref' in value && typeof value.__zipbul_ref === 'string') {
    return true;
  }

  if ('__zipbul_lazy_ref' in value && typeof value.__zipbul_lazy_ref === 'string') {
    return true;
  }

  if ('name' in value && typeof value.name === 'string') {
    return true;
  }

  return false;
}

/**
 * Resolves a TokenRecord into its string reference if possible.
 * Returns the original token unchanged if it is not a TokenRecord.
 *
 * @param token - The token to resolve
 * @returns The resolved string token, or the original value
 * @public
 */
export function resolveTokenRecord(token: Token | TokenRecord | undefined): Token | TokenRecord | undefined {
  if (!isTokenRecord(token)) {
    return token;
  }

  if (typeof token.__zipbul_ref === 'string') {
    return token.__zipbul_ref;
  }

  if (typeof token.__zipbul_lazy_ref === 'string') {
    return token.__zipbul_lazy_ref;
  }

  return token;
}
