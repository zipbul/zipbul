/**
 * Micro-benchmarks for @zipbul/compression (Bun + mitata). Run: `bun run bench`.
 *
 * Scope is HONEST (see bench/PLAN.md): the dominant cost — codec compression — is the
 * Bun/node:zlib LIBRARY, NOT our code, so it is flagged "library" and never used to claim
 * "best-in-class". What IS ours and measured here: Accept-Encoding negotiation, serialize,
 * orchestration overhead (reported as a DELTA over the codec + harness baseline), BREACH
 * padding, and wrapper-vs-raw (should be ≈0). Payloads are realistic/compressible (NOT the
 * degenerate `'a'.repeat` corpus from the test helpers). Dev-only, not shipped.
 */
import { bench, boxplot, do_not_optimize, run, summary } from 'mitata';
import { deflateSync } from 'node:zlib';

import { compressionMiddleware } from '../index';
import { BUFFER_COMPRESSORS } from '../src/compressors';
import { parseAcceptEncoding, negotiateEncoding } from '../src/encoding';
import { serializeBody } from '../src/serialize';
import { injectGzipPadding, injectZstdPadding } from '../src/htb';
import { compressStream } from '../src/streaming';
import { CompressionCodec } from '../src/enums';
import { DEFAULT_LEVELS } from '../src/constants';
import { drainStream, makeRequestHeaders, mockContext, mockHttpResponse, streamOf, unwrap } from '../test/integration/helpers';

// ── Realistic, compressible payloads (varied values → ~5-10:1, not degenerate 1000:1) ──

function jsonPayload(targetBytes: number): string {
  const items: unknown[] = [];
  let s = '[]';
  let i = 0;
  while (s.length < targetBytes) {
    items.push({
      id: i,
      name: `user_${i}`,
      email: `user${i}@example.com`,
      active: i % 2 === 0,
      score: (i * 37) % 100,
      tags: ['alpha', 'beta', 'gamma', 'delta'].slice(0, (i % 4) + 1),
      note: `record ${i} created at step ${(i * 7) % 1000}`,
    });
    s = JSON.stringify(items);
    i++;
  }
  return s;
}

function prosePayload(targetBytes: number): string {
  const words = 'the quick brown fox jumps over a lazy dog while parsing http headers and negotiating content codings'.split(' ');
  let s = '';
  let i = 0;
  while (s.length < targetBytes) {
    s += words[i % words.length] + (i % 12 === 11 ? '.\n' : ' ');
    i++;
  }
  return s;
}

const enc = new TextEncoder();

const JSON_1K = jsonPayload(1024);
const JSON_10K = jsonPayload(10_240);
const JSON_100K = jsonPayload(102_400);
const PROSE_10K = prosePayload(10_240);

const B_JSON_1K = enc.encode(JSON_1K);
const B_JSON_10K = enc.encode(JSON_10K);
const B_JSON_100K = enc.encode(JSON_100K);
const OBJ_10K = JSON.parse(JSON_10K) as object;

const { Gzip, Br, Deflate, Zstd } = CompressionCodec;
const ratio = (inN: number, out: number) => (inN / out).toFixed(1);

// Report compression ratios once (context for the library numbers).
console.log('# payload ratios (input:compressed, gzip level 6)');
for (const [name, b] of [['json1k', B_JSON_1K], ['json10k', B_JSON_10K], ['json100k', B_JSON_100K]] as const) {
  const out = Bun.gzipSync(b, { level: 6 });
  console.log(`#   ${name}: ${b.byteLength}B → ${out.byteLength}B  (${ratio(b.byteLength, out.byteLength)}:1)`);
}

// Warm up: seal the baker once so factory group measures steady-state validateSync, not the one-shot seal.
do_not_optimize(compressionMiddleware());

// Pre-built middleware handler (immutable) — response is rebuilt PER ITERATION (it is mutated).
const mwDefault = unwrap(compressionMiddleware()).handler;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ BENCHMARKS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Factory cost (OUR code: baker validateSync) ──
boxplot(() => {
  bench('create() — default', () => { do_not_optimize(compressionMiddleware()); }).gc('inner');
  bench('create() — full custom', () => {
    do_not_optimize(compressionMiddleware({ encodings: [Br, Gzip, Deflate, Zstd], threshold: 512, level: { gzip: 7, br: 6, deflate: 5, zstd: 12 } }));
  }).gc('inner');
  bench('create() — breach', () => { do_not_optimize(compressionMiddleware({ breach: { maxPadding: 256 } })); }).gc('inner');
});

// ── 2. Accept-Encoding negotiation (OUR code) ──
const SERVER = [Br, Gzip];
summary(() => {
  bench('negotiate — simple "gzip"', () => { do_not_optimize(negotiateEncoding(SERVER, parseAcceptEncoding('gzip'))); });
  bench('negotiate — multi+q', () => { do_not_optimize(negotiateEncoding(SERVER, parseAcceptEncoding('gzip;q=0.8, br;q=1.0, deflate;q=0.5'))); });
  bench('negotiate — wildcard', () => { do_not_optimize(negotiateEncoding(SERVER, parseAcceptEncoding('*'))); });
  bench('negotiate — browser real', () => { do_not_optimize(negotiateEncoding(SERVER, parseAcceptEncoding('gzip, deflate, br, zstd'))); });
  bench('negotiate — no match (identity)', () => { do_not_optimize(negotiateEncoding(SERVER, parseAcceptEncoding('identity'))); });
});

// ── 3. serialize-only (OUR code) ──
summary(() => {
  bench('serialize — string 10KB', () => { do_not_optimize(serializeBody(JSON_10K)); });
  bench('serialize — Uint8Array passthrough', () => { do_not_optimize(serializeBody(B_JSON_10K)); });
  bench('serialize — JSON object 10KB', () => { do_not_optimize(serializeBody(OBJ_10K)); });
});

// ── 4. codec-only — ⚠ LIBRARY (Bun/node:zlib), NOT our merit ──
summary(() => {
  bench('gzip 10KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Gzip](B_JSON_10K, DEFAULT_LEVELS[Gzip])); });
  bench('br 10KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Br](B_JSON_10K, DEFAULT_LEVELS[Br])); });
  bench('deflate 10KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Deflate](B_JSON_10K, DEFAULT_LEVELS[Deflate])); });
  bench('zstd 10KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Zstd](B_JSON_10K, DEFAULT_LEVELS[Zstd])); });
});
summary(() => {
  bench('gzip 1KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Gzip](B_JSON_1K, DEFAULT_LEVELS[Gzip])); });
  bench('gzip 100KB [library]', () => { do_not_optimize(BUFFER_COMPRESSORS[Gzip](B_JSON_100K, DEFAULT_LEVELS[Gzip])); });
});

// ── 5. wrapper overhead — OUR wrapper vs the SAME underlying lib (should be ≈0) ──
summary(() => {
  bench('gzip — @zipbul wrapper', () => { do_not_optimize(BUFFER_COMPRESSORS[Gzip](B_JSON_10K, 6)); });
  bench('gzip — Bun.gzipSync direct', () => { do_not_optimize(Bun.gzipSync(B_JSON_10K, { level: 6 })); });
});
summary(() => {
  bench('deflate — @zipbul wrapper', () => { do_not_optimize(BUFFER_COMPRESSORS[Deflate](B_JSON_10K, 6)); });
  bench('deflate — node:zlib.deflateSync direct', () => { do_not_optimize(deflateSync(B_JSON_10K, { level: 6 })); });
});

// ── 6. Orchestration hot path — OUR code = (full − harness − codec). Response reset per iter. ──
summary(() => {
  bench('harness baseline (mock only)', () => {
    const r = mockHttpResponse({ body: JSON_10K, contentType: 'application/json' });
    do_not_optimize(mockContext({ headers: makeRequestHeaders('gzip') }, r));
  });
  bench('full pipeline — 10KB compress', () => {
    const r = mockHttpResponse({ body: JSON_10K, contentType: 'application/json' });
    mwDefault(mockContext({ headers: makeRequestHeaders('gzip') }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
  bench('skip — no Accept-Encoding', () => {
    const r = mockHttpResponse({ body: JSON_10K, contentType: 'application/json' });
    mwDefault(mockContext({ headers: makeRequestHeaders(undefined) }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
  bench('skip — filtered content-type (image/png)', () => {
    const r = mockHttpResponse({ body: JSON_10K, contentType: 'image/png' });
    mwDefault(mockContext({ headers: makeRequestHeaders('gzip') }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
});
summary(() => {
  bench('full pipeline — 1KB', () => {
    const r = mockHttpResponse({ body: JSON_1K, contentType: 'application/json' });
    mwDefault(mockContext({ headers: makeRequestHeaders('gzip') }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
  bench('full pipeline — 100KB', () => {
    const r = mockHttpResponse({ body: JSON_100K, contentType: 'application/json' });
    mwDefault(mockContext({ headers: makeRequestHeaders('gzip') }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
});

// ── 7. inflation guard — payload that compresses but does NOT shrink (compress-then-discard) ──
const INCOMPRESSIBLE = Bun.gzipSync(B_JSON_10K, { level: 6 }); // already-compressed bytes as a body
summary(() => {
  bench('inflation guard — incompressible body (skip after compress)', () => {
    const r = mockHttpResponse({ body: INCOMPRESSIBLE, contentType: 'application/octet-stream' });
    mwDefault(mockContext({ headers: makeRequestHeaders('gzip') }, r));
    do_not_optimize(r.getHeader('content-encoding'));
  });
});

// ── 8. BREACH padding (OUR htb code; CSPRNG draw included) — pre-compressed once, pad a copy ──
const PRE_GZIP = Bun.gzipSync(B_JSON_10K, { level: 6 });
const PRE_ZSTD = Bun.zstdCompressSync(B_JSON_10K, { level: 3 });
summary(() => {
  bench('gzip padding — maxPad 16', () => { do_not_optimize(injectGzipPadding(PRE_GZIP, 16)); });
  bench('gzip padding — maxPad 256', () => { do_not_optimize(injectGzipPadding(PRE_GZIP, 256)); });
  bench('gzip padding — maxPad 4096', () => { do_not_optimize(injectGzipPadding(PRE_GZIP, 4096)); });
  bench('zstd padding — maxPad 256', () => { do_not_optimize(injectZstdPadding(PRE_ZSTD, 256)); });
});

// ── 9. streaming — OUR stream orchestration (codec = runtime CompressionStream) ──
summary(() => {
  bench('stream compress+drain — 10KB gzip', async () => {
    do_not_optimize(await drainStream(compressStream(streamOf(JSON_10K), Gzip)));
  });
  bench('stream compress+drain — 100KB gzip', async () => {
    do_not_optimize(await drainStream(compressStream(streamOf(JSON_100K), Gzip)));
  });
  bench('stream compress+drain — 10KB br', async () => {
    do_not_optimize(await drainStream(compressStream(streamOf(PROSE_10K), Br)));
  });
});

await run();
