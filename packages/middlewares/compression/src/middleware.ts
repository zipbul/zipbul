import { defineMiddleware } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';
import { isErr } from '@zipbul/result';
import { HttpHeader, HttpStatus } from '@zipbul/http-adapter';

import { BUFFER_COMPRESSORS } from './compressors';
import { CompressionCodec } from './enums';
import { injectGzipPadding, injectZstdPadding } from './htb';
import { CompressionError } from './interfaces';
import type { BreachOptions, CompressionOptions } from './interfaces';
import { resolveCompressionOptions, validateCompressionOptions } from './options';
import { BREACH_SAFE_ENCODINGS, INTEGRITY_FIELDS } from './constants';
import { isIdentityAcceptable, negotiateEncoding, parseAcceptEncoding } from './encoding';
import { compressStream } from './streaming';
import { serializeBody } from './serialize';
import { weakenETag } from './etag';
import { hasNoTransform, varyCoversAcceptEncoding, varyTokensToAppend } from './eligibility';

/**
 * Compression HTTP middleware factory.
 *
 * Options are validated at boot — invalid options are a programmer error
 * that fails identically on every boot, so the factory throws instead of
 * returning a Result.
 *
 * @throws {CompressionError} when options fail validation.
 */
export function compressionMiddleware(opts?: CompressionOptions): MiddlewareDefinition {
  const resolved = resolveCompressionOptions(opts);
  // 생성 시점 스냅숏 — 검증을 통과한 값이 사후 변조로 오염되지 않는다
  const breach: BreachOptions | undefined =
    opts?.breach === undefined ? undefined : { maxPadding: opts.breach.maxPadding };

  const validation = validateCompressionOptions(resolved, breach);
  if (isErr(validation)) throw new CompressionError(validation.data);

  // When BREACH mitigation is enabled, restrict to encodings with safe padding
  const effectiveEncodings = breach !== undefined
    ? resolved.encodings.filter((e) => BREACH_SAFE_ENCODINGS.has(e))
    : resolved.encodings;

  return defineMiddleware([HttpAdapter], () => (ctx) => {
    const http = ctx.to(HttpContext);
    const { request, response } = http;

    // 스트림 경로: stream/Blob/raw Response body는 buffered `_body`가 아니라
    // native Response에 저장된다. peekNativeResponse는 read-only라 lazy-merge
    // 캐시를 만들지 않는다 — skip 경로에서도 안전하다. status·no-transform 게이트가
    // native Response의 자체 status/헤더를 봐야 하므로 게이트보다 먼저 확인한다.
    const body = response.getBody();
    const native = body === undefined || body === null ? response.peekNativeResponse() : undefined;
    const nativeBody = native?.body ?? null;

    // RFC 9110 §15: skip responses that MUST NOT have a body.
    // 206: Content-Range가 이미 (비인코딩) 선택 표현 기준으로 계산되어 있으므로
    // 사후 인코딩은 §15.3.7.1의 "동봉된 range 서술" 요건을 깨뜨린다 (§14.1.2).
    // 핸들러가 반환한 raw Response의 status는 HttpResponse._status로 동기화되지 않으므로
    // (getStatus()는 _status만 반환) native.status도 함께 본다 — 안 그러면 raw 206/205 등이
    // 게이트를 통과해 압축된다. 미설정 status는 어댑터와 동일하게 200으로 취급한다.
    const status = response.getStatus() ?? native?.status ?? HttpStatus.Ok;
    if (
      status < 200
      || status === HttpStatus.NoContent
      || status === HttpStatus.ResetContent
      || status === HttpStatus.PartialContent
      || status === HttpStatus.NotModified
    ) return;

    // RFC 9110 §9.3.2: HEAD responses MUST NOT have content
    if (request.method === 'HEAD') return;

    if ((body === undefined || body === null) && nativeBody === null) return;
    if (response.getHeader(HttpHeader.ContentEncoding) !== null) return;
    // 핸들러가 반환한 raw Response 자체의 CE도 존중 — 이중 압축 금지 (§2.4.1)
    if (native !== undefined && native.headers.get(HttpHeader.ContentEncoding) !== null) return;

    // RFC 9110 §7.7 + RFC 9111 §5.2.2.6: no-transform prohibits compression.
    // CT·CE와 마찬가지로 native Response 자체의 Cache-Control도 본다 — raw Response에
    // no-transform이 있으면 압축하지 않는다.
    const cacheControl = response.getHeader(HttpHeader.CacheControl)
      ?? (native !== undefined ? native.headers.get(HttpHeader.CacheControl) : null);
    if (cacheControl !== null && hasNoTransform(cacheControl)) return;

    // filter는 사용자 코드 — throw 시 보수적으로 압축을 포기한다 (응답은 원본 유지)
    // 스트림 경로에서는 native Response 내부 CT(raw Response 핸들러의 SSE 등)도 본다.
    const contentType = response.getContentType()
      ?? (native !== undefined ? native.headers.get(HttpHeader.ContentType) : null);
    if (contentType !== null) {
      let allowed: boolean;
      try {
        allowed = resolved.filter(contentType);
      } catch {
        return;
      }
      if (!allowed) return;
    }

    // RFC 9110 §12.5.5: Vary lists only request fields that influenced content selection.
    // Set it here — once the response is known Accept-Encoding-negotiable (compressible
    // content-type, not no-transform) — but before every negotiation-dependent early
    // return, so identity/absent-AE responses of a negotiable resource still vary.
    // no-transform and filter-excluded responses returned above intentionally get no Vary:
    // Accept-Encoding never influences their (always-identity) representation.
    const existingVary = response.getHeader(HttpHeader.Vary);
    if (existingVary === null || !varyCoversAcceptEncoding(existingVary)) {
      response.appendHeader(HttpHeader.Vary, HttpHeader.AcceptEncoding);
    }

    // BREACH 활성 시 스트림은 압축하지 않는다 — 포맷 패딩 주입이 불가능하므로
    // 압축 이득보다 오라클 방어를 우선한다 (§9.3.1 정책). Vary는 위에서 이미 설정.
    if (native !== undefined && breach !== undefined) return;

    // Check Accept-Encoding and negotiate before serializing body (avoids
    // wasteful JSON.stringify + TextEncoder.encode when no encoding matches).
    const acceptHeader = request.headers.get(HttpHeader.AcceptEncoding);
    if (acceptHeader === null || acceptHeader === '') return;

    const clientPrefs = parseAcceptEncoding(acceptHeader);
    const encoding = negotiateEncoding(effectiveEncodings, clientPrefs);

    if (encoding === null) {
      // RFC 9110 §12.5.3: acceptable coding이 없으면 코딩 없이(identity) 보내되(SHOULD),
      // identity가 unacceptable로 표시된 경우는 예외 — §15.5.7의 406으로 대응한다.
      if (!isIdentityAcceptable(clientPrefs)) {
        response
          .setStatus(HttpStatus.NotAcceptable)
          .setBody(null)
          .removeHeader(HttpHeader.ContentLength);
      }
      return;
    }

    // ── 스트림 경로: 길이 미지 — threshold·팽창 가드 미적용, CL 제거 ──
    if (native !== undefined && nativeBody !== null) {
      // native Response의 자체 헤더(핸들러가 raw Response로 설정한 CT·커스텀 헤더 등)를
      // setBody 전에 포착한다 — setBody(stream)이 native Response를 통째로 교체하므로,
      // 보존하지 않으면 이 헤더들이 소실된다.
      const preserved = native.headers;
      const compressedStream = compressStream(nativeBody, encoding);
      response
        .setBody(compressedStream)
        .setHeader(HttpHeader.ContentEncoding, encoding)
        .removeHeader(HttpHeader.ContentLength);
      // RFC 9530 §2·§3: 비인코딩 기준 integrity 필드는 인코딩 후 거짓 — CL과 같이 무효화
      for (const field of INTEGRITY_FIELDS) response.removeHeader(field);
      // 원본 native 헤더를 재적용 — 인코딩으로 무효해진 CL과 우리가 설정한 CE는 제외.
      // 이미 설정된 헤더는 덮지 않되, Vary는 예외로 병합한다: 미들웨어가 위에서
      // Accept-Encoding을 얹었으므로 단순 skip하면 핸들러가 설정한 selecting header
      // (예: Accept-Language)가 소실되어 shared cache가 깨진다 (§4.1 · RFC 9110 §12.5.5).
      for (const [name, value] of preserved) {
        const lower = name.toLowerCase();
        if (lower === HttpHeader.ContentEncoding || lower === HttpHeader.ContentLength) continue;
        // 인코딩으로 무효해진 integrity 필드(RFC 9530)도 재적용하지 않는다
        if ((INTEGRITY_FIELDS as readonly string[]).includes(lower)) continue;
        // Set-Cookie는 다중값이라 아래에서 getSetCookie()로 일괄 append한다 — 여기서
        // setHeader로 처리하면 두 번째 이후 쿠키가 소실된다 (RFC 6265: 다중 허용).
        if (lower === HttpHeader.SetCookie) continue;
        if (lower === HttpHeader.Vary) {
          for (const token of varyTokensToAppend(response.getHeader(HttpHeader.Vary), value)) {
            response.appendHeader(HttpHeader.Vary, token);
          }
          continue;
        }
        if (response.getHeader(name) === null) response.setHeader(name, value);
      }
      // 원본 native의 모든 Set-Cookie를 개별 헤더로 재적용 (iterator/​setHeader 병합 회피)
      for (const cookie of preserved.getSetCookie()) {
        response.appendHeader(HttpHeader.SetCookie, cookie);
      }
      const streamETag = response.getHeader(HttpHeader.ETag);
      if (streamETag !== null) {
        response.setHeader(HttpHeader.ETag, weakenETag(streamETag));
      }
      return;
    }
    if (body === undefined || body === null) return; // 방어적 — 위 분기 후 buffered만 남는다

    // 직렬화 불가 body(순환 참조·BigInt 등)는 throw 대신 스킵 — 원본이 그대로
    // 후속 파이프라인으로 흘러가 어댑터의 자체 직렬화 오류 처리에 맡겨진다
    let bytes: Uint8Array;
    try {
      bytes = serializeBody(body);
    } catch {
      return;
    }
    if (bytes.byteLength < resolved.threshold) return;

    let compressed: Uint8Array;
    try {
      compressed = BUFFER_COMPRESSORS[encoding](bytes, resolved.level[encoding]);
    } catch {
      return;
    }

    // 팽창 가드: 압축이 이득이 없으면(비압축성 입력) 원본을 유지한다 — 정책(§9.2.3)
    if (compressed.byteLength >= bytes.byteLength) return;

    // BREACH mitigation: inject format-level padding
    if (breach !== undefined) {
      if (encoding === CompressionCodec.Gzip) {
        compressed = injectGzipPadding(compressed, breach.maxPadding);
      } else if (encoding === CompressionCodec.Zstd) {
        compressed = injectZstdPadding(compressed, breach.maxPadding);
      }
    }

    // RFC 9110 §8.6: Transfer-Encoding이 "없을 때만" 크기를 알면 Content-Length 생성(SHOULD)
    // — TE가 있으면 CL 병존 금지(RFC 9112 §6.2)이므로 제거만 하고, 없으면
    // 인코딩된(패딩 포함) content의 octet 수로 설정한다.
    response
      .setBody(compressed)
      .setHeader(HttpHeader.ContentEncoding, encoding);
    // RFC 9530 §2·§3: 비인코딩 기준 integrity 필드는 인코딩 후 거짓 — CL과 같이 무효화
    for (const field of INTEGRITY_FIELDS) response.removeHeader(field);
    if (response.getHeader(HttpHeader.TransferEncoding) === null) {
      response.setHeader(HttpHeader.ContentLength, String(compressed.byteLength));
    } else {
      response.removeHeader(HttpHeader.ContentLength);
    }

    // RFC 9110 §8.8.1: strong ETag must be weakened after content transformation
    const etag = response.getHeader(HttpHeader.ETag);
    if (etag !== null) {
      response.setHeader(HttpHeader.ETag, weakenETag(etag));
    }
  });
}
