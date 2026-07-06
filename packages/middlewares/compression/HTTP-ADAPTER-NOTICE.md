# To: http-adapter — Compression 책임 선언

**From**: `@zipbul/compression` (packages/middlewares/compression)
**To**: `@zipbul/http-adapter` (packages/adapters/http)
**Date**: 2026-07-02
**성격**: 책임 경계 선언 (요청서 아님 — adapter에 요구하는 변경 없음)

---

## 1. 선언

이 미들웨어는 응답 content coding에 관한 아래 규칙 영역을 **자체 `STANDARDS.md`(대조 기준일 2026-07-02, 규칙 60개)로 소유하고 책임진다.** adapter는 이 영역을 자신의 STANDARDS.md에 중복 수록하거나 파이프라인에서 재검증할 필요가 없다.

| 영역 | compression STANDARDS.md |
|---|---|
| `Accept-Encoding` 해석·협상 (qvalue·wildcard·identity·x-gzip 별칭) | §1 |
| `Content-Encoding` 생성 (순서·identity 배제·IANA 등록 이름) | §2 |
| 인코딩 후 `Content-Length` 무효화·재생성 | §2.3.2·§2.3.3 |
| 압축 제외 판정 (null-body status·HEAD·206·중복 인코딩·no-transform) | §3 |
| 인코딩 협상에 따른 `Vary` 생성 | §4.1 |
| 압축 후 entity tag weak 표기(`W/`) | §4.2 |
| 코딩 바이트 포맷 준수 (gzip/deflate zlib-wrapped/br/zstd 8MB window) | §5 |
| 포맷 확장 필드(gzip FEXTRA·zstd Skippable Frame — 패딩 주입) | §6 |
| 스트리밍 압축 포맷 매핑 (WHATWG CompressionStream) | §7 |

책임의 의미: 위 영역의 표준 위반이 발견되면 그것은 **이 패키지의 버그**이며, 이 패키지의 테스트가 검증을 소유한다.

## 2. adapter가 가정해도 되는 것

이 미들웨어가 파이프라인에 장착된 경우:

- 응답 body를 압축했다면 `Content-Encoding`은 반드시 설정되어 있다 (§2.1.1).
- 버퍼 body를 압축했다면 `Content-Length`는 인코딩된 크기로 재설정되어 있다(단 `Transfer-Encoding` 존재 시 미설정) (§2.3.2·§2.3.3). 스트림 body 압축 시 CL은 제거된다(길이 미지).
- 1xx·204·205·304·HEAD·206·`no-transform`·이미 인코딩된 응답(자체 CE를 가진 raw Response 포함)은 건드리지 않는다 (§3·§2.4.1).
- `Accept-Encoding`을 판정 입력으로 사용한 응답에는 `Vary: Accept-Encoding`이 반영되어 있다 (§4.1).
- 장착되지 않은 경우: adapter는 압축에 관해 아무것도 할 필요가 없다 — 압축 적용 여부 자체가 서버 재량이므로 (compression §9.1.1) 무압축 응답은 그 자체로 표준 적합이다.

## 3. 이 미들웨어가 adapter에 의존하는 전제 (현행 동작의 확인이며 변경 요청 아님)

1. **Serialize 선행** — `HttpResponse.serialize()`(Content-Type 추론 + JSON 직렬화)가 AfterHandle과 BeforeResponse 사이에 실행되어, BeforeResponse 미들웨어가 직렬화된 body와 확정된 Content-Type을 받는다. (http-response.ts의 현행 문서화된 동작)
2. **메시징 계층** — `Transfer-Encoding`·chunked framing·HTTP/1.1 message framing·HTTP/2/3 프레이밍은 adapter/런타임 소관이다 (compression §8.2.1). 이 미들웨어는 representation 계층(`Content-Encoding`)만 만진다.
3. **요청 측 디코딩** — 요청 body의 content coding 해제와 415 응답은 이 미들웨어의 범위 밖이다 (compression §8.3.1).
4. **헤더 API** — `getHeader`/`setHeader`/`appendHeader`/`removeHeader`와 `getStatus`/`setStatus`/`getBody`/`setBody`의 현행 시맨틱.
5. **native Response read-only 접근** — `peekNativeResponse()`(raw native Response를 merge 부작용 없이 반환)와 `hasNativeResponse()`. 스트림/Blob/raw Response 응답의 압축 판정(자체 CE·CT 검사)과 body 스트림 교체(`setBody(ReadableStream)`)가 이에 의존한다. `getNativeResponse()`는 lazy-merge 캐시를 남기므로 미들웨어는 호출하지 않는다.

이 전제 중 하나가 바뀌면 이 문서와 compression 구현의 재검토가 필요하다.

## 4. 경계 요약

```
adapter  : 메시지가 올바르게 만들어지고 전송되는가   (framing·CL 전송 규칙·상태코드 의미론)
compression: representation이 올바르게 인코딩되는가  (협상·Content-Encoding·Vary·ETag·바이트 포맷)
```

겹치는 헤더(`Content-Length`·`Vary`·`ETag`)는 **"인코딩으로 인해 변하는 부분"만 compression 책임**이고, 그 외 생성·전송 규칙은 adapter 소유다. 각자의 STANDARDS.md는 상호 참조 없이 독립적으로 완결된다.
