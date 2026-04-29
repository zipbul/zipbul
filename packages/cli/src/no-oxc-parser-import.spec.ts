/**
 * Regression guard for the gildash single-entrypoint policy
 * (ADAPTER_COMPILER.md Section N Item 121, Step 9).
 *
 * `@zipbul/cli` must not import from `oxc-parser` directly. All AST access
 * goes through `@zipbul/gildash` re-exports (`Node`, `Visitor`, `visitorKeys`,
 * etc.) and high-level APIs (`extractSymbols`, `extractRelations`,
 * `findPattern`). Transitive presence of `oxc-parser` (gildash bringing it
 * in) is allowed; direct `import ... from 'oxc-parser'` lines are not.
 *
 * The check scans every `.ts` / `.tsx` file under `packages/cli/src` (excluding
 * this spec itself, which references the string in prose) and fails on any
 * `from 'oxc-parser'` substring. Detection via regex on raw source is robust
 * against import-type-only forms, alias renames, and multiline imports — the
 * forbidden token is the literal module specifier string.
 */
import { describe, expect, it } from 'bun:test';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SELF_PATH = join('packages', 'cli', 'src', 'no-oxc-parser-import.spec.ts');

async function* walkTsFiles(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir);

  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);

    if (info.isDirectory()) {
      yield* walkTsFiles(full);

      continue;
    }

    if (!info.isFile()) continue;
    if (!full.endsWith('.ts') && !full.endsWith('.tsx')) continue;

    yield full;
  }
}

describe('no oxc-parser direct import in @zipbul/cli', () => {
  it('every cli source file accesses AST only via @zipbul/gildash', async () => {
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for await (const file of walkTsFiles('packages/cli/src')) {
      if (file.endsWith(SELF_PATH)) continue;

      const text = await readFile(file, 'utf8');
      const lines = text.split('\n');

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;

        if (line.includes(`'oxc-parser'`) || line.includes(`"oxc-parser"`)) {
          offenders.push({ file, line: index + 1, text: line });
        }
      }
    }

    if (offenders.length > 0) {
      const message = offenders
        .map(o => `  ${o.file}:${o.line}  ${o.text.trim()}`)
        .join('\n');

      throw new Error(
        `cli must not reference 'oxc-parser' directly. Use @zipbul/gildash.\n${message}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
