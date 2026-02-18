# Card-centric MCP Index Design (Git-first + File SSOT + SQLite Index)

> **Scope**: zipbul MCP architecture optimized for vibe-coding agents
> **Status**: Draft v6.0 — 2026-02-16
> **Core idea**: **Git is the source of truth** (cards are files with frontmatter metadata + body spec). **SQLite is a disposable local index (gitignored, always rebuildable)** for ultra-fast agent traversal. **SQLite is managed exclusively by the MCP domain** — `zp build/dev` produce only build artifacts (manifest); `zp mcp` owns all SQLite indexing.
> **Where it lives**: zipbul **CLI package** — CLI and MCP share the same core logic.
> **Card = Spec**: Cards are exclusively for specifications. No type field — all cards are specs. Classification via keyword (normalized term dictionary) + tag (free categorization).

**Out of scope**: repository documentation directory (it will be deleted)

---

## 1. Problem Statement

During vibe-coding, an agent must be able to answer quickly:

- "What requirement(card) does this code implement?"
- "What code implements this card?"
- "What other cards depend on this?"
- "What code is adjacent/impacted?"

And the answer must be:

- **Fast** (sub-100ms interactive)
- **Branch-safe** (Git branches naturally isolate)
- **Merge-safe** (Git merge resolves conflicts)
- **Low-ops** (no always-on shared DB requirement)

---

## 2. Design Goals

1. **Git-first SSOT**: Card files (frontmatter + body) are Git-tracked, human-reviewable, mergeable.
2. **SQLite index**: Disposable local cache (gitignored). Provides high-performance traversal/search. Always rebuildable.
3. **CLI + MCP share core**: Both interfaces invoke the same core logic for reads and writes. Framework authors may use MCP exclusively; end-users may use CLI.
4. **MCP embedded**: MCP server is started via `zp mcp` (single command). MCP write tools are **required** (not deferred).
5. **AOT/AST (oxc-parser only)**: Reuse existing CLI `oxc-parser` pipeline. No TypeScript Compiler API dependency.
6. **Call-level code relations**: Code↔code relations include imports, calls, extends, implements — all statically extractable via AST. (DI inject/provide reserved for future framework-user features.)
7. **Dual audience**: Must serve both the framework author (building zipbul itself via vibe-coding/MCP) and framework users (who get richer features including framework rules via MCP).
8. **No "snapshot export/import" as a workflow**: the SSOT is the files themselves.

---

## 3. High-Level Architecture

### 3.1 Source-of-truth layers

- **SSOT (Git-tracked)**: `.zipbul/cards/**/*.card.md` (frontmatter=metadata, body=spec) + **optional** in-code card links (JSDoc `@see key`)
- **Build artifacts (Git-tracked)**: `.zipbul/build/` — compiler output (manifest TS, etc.)
- **Derived local index (gitignored)**: `.zipbul/cache/index.sqlite` — managed exclusively by MCP domain

```
repo/
  .zipbul/
    cards/                 # SSOT: card files (frontmatter + body)
    build/                 # Git-tracked: compiler artifacts
      runtime.ts           #   manifest (export const manifest = ... as const)
    cache/                 # gitignored: MCP-managed derived data
      index.sqlite         #   project index (code_entity, card, relations, FTS5)
      watcher.owner.lock   #   Owner Election lock file (PID)
  zipbul.jsonc             # Config: source dir, entry, relations, exclusions
  src/
    ...                    # Code SSOT
```

`.gitignore` rule: `.zipbul/cache/`

### 3.2 Read vs Write paths

- **Reads** (agent tools): always serve from SQLite index
- **Writes** (human/agent via CLI or MCP): modify SSOT files (cards / code annotations) via shared core logic, then re-index

CLI and MCP invoke the **same core** for writes (AST-safe edits, card CRUD, re-index).
The SQLite DB is always rebuildable.

---

## 4. SSOT File Model

### 4.1 Cards as files

Cards are stored as Markdown files with **frontmatter (metadata) + body (spec content only)**.

Path convention:

- `.zipbul/cards/auth.card.md`
- `.zipbul/cards/auth/login.card.md`

This is a filesystem hierarchy for organization. Logical relationships are stored in frontmatter, not directory structure.

### 4.2 Card classification (keyword + tag)

Cards have no `type` field — all cards are specs. Classification uses two orthogonal mechanisms:

| Mechanism | Purpose | Storage | Constraint |
|-----------|---------|---------|------------|
| **keyword** | Normalized term dictionary (search precision) | `keyword` table (PK) + `card_keyword` N:M | Registered terms only |
| **tag** | Free categorization (grouping/filtering) | `tag` table (PK) + `card_tag` N:M | Registered tags only |

**keyword** = "이 카드가 무엇에 관한 것인가" (e.g. `authentication`, `jwt`, `UserService`). Normalized PK prevents agents from using inconsistent terms (`auth` vs `authentication` vs `인증`).

**tag** = "이 카드를 어떻게 분류할 것인가" (e.g. `auth-module`, `core`, `v2`). PK-managed to prevent duplicate/inconsistent tags.

Relation types are configured in `zipbul.jsonc`:

```jsonc
{
  "sourceDir": "./src",
  "entry": "./src/main.ts",
  "module": { "fileName": "module.ts" },
  "mcp": {
    "card": {
      "relations": ["depends-on", "references", "related", "extends", "conflicts"]
    },
    "exclude": []
  }
}
```

- `mcp.card.relations`: allowed `relations[].type` values. Default: 5 types above.
- `mcp.exclude`: glob patterns excluded from indexing and `@see` verification.
- ~~`mcp.card.types`~~: **Removed**. No type system — all cards are specs.

### 4.3 Card frontmatter

```yaml
---
key: auth/login
summary: OAuth login
status: draft              # draft | accepted | implementing | implemented | deprecated
tags:                      # registered tags for categorization (PK-managed)
  - auth-module
  - user-facing
keywords:                  # registered terms for search precision (PK-managed)
  - authentication
  - jwt
constraints:               # optional (spec-specific constraints, brief)
  - latency < 200ms
  - PII must be masked
relations:                 # optional (graph edges to other cards)
  - type: depends-on
    target: auth/session
  - type: related
    target: auth/token-refresh
---
```

**Body** contains **spec content only**. No AC checklists, no style guides, no tutorials. Completion is determined by user-directed `status` transitions.

### 4.4 Relationship model (graph/web, no tree)

- **No `parent` field**. No forced tree hierarchy.
- All card↔card relationships are **typed edges** stored in frontmatter `relations[]`.
- `relations[].type` is a fixed set of edge kinds:

| Type | Meaning |
|------|---------|
| `depends-on` | Prerequisite / blocking |
| `references` | Weak reference / background |
| `related` | Associated (symmetric — both directions have identical semantics) |
| `extends` | Refinement / elaboration |
| `conflicts` | Contradicts / clashes |

- SSOT stores **outgoing edges only**. Reverse edges are auto-generated by the indexer in SQLite.
- Start with R1 (frontmatter). Migrate to R2 (separate files) if merge conflicts become frequent.

### 4.5 Card↔Code links (card-centric verification)

`@see key` is an **optional connection mechanism**. Code uses `@see` to declare that it implements a specific card.

Not every code file needs a card link. Types, interfaces, constants, and utility code may exist without `@see`. Verification is **card-centric**, not code-centric.

#### Syntax

```ts
/**
 * @see auth/login
 */
export function handleOAuthCallback() {}
```

Multiple links:

```ts
/**
 * @see auth/login
 * @see auth/session
 */
```

#### Card-centric verification rules

Verification checks whether **confirmed cards have implementation code linked**, not whether all code has card links.

| Card status | No @see references | Action |
|-------------|-------------------|--------|
| `draft` | — | no check |
| `accepted` | warning | "confirmed card, no implementation code linked" |
| `implementing` | warning | "card in progress, no code linked" |
| `implemented` | **error** | "marked implemented but no code linked" |
| `deprecated` | — | no check |

#### Verification layers

Card-centric verification operates at two layers:

**1. Verification command warnings**

When the verification command (`zp mcp verify`) is executed, it performs full integrity verification and reports errors/warnings. It warns about confirmed cards (`accepted` / `implementing` / `implemented`) that have no `@see` code links.

**2. Agent instruction hardcoding (out of document scope)**

Hardcode the following rule into agent instruction files (`.github/copilot-instructions.md`, `AGENTS.md`, `.cursor/rules/`, etc.):

> When writing or modifying implementation code, always insert `@see key` JSDoc comments if the code relates to a card.

This rule is outside the scope of the card system document, but is stated at the design stage because card-centric verification requires agents to consistently insert `@see` links. Actual instruction file modifications will be done during implementation.

#### Validity rules (always enforced)

- Every `@see key` in code MUST reference an existing card
- Invalid `@see` references are **errors**

Notes:

- JSDoc contains **only the card key reference** (no spec duplication). The card file remains SSOT for spec content.
- Link insertion is supported via CLI/MCP core (AST-safe edit).

---

## 5. Local SQLite Index Model (Derived)

### 5.1 Purpose

SQLite index is the **MCP-managed project index**. The MCP domain is the sole owner of all SQLite read/write operations. `zp build/dev` do not access SQLite.

**MCP read tools** (consumer):
- `search`, `get_context`, `get_subgraph`, `impact_analysis`, `trace_chain`

**MCP indexer** (producer):
- `zp mcp rebuild` performs full index build (card parsing + code AST scanning + FTS5)
- `zp mcp` server performs incremental re-index on file changes (watch mode)

The index is always **disposable and rebuildable** from:

- `.zipbul/cards/**/*.card.md`
- code files under configured source roots (from `zipbul.jsonc`)

**WAL mode**: SQLite is opened with `PRAGMA journal_mode = WAL` for optimal read-write concurrency (single writer via Owner Election, multiple readers via MCP tools). `PRAGMA busy_timeout = 5000` is set to handle transient lock contention.

### 5.2 Tables (domain-separated)

```sql
-- Schema metadata (versioning, configuration)
metadata(
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
)
-- Initial row: ('schema_version', '1')
-- Code constant SCHEMA_VERSION compared on open; mismatch → DROP ALL + rebuild (disposable DB)

-- Card metadata (parsed from frontmatter)
card(
  key           TEXT PRIMARY KEY,  -- e.g. 'auth/login'
  summary       TEXT NOT NULL,
  status        TEXT NOT NULL,     -- draft|accepted|implementing|implemented|deprecated
  constraints_json TEXT,           -- JSON array
  body          TEXT,              -- raw markdown body
  file_path     TEXT NOT NULL,     -- source .card.md path
  updated_at    TEXT NOT NULL
)

-- Keyword master table (unique keyword registry / term dictionary)
keyword(
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE  -- e.g. 'authentication', 'jwt', 'UserService'
)

-- Card↔Keyword mapping (N:M, PK-managed)
card_keyword(
  card_key      TEXT NOT NULL REFERENCES card(key),
  keyword_id    INTEGER NOT NULL REFERENCES keyword(id),
  PRIMARY KEY (card_key, keyword_id)
)

-- Tag master table (unique tag registry / categorization)
tag(
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE  -- e.g. 'auth-module', 'core', 'v2'
)

-- Card↔Tag mapping (N:M, PK-managed)
card_tag(
  card_key      TEXT NOT NULL REFERENCES card(key),
  tag_id        INTEGER NOT NULL REFERENCES tag(id),
  PRIMARY KEY (card_key, tag_id)
)

-- Code entities (parsed from AST by MCP indexer)
code_entity(
  entity_key    TEXT PRIMARY KEY,  -- e.g. 'symbol:src/auth/login.ts#handleOAuth'
  file_path     TEXT NOT NULL,
  symbol_name   TEXT,
  kind          TEXT NOT NULL,     -- module|class|function|variable|...
  signature     TEXT,
  fingerprint   TEXT,              -- hash of (symbol_name + kind + signature) for move tracking
  content_hash  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)

-- Card↔Card relations (parsed from frontmatter relations[])
-- Indexer auto-generates reverse edges (is_reverse = true) for bidirectional traversal
card_relation(
  id            INTEGER PRIMARY KEY,
  type          TEXT NOT NULL,     -- depends-on|references|related|extends|conflicts
  src_card_key  TEXT NOT NULL REFERENCES card(key),
  dst_card_key  TEXT NOT NULL REFERENCES card(key),
  is_reverse    BOOLEAN NOT NULL DEFAULT false,
  meta_json     TEXT
)

-- Card↔Code links (parsed from JSDoc @see key)
-- entity_key is NOT NULL: file-level @see maps to the module entity
card_code_link(
  id            INTEGER PRIMARY KEY,
  type          TEXT NOT NULL,     -- see (all card↔code links are represented as @see)
  card_key      TEXT NOT NULL REFERENCES card(key),
  entity_key    TEXT NOT NULL REFERENCES code_entity(entity_key),
  file_path     TEXT NOT NULL,
  symbol_name   TEXT,
  meta_json     TEXT
)

-- Code↔Code relations (extracted by AST pipeline)
code_relation(
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,   -- imports|calls|extends|implements
  src_entity_key  TEXT NOT NULL REFERENCES code_entity(entity_key),
  dst_entity_key  TEXT NOT NULL REFERENCES code_entity(entity_key),
  meta_json       TEXT
)

-- File state (for incremental indexing)
file_state(
  path            TEXT PRIMARY KEY,
  content_hash    TEXT NOT NULL,
  mtime           TEXT NOT NULL,
  last_indexed_at TEXT NOT NULL
)

-- FTS5 external content virtual tables (trigram tokenizer for CJK support)
-- External content FTS5: content stored in source table, FTS index auto-synced via triggers
-- No data duplication — FTS reads from source table on SELECT, only index is stored
CREATE VIRTUAL TABLE card_fts USING fts5(
  key, summary, body,
  content='card', content_rowid='rowid',
  tokenize='trigram'
);
CREATE VIRTUAL TABLE code_fts USING fts5(
  entity_key, symbol_name,
  content='code_entity', content_rowid='rowid',
  tokenize='trigram'
);

-- FTS external content sync triggers (card_fts)
-- External content DELETE uses special INSERT INTO fts(fts, ...) VALUES('delete', ...) syntax
CREATE TRIGGER card_fts_ai AFTER INSERT ON card BEGIN
  INSERT INTO card_fts(rowid, key, summary, body)
    VALUES (new.rowid, new.key, new.summary, new.body);
END;
CREATE TRIGGER card_fts_au AFTER UPDATE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body)
    VALUES('delete', old.rowid, old.key, old.summary, old.body);
  INSERT INTO card_fts(rowid, key, summary, body)
    VALUES (new.rowid, new.key, new.summary, new.body);
END;
CREATE TRIGGER card_fts_ad AFTER DELETE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body)
    VALUES('delete', old.rowid, old.key, old.summary, old.body);
END;

-- FTS external content sync triggers (code_fts)
CREATE TRIGGER code_fts_ai AFTER INSERT ON code_entity BEGIN
  INSERT INTO code_fts(rowid, entity_key, symbol_name)
    VALUES (new.rowid, new.entity_key, new.symbol_name);
END;
CREATE TRIGGER code_fts_au AFTER UPDATE ON code_entity BEGIN
  INSERT INTO code_fts(code_fts, rowid, entity_key, symbol_name)
    VALUES('delete', old.rowid, old.entity_key, old.symbol_name);
  INSERT INTO code_fts(rowid, entity_key, symbol_name)
    VALUES (new.rowid, new.entity_key, new.symbol_name);
END;
CREATE TRIGGER code_fts_ad AFTER DELETE ON code_entity BEGIN
  INSERT INTO code_fts(code_fts, rowid, entity_key, symbol_name)
    VALUES('delete', old.rowid, old.entity_key, old.symbol_name);
END;

-- Indexes for query performance (§9 targets)
CREATE INDEX idx_card_status ON card(status);
CREATE INDEX idx_card_file_path ON card(file_path);
CREATE INDEX idx_code_entity_file_path ON code_entity(file_path);
CREATE INDEX idx_code_entity_kind ON code_entity(kind);
CREATE INDEX idx_card_relation_src ON card_relation(src_card_key);
CREATE INDEX idx_card_relation_dst ON card_relation(dst_card_key);
CREATE INDEX idx_card_relation_type ON card_relation(type);
CREATE INDEX idx_card_code_link_card ON card_code_link(card_key);
CREATE INDEX idx_card_code_link_entity ON card_code_link(entity_key);
CREATE INDEX idx_card_code_link_file ON card_code_link(file_path);
CREATE INDEX idx_code_relation_src ON code_relation(src_entity_key);
CREATE INDEX idx_code_relation_dst ON code_relation(dst_entity_key);
CREATE INDEX idx_code_relation_type ON code_relation(type);
CREATE INDEX idx_card_keyword_card ON card_keyword(card_key);
CREATE INDEX idx_card_keyword_keyword ON card_keyword(keyword_id);
CREATE INDEX idx_card_tag_card ON card_tag(card_key);
CREATE INDEX idx_card_tag_tag ON card_tag(tag_id);
-- Note: keyword.name and tag.name already have UNIQUE indexes (implicit from UNIQUE constraint)
```

### 5.3 Identity strategy

**Namespace separation** (intentional delimiter difference):
- Card keys use **slash-separated slugs** — e.g. `auth/login`, `auth/session`
- Code entity keys use **single colon** `:` — e.g. `module:src/auth/login.ts`, `symbol:src/auth/login.ts#handleOAuth`

This prevents ambiguity: any key containing `:` (single colon) is a code entity, keys without colon are cards.

- Cards: identity is `card.key` (e.g. `auth/login`). Key is defined in frontmatter and is immutable by policy. Rename is supported via `card_rename` tool (updates all references).
- Code: identity is `entity_key` derived from AST:
  - module: `module:{relativePath}`
  - symbol: `symbol:{relativePath}#{symbolName}`

**Fingerprint for move tracking**:
- `fingerprint` = hash of (symbol_name + kind + signature)
- When a file moves, the indexer matches old entities to new entities by fingerprint
- **Safety-first (zero false positives):** retarget only when fingerprint match is **unique 1:1** (single old ↔ single new). Ambiguous matches are skipped.
- Match found → retarget `code_relation` (src/dst) and `card_code_link.entity_key` to the new `entity_key`, then delete the old entity row
- No match → delete old, create new

---

## 6. MCP Indexing Pipeline

The MCP domain is the sole owner of SQLite indexing. `zp build/dev` produce only build artifacts (manifest) and do **not** access SQLite. The MCP indexer independently parses card files and code files to populate the index.

### 6.1 Full rebuild (`zp mcp rebuild --full`)

1. Check `metadata.schema_version` → mismatch with code constant → DROP ALL tables + recreate schema
2. **Entire rebuild is wrapped in a single SQLite transaction** (atomic: all-or-nothing)
3. Parse all card files → `card` rows + `card_relation` rows (from frontmatter `relations[]`) + `keyword`/`card_keyword` rows (from frontmatter `keywords[]`) + `tag`/`card_tag` rows (from frontmatter `tags[]`)
4. Auto-generate reverse `card_relation` rows (`is_reverse = true`)
5. Parse code files via `oxc-parser` AST → `code_entity` rows (with fingerprint) + `code_relation` rows (imports, calls, extends, implements)
6. Parse JSDoc `@see key` annotations → `card_code_link` rows
7. FTS5 external content tables are auto-synchronized via triggers (no manual refresh needed)
8. Update `file_state` for all processed files

### 6.2 Incremental re-index (watch mode / `zp mcp rebuild`)

- Use `file_state` to skip unchanged files (content_hash + mtime comparison)
- Each file update is wrapped in a **SQLite transaction** (atomic per-file: all-or-nothing)
- If a card file changes: update `card` + `card_relation` + `card_keyword` + `card_tag` rows from that file. **Reverse edge scope**: delete only reverse edges where `dst_card_key` is the changed card, then regenerate from the card's current outgoing relations (not full reverse rebuild)
- If a code file changes: update `code_entity` + `code_relation` + `card_code_link` rows from that file
- FTS5 external content tables are auto-synchronized via triggers (no manual update needed)
- File move detection: compare fingerprints of deleted entities with new entities to preserve relations
  - **Conservative retargeting:** only 1:1 fingerprint matches are retargeted (otherwise skip)
  - Retarget scope: `code_relation` (src/dst) + `card_code_link.entity_key` (best-effort)

### 6.3 Data flow

```
[.card.md frontmatter] ──parse──→ card + card_relation + card_keyword + card_tag tables (+ reverse edges)
[.card.md body]        ──parse──→ card.body column
[*.ts files AST]       ──parse──→ code_entity (with fingerprint) + code_relation tables
[*.ts JSDoc @see]      ──parse──→ card_code_link table
(FTS5 external content) ──triggers──→ card_fts + code_fts indexes (no data duplication)
```

### 6.4 Code relation extractor (plugin structure)

The code relation extraction pipeline is designed for extensibility. Extractors live in `compiler/` domain and are imported by MCP indexer.

```typescript
interface CodeRelationExtractor {
  name: string;
  extract(ast: AST, filePath: string): CodeRelation[];
}
```

**Currently implemented:** `imports`, `calls`, `extends`, `implements` (pure AST extractable)

**Reserved for future:** `injects`, `provides` (framework-user features, to be added with system/adapter card types)

### 6.5 Build vs Index separation

| Command | Responsibility | SQLite access |
|---------|---------------|---------------|
| `zp build` | AOT compilation → manifest (`.zipbul/build/runtime.ts`) | **None** |
| `zp dev` | Watch mode compilation → manifest | **None** |
| `zp mcp rebuild` | Full/incremental index rebuild | **Read + Write** |
| `zp mcp` (server) | Watch mode incremental re-index + MCP tools | **Read + Write** |

---

## 7. CLI Surface (Draft)

### 7.1 Commands

- `zp mcp rebuild [--full]`
  - build/refresh `.zipbul/cache/index.sqlite` (manual rebuild)

- `zp mcp verify`
  - runs full integrity verification (cards, relations, and `@see` links)
  - prints errors/warnings and returns non-zero exit code on errors
  - **CI integration**: run `zp mcp verify` in CI pipeline to enforce invariants

- `zp mcp`
  - start MCP server (stdio / HTTP)
  - auto-ensure required repo structure/config on startup:
    - create `.zipbul/` structure if missing (including `cards/`, `build/`, `cache/`)
    - ensure `.zipbul/cache/` is gitignored
    - if `zipbul.jsonc` is missing: create it with minimum required fields (`sourceDir`, `entry`, `module.fileName`)
    - if `zipbul.jsonc` exists: never auto-edit it (non-destructive); missing fields are filled by runtime defaults
  - ensures index is ready (build if missing)
  - always-on index watch: when cards/code/config change, automatically re-index
    - `.zipbul/cards/**/*.card.md` changes: incremental re-index
    - code changes under `sourceDir` (`*.ts`, excluding `*.d.ts`): incremental re-index
    - `zipbul.jsonc` changes: full rebuild

### 7.2 Write helpers

- `zp mcp card create|update|delete|rename|status`
  - create/modify/delete/rename `.card.md` (frontmatter + body)
  - `rename` updates all `@see` references + `relations[].target` across codebase

- `zp mcp link add|remove`
  - insert/remove `@see key` annotation using AST (safe edit)

- `zp mcp relation add|remove`
  - add/remove `relations[]` entries in card frontmatter

All write helpers use the **shared core logic** (same code as MCP write tools).

---

## 8. MCP Server (Embedded in CLI)

CLI and MCP share the **same core**. MCP is the primary interface for vibe-coding.

### 8.1 Read tools

- `search(query, filters)` — full-text search across cards and code
- `get_context(target)` — card or code entity with linked entities
- `get_subgraph(center, hops, filters)` — N-hop graph traversal (visited set cycle prevention)
- `impact_analysis(card_key)` — cards + code affected by a card change (reverse dependency traversal)
- `trace_chain(from_key, to_key)` — shortest relation path between two entities
- `coverage_report(card_key)` — card's linked code status
- `list_unlinked(status_filter)` — cards with no @see code references (filterable by status)
- `list_cards(filters)` — card listing by status, tags, keywords
- `get_relations(card_key, direction)` — card's relations (outgoing / incoming / both)

All read tools query SQLite only.

### 8.2 Write tools (required, not deferred)

MCP write tools are **required**. Framework authors use MCP exclusively.

Write tools must:

- modify SSOT files (cards / code annotations) via shared core logic
- trigger re-index after write
- never modify SQLite directly as SSOT

Tools:

- `card_create(key, summary, body, keywords?, tags?)` — create card file
- `card_update(key, fields)` — update card frontmatter/body
- `card_delete(key)` — delete card file (rejects deletion if `@see` references still exist in code OR other cards reference this card in `relations[].target`; user must remove all references first)
- `card_rename(old_key, new_key)` — rename key across all @see + relations
- `card_update_status(key, status)` — transition card status
- `link_add(file_path, card_key)` — AST-safe JSDoc @see insertion
- `link_remove(file_path, card_key)` — AST-safe JSDoc @see removal
- `relation_add(src_key, dst_key, type)` — add relation to card frontmatter
- `relation_remove(src_key, dst_key, type)` — remove relation from card frontmatter
- `keyword_create(name)` — register new keyword in term dictionary
- `keyword_delete(name)` — remove keyword (unlinks from all cards)
- `tag_create(name)` — register new tag
- `tag_delete(name)` — remove tag (unlinks from all cards)

---

## 9. Performance Targets (Draft)

Benchmark baseline: **500 cards + 2,000 code files + 10,000 code entities**

On a typical laptop (local SQLite):

| Operation | Target |
|-----------|--------|
| `get_context` | < 20ms |
| `search` (FTS trigram) | < 30ms |
| `get_subgraph` (hops=2) | < 50ms |
| `impact_analysis` (depth=3) | < 100ms |
| incremental index (1 file) | < 200ms |
| full rebuild | < 10s |

---

## 10. Governance & History (Git-native)

All governance is handled by Git:

- approvals: PR review + commit history
- rollback: `git revert`
- history: `git log .zipbul/cards/...`

If stronger governance is required later:

- add an optional append-only `.zipbul/events.jsonl` (Git-tracked) as a structured audit stream

---

## 11. Invariants (Minimal set)

Hard rules (errors):

1. `card.key` is globally unique in repo
2. no duplicate card file defines the same key
3. every code-referenced `@see key` must exist as a card
4. every `relations[].target` in frontmatter must exist as a card
5. card with status `implemented` must have at least one `@see` code reference
6. every `relations[].type` must be in `mcp.card.relations` (in `zipbul.jsonc`)
7. every keyword in frontmatter `keywords[]` must be registered in `keyword` table
8. every tag in frontmatter `tags[]` must be registered in `tag` table

Soft rules (warnings):

1. card with status `accepted` or `implementing` has no `@see` code references
2. `depends-on` cycles (traversal uses visited set to prevent infinite loops)
3. references to `deprecated` cards

---

## 12. Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Card status set | `draft \| accepted \| implementing \| implemented \| deprecated` |
| 2 | Relation storage | R1 (frontmatter, outgoing only) to start. Reverse edges auto-generated by indexer. Migrate to R2 if merge conflicts become frequent |
| 3 | AST engine | `oxc-parser` only. No TypeScript Compiler API |
| 4 | Code relation depth | Call-level included (imports, calls, extends, implements). injects/provides reserved for future |
| 5 | Link prefix | `@see key` (slug only, no type prefix). Card = spec, type removed |
| 6 | Policy/agent rules | Not stored in cards. Out of scope for card model |
| 7 | `.tsx` support | Not applicable (backend framework) |
| 8 | In-code ignore tokens | Not applicable (`@see` is optional; no code-level enforcement to bypass) |
| 9 | MCP write tools | Required (not deferred). Full CRUD for cards, links, relations |
| 10 | `parent` field | Removed. Graph/web structure only (typed edges) |
| 11 | Card↔code links | `@see {type}::key` is optional. Verification is card-centric (not code-centric) |
| 12 | CI enforcement | Mandatory for: invalid @see targets, implemented cards without code links |
| 13 | @see enforcement | Optional. Card-centric verification, not code-centric |
| 14 | Reverse relations | Auto-generated by indexer (`is_reverse` flag). SSOT stores outgoing only |
| 15 | Code identity | Path-based `entity_key` + `fingerprint` (symbol+kind+signature hash) for move tracking |
| 16 | Status transitions | User-directed. No automatic AC checking. Agent acts on user instruction |
| 17 | FTS tokenizer | trigram (for CJK/Unicode support) |
| 18 | Cycle handling | Visited set in traversal tools. `depends-on` cycles are CI warnings (not errors) |
| 19 | Code relation extractors | Plugin interface ready. Only pure-AST extractors implemented now |
| 20 | Config format | `zipbul.jsonc` (JSONC). Shared with framework config |
| 21 | Package structure | CLI package (`packages/cli/`). MCP commands as `zp mcp` subcommand group |
| 22 | Framework-shipped cards | Deferred. `zp mcp` auto-creates required empty structure on first run. Content TBD |
| 23 | Card type registry | **Removed**. All cards are specs. No `mcp.card.types` config. Classification via keyword (term dict PK) + tag (category PK) |
| 24 | `relations[].type` set | `mcp.card.relations` in `zipbul.jsonc`. Default: `["depends-on", "references", "related", "extends", "conflicts"]` |
| 25 | Verification command | `zp mcp verify` performs full integrity verification; warns about confirmed cards with no code links |
| 26 | Agent @see insertion rule | Hardcode `@see` insertion rule in agent instruction files (applied during implementation) |
| 27 | Manifest format | TypeScript: `export const manifest = ${JSON.stringify(data)} as const;`. Frozen at build time, deleted from memory after bootstrap via null assignment + GC |
| 28 | SQLite ownership | **MCP-exclusive** — MCP domain is the sole owner of all SQLite operations. `zp build/dev` do not access SQLite. MCP indexer independently parses card files and code AST to populate the index |
| 29 | `.zipbul/` directory | `cards/` + `build/` (Git-tracked) + `cache/` (gitignored: `index.sqlite` + `watcher.owner.lock`). No `schema/` directory — schema versioning is handled by `metadata` table in SQLite |
| 30 | Owner Election | lock file + PID + signal. **MCP processes only** (build/dev do not participate). First `zp mcp` process = owner (watch + write), subsequent = reader (signal + read only). Owner death → reader promotes |
| 31 | WAL mode | `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000`. Optimal for single-writer + multi-reader (Owner Election + MCP read tools) |
| 32 | CLI architecture | Domain-oriented vertical slicing: `compiler/`, `mcp/`, `store/`, `watcher/`, `config/`, `diagnostics/`, `shared/`, `errors/`, `bin/`. No horizontal layering |
| 33 | Angular CLI patterns | All 8 patterns adopted (Bun-native): declareTool factory, Host abstraction, McpToolContext, SQLite schema versioning, FTS5+bm25, domain-vertical dirs, Zod schemas, shouldRegister |
| 34 | Design principle | Performance, safety, stability over implementation cost. Complexity is acceptable when it serves these goals |
| 35 | build/dev duplication | Resolved by domain restructuring — compiler domain unifies analyzer + generator + build/dev orchestration |
| 36 | Build vs Index separation | `zp build/dev` = manifest only (no SQLite). `zp mcp rebuild` = SQLite sync. Complete responsibility separation |
| 37 | `metadata` table | `metadata(key TEXT PK, value TEXT NOT NULL)` in SQLite. Stores `schema_version`. Code constant `SCHEMA_VERSION` compared on open; mismatch → DROP ALL + rebuild |
| 38 | `.zipbul/schema/` removal | Removed. No separate schema directory needed. DB schema version in `metadata` table, card format handled by backward-compatible parser |
| 39 | FTS5 auto-sync | External content FTS5 (`content='card'`/`content='code_entity'`, `content_rowid='rowid'`). Trigger-based sync using special `VALUES('delete', ...)` syntax. No data duplication, no manual FTS update needed |
| 40 | `card_code_link.entity_key` | NOT NULL. File-level `@see` maps to the file's `module:` entity. Ensures referential integrity and simpler JOINs |
| 41 | `code_relation.type` scope | Current: `imports\|calls\|extends\|implements`. `injects\|provides` reserved for future framework-user features |
| 42 | CLI naming convention | CRUD standard: `create\|update\|delete\|rename\|status`. CLI and MCP tool names aligned (e.g. `card create` / `card_create`) |
| 43 | Keyword system | Keywords are a **normalized term dictionary** (PK-managed). `keyword` table (id + name UNIQUE) + `card_keyword` N:M. No denormalized TEXT column in card table. FTS searches body/summary only; keyword/tag lookup via JOIN |
| 44 | Keyword PK strategy | INTEGER PK (`keyword.id`) + `name TEXT UNIQUE`. ID-based FK in `card_keyword` — keyword rename does not cascade to junction table. Chosen because agents frequently rename keywords |
| 45 | P0 directory restructure | Pure directory move before any new code. `analyzer/+generator/ → compiler/`, `commands/ → bin/`, empty dirs created. File rename/refactor deferred to each Phase. Git history preserved via pure mv |
| 46 | Card type removal | `card.type` field **removed**. All cards are specs. Key format changed: `spec::auth/login` → `auth/login`. No type prefix in `@see` links. Simplifies schema, config, validation |
| 47 | Tag system | Tags are **PK-managed categorization**. `tag` table (id + name UNIQUE) + `card_tag` N:M. Same structure as keyword but different purpose: keyword = search precision (what), tag = classification (how to organize) |
| 48 | Card TEXT columns removed | `card.keywords` TEXT and `card.type` TEXT removed from card table. keyword/tag data lives exclusively in normalized N:M tables. FTS covers only `key`, `summary`, `body` |
| 49 | Framework doc delivery | **YAGNI**. No MCP tool for framework docs. `.d.ts` JSDoc is the API reference. MCP provides project KB only. Revisit when agent-to-agent workflow is implemented |
| 50 | Workflow documents | Not part of card system. Plans, reviews, discussions are temporary markdown files managed outside KB. Cards = specs only |

## 13. Future Discussion (out of current scope)

Items to discuss in later phases. Recorded here for continuity.

### Architecture / Design

1. **Framework user data accumulation**: How to collect and structure data for framework end-users? What data does the MCP expose to users building apps with zipbul?
2. **Agent-to-agent workflow**: Multi-agent orchestration for planning, coding, testing, review. Temporary workflow documents (plans, discussions, reviews) managed outside card system as plain markdown files.
3. **Framework documentation delivery**: When `.d.ts` JSDoc is insufficient, consider MCP tool for framework docs. Currently YAGNI.

### Implementation Details

1. **YAML frontmatter parser**: Bun-compatible library selection for card parsing
2. **oxc-parser JSDoc @see extraction**: Integration with existing CLI AST pipeline for `@see key` parsing
3. **MCP transport protocol**: stdio vs HTTP selection criteria and configuration
4. **`card_rename` transaction safety**: Atomicity guarantees when renaming across many files

---

## 14. CLI Domain Architecture

The CLI package uses **domain-oriented vertical slicing**. Each domain owns all its code (no horizontal layers splitting domains).

```
packages/cli/src/
  compiler/        # AOT build: AST parsing, module graph, manifest, injector, code gen
                   #   Does NOT access SQLite. Produces only build artifacts.
                   #   Contains CodeRelationExtractor implementations (reused by MCP indexer)
  mcp/             # Card system + indexing: card CRUD, indexing, MCP server, verification
    card/          #   Card parsing (frontmatter+body), CRUD helpers
    index/         #   Full/incremental indexing (card, code_entity, relations, FTS5)
    server/        #   MCP server (stdio), tool registry (declareTool pattern)
    verify/        #   Integrity verification (invariants §11)
  store/           # SQLite access layer (used by MCP domain only)
    index-store.ts #   Schema, connection, WAL, metadata, CRUD operations
    file-state.ts  #   Incremental indexing (file_state table)
    interfaces.ts  #   Port interfaces
  watcher/         # File watching + Owner Election (lock+PID+signal)
  config/          # zipbul.jsonc loading, config resolution (currently in common/, migrated in P8)
  diagnostics/     # Diagnostic message building/reporting
  shared/          # Pure utilities (codepoint-compare, glob-scan, write-if-changed)
  errors/          # Error types
  bin/             # CLI entry points (zp build, zp dev, zp mcp)
```

### 14.1 Owner Election

- Scope: **MCP processes only** (`zp mcp` / `zp mcp rebuild`). `zp build/dev` do not participate.
- Lock file: `.zipbul/cache/watcher.owner.lock` contains owner PID
- First `zp mcp` process = **owner** (watch + SQLite write authority)
- Subsequent `zp mcp` processes = **reader** (SQLite read only, signal owner for re-index)
- Owner death detection: reader checks if PID is alive; promotes if dead
- Single writer eliminates concurrency hazards at the root cause

### 14.2 Manifest Format

- TypeScript: `export const manifest = ${JSON.stringify(data)} as const;`
- Output: `.zipbul/build/runtime.ts` (Git-tracked)
- Lifecycle: frozen (`Object.freeze` + `Object.seal`) at build time → consumed during bootstrap → deleted from memory (`null` + GC)

### 14.3 Angular CLI Patterns (Bun-adapted)

All patterns adopted from Angular CLI MCP, adapted for Bun runtime:

1. **declareTool factory** — Tool declaration/registration/filtering separation
2. **Host abstraction** — OS/FS operations behind interface for testability
3. **McpToolContext** — Shared context injected into all tools
4. **SQLite schema versioning** — `metadata(key, value)` table with `schema_version`
5. **FTS5 + bm25 weighted search** — Column-weighted relevance ranking
6. **Domain-vertical directory organization** — Related files grouped by domain
7. **Zod input/output schemas** — Type-safe tool I/O validation
8. **shouldRegister conditional registration** — Runtime condition checks for tool availability

### 14.4 Implementation Order

| Phase | Domain | Content | Depends On |
|-------|--------|---------|------------|
| P0 | (all) | **Directory restructure** (pure mv + import path fix, no file rename/refactor). `analyzer/+generator/ → compiler/`, `commands/ → bin/`, empty dirs: `store/`, `shared/`, `mcp/{card,index,server,verify}/`. Git history preserved via pure move. Tests must pass after each commit | — |
| P1 | `store/` | SQLite schema (§5.2 — card without type/keywords TEXT, keyword, card_keyword, **tag, card_tag**), connection, WAL, file_state, port interfaces | config (done) |
| P2 | `compiler/` | CodeRelationExtractor implementations for MCP indexer reuse. No SQLite access | P0 |
| P3 | `mcp/card/` | Card file parsing (frontmatter+body — **no type field, with tags[] and keywords[]**), CRUD helpers, key format (slug only, no type prefix) | config |
| P4 | `mcp/index/` | Full/incremental indexing (card, card_relation, card_code_link, code_entity, code_relation, **card_keyword, card_tag**), FTS5 (key/summary/body only), file_state | store/, mcp/card/, compiler/ |
| P5 | `mcp/verify/` | Invariants §11 verification (8 hard + 3 soft rules — **no type validation, added keyword/tag registration checks**) | store/, mcp/card/ |
| P6 | `watcher/` | Owner Election (lock+PID+signal), incremental re-index trigger | store/ |
| P7 | `mcp/server/` | MCP server (stdio), tool registry (declareTool), read/write tools (**including keyword_create/delete, tag_create/delete**) | store/, mcp/card/, mcp/index/, mcp/verify/ |
| P8 | `bin/` | CLI entry restructure: `zp build`, `zp dev`, `zp mcp`. `config/` 분리 (`common/` 유틸 유지) | all |

P0 is a prerequisite for all phases. P1 and P3 are independent and can proceed in parallel after P0. P6 is independent after P1.

Each phase follows **strict TDD**: write ALL tests first → RED → implement → GREEN.

---

## Appendix: Why this aligns with vibe-coding

- Agent reads become deterministic and fast (SQLite index)
- Human collaboration remains Git-native
- Complexity is concentrated in the indexer (single place), not in distributed constraints
- MCP write tools enable fully MCP-driven development (no CLI required)
- Card = Spec: single purpose simplifies tooling; keyword (term dict) + tag (classification) provide flexible discovery without schema bloat
- Card-centric verification allows exploratory coding (code first, link later) while ensuring confirmed specs have implementations

---

## Appendix: Non-Guarantee Area (Static-only Limits)

이 문서에서 말하는 `compiler/`의 CodeRelationExtractor(= pure AST 기반)는 **정적 분석만으로** 관계를 추출한다. 따라서 아래 케이스들은 “구멍”이 아니라 **정의상 보장 불가 영역**이다.

1. **비리터럴 dynamic import**: `import(expr)`에서 `expr`가 문자열 리터럴이 아니면 대상 모듈을 결정할 수 없다.
2. **계산된 멤버 접근/호출**: `obj[expr]()` / `obj[expr]`는 `expr` 평가 결과에 따라 대상이 달라져 정적으로 확정 불가.
3. **런타임 재바인딩/몽키패치**: 함수/메서드가 재할당되거나 프로토타입이 변경되면 “호출 → 실제 대상” 매핑이 런타임에 바뀐다.
4. **리플렉션/메타프로그래밍**: `Reflect`, `Proxy`, 데코레이터/메타데이터 기반 라우팅 등은 AST만으로 완전 추적 불가.
5. **FS/툴체인 의존 해석**: `tsconfig paths`, 확장자/인덱스 규칙, 번들러 리졸브 규칙 등은 파일시스템/설정에 의존하므로 P2의 “no FS / no SQLite” 제약 하에서 완전해질 수 없다.

### Guarantee modes

정적 추출 결과의 신뢰도/완전성은 모드로 정의한다.

1. **Sound mode (no false positives)**
  - 확실히 판별 가능한 관계만 기록한다.
  - 장점: 잘못된 엣지(거짓 양성)를 최소화.
  - 단점: 누락(거짓 음성)이 늘 수 있음.

2. **Complete-ish mode (best-effort + meta_json)**
  - 가능한 많이 엣지를 생성하되, 애매한 경우 `meta_json`에 “best-effort/불확실성”을 명시한다.
  - 장점: 누락(거짓 음성)을 줄여 탐색/리트리벌에 유리.
  - 단점: 일부 엣지는 런타임과 불일치할 수 있음(거짓 양성 가능).

현재 계획은 인덱서의 탐색 성능/리트리벌을 우선하여 **Complete-ish**를 기본으로 한다.
