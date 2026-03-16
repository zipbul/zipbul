---
name: no-root-deps
description: Never install runtime packages in monorepo root — always install in the specific package that needs them
type: feedback
---

Never install runtime packages in the monorepo root. Always install in the specific package directory that uses them.

**Why:** Root dependencies are not for monorepo management. Each package must explicitly declare its own dependencies. Installing in root makes it impossible to track which package actually depends on what.

**How to apply:** Always use `--cwd packages/<target>` flag with `bun add <pkg>`. Only devDependencies (lint, test, build tooling) are allowed in root.
