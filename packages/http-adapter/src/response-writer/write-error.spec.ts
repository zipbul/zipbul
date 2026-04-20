import { describe, expect, it } from 'bun:test';
import { StatusCodes } from 'http-status-codes';

import { httpError } from '../http-error';
import { HttpResponse } from '../http-response';
import { createTestHttpRequest } from '../test-fixtures/http-request-fixture';
import { writeErrorResponse } from './write-error';

function makeRes(): HttpResponse {
  return new HttpResponse(createTestHttpRequest(), new Headers());
}

describe('writeErrorResponse', () => {
  it('writes ErrorResponseData built by httpError() factory (status + default reason phrase)', async () => {
    const res = makeRes();
    const e = httpError(StatusCodes.IM_A_TEAPOT);
    writeErrorResponse(res, e.data);
    const wire = res.end();
    expect(wire.status).toBe(418);
    const body = await wire.json();
    expect(body).toEqual({ status: 418, message: "I'm a teapot" });
  });

  it('writes ErrorResponseData with custom message', async () => {
    const res = makeRes();
    const e = httpError(StatusCodes.FORBIDDEN, 'No entry');
    writeErrorResponse(res, e.data);
    const wire = res.end();
    expect(wire.status).toBe(403);
    const body = await wire.json();
    expect(body).toEqual({ status: 403, message: 'No entry' });
  });

  it('includes errors array when present', async () => {
    const res = makeRes();
    const e = httpError(
      StatusCodes.UNPROCESSABLE_ENTITY,
      'Validation failed',
      [{ field: 'name' }],
    );
    writeErrorResponse(res, e.data);
    const wire = res.end();
    expect(wire.status).toBe(422);
    const body = await wire.json();
    expect(body).toEqual({ status: 422, message: 'Validation failed', errors: [{ field: 'name' }] });
  });

  it('omits errors field when undefined', async () => {
    const res = makeRes();
    writeErrorResponse(res, { status: StatusCodes.NOT_FOUND, message: 'nope' });
    const wire = res.end();
    const body = await wire.json() as Record<string, unknown>;
    expect(body.errors).toBeUndefined();
  });

  it('clones errors array to avoid readonly leak', async () => {
    const res = makeRes();
    const errors = [{ field: 'a' }];
    writeErrorResponse(res, {
      status: StatusCodes.BAD_REQUEST,
      message: 'x',
      errors,
    });
    const wire = res.end();
    const body = await wire.json() as { errors: unknown[] };
    expect(body.errors).not.toBe(errors);
    expect(body.errors).toEqual([{ field: 'a' }]);
  });
});

describe('httpError() factory', () => {
  it('supplies default message from StatusCodes reason phrase', () => {
    expect(httpError(404).data).toEqual({ status: 404, message: 'Not Found' });
    expect(httpError(500).data).toEqual({ status: 500, message: 'Internal Server Error' });
  });

  it('applies RFC 9110 phrase overrides for codes the http-status-codes package ships with RFC 2616 text', () => {
    // RFC 9110 §15 renamed/reworded these phrases. The override map must cover them.
    expect(httpError(413).data.message).toBe('Content Too Large');
    expect(httpError(414).data.message).toBe('URI Too Long');
    expect(httpError(416).data.message).toBe('Range Not Satisfiable');
    expect(httpError(422).data.message).toBe('Unprocessable Content');
  });

  it('custom message always wins over RFC override', () => {
    expect(httpError(413, 'Payload too big').data.message).toBe('Payload too big');
    expect(httpError(422, 'Bad input').data.message).toBe('Bad input');
  });

  it('accepts custom message override', () => {
    expect(httpError(400, 'Malformed JSON').data).toEqual({ status: 400, message: 'Malformed JSON' });
  });

  it('attaches errors array when provided', () => {
    const issues = [{ path: 'name', code: 'required' }];
    expect(httpError(422, 'Validation', issues).data).toEqual({
      status: 422,
      message: 'Validation',
      errors: issues,
    });
  });

  it('omits errors field when not provided', () => {
    expect(httpError(401).data).toEqual({ status: 401, message: 'Unauthorized' });
    expect('errors' in httpError(401).data).toBe(false);
  });

  it('returns a frozen Err via zipbul/result', () => {
    const e = httpError(500);
    expect(() => { (e as { data: ErrorResponseData }).data = {} as never; }).toThrow();
  });
});

import type { ErrorResponseData } from '../types';
