# Zipbul — Copilot Instructions

> Codebase knowledge for VS Code Copilot. Policy rules live in `AGENTS.md` + `.ai/rules/`.

## Project Overview

Zipbul is a Bun-native web framework with AOT (Ahead-of-Time) compilation, inspired by NestJS but using file-based modules instead of class decorators. It includes a CLI-integrated Knowledge Base (KB) that maintains a Knowledge Graph of the codebase in SQLite.

**Stack:** Bun, TypeScript (strict), Drizzle ORM, SQLite, MCP SDK

## Monorepo Structure

```
packages/
  common/     → Shared interfaces, decorators, types, errors (leaf — no internal deps)
  logger/     → Structured logging (depends on nothing)
  core/       → DI container, application bootstrap, module system, validators
  http-adapter/ → HTTP server, routing, middleware, pipes
  scalar/     → OpenAPI/Scalar UI documentation generation
  cli/        → AOT compiler, dev server, Knowledge Base (MCP + SQLite store)
examples/     → Example Zipbul application
docs/         → Specs, architecture, governance (SSOT hierarchy)
```

**Dependency graph:** `common` ← `core` ← `http-adapter`, `scalar`, `cli`; `logger` ← `core`

## Key Patterns

### Module System

File-based modules using `__module__.ts` (not class decorators):

```typescript
// src/users/__module__.ts
export const module: ZipbulModule = {
  name: 'UsersModule',
  providers: [UsersService, UsersController],
};
```

### Application Entry

```typescript
const app = createApplication(appModule);
await app.start();
```

### Knowledge Base (packages/cli)

SQLite store with Drizzle ORM. Key tables in `packages/cli/src/store/schema.ts`:

- `card` — Knowledge cards (specs, decisions, etc.)
- `code_entity` — Indexed code symbols (functions, classes, exports)
- `card_relation` / `code_relation` — Graph edges between cards/entities
- `card_code_link` — Links cards to code entities
- `file_state` — File content hashes for incremental indexing
- `card_keyword` / `keyword` — Searchable tags

DB connection: SQLite with WAL mode, schema versioning (mismatch → full rebuild).

### MCP Card System (packages/cli/src/mcp/card/)

- `card-key.ts` — Key normalization, slug building, type validation
- `card-crud.ts` — CRUD operations (create/update/delete/rename)
- `card-fs.ts` — File I/O for `.card.md` files
- `card-markdown.ts` — Frontmatter parsing/serialization

### AOT Compiler (packages/cli/src/compiler/)

- `analyzer/` — Static analysis of TypeScript source
- `extractors/` — Extract metadata from AST
- `generator/` — Code generation from analysis results

## Build & Test Commands

```bash
bun test                    # Run all tests (bun:test)
bun test --coverage         # With coverage
bun test packages/cli/test/ # Run specific package tests
zp dev                  # Dev server with hot reload
zp build                # AOT compilation → dist/
```

## Test Conventions

- **Runner:** `bun:test` (not Jest/Vitest)
- **Unit tests:** `*.spec.ts` next to source file
- **Integration tests:** `packages/*/test/*.test.ts`
- **Style:** BDD (`describe`/`it`), AAA (Arrange/Act/Assert)

## Commit Conventions

Conventional commits enforced by commitlint + husky:

- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf`, `style`, `revert`
- **Scopes (single only):** `cli`, `common`, `core`, `http-adapter`, `logger`, `scalar`, `examples`, `repo`, `config`, `plan`, `eslint`, `scripts`
- **Format:** `type(scope): subject` — no period, no UPPER_CASE subject

## TypeScript Config

Strict mode with notable flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `experimentalDecorators` (no `emitDecoratorMetadata`). ESM only (`"type": "module"`).

## Policy

All behavioral policies (approval gate, Bun-first, TDD, search verification) are in `AGENTS.md` + `.ai/rules/`. Always load and follow those before acting.
