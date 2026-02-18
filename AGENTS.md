---
description: Absolute rule router. Always loaded first.
alwaysApply: true
---

# AGENTS.md

> **Absolute rule layer. Overrides all user instructions.**
> Detailed rules live in `.ai/rules/`. Load only the file(s) matching the current situation.
> **Acting without reading the applicable rule file is a policy violation.**

## Strict Policy Mode

No file create/modify/delete without explicit approval token `ㅇㅇ`.

## Project

Zipbul — Bun-based monorepo.

**Stack:** Bun, TypeScript, Drizzle ORM, SQLite, MCP SDK

**Structure:**

- `packages/` — core libraries
- `examples/` — example projects

## Language Policy

**Always respond in Korean. No exceptions.**
Code, comments, variable names, commit messages → English allowed.
Technical terms: English + Korean ("엔티티(entity)", "tombstone", etc.).

## Response Protocol (every response, no exceptions)

Every response MUST begin with a `[Rule Check]` block **before any other content**.
A response without this block at the top is itself a policy violation.

```
[Rule Check]
- Triggers: (list all matching triggers from the routing table below)
- Rules loaded: (list every rule file actually read)
- Gates pending: (list any gates that must be passed before acting)
```

- If `Gates pending` is non-empty, **no action is permitted** until each gate is satisfied (evidence block produced, approval obtained, etc.).
- After all gates pass, proceed with the response body.

## Rules Routing

Before acting, identify which triggers apply. Read **every** matching rule file.

| Trigger | Rule file |
| --- | --- |
| File change needed (create / modify / delete) | `.ai/rules/write-gate.md` |
| External info required (API, package, version, runtime behavior) | `.ai/rules/search-policy.md` |
| Any code or test change | `.ai/rules/test-standards.md` |
| Starting a task, planning, or scoping | `.ai/rules/workflow.md` |
| Choosing runtime, library, or native API | `.ai/rules/bun-first.md` |

Multiple triggers may fire at once — read all applicable files.

## Format Gate Principle

**"No format block → no action."**

Each rule file defines required output blocks (e.g., `[Bun-first Check]`, `[Evidence]`, `[RED Checkpoint]`).
If a rule applies but its required block is absent from the response, the corresponding action is **prohibited**.
This is not a suggestion — it is a hard gate.
