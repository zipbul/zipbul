import { err, isErr } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import type { HttpContext } from '../http-context';
import type { ErrorResponseData } from '../interfaces';
import { ContentType, HttpHeader, HttpMethod, HttpStatus } from '../enums';

import { readBodyWithLimit } from './read-with-limit';
import { parseJsonBody } from './parse-json';

/**
 * Parses the HTTP request body from the raw Bun `Request`.
 * 3분기 구조 보존 — CL fast path의 Bun 특화 동작 유지.
 *
 * @param http - The HTTP context.
 * @param defaultBodyLimit - Global body limit from server options.
 * @param textMediaTypes - Set of media types treated as text.
 * @returns `void` on success, `Err` with status on failure.
 */
export async function parseBody(
  http: HttpContext,
  defaultBodyLimit: number,
  textMediaTypes: ReadonlySet<string>,
): Promise<Result<void, ErrorResponseData>> {
  const req = http.request;
  const rawReq = http.consumeRawRequest();

  if (rawReq === undefined) return undefined;
  if (req.method === HttpMethod.Get || req.method === HttpMethod.Head) return undefined;
  if ((req.method === HttpMethod.Delete || req.method === HttpMethod.Options) && req.contentType === null) return undefined;

  // Content-Length: 0 — body 없음. Content-Encoding보다 먼저 체크.
  if (req.contentLength === 0) return undefined;

  // Content-Encoding 감지
  const contentEncoding = req.headers.get(HttpHeader.ContentEncoding);
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
    // RFC 9110 §15.5.16
    http.response.setHeader(HttpHeader.AcceptEncoding, 'identity');
    return err({
      status: HttpStatus.UnsupportedMediaType,
      message: `Content-Encoding '${contentEncoding}' is not supported. Send uncompressed request body.`,
    });
  }

  const mediaType = req.contentType?.mediaType ?? '';
  const isJson = mediaType === ContentType.Json || mediaType.endsWith('+json');
  const isTextLike = mediaType.startsWith('text/')
    || mediaType === ContentType.FormUrlEncoded
    || textMediaTypes.has(mediaType);
  const shouldBuffer = isJson || isTextLike;
  const rawBodyEnabled = http.matchedRoute?.rawBody === true;
  const charset = req.contentType?.charset ?? 'utf-8';

  // JSON charset 제한: RFC 8259 §8.1 — UTF-8만 허용
  if (isJson) {
    try {
      if (new TextDecoder(charset as Bun.Encoding).encoding !== 'utf-8') {
        return err({
          status: HttpStatus.BadRequest,
          message: `JSON requires UTF-8 encoding (RFC 8259 §8.1), received: ${charset}`,
        });
      }
    } catch {
      return err({
        status: HttpStatus.BadRequest,
        message: `JSON requires UTF-8 encoding (RFC 8259 §8.1), received: ${charset}`,
      });
    }
  }

  const effectiveBodyLimit = http.matchedRoute?.bodyLimit ?? defaultBodyLimit;

  if (shouldBuffer && rawBodyEnabled) {
    // ── 버퍼링 + rawBody (CL 유무 불문 readBodyWithLimit) ──
    const bytesResult = await readBodyWithLimit(rawReq, req.contentLength, effectiveBodyLimit);
    if (isErr(bytesResult)) return bytesResult;

    req.rawBody = bytesResult;

    let text: string;
    try {
      text = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(bytesResult);
    } catch {
      return err({ status: HttpStatus.BadRequest, message: `Unsupported or malformed charset: ${charset}` });
    }

    if (isJson) {
      try {
        req.body = parseJsonBody(JSON.parse(text));
      } catch {
        return err({ status: HttpStatus.BadRequest, message: 'Invalid JSON in request body' });
      }
    } else {
      req.body = text;
    }
    return undefined;
  }

  if (shouldBuffer) {
    // ── 버퍼링, rawBody 비활성 ──
    if (req.contentLength === null) {
      // CL 없음 (chunked TE) — readBodyWithLimit으로 점진적 size 체크
      const bytesResult = await readBodyWithLimit(rawReq, null, effectiveBodyLimit);
      if (isErr(bytesResult)) return bytesResult;

      let text: string;
      try {
        text = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(bytesResult);
      } catch {
        return err({ status: HttpStatus.BadRequest, message: `Unsupported or malformed charset: ${charset}` });
      }

      if (isJson) {
        try {
          req.body = parseJsonBody(JSON.parse(text));
        } catch {
          return err({ status: HttpStatus.BadRequest, message: 'Invalid JSON in request body' });
        }
      } else {
        req.body = text;
      }
      return undefined;
    }

    // CL 존재 — fast path. bodyLimit 초과 시 즉시 거부.
    if (req.contentLength! > effectiveBodyLimit) {
      return err({ status: HttpStatus.ContentTooLarge, message: 'Request body exceeds size limit' });
    }
    if (isJson) {
      try {
        req.body = parseJsonBody(await rawReq.json());
      } catch (error) {
        // SyntaxError = 클라이언트가 잘못된 JSON 전송 → err(400)
        // TypeError/기타 = body 이중 소비, 네트워크 끊김 등 인프라 에러 → throw 전파
        if (error instanceof SyntaxError) {
          return err({ status: HttpStatus.BadRequest, message: 'Invalid JSON in request body' });
        }
        throw error;
      }
    } else {
      try {
        const raw = new Uint8Array(await rawReq.arrayBuffer());
        req.body = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(raw);
      } catch {
        return err({ status: HttpStatus.BadRequest, message: `Unsupported or malformed charset: ${charset}` });
      }
    }
    return undefined;
  }

  // ── 스트리밍 — 버퍼링 없음 ──
  if (rawReq.body !== null) {
    // Bun Request.body는 ReadableStream<Uint8Array>이지만 TS 타입이 ReadableStream<any>로 선언됨
    req.body = rawReq.body as ReadableStream<Uint8Array>;
  }
  return undefined;
}
