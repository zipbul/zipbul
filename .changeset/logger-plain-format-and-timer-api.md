---
"@zipbul/logger": patch
---

Agent-line plain format + timer/format-specifier APIs, along with widened argument typing so callers can forward `unknown` values from `catch` blocks without manual narrowing.

**Output format**

- `ConsoleTransport`'s `'pretty'` mode (timestamps, `✦` icons, RGB true-color, dim fn separators) replaced with `'plain'`: a single line of `<level>: [<context>[/<fn>]] <msg> [<key>=<val> ...]`. No ANSI escapes, no timestamps, no decorative glyphs. The `'plain'` format is the new non-production default; production keeps `'json'` (NDJSON, one JSON object per line) unchanged.
- Stream split is now an explicit contract: `trace` / `debug` / `info` write to `process.stdout`; `warn` / `error` / `fatal` write to `process.stderr`. Errors with a `stack` are emitted on a second stderr write so the header line stays single-line for greppers.
- Metadata trailer renders primitives as bare `key=value`; strings containing whitespace or `=` are JSON-quoted; `Loggable` and object metadata pass through `util.inspect({ depth: 3, colors: false, compact: true })` so the line stays parseable.
- `LoggerOptions.format` is now `'plain' | 'json'`; the `Color`, `LoggerPrettyOptions`, and `prettyOptions` types are removed.

**Logger API additions**

- `log.time(label)` / `log.timeEnd(label)` — per-instance timers that emit `<label>: <ms>ms` at info level. Re-calling `time()` with the same label resets the start (matches `console.time` semantics); calling `timeEnd()` for an unstarted label warns and returns. Timers are per-instance, so a child or sibling Logger does not see them.
- `log.<level>(msg, ...args)` now interpolates `util.format` specifiers (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, `%j`) in `msg` against primitive arguments. Mixed calls work as expected: `log.info('handler %s', 'getUser', { route: '/users/:id' })` interpolates `'getUser'` into the message and stores `{ route }` as metadata.
- `LogArgument` widened to `unknown`. `catch (e)` values now forward through `log.warn('failed: %s', e)` without manual `e instanceof Error ? e.message : String(e)` dance — the runtime classifier sorts Error / Loggable / object into metadata and primitives into format args.

**Index re-exports**

- `TestTransport` and `Trace` are now re-exported from the package root so consumers can `import { TestTransport } from '@zipbul/logger'` without reaching into the dist `src/transports/test` path.
