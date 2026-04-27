# Zipbul

한국어 | **[English](../../README.md)**

AOT(Ahead-of-Time) 컴파일을 지원하는 초고속 Bun 네이티브 웹 서버 프레임워크입니다.

[![Bun](https://img.shields.io/badge/Bun-v1.0%2B-000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript)](https://www.typescriptlang.org/)

## 왜 Zipbul인가?

Zipbul는 Bun의 성능을 최대한 활용하면서 친숙한 NestJS 스타일의 개발 경험을 제공하도록 처음부터 설계되었습니다. 런타임 리플렉션에 의존하는 기존 Node.js 프레임워크와 달리, Zipbul는 **AOT(Ahead-of-Time) 컴파일**을 사용하여 빌드 시점에 애플리케이션을 분석합니다:

- ⚡ **빠른 시작 시간** — 런타임 메타데이터 스캔 없음
- 🛡️ **컴파일 타임 검증** — 런타임 전에 의존성 주입 오류 감지
- 📦 **작은 번들 크기** — 실제로 사용되는 것만 포함
- 🔍 **더 나은 디버깅** — 소스 위치가 포함된 명확한 오류 메시지

## 주요 기능

- 🚀 **Bun 네이티브** — Bun 런타임 전용으로 제작
- 🔧 **AOT 컴파일** — 빌드 시점의 정적 분석 및 코드 생성
- 💉 **의존성 주입** — 스코프 프로바이더를 지원하는 강력한 DI 컨테이너
- 🌐 **HTTP 어댑터** — 라우팅을 지원하는 고성능 HTTP 서버
- 🔄 **핫 리로드** — 파일 감시를 통한 빠른 개발 반복
- ✅ **타입 안전** — 엄격한 타입 검사를 지원하는 완전한 TypeScript 지원

## 요구사항

| 요구사항       | 버전      | 비고                          |
| -------------- | --------- | ----------------------------- |
| **Bun**        | `≥ 1.0.0` | 필수 런타임                   |
| **TypeScript** | `≥ 5.0`   | 소스 파일은 TypeScript여야 함 |
| **Node.js**    | ❌        | 미지원 — Bun 전용             |

## 빠른 시작

### 1. 새 프로젝트 생성

```bash
mkdir my-app && cd my-app
bun init
```

### 2. Zipbul 패키지 설치

```bash
bun add @zipbul/core @zipbul/common @zipbul/http-adapter @zipbul/cli
```

### 3. 모듈 생성

```typescript
// src/__module__.ts
import type { ZipbulModule } from '@zipbul/common';
import { UserService } from './user.service';

export const module: ZipbulModule = {
  name: 'AppModule',
  providers: [UserService],
};
```

### 4. 진입점 생성

```typescript
// src/main.ts
import { bootstrapApplication } from '@zipbul/core';
import { zipbulHttpAdapter } from '@zipbul/http-adapter';
import { module } from './__module__';

await bootstrapApplication(module, {
  name: 'my-app',
  adapters: [
    zipbulHttpAdapter(() => ({
      name: 'http-server',
      port: 3000,
    })),
  ],
});
```

### 5. 개발 서버 실행

```bash
zp dev
bun .zipbul/index.ts
```

## 패키지

| 패키지                                          | 설명                                                           |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [@zipbul/cli](./packages/cli)                   | AOT 컴파일 및 개발을 위한 CLI 도구                             |
| [@zipbul/core](./packages/core)                 | DI 컨테이너와 애플리케이션 부트스트랩을 포함한 코어 프레임워크 |
| [@zipbul/common](./packages/common)             | 공유 인터페이스, 데코레이터, 유틸리티                          |
| [@zipbul/http-adapter](./packages/http-adapter) | 라우팅과 미들웨어를 지원하는 HTTP 서버 어댑터                  |
| [@zipbul/logger](./packages/logger)             | 구조화된 로깅 유틸리티                                         |

## 프로젝트 구조

```text
my-app/
├── src/
│   ├── main.ts              # 애플리케이션 진입점
│   ├── __module__.ts        # 루트 모듈 정의
│   ├── users/
│   │   ├── __module__.ts    # Users 기능 모듈
│   │   ├── users.service.ts
│   │   └── users.controller.ts
│   └── posts/
│       ├── __module__.ts    # Posts 기능 모듈
│       └── ...
├── .zipbul/                  # 생성된 AOT 아티팩트 (개발)
├── dist/                     # 프로덕션 빌드 출력
├── zipbul.config.ts          # CLI 설정
└── package.json
```

## 모듈 시스템

Zipbul는 `__module__.ts` 파일 기반의 모듈 시스템을 사용합니다:

```typescript
// src/users/__module__.ts
import type { ZipbulModule } from '@zipbul/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

export const module: ZipbulModule = {
  name: 'UsersModule',
  providers: [UsersService, UsersController],
};
```

### 가시성 제어

`visibleTo` 옵션으로 모듈 간 접근을 제어합니다:

```typescript
@Injectable({ visibleTo: 'all' })
export class SharedService {}
```

## 문서화

- **[문서 지표 (SSOT)](../00_INDEX.md)** — 모든 가이드와 규칙의 시작점
- [아키텍처](../20_ARCHITECTURE/ARCHITECTURE.md) — 시스템 설계 및 패키지 구조
- [기여하기](../../.github/CONTRIBUTING.md) — 기여 방법
- [보안](../../.github/SECURITY.md) — 보안 정책 및 보고

## 제한사항

- **Bun 전용** — Node.js 런타임 미지원
- **ESM 전용** — CommonJS 모듈 미지원
- **TypeScript 필수** — JavaScript 소스 파일은 분석되지 않음
- **파일 기반 모듈** — 클래스 데코레이터 대신 `__module__.ts` 사용

## 로드맵

- [ ] WebSocket 어댑터
- [ ] 마이크로서비스 어댑터
- [ ] GraphQL 통합
- [ ] 데이터베이스 ORM 통합
- [ ] 인증/인가 모듈

## 기여하기

기여를 환영합니다! 자세한 내용은 [기여 가이드](../../.github/CONTRIBUTING.md)를 참조하세요.

## 라이선스

MIT © [ParkRevil](https://github.com/parkrevil)

---

Bun 생태계를 위해 ❤️로 만들었습니다
