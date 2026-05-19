import { describe, expect, it } from 'bun:test';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';

describe('CORS_DEFAULT_METHODS', () => {
  it('should be the exact list ["GET","HEAD","PUT","PATCH","POST","DELETE"]', () => {
    expect(CORS_DEFAULT_METHODS).toEqual(['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']);
  });
});

describe('CORS_DEFAULT_OPTIONS_SUCCESS_STATUS', () => {
  it('should be exactly 204 (HttpStatus.NoContent)', () => {
    expect(CORS_DEFAULT_OPTIONS_SUCCESS_STATUS).toBe(204);
  });
});
