import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import { StatusCodes } from 'http-status-codes';

import type { ErrorResponseData } from '../types';

export async function readBodyWithLimit(
  rawReq: Request,
  contentLength: number | null,
  bodyLimit: number,
): Promise<Result<Uint8Array, ErrorResponseData>> {
  // CL 존재 — fast path. bodyLimit 초과 시 즉시 거부.
  if (contentLength !== null) {
    if (contentLength > bodyLimit) {
      return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
    }
    return new Uint8Array(await rawReq.arrayBuffer());
  }

  // CL 없음 (chunked TE) — 점진적 size 체크
  const body = rawReq.body;
  if (body === null) {
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  let limitExceeded = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.byteLength;
      if (totalSize > bodyLimit) {
        limitExceeded = true;
        return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
      }

      chunks.push(value);
    }
  } finally {
    if (limitExceeded) {
      await reader.cancel();
    }
    reader.releaseLock();
  }

  if (chunks.length === 1) {
    return chunks[0]!;
  }

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
