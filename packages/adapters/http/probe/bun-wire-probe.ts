#!/usr/bin/env bun
/**
 * bun-wire-probe — Bun HTTP 서버의 wire 내부처리 계측기.
 *
 * ⚠️ 이것은 테스트가 아니다. 단언(assert)이 없다.
 * Bun.serve가 *실제로* 무엇을 하는지 raw TCP로 손수 만든 HTTP/1.1 바이트를
 * 직접 흘려보내 관찰하고, "사실 기록(baseline)"을 만든다. SPEC §1.1의
 * "Bun이 보장" 항목은 기억이 아니라 이 측정 결과를 근거로 삼는다.
 *
 * fetch()/Request로는 malformed wire를 만들 수 없으므로(전송 전 정규화·거부),
 * 반드시 raw 소켓(Bun.connect)으로 바이트를 직접 써야 한다.
 *
 * 측정 범위 = "Bun이 핸들러 dispatch *전·시점*에 무엇을 하는가". 핸들러는
 * body를 읽지 않는다 — body 스트림 abort-on-read는 타이밍 의존이라 이 입력
 * 프로브의 결정적 범위 밖이며, 별도 측정 대상이다(README 참조).
 *
 * 실행:
 *   bun probe/bun-wire-probe.ts            # 측정 결과 출력
 *   bun probe/bun-wire-probe.ts --write    # baseline.json 갱신(의도적 스냅샷)
 *
 * 판정(verdict):
 *   BUN_REJECTED   핸들러 미도달 + Bun이 명확한 4xx/5xx로 거부
 *   REACHED_RAW    핸들러까지 도달(dispatch됨)
 *   INCONCLUSIVE   미도달 + 무응답/타임아웃 — *거부로 단정하지 않는다*
 *
 * 도달 판정은 핸들러가 per-case nonce(`X-Probe-Case`)를 seen Map에 기록하는
 * 것으로 한다(wire 응답의 부산물이 아니라 핸들러 dispatch 자체가 증거).
 * 핸들러는 동기 반환이라 pending async도 공유 가변 상태도 없다.
 *
 * baseline은 케이스별 {id, label, verdict, signal}을 저장하고, drift는 그중
 * (label, verdict, signal)을 비교한다 — signal은 케이스별 정규화된 *결정적*
 * 사실 문자열이라 verdict가 같아도 세부 회귀(상태코드·100-continue·Date 소실·
 * Host comma-join·authority)를 drift가 잡는다.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import type { Socket } from 'bun';

export const BUN_VERSION = Bun.version;
export const PLATFORM = `${process.platform}-${process.arch}`;

export type Verdict = 'BUN_REJECTED' | 'REACHED_RAW' | 'INCONCLUSIVE';
export type Label = 'bun-should-reject' | 'known-passthrough' | 'behavior';

export interface ProbeResult {
  id: string;
  label: Label;
  verdict: Verdict;
  /** 정규화된 결정적 사실 — drift guard가 비교하는 값. */
  signal: string;
  /** 사람 디버그용(baseline 미저장). */
  evidence: Record<string, unknown>;
}

/** 핸들러가 dispatch 시점에 관찰한 요청 사실. 도달했을 때만 존재한다. */
interface Observed {
  url: string;
  method: string;
  /** raw `Host` 헤더(다중 Host면 comma-join). req.url authority와 다를 수 있다. */
  host: string | null;
  contentLength: string | null;
}

interface ProbeCase {
  id: string;
  label: Label;
  desc: string;
  request: string;
}

interface RawResponse {
  raw: string;
  closed: boolean;
  timedOut: boolean;
}

const CRLF = '\r\n';

/** 요청 바이트 빌더: 요청라인 + 헤더들 + 빈 줄 + 바디. */
function buildRequest(requestLine: string, headers: readonly string[], body = ''): string {
  return [requestLine, ...headers, '', body].join(CRLF);
}

/** 표준 헤더(Host, per-case nonce, Connection: close)를 붙인다. */
function withStd(id: string, extra: readonly string[]): string[] {
  return ['Host: probe', `X-Probe-Case: ${id}`, ...extra, 'Connection: close'];
}

const CASES: ProbeCase[] = [
  {
    id: '1.1.1/bad-method-token',
    label: 'bun-should-reject',
    desc: '메서드 토큰에 비-tchar(`{`)',
    request: buildRequest('GE{T / HTTP/1.1', withStd('1.1.1/bad-method-token', [])),
  },
  {
    id: '1.1.2/dup-cl-same-value',
    label: 'bun-should-reject',
    desc: '중복 Content-Length(동일값 5,5)',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.2/dup-cl-same-value', ['Content-Length: 5', 'Content-Length: 5']),
      'hello',
    ),
  },
  {
    id: '1.1.2/dup-cl-diff-value',
    label: 'bun-should-reject',
    desc: '중복 Content-Length(상이값 5 vs 6) — RFC 9112 §6.3.3 MUST reject',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.2/dup-cl-diff-value', ['Content-Length: 5', 'Content-Length: 6']),
      'hello',
    ),
  },
  {
    id: '1.1.2/nonnumeric-cl',
    label: 'bun-should-reject',
    desc: '비숫자 Content-Length',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.2/nonnumeric-cl', ['Content-Length: abc']),
      'hello',
    ),
  },
  {
    id: '1.1.2/negative-cl',
    label: 'bun-should-reject',
    desc: '음수 Content-Length',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.2/negative-cl', ['Content-Length: -1']),
      'hello',
    ),
  },
  {
    id: '1.1.2/te-cl-smuggling',
    label: 'bun-should-reject',
    desc: 'Transfer-Encoding + Content-Length 동시 (smuggling)',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.2/te-cl-smuggling', ['Content-Length: 6', 'Transfer-Encoding: chunked']),
      '0' + CRLF,
    ),
  },
  {
    id: '1.1.3/bare-cr',
    label: 'bun-should-reject',
    desc: '헤더 값 내 bare CR',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.3/bare-cr', ['X-Bad: a\rb'])),
  },
  {
    id: '1.1.3/bare-lf',
    label: 'bun-should-reject',
    desc: '헤더 값 내 bare LF(CR 없는 LF — 불법 line terminator)',
    request:
      'GET / HTTP/1.1' + CRLF + 'Host: probe' + CRLF +
      'X-Probe-Case: 1.1.3/bare-lf' + CRLF + 'X-Bad: a\nb' + CRLF +
      'Connection: close' + CRLF + CRLF,
  },
  {
    id: '1.1.3/nul-in-header',
    label: 'bun-should-reject',
    desc: '헤더 값 내 NUL(U+0000)',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.3/nul-in-header', ['X-Bad: a\x00b'])),
  },
  {
    id: '1.1.3/obs-fold',
    label: 'bun-should-reject',
    desc: 'obs-fold(접힌 헤더 라인)',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.3/obs-fold', ['X-Fold: one', ' two'])),
  },
  {
    id: '1.1.3/non-tchar-field-name',
    label: 'bun-should-reject',
    desc: '필드명에 공백(비-tchar)',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.3/non-tchar-field-name', ['X Bad: 1'])),
  },
  {
    id: '1.1.4/incomplete-body',
    label: 'bun-should-reject',
    desc: 'Content-Length=100 선언, 5바이트만 전송 — Bun이 dispatch 전 abort하나',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.4/incomplete-body', ['Content-Length: 100']),
      'hello',
    ),
  },
  {
    id: '1.1.4/expect-100-continue',
    label: 'behavior',
    desc: 'Expect: 100-continue 에 100 Continue 자동 응답하나',
    request: buildRequest(
      'POST / HTTP/1.1',
      withStd('1.1.4/expect-100-continue', ['Expect: 100-continue', 'Content-Length: 5']),
      'hello',
    ),
  },
  {
    id: '1.1.5/oversized-header',
    label: 'bun-should-reject',
    desc: '과대 헤더(100KB) — 버전/설정 의존(§6)',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.5/oversized-header', ['X-Big: ' + 'a'.repeat(100_000)])),
  },
  {
    id: '1.1.5/bad-request-target',
    label: 'bun-should-reject',
    desc: 'request-target에 control char(거부 — Bun은 505로 응답)',
    request: buildRequest('GET /a\x01b HTTP/1.1', withStd('1.1.5/bad-request-target', [])),
  },
  {
    id: '1.1.6/date-generation',
    label: 'behavior',
    desc: '정상 요청 응답에 Date 헤더 자동 생성',
    request: buildRequest('GET / HTTP/1.1', withStd('1.1.6/date-generation', [])),
  },
  {
    id: '1.2.1/absolute-form',
    label: 'known-passthrough',
    desc: 'absolute-form request-target는 핸들러까지 통과(양성대조)',
    request: buildRequest('GET http://evil.example/ HTTP/1.1', withStd('1.2.1/absolute-form', [])),
  },
  {
    id: '1.2.2/multi-host-comma',
    label: 'known-passthrough',
    desc: '다중 Host 헤더 — Bun이 거부하나 통과시키나(어댑터는 comma-join 거부 책임 §3.C)',
    request:
      'GET / HTTP/1.1' + CRLF + 'Host: a.example' + CRLF + 'Host: b.example' + CRLF +
      'X-Probe-Case: 1.2.2/multi-host-comma' + CRLF + 'Connection: close' + CRLF + CRLF,
  },
];

function sendRaw(port: number, bytes: string, timeoutMs = 1500): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    let sock: Socket<undefined> | undefined;

    const finish = (timedOut: boolean, closed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        sock?.end();
      } catch {
        /* already closed */
      }
      resolve({ raw: Buffer.concat(chunks).toString('latin1'), closed, timedOut });
    };

    const timer = setTimeout(() => finish(true, false), timeoutMs);

    Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(socket): void {
          sock = socket;
          socket.write(bytes);
        },
        data(_socket, data): void {
          chunks.push(data);
        },
        close(): void {
          finish(false, true);
        },
        error(): void {
          finish(false, true);
        },
      },
    }).catch(() => finish(false, true));
  });
}

function parseStatus(raw: string): number {
  return Number.parseInt(raw.split(CRLF)[0]?.split(' ')[1] ?? '', 10);
}

/** req.url의 authority(host[:port]) — absolute-form/다중 Host 신뢰 사실을 signal에 박기 위함. */
function authorityOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '?';
  }
}

function classify(c: ProbeCase, obs: Observed | undefined, res: RawResponse): ProbeResult {
  const firstLine = res.raw.split(CRLF)[0] ?? '';
  const status = parseStatus(res.raw);
  const reached = obs !== undefined;

  // behavior 프로브: 측정 사실을 signal에 인코딩(도달은 nonce로 검증).
  if (c.label === 'behavior') {
    if (c.id.startsWith('1.1.6')) {
      const datePresent = /\r\ndate:/i.test(res.raw);
      return {
        id: c.id,
        label: c.label,
        verdict: reached ? 'REACHED_RAW' : 'INCONCLUSIVE',
        signal: `reached:${reached}|date:${datePresent}`,
        evidence: { reached, datePresent, status, firstLine },
      };
    }
    if (c.id.startsWith('1.1.4/expect')) {
      const has100 = /HTTP\/1\.1 100\b/.test(res.raw);
      return {
        id: c.id,
        label: c.label,
        verdict: reached ? 'REACHED_RAW' : 'INCONCLUSIVE',
        signal: `reached:${reached}|100-continue:${has100}`,
        evidence: { reached, continue100: has100, status, firstLine },
      };
    }
  }

  // 핸들러 도달(dispatch됨). authority는 신뢰 경계 사실이라 signal에 박는다.
  if (obs !== undefined) {
    return {
      id: c.id,
      label: c.label,
      verdict: 'REACHED_RAW',
      signal:
        `reached|status:${Number.isFinite(status) ? status : '?'}` +
        `|urlhost:${authorityOf(obs.url)}|hdrhost:${obs.host ?? '-'}` +
        `|cl:${obs.contentLength ?? '-'}`,
      evidence: { status, observed: obs },
    };
  }

  // 미도달 + 명확한 4xx/5xx → 거부.
  if (Number.isFinite(status) && status >= 400) {
    return {
      id: c.id,
      label: c.label,
      verdict: 'BUN_REJECTED',
      signal: `rejected|status:${status}`,
      evidence: { status, firstLine },
    };
  }

  // 미도달 + 무응답/타임아웃 → 불확정(거부로 단정하지 않는다).
  return {
    id: c.id,
    label: c.label,
    verdict: 'INCONCLUSIVE',
    signal:
      `inconclusive|status:${Number.isFinite(status) ? status : '?'}` +
      `|timedOut:${res.timedOut}|closed:${res.closed}`,
    evidence: { firstLine, timedOut: res.timedOut, closed: res.closed, rawLen: res.raw.length },
  };
}

export async function runProbes(): Promise<ProbeResult[]> {
  const seen = new Map<string, Observed>();

  const server = Bun.serve({
    port: 0,
    // 동기 반환 — body를 읽지 않는다(pending async·hang 없음). dispatch 시점의
    // 요청 사실만 nonce 키로 기록한다.
    fetch(req): Response {
      const caseId = req.headers.get('x-probe-case') ?? '(none)';
      seen.set(caseId, {
        url: req.url,
        method: req.method,
        host: req.headers.get('host'),
        contentLength: req.headers.get('content-length'),
      });
      return new Response('ok', { headers: { 'x-probe-reached': '1' } });
    },
  });

  const port = server.port;
  if (port === undefined) {
    server.stop(true);
    throw new Error('probe: Bun.serve did not expose a TCP port');
  }

  const results: ProbeResult[] = [];
  try {
    for (const c of CASES) {
      const res = await sendRaw(port, c.request);
      results.push(classify(c, seen.get(c.id), res));
    }
  } finally {
    server.stop(true);
  }
  return results;
}

if (import.meta.main) {
  const results = await runProbes();

  console.log(`Bun ${BUN_VERSION} (${PLATFORM}) — wire probe (${results.length} cases)\n`);
  for (const r of results) {
    console.log(`${r.verdict.padEnd(14)} ${r.id.padEnd(30)} ${r.signal}`);
  }

  const baseline = {
    bunVersion: BUN_VERSION,
    platform: PLATFORM,
    cases: results.map(({ id, label, verdict, signal }) => ({ id, label, verdict, signal })),
  };
  const baselinePath = new URL('./bun-wire.baseline.json', import.meta.url).pathname;

  if (process.argv.includes('--write')) {
    await Bun.write(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nbaseline written → ${baselinePath}`);
  } else {
    console.log('\n(--write 로 baseline.json 스냅샷을 의도적으로 갱신)');
  }
}
