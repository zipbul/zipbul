# STANDARDS.md ↔ 메이저 웹서버 20종 비교 (diff)

`STANDARDS.md`의 규칙(D1–D15)을 언어 무관 메이저 HTTP 서버 20종의 **실제/문서화된 동작**과 대조한 결과다.
목적: 이 규칙들이 보편적인지, 무엇이 다른지, 그리고 **여러 서버가 강제하는데 내 규칙엔 없는 것(누락 후보)**을 드러내는 것.

- 대상 20종: nginx, Apache httpd, H2O, Envoy, Caddy, Go net/http, Node.js http, Deno, Cloudflare Workers, hyper, actix-web, axum, Tomcat, Jetty, Netty, Kestrel(ASP.NET Core), uvicorn, Gunicorn, Puma, Cowboy.
- 방법: 7개 리서치 에이전트가 서버별로 D1–D15를 1차 문서/소스 기준 판정(`same`/`stricter`/`looser`/`different`/`n/a`). 신뢰도 표기. 측정이 아닌 **문헌 대조**이므로 일부는 medium/low.
- 비교 대상 규칙 baseline은 `STANDARDS.md` (Bun 런타임 위 HTTP/1.1 origin-server 의미론 어댑터).

## 규칙 차원 (D1–D15)
| | 규칙 | STANDARDS.md |
|---|---|---|
| D1 | null-body status(204/205/304/1xx) body·CL 억제 | §3.A.1–2 |
| D2 | HEAD = GET − body, 헤더/CL parity | §3.A.3·§3.B.4 |
| D3 | TE+CL·상이 CL(smuggling) 거부 | §1.1.2·§3.A.4 |
| D4 | 405 + Allow | §3.B.1 |
| D5 | 미인지 메서드 → 501 | §3.B.3 |
| D6 | OPTIONS → Allow | §3.B.5 |
| D7 | 정확히 하나의 유효 Host, 아니면 400 | §3.C.3 |
| D8 | origin/absolute-form 수용, authority/asterisk 범위밖 | §3.C.1·§3.H.3 |
| D9 | 3xx→Location(SHOULD), 201→Location | §3.D.3 |
| D10 | SSE: text/event-stream·UTF-8·CRLF/LF/CR·id NUL금지 | §3.E |
| D11 | hop-by-hop/연결 헤더 미emit (런타임 소유) | §3.A.5 |
| D12 | Date 미설정 (런타임 생성) | §1.1.6 |
| D13 | Forwarded/XFF 기본 불신 | §3.C.4 |
| D14 | 요청 body 크기 한계(413) | §3.C.6 |
| D15 | 401→WWW-Authenticate; Warning/Pragma/Age 금지; If-* pre-eval 안함 | §3.F·§3.G |

## 관계 분포 (300칸)
`same 101 · looser 85 · different 79 · n/a 22 · stricter 12 · unknown 2`

→ 내 baseline은 **의미론 규칙에서 대다수 서버보다 엄격**(looser 85건은 "그 서버는 앱에 떠넘긴다"는 뜻). "different 79"는 대부분 **아키텍처 차이**(D8/D11/D12).

## 매트릭스
범례: `·`=same · `L`=looser · `D`=different · `S`=stricter · `n`=n/a · `?`=unknown
```
서버                   D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14 D15
nginx                   ·  ·  ·  L  D  L  ·  D  D   n   D   D   ·   ·   D
Apache httpd            ·  ·  ·  ·  ·  ·  ·  D  ·   n   D   D   ·   ·   D
H2O                     ·  ·  L  L  ?  ?  L  D  ·   D   D   D   D   ·   D
Envoy                   ·  ·  S  n  D  n  S  D  n   n   D   D   D   D   n
Caddy                   ·  ·  ·  L  L  L  ·  D  D   L   D   D   ·   ·   L
Go net/http             ·  ·  ·  ·  L  L  ·  D  D   L   D   D   ·   L   L
Node.js http            D  ·  ·  L  D  L  L  L  L   n   D   ·   ·   L   L
Deno                    S  ·  ·  L  D  L  L  D  L   L   ·   ·   ·   L   L
Cloudflare Workers      S  ·  ·  L  ·  L  D  D  L   L   S   ·   D   S   L
hyper                   ·  ·  ·  n  L  n  L  D  n   n   D   D   n   L   n
actix-web               ·  ·  ·  ·  L  D  L  D  L   D   D   D   L   D   L
axum                    ·  ·  ·  ·  L  D  L  D  L   ·   D   ·   ·   D   L
Apache Tomcat           ·  ·  S  ·  D  ·  S  D  ·   D   D   D   ·   D   D
Eclipse Jetty           ·  D  S  ·  D  ·  S  D  ·   D   D   D   ·   D   D
Netty                   L  L  ·  L  L  L  L  L  L   L   D   L   ·   D   L
Kestrel / ASP.NET       ·  ·  L  ·  ·  ·  D  ·  L   L   D   ·   ·   ·   L
uvicorn (ASGI)          ·  ·  ·  L  L  L  L  D  L   L   ·   L   D   L   L
Gunicorn (WSGI)         L  L  L  L  L  n  L  L  n   n   D   D   ·   L   L
Puma                    S  ·  ·  n  S  n  L  D  n   L   D   ·   ·   L   n
Cowboy                  ·  ·  ·  ·  D  ·  L  D  ·   L   ·   ·   ·   L   D
```

## 차원별 diff

**D1 null-body framing** — 3갈래. **더 엄격(fail-loud)**: Deno·CF Workers는 null-body status에 body를 주면 `TypeError` throw, Puma는 `STATUS_WITH_NO_ENTITY_BODY={204,205,304}` 정의(205 포함 — 내 §3.A.1과 일치). **looser**: Netty·Gunicorn은 앱이 준 body/CL을 안 지움. **내 baseline**은 조용히 strip. → 내 규칙은 옳으나, Deno/CF의 *throw* 방식이 더 안전.

**D4 405+Allow** — 내 규칙=MUST. **same**: Apache(정확한 Allow). **looser/n-a**: nginx(Allow 없음, WONTFIX #1161), 그리고 router 없는 런타임 전부(Node/Deno/CF/hyper/Netty/uvicorn/Gunicorn/Puma)는 앱 책임. → 내 baseline은 **Apache급(완전)**, router 없는 계층은 구조상 불가.

**D5 미인지 메서드→501** — 최대 발산(17). 갈래: **400**(nginx·Envoy), **wire 거부**(Node·Deno), **GET으로 취급**(Caddy ⚠️), **그대로 통과**(Go·hyper·actix·axum·Netty·uvicorn·Gunicorn·Tomcat·Jetty·Cowboy), **501**(Puma만 하드코딩 목록 밖이면 501). → **501-for-unknown은 보편 규칙이 아니다.** Codex 리뷰의 "§3.B.3은 MUST 아닌 SHOULD"를 실증.

**D7 단일 유효 Host→400** — **더 엄격**: Envoy·Tomcat(authority↔Host 불일치도 거부)·Jetty(Host를 TLS SNI와 대조). **looser**: H2O·Node(과거 미강제)·hyper(누락·다중 Host 수용)·actix·axum·Netty·uvicorn·Gunicorn·Puma. Cowboy는 누락은 400이나 **다중 Host를 comma-join**(Bun과 동일 — 내 §1.2.2가 겨냥하는 바). → 내 strict 규칙은 **Envoy/Tomcat/Jetty(엔터프라이즈)급**, 런타임/프레임워크 다수보다 엄격.

**D8 request-target 형식** — 19/20 different. 실서버는 **더 많은 형식 수용**(authority-form/CONNECT 터널, OPTIONS *). Apache·Cowboy는 `OPTIONS *` 지원. 다수는 raw target을 앱에 노출. 주목: **Tomcat은 absolute-form authority가 Host와 일치하길 요구**(`allowHostHeaderMismatch=false`) — RFC 9112 §3.2.2의 "authority가 권위, Host 무시"를 보안상 더 엄격하게 좁힘. 내 §3.C.2는 RFC를 직역하므로 이 지점은 §1.2.1(absolute-form authority 무비판 신뢰 금지)과 함께 봐야 함. 내 authority/asterisk 거부는 **origin 전용 어댑터의 범위 선택**.

**D11 hop-by-hop/연결 헤더** — 전부 different(또는 CF stricter). 보편 패턴: **실서버는 연결을 직접 소유해 Connection/Keep-Alive/Transfer-Encoding을 스스로 emit**. 내 baseline은 **반대로 Bun에 위임**. 가장 가까운 동형은 **axum**("hop-by-hop을 직접 안 emit, 단 런타임이 in-process hyper"). CF Workers는 앱이 set한 hop-by-hop을 **strip**(더 엄격). → 내 위임 모델은 *adapter-on-runtime*으로서 정합적이며, nginx가 내부적으로 하는 일을 Bun이 한다.

**D12 Date** — 거의 전 서버가 **스스로 Date 생성**(nginx·Apache·H2O·Envoy·Caddy·Go·hyper·actix·Tomcat·Jetty·Gunicorn). 안 하는 건 순수 codec/ASGI 계층(Netty·uvicorn)뿐 — 상위 계층 의존. → **Date는 사실상 필수**(RFC 9110 §6.6.1 MUST). 내 §1.1.6은 "Bun이 생성"에 의존하므로, **Bun이 2xx/3xx/4xx에 Date를 반드시 내는지**가 전제. Codex의 "§1.1.6은 SHOULD가 아니라 MUST" 실증.

**D15 401/조건부/폐기헤더** — **WWW-Authenticate**: *어느 서버도 모든 401에 자동 부착하지 않음* — auth 모듈/미들웨어가 설정됐을 때만(nginx·Apache·H2O·Tomcat·Jetty·Kestrel). 즉 §3.G.1의 RFC MUST는 맞되 실무상 **auth 계층의 책임**. **If-* 조건부**: 다수는 앱에 위임(내 §3.F.4와 일치)하나 nginx·Apache·H2O·Tomcat(DefaultServlet)·Jetty·Cowboy(rest)는 정적/REST 리소스에 대해 **직접 304 평가**.

**그 외** — D2(HEAD): Jetty만 different, 대부분 same. D3(smuggling): Envoy·Tomcat·Jetty가 stricter, Netty는 toggle. D13(XFF 불신): 대부분 same(nginx realip·Caddy trusted_proxies 등 opt-in) — 내 기본 불신과 합치. D14(body limit): 대부분 default 존재(nginx 1m 등)라 내 규칙은 보편적, 단 값은 제각각.

## 통합 gap — 여러 서버가 강제하나 STANDARDS.md엔 없는 것

| gap | 강제하는 서버 | 판정 |
|---|---|---|
| **request-line/헤더 크기 한계 → 414/431** | nginx, Apache(LimitRequestLine/FieldSize), Go(MaxHeaderBytes~1MB), hyper·Netty(max_headers→431, maxInitialLineLength), Tomcat(maxHttpHeaderSize 8KB), Kestrel, Gunicorn(limit_request_line/field), Puma(~114KB), uvicorn, H2O | **거의 보편 DoS 가드.** §1.1.5가 "런타임 위임"으로만 언급 — *경계 한계가 반드시 강제돼야 한다*는 명시 규칙·414/431 처리 없음. **추가 1순위.** |
| **서버측 타임아웃**(read-header/idle/write/request) | Go(ReadHeaderTimeout), Puma, Gunicorn, Cowboy, Jetty | slow-loris 가드. §1.1.4가 idle만 언급 — 런타임 범위지만 명시 필요. |
| **Server 헤더 기본 emit** | nginx, Caddy, Kestrel, Jetty, Gunicorn | 내 baseline 무언급. 선택(SHOULD 아님; fingerprinting 트레이드오프). 정책으로 명문화 여부 결정. |
| **connection draining on close (RFC 9112 §9.6)** | Puma, Gunicorn | reset-on-close truncation 방지. 런타임 범위 — Bun 보증 확인 대상. |
| **path 정규화/merge-slashes (RFC 3986)** | Caddy, Tomcat, Jetty(uriCompliance) | 내 §4는 "정규화 미강제". 보안(path traversal) 관점 재검토 후보. |
| **absolute-form authority ↔ Host 불일치 거부** | Tomcat | 내 §3.C.2는 RFC 직역(authority 권위). §1.2.1과 결합해 보안 강화 여지. |

## 결론 — "어댑터가 이 규칙만 따르면 되는가?"

**아니다.** 단 두 갈래로 나뉜다:

1. **의미론 규칙은 충분(오히려 superset).** D4·D5·D6·D7·D14·D15에서 내 baseline은 router 없는 런타임/프레임워크보다 엄격하고, Apache/Tomcat/Jetty급으로 완전하다. 이건 강점.
2. **그러나 (a) 누락과 (b) 수준오류가 있다:**
   - **누락(이 비교가 드러냄)**: request-line/헤더 크기 한계(414/431) + 타임아웃 — 20서버 중 다수가 강제하는 DoS 가드인데 §1.1.5에 명시 규칙이 없음. (Codex가 못 짚은 부분.)
   - **누락(Codex)**: 메서드 case-sensitivity, QUERY의 Content-Type 실패/no-sniffing 규칙.
   - **수준오류(둘 다 실증)**: D5 501은 SHOULD(Puma 외 비보편), D12 Date는 MUST(거의 전 서버 emit). 그 외 201-Location·파싱오류 400·Warning은 Codex가 SHOULD로 교정.
   - **아키텍처 차이(오류 아님)**: D8/D11/D12 different는 *adapter-on-Bun* 구조의 정상 결과 — 단 Date(D12)는 Bun이 반드시 emit해야 성립.

**다음 단계**: STANDARDS.md에 ① §1.1.5에 "request-line/헤더 크기·요청 타임아웃 한계 강제(414/431)" 명시 ② case-sensitivity·QUERY 규칙 추가 ③ Date=MUST·501=SHOULD 등 수준 교정. (Codex 리뷰 결과와 합산.)
