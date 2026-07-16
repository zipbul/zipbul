// Competitive benchmarks — @zipbul/query-parser vs other libraries.
//
// FAIRNESS CONTRACT (read before trusting any number):
//   • Runtime: Bun only. `node:querystring` here is Bun's implementation, NOT a
//     Node.js server baseline.
//   • @zipbul is imported from the BUILT `dist/` (run `bun run build` first — the
//     `bench:vs` script does this) so it is measured as a published artifact,
//     apples-to-apples with the pre-compiled rivals in node_modules. The `self`
//     bench measures `src/` instead.
//   • Capability cohorts — a library is only compared against peers of the same
//     class, so no parser is credited for work it structurally skips:
//       – flat-only cohort: @zipbul{nesting:false} vs node:querystring vs
//         URLSearchParams→record vs fast-querystring (none do nesting).
//       – full-parser cohort: @zipbul{nesting:true} vs qs vs picoquery (all
//         bracket-capable). Note: on bracket-FREE flat keys @zipbul{nesting:true}
//         still short-circuits to its flat path, so the flat full-parser row
//         measures "product class on flat traffic", not identical internal work.
//   • qs / picoquery option objects are hoisted (frozen) OUTSIDE the timed loop —
//     passing them inside would re-merge/allocate every iteration and penalize
//     the rival. qs is given NO redundant default options.
//   • URLSearchParams rows are labelled "USV→record": they include
//     Object.fromEntries materialization, matching the record output the others
//     produce (bare URLSearchParams would be a different, lazier product).
//   • Duplicate-key SEMANTICS differ (e.g. @zipbul default 'first' vs qs/
//     fast-querystring arrays). do_not_optimize hides wrong answers but not
//     unequal work, so duplicate-bearing inputs (e-commerce) are labelled and
//     kept out of any headline flat throughput table. See the parity preview.
//   • qs is pinned to an exact version in package.json for reproducibility.
//
// Numbers are machine/version dependent — re-run locally; do not copy stale
// figures into the README.

import { run, bench, summary, do_not_optimize } from 'mitata';
import querystring from 'node:querystring';

import qs from 'qs';
import fastquerystring from 'fast-querystring';
import { parse as picoparse } from 'picoquery';

// Built artifact, not src — see the fairness contract above.
import { QueryParser } from '../dist/index.js';

import {
  FLAT_10,
  FLAT_50,
  ENCODED_5,
  NESTED_3,
  ARRAY_INDEX_10,
  ECOMMERCE,
  PLUS_HEAVY,
} from './fixtures';

const flatParser = QueryParser.create({ nesting: false });
const nestingParser = QueryParser.create({ nesting: true });

// Hoisted (frozen) rival options — allocating these inside a bench body would
// unfairly charge the rival for per-call option merging. picoquery needs
// nestingSyntax:'index' to parse bracket keys (its default is dot-syntax).
const PICO_INDEX = Object.freeze({ nesting: true, nestingSyntax: 'index' as const });

const usvToRecord = (s: string): Record<string, string> => Object.fromEntries(new URLSearchParams(s));

// ── Output-parity preview (NOT timed) ───────────────────────────────────────
// Printed once so a reader can SEE where output shapes agree or diverge before
// reading the timings. Perf without shape parity is meaningless.
{
  const j = (o: unknown): string => JSON.stringify(o);
  // eslint-disable-next-line no-console
  console.log('── output parity (not timed) ──');
  // eslint-disable-next-line no-console
  console.log('nested a[b][c][d]=1');
  // eslint-disable-next-line no-console
  console.log('  @zipbul  ', j(nestingParser.parse(NESTED_3)));
  // eslint-disable-next-line no-console
  console.log('  qs       ', j(qs.parse(NESTED_3)));
  // eslint-disable-next-line no-console
  console.log('  picoquery', j(picoparse(NESTED_3, PICO_INDEX)));
  // eslint-disable-next-line no-console
  console.log('e-commerce (duplicate brand[]/size[] — semantics differ):');
  // eslint-disable-next-line no-console
  console.log('  @zipbul  ', j(nestingParser.parse(ECOMMERCE)));
  // eslint-disable-next-line no-console
  console.log('  qs       ', j(qs.parse(ECOMMERCE)));
  // eslint-disable-next-line no-console
  console.log('  picoquery', j(picoparse(ECOMMERCE, PICO_INDEX)));
  // eslint-disable-next-line no-console
  console.log('───────────────────────────────\n');
}

// ── Flat-only cohort (parsers that do NOT nest) ──
summary(() => {
  bench('flat 10 — @zipbul (nesting:false)', () => do_not_optimize(flatParser.parse(FLAT_10)));
  bench('flat 10 — node:querystring', () => do_not_optimize(querystring.parse(FLAT_10)));
  bench('flat 10 — URLSearchParams→record', () => do_not_optimize(usvToRecord(FLAT_10)));
  bench('flat 10 — fast-querystring', () => do_not_optimize(fastquerystring.parse(FLAT_10)));
});

summary(() => {
  bench('flat 50 — @zipbul (nesting:false)', () => do_not_optimize(flatParser.parse(FLAT_50)));
  bench('flat 50 — node:querystring', () => do_not_optimize(querystring.parse(FLAT_50)));
  bench('flat 50 — URLSearchParams→record', () => do_not_optimize(usvToRecord(FLAT_50)));
  bench('flat 50 — fast-querystring', () => do_not_optimize(fastquerystring.parse(FLAT_50)));
});

summary(() => {
  bench('encoded 5 — @zipbul (nesting:false)', () => do_not_optimize(flatParser.parse(ENCODED_5)));
  bench('encoded 5 — node:querystring', () => do_not_optimize(querystring.parse(ENCODED_5)));
  bench('encoded 5 — URLSearchParams→record', () => do_not_optimize(usvToRecord(ENCODED_5)));
  bench('encoded 5 — fast-querystring', () => do_not_optimize(fastquerystring.parse(ENCODED_5)));
});

// ── Full-parser cohort on flat input (bracket-capable) ──
summary(() => {
  bench('flat 10 — @zipbul (nesting:true)', () => do_not_optimize(nestingParser.parse(FLAT_10)));
  bench('flat 10 — qs', () => do_not_optimize(qs.parse(FLAT_10)));
  bench('flat 10 — picoquery', () => do_not_optimize(picoparse(FLAT_10, PICO_INDEX)));
});

// ── Full-parser cohort — nested / array ──
summary(() => {
  bench('nested depth 3 — @zipbul', () => do_not_optimize(nestingParser.parse(NESTED_3)));
  bench('nested depth 3 — qs', () => do_not_optimize(qs.parse(NESTED_3)));
  bench('nested depth 3 — picoquery', () => do_not_optimize(picoparse(NESTED_3, PICO_INDEX)));
});

summary(() => {
  bench('array ×10 — @zipbul', () => do_not_optimize(nestingParser.parse(ARRAY_INDEX_10)));
  bench('array ×10 — qs', () => do_not_optimize(qs.parse(ARRAY_INDEX_10)));
  bench('array ×10 — picoquery', () => do_not_optimize(picoparse(ARRAY_INDEX_10, PICO_INDEX)));
});

// e-commerce: duplicate-key semantics differ across parsers (see parity preview).
// Kept for shape-representative throughput, NOT as an equal-output race.
summary(() => {
  bench('e-commerce — @zipbul', () => do_not_optimize(nestingParser.parse(ECOMMERCE)));
  bench('e-commerce — qs', () => do_not_optimize(qs.parse(ECOMMERCE)));
  bench('e-commerce — picoquery', () => do_not_optimize(picoparse(ECOMMERCE, PICO_INDEX)));
});

// ── + as space (form-urlencoded semantics) ──
summary(() => {
  bench('plus-heavy — @zipbul', () => do_not_optimize(flatParser.parse(PLUS_HEAVY)));
  bench('plus-heavy — qs', () => do_not_optimize(qs.parse(PLUS_HEAVY)));
  bench('plus-heavy — URLSearchParams→record', () => do_not_optimize(usvToRecord(PLUS_HEAVY)));
});

await run();
