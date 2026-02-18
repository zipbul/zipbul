# Zipbul

**[한국어](./docs/90_REFERENCE/README.ko.md)** | English

A blazing-fast, Bun-native web server framework with Ahead-of-Time (AOT) compilation.

[![Bun](https://img.shields.io/badge/Bun-v1.0%2B-000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript)](https://www.typescriptlang.org/)

## Why Zipbul?

Zipbul is designed from the ground up to leverage Bun's performance while providing a familiar, NestJS-inspired developer experience. Unlike traditional Node.js frameworks that rely on runtime reflection, Zipbul uses **AOT (Ahead-of-Time) compilation** to analyze your application at build time, resulting in:

- ⚡ **Faster startup times** — No runtime metadata scanning
- 🛡️ **Compile-time validation** — Catch dependency injection errors before runtime
- 📦 **Smaller bundles** — Only include what's actually used
- 🔍 **Better debugging** — Clear error messages with source locations

## Features

- 🚀 **Bun-Native** — Built exclusively for Bun runtime
- 🔧 **AOT Compilation** — Static analysis and code generation at build time
- 💉 **Dependency Injection** — Powerful DI container with scoped providers
- 🌐 **HTTP Adapter** — High-performance HTTP server with routing
- 📝 **OpenAPI/Scalar** — Automatic API documentation generation
- 🔄 **Hot Reload** — Fast development iteration with file watching
- ✅ **Type-Safe** — Full TypeScript support with strict type checking

## Requirements

| Requirement    | Version   | Notes                           |
| -------------- | --------- | ------------------------------- |
| **Bun**        | `≥ 1.0.0` | Required runtime                |
| **TypeScript** | `≥ 5.0`   | Source files must be TypeScript |
| **Node.js**    | ❌        | Not supported — Bun only        |

## Quick Start

### 1. Create a new project

```bash
mkdir my-app && cd my-app
bun init
```

### 2. Install Zipbul packages

```bash
bun add @zipbul/core @zipbul/common @zipbul/http-adapter @zipbul/cli
```

### 3. Create your module

```typescript
// src/__module__.ts
import type { ZipbulModule } from '@zipbul/common';
import { UserService } from './user.service';

export const module: ZipbulModule = {
  name: 'AppModule',
  providers: [UserService],
};
```

### 4. Create your entry point

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

### 5. Run development server

```bash
zp dev
bun .zipbul/index.ts
```

## Packages

| Package                                         | Description                                                |
| ----------------------------------------------- | ---------------------------------------------------------- |
| [@zipbul/cli](./packages/cli)                   | CLI tooling for AOT compilation and development            |
| [@zipbul/core](./packages/core)                 | Core framework with DI container and application bootstrap |
| [@zipbul/common](./packages/common)             | Shared interfaces, decorators, and utilities               |
| [@zipbul/http-adapter](./packages/http-adapter) | HTTP server adapter with routing and middleware            |
| [@zipbul/logger](./packages/logger)             | Structured logging utility                                 |
| [@zipbul/scalar](./packages/scalar)             | OpenAPI documentation with Scalar UI                       |

## Project Structure

```text
my-app/
├── src/
│   ├── main.ts              # Application entry point
│   ├── __module__.ts        # Root module definition
│   ├── users/
│   │   ├── __module__.ts    # Users feature module
│   │   ├── users.service.ts
│   │   └── users.controller.ts
│   └── posts/
│       ├── __module__.ts    # Posts feature module
│       └── ...
├── .zipbul/                  # Generated AOT artifacts (dev)
├── dist/                     # Production build output
├── zipbul.config.ts          # CLI configuration
└── package.json
```

## Module System

Zipbul uses a file-based module system with `__module__.ts` files:

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

### Visibility Control

Control cross-module access with the `visibility` option:

```typescript
@Injectable({ visibility: 'exported' })
export class SharedService {}
```

## Documentation

- **[Documentation Index (SSOT)](./docs/00_INDEX.md)** — Start here for all guides and rules
- [Architecture](./docs/20_ARCHITECTURE/ARCHITECTURE.md) — System design and package structure
- [Contributing](.github/CONTRIBUTING.md) — How to contribute
- [Security](.github/SECURITY.md) — Security policy and reporting

## Limitations

- **Bun only** — Does not support Node.js runtime
- **ESM only** — CommonJS modules are not supported
- **TypeScript required** — JavaScript source files are not analyzed
- **File-based modules** — Uses `__module__.ts` instead of class decorators

## Roadmap

- [ ] WebSocket adapter
- [ ] Microservices adapter
- [ ] GraphQL integration
- [ ] Database ORM integration
- [ ] Authentication/Authorization modules

## Contributing

We welcome contributions! Please see our [Contributing Guide](.github/CONTRIBUTING.md) for details.

## License

MIT © [ParkRevil](https://github.com/parkrevil)

---

<p align="center">
  Built with ❤️ for the Bun ecosystem
</p>
