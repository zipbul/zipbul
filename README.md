# Zipbul

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
// src/module.ts
import { defineModule } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';

// Providers and controllers are discovered from the source tree at build time
// (any @Injectable / @Controller in this module's directory) — you don't list
// them here. defineModule declares the module name and which adapters it wires.
export const appModule = defineModule({
  name: 'App',
  adapters: [{ adapter: HttpAdapter }],
});
```

### 4. Create your entry point

```typescript
// src/main.ts
import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';

import { appModule } from './module';

const app = createApplication(appModule);
app.attach(HttpAdapter, { port: 3000 }); // bind transport options
await app.start();
```

### 5. Run it

```bash
zb dev                          # watch mode with hot reload
zb build && bun dist/entry.js   # production build + run
```

## Packages

| Package                                                    | Description                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| [@zipbul/cli](./packages/framework/cli)                    | CLI tooling for AOT compilation and development            |
| [@zipbul/core](./packages/framework/core)                  | Core framework with DI container and application bootstrap |
| [@zipbul/common](./packages/framework/common)              | Shared interfaces, decorators, and utilities               |
| [@zipbul/http-adapter](./packages/adapters/http)           | HTTP server adapter with routing and middleware            |
| [@zipbul/logger](./packages/framework/logger)              | Structured logging utility                                 |

## Project Structure

```text
my-app/
├── src/
│   ├── main.ts              # Application entry point
│   ├── module.ts            # Root module (defineModule)
│   ├── users/
│   │   ├── module.ts        # Users feature module
│   │   ├── users.service.ts
│   │   └── users.controller.ts
│   └── posts/
│       ├── module.ts        # Posts feature module
│       └── ...
├── .zipbul/                  # Generated AOT artifacts (dev)
├── dist/                     # Build output (zb build)
├── zipbul.jsonc              # CLI configuration
└── package.json
```

## Module System

Zipbul uses a file-based module system. Each module is a `module.ts` that calls
`defineModule`; the providers and controllers that belong to it are discovered
from the same directory tree at build time — you don't enumerate them:

```typescript
// src/users/module.ts
import { defineModule } from '@zipbul/core';

// UsersService / UsersController in this directory are collected automatically.
export const usersModule = defineModule();
```

### Visibility Control

By default a provider is visible only within its own module. Widen cross-module
access with the `visibleTo` option (`'all'` | `'module'` | module markers):

```typescript
@Injectable({ visibleTo: 'all' })
export class SharedService {}
```

## Documentation

- [Contributing](.github/CONTRIBUTING.md) — How to contribute
- [Security](.github/SECURITY.md) — Security policy and reporting

## Limitations

- **Bun only** — Does not support Node.js runtime
- **ESM only** — CommonJS modules are not supported
- **TypeScript required** — JavaScript source files are not analyzed
- **File-based modules** — Uses `module.ts` (`defineModule`) instead of class decorators

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
