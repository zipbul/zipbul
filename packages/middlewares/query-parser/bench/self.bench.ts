// Self / regression micro-benchmarks — @zipbul/query-parser ONLY.
//
// Purpose: track this parser's own performance across changes. Imports the TS
// SOURCE (`../src`) deliberately — it measures the code under edit, run via Bun's
// transpile pipeline. This is NOT a cross-library comparison; see
// competitive.bench.ts for that (which measures the built `dist/` against rivals).
//
// Regression workflow: this file has no built-in baseline. To A/B a change, run
// it on the current tree, stash the source change, run again, and diff — same
// machine, same Bun version.

import { run, bench, boxplot, summary, do_not_optimize } from 'mitata';

import { QueryParser } from '../src/query-parser';

import {
  FLAT_1,
  FLAT_5,
  FLAT_10,
  FLAT_50,
  FLAT_100,
  NESTED_1,
  NESTED_2,
  NESTED_3,
  NESTED_5,
  ARRAY_PUSH_10,
  ARRAY_INDEX_10,
  ARRAY_MIXED,
  HPP_20,
  NO_ENCODING,
  ENCODED_VALUES,
  ENCODED_KEYS,
  SEARCH_FORM,
  FILTER_API,
  ECOMMERCE,
  FORM_ENCODED,
  PLUS_HEAVY,
} from './fixtures';

const defaultParser = QueryParser.create();
const nestingParser = QueryParser.create({ nesting: true });
const strictParser = QueryParser.create({ strict: true });
const strictNestingParser = QueryParser.create({ nesting: true, strict: true });
const dupFirstParser = QueryParser.create({ duplicates: 'first' });
const dupLastParser = QueryParser.create({ duplicates: 'last' });
const dupArrayParser = QueryParser.create({ duplicates: 'array' });
const urlEncodedParser = QueryParser.create({ urlEncoded: true });

// ── 1. Factory cost ──
boxplot(() => {
  bench('QueryParser.create() — default', () => {
    do_not_optimize(QueryParser.create());
  }).gc('inner');

  bench('QueryParser.create() — full custom', () => {
    do_not_optimize(
      QueryParser.create({
        depth: 10,
        maxParams: 500,
        nesting: true,
        arrayLimit: 50,
        duplicates: 'array',
        strict: true,
      }),
    );
  }).gc('inner');
});

// ── 2. Flat key=value — parameter count scaling ──
summary(() => {
  bench('flat 1 param', () => do_not_optimize(defaultParser.parse(FLAT_1)));
  bench('flat 5 params', () => do_not_optimize(defaultParser.parse(FLAT_5)));
  bench('flat 10 params', () => do_not_optimize(defaultParser.parse(FLAT_10)));
  bench('flat 50 params', () => do_not_optimize(defaultParser.parse(FLAT_50)));
  bench('flat 100 params', () => do_not_optimize(defaultParser.parse(FLAT_100)));
});

// ── 3. Nested object parsing — by depth ──
summary(() => {
  bench('nested depth 1 — a[b]=1', () => do_not_optimize(nestingParser.parse(NESTED_1)));
  bench('nested depth 2 — a[b][c]=1', () => do_not_optimize(nestingParser.parse(NESTED_2)));
  bench('nested depth 3 — a[b][c][d]=1', () => do_not_optimize(nestingParser.parse(NESTED_3)));
  bench('nested depth 5 — a[b][c][d][e][f]=1', () => do_not_optimize(nestingParser.parse(NESTED_5)));
});

// ── 4. Array parsing ──
summary(() => {
  bench('array push ×10 — a[]=0&...', () => do_not_optimize(nestingParser.parse(ARRAY_PUSH_10)));
  bench('array indexed ×10 — a[0]=0&...', () => do_not_optimize(nestingParser.parse(ARRAY_INDEX_10)));
  bench('array+object mixed', () => do_not_optimize(nestingParser.parse(ARRAY_MIXED)));
});

// ── 5. Duplicates mode comparison ──
summary(() => {
  bench('hpp first — 20 duplicates', () => do_not_optimize(dupFirstParser.parse(HPP_20)));
  bench('hpp last — 20 duplicates', () => do_not_optimize(dupLastParser.parse(HPP_20)));
  bench('hpp array — 20 duplicates', () => do_not_optimize(dupArrayParser.parse(HPP_20)));
});

// ── 6. Percent encoding overhead ──
summary(() => {
  bench('no encoding', () => do_not_optimize(defaultParser.parse(NO_ENCODING)));
  bench('encoded values', () => do_not_optimize(defaultParser.parse(ENCODED_VALUES)));
  bench('encoded keys + values', () => do_not_optimize(defaultParser.parse(ENCODED_KEYS)));
});

// ── 7. Strict mode overhead ──
summary(() => {
  bench('flat 10 (non-strict)', () => do_not_optimize(defaultParser.parse(FLAT_10)));
  bench('flat 10 (strict)', () => do_not_optimize(strictParser.parse(FLAT_10)));
  bench('nested depth 3 (non-strict)', () => do_not_optimize(nestingParser.parse(NESTED_3)));
  bench('nested depth 3 (strict)', () => do_not_optimize(strictNestingParser.parse(NESTED_3)));
});

// ── 8. Realistic payloads ──
summary(() => {
  bench('search form (flat)', () => do_not_optimize(defaultParser.parse(SEARCH_FORM)));
  bench('filter API (nested)', () => do_not_optimize(nestingParser.parse(FILTER_API)));
  bench('e-commerce (arrays)', () => do_not_optimize(nestingParser.parse(ECOMMERCE)));
  bench('form payload (urlEncoded)', () => do_not_optimize(urlEncodedParser.parse(FORM_ENCODED)));
  bench('plus-heavy (urlEncoded)', () => do_not_optimize(urlEncodedParser.parse(PLUS_HEAVY)));
});

await run();
