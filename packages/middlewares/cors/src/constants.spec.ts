import { HttpMethod } from '@zipbul/http-adapter';
import { describe, expect, it } from 'bun:test';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';

describe('CORS_DEFAULT_METHODS', () => {
  it('should be the exact list of standard HttpMethod enum members', () => {
    expect(CORS_DEFAULT_METHODS).toEqual([
      HttpMethod.Get,
      HttpMethod.Head,
      HttpMethod.Put,
      HttpMethod.Patch,
      HttpMethod.Post,
      HttpMethod.Delete,
    ]);
  });
});

describe('CORS_DEFAULT_OPTIONS_SUCCESS_STATUS', () => {
  it('should be exactly 204 (HttpStatus.NoContent)', () => {
    expect(CORS_DEFAULT_OPTIONS_SUCCESS_STATUS).toBe(204);
  });
});
