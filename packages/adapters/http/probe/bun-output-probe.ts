#!/usr/bin/env bun
/**
 * bun-output-probe — Bun HTTP 서버의 *출력측* framing 계측기.
 *
 * 짝: bun-wire-probe.ts(입력측 거부/통과). 이건 SPEC §3.A "응답 framing 정합"이
 * 주장하는 Bun 동작을 실측한다 — 핸들러가 조작된 Response를 반환하거나 HEAD/
 * null-body status를 만들 때 Bun이 wire에 무엇을 내보내는가(또는 던지는가).
 * 테스트 아님(단언 없음). raw TCP로 응답 바이트를 직접 받아 관찰한다.
 *
 * 실행: bun probe/bun-output-probe.ts
 */

import { Buffer } from 'node:buffer';
import type { Socket } from 'bun';

const CRLF = '\r\n';

interface ParsedResponse {
  statusLine: string;
  headers: Record<string, string>;
  body: string;
}

interface OutCase {
  id: string;
  method: 'GET' | 'HEAD';
  desc: string;
}

const CASES: OutCase[] = [
  { id: '3A/head-body-strip', method: 'HEAD', desc: 'HEAD 응답 body 제거 + CL은 GET 본문 길이' },
  { id: '3A/cl-auto', method: 'GET', desc: 'CL 미설정 시 Bun이 Content-Length 자동 산출' },
  { id: '3A/null-body-204-construct', method: 'GET', desc: '204 + body로 Response 생성 시 throw하나' },
  { id: '3A/null-body-205-construct', method: 'GET', desc: '205 + body Response 생성 throw하나' },
  { id: '3A/null-body-304-construct', method: 'GET', desc: '304 + body Response 생성 throw하나' },
  { id: '3A/null-body-101-construct', method: 'GET', desc: '101 + body Response 생성 throw하나' },
  { id: '3A/hop-by-hop-connection', method: 'GET', desc: '핸들러가 Connection/Keep-Alive 설정 시 wire에 남나' },
  { id: '3A/hop-by-hop-te', method: 'GET', desc: '핸들러가 Transfer-Encoding 설정 시 wire 처리' },
  { id: '3A/date-override', method: 'GET', desc: '핸들러가 Date 설정 시 Bun이 유지하나 덮나' },
];

const handlerThrew = new Map<string, boolean>();

function tryNullBody(id: string, status: number): void {
  try {
    // eslint-disable-next-line no-new
    new Response('body', { status });
    handlerThrew.set(id, false);
  } catch {
    handlerThrew.set(id, true);
  }
}

function makeResponse(id: string): Response {
  switch (id) {
    case '3A/head-body-strip':
    case '3A/cl-auto':
      return new Response('hello', { headers: { 'content-type': 'text/plain' } });
    case '3A/null-body-204-construct':
      tryNullBody(id, 204);
      return new Response('ok');
    case '3A/null-body-205-construct':
      tryNullBody(id, 205);
      return new Response('ok');
    case '3A/null-body-304-construct':
      tryNullBody(id, 304);
      return new Response('ok');
    case '3A/null-body-101-construct':
      tryNullBody(id, 101);
      return new Response('ok');
    case '3A/hop-by-hop-connection':
      return new Response('ok', { headers: { connection: 'close', 'keep-alive': 'timeout=5' } });
    case '3A/hop-by-hop-te':
      return new Response('ok', { headers: { 'transfer-encoding': 'chunked' } });
    case '3A/date-override':
      return new Response('ok', { headers: { date: 'Thu, 01 Jan 1970 00:00:00 GMT' } });
    default:
      return new Response('ok');
  }
}

function parseResponse(raw: string): ParsedResponse {
  const sep = raw.indexOf(CRLF + CRLF);
  const head = sep === -1 ? raw : raw.slice(0, sep);
  const body = sep === -1 ? '' : raw.slice(sep + 4);
  const lines = head.split(CRLF);
  const statusLine = lines[0] ?? '';
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) {
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  return { statusLine, headers, body };
}

function sendRaw(port: number, bytes: string, timeoutMs = 1000): Promise<string> {
  return new Promise<string>((resolve) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    let sock: Socket<undefined> | undefined;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        sock?.end();
      } catch {
        /* closed */
      }
      resolve(Buffer.concat(chunks).toString('latin1'));
    };
    const timer = setTimeout(finish, timeoutMs);
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
        close: finish,
        error: finish,
      },
    }).catch(finish);
  });
}

function signalFor(c: OutCase, r: ParsedResponse): string {
  const h = r.headers;
  switch (c.id) {
    case '3A/head-body-strip':
      return `status:${r.statusLine}|bodyLen:${r.body.length}|cl:${h['content-length'] ?? '-'}`;
    case '3A/cl-auto':
      return `cl:${h['content-length'] ?? '-'}|bodyLen:${r.body.length}`;
    case '3A/null-body-204-construct':
    case '3A/null-body-205-construct':
    case '3A/null-body-304-construct':
    case '3A/null-body-101-construct':
      return `construct-threw:${handlerThrew.get(c.id) ?? '?'}`;
    case '3A/hop-by-hop-connection':
      return `connection:${h['connection'] ?? '-'}|keep-alive:${h['keep-alive'] ?? '-'}`;
    case '3A/hop-by-hop-te':
      return `transfer-encoding:${h['transfer-encoding'] ?? '-'}|cl:${h['content-length'] ?? '-'}|bodyLen:${r.body.length}`;
    case '3A/date-override':
      return `date:${h['date'] ?? '-'}`;
    default:
      return r.statusLine;
  }
}

const server = Bun.serve({
  port: 0,
  fetch(req): Response {
    return makeResponse(req.headers.get('x-probe-case') ?? '(none)');
  },
});

const port = server.port;
if (port === undefined) {
  server.stop(true);
  throw new Error('output-probe: no port');
}

console.log(`Bun ${Bun.version} — output framing probe (§3.A)\n`);
try {
  for (const c of CASES) {
    const reqBytes =
      `${c.method} / HTTP/1.1` + CRLF + 'Host: probe' + CRLF +
      `X-Probe-Case: ${c.id}` + CRLF + 'Connection: close' + CRLF + CRLF;
    const raw = await sendRaw(port, reqBytes);
    console.log(`${c.id.padEnd(32)} ${signalFor(c, parseResponse(raw))}`);
  }
} finally {
  server.stop(true);
}
