import { afterAll, beforeAll } from 'bun:test';
import type { CompiledHandlerEntry, MiddlewareDefinition } from '@zipbul/common';
import { registerBootstrapState } from '@zipbul/core';
import { HttpAdapter, HttpAdapterPhase, HttpAdapterStep } from '@zipbul/http-adapter';
import type { HttpContext } from '@zipbul/http-adapter';
import { isErr } from '@zipbul/result';
import { Tck, type TestApplication } from '@zipbul/tck';

import { compressionMiddleware } from '../../index';
import type { CompressionOptions } from '../../index';

export interface CompressionTestApp {
  testApp: TestApplication;
  port: number;
  url(path: string): string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Bun 확장 `decompress: false`로 자동 해제를 우회해 wire 그대로의 body/헤더를 관찰한다. */
  fetchRaw(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export type RouteHandlers = Record<string, (ctx: HttpContext) => unknown>;

export interface BootCompressionAppExtras {
  priorMiddlewares?: MiddlewareDefinition[];
  /** compression 없이 부팅 (E2E-PL-04) */
  withoutCompression?: boolean;
}

const CONTROLLER_KEY = 'CompressionE2EController';

/** 수동 handlerIndex 엔트리 — AOT 컴파일러가 생성하는 형태를 재현한다.
 *  compiledPre/Post는 adapter-definition.ts의 pipeline에서 core dead-step
 *  (Validation·Guard — 이 컨트롤러엔 없음)을 제거한 것과 동일하다. */
function makeEntry(path: string, methodName: string): CompiledHandlerEntry {
  return {
    id: `HttpAdapter:e2e#${CONTROLLER_KEY}.${methodName}`,
    adapterId: 'HttpAdapter',
    className: CONTROLLER_KEY,
    controllerKey: CONTROLLER_KEY,
    methodName,
    handlerDecorator: 'Get',
    // AOT와 동일하게 선행 슬래시 없는 경로 — route-handler는 '/'를 스스로 prepend한다
    handlerDecoratorArgs: [path.replace(/^\/+/, '')],
    compiledPre: [
      HttpAdapterStep.ResolveRoute,
      HttpAdapterPhase.BeforeParse,
      HttpAdapterStep.ParseBody,
      HttpAdapterPhase.BeforeValidate,
      HttpAdapterPhase.BeforeHandle,
    ],
    compiledPost: [
      HttpAdapterStep.WriteResponse,
      HttpAdapterPhase.AfterHandle,
      HttpAdapterStep.Serialize,
      HttpAdapterPhase.BeforeResponse,
      HttpAdapterPhase.AfterResponse,
    ],
  };
}

export function unwrapMiddleware(opts?: CompressionOptions): MiddlewareDefinition {
  const result = compressionMiddleware(opts);
  if (isErr(result)) {
    throw new Error(`compressionMiddleware setup failed: ${result.data.message}`);
  }
  return result;
}

/** 실제 zipbul 앱을 부팅한다: 수동 handlerIndex 라우트 + BeforeResponse phase의
 *  compression — AOT 앱과 동일한 파이프라인(WriteResponse→AfterHandle→Serialize→
 *  BeforeResponse)을 real wire로 검증하기 위한 것이다. */
export async function bootCompressionApp(
  routes: RouteHandlers,
  opts?: CompressionOptions,
  extras: BootCompressionAppExtras = {},
): Promise<CompressionTestApp> {
  const methodNames = Object.keys(routes);
  const entries = methodNames.map((name, i) => makeEntry(`/${methodNames[i]}`, name));
  const controller: Record<string, (ctx: HttpContext) => unknown> = { ...routes };

  registerBootstrapState({
    handlerIndex: entries,
    controllerFactories: new Map([[CONTROLLER_KEY, () => controller]]),
  });

  let captured: HttpAdapter | undefined;
  const middlewares = extras.withoutCompression === true
    ? [...(extras.priorMiddlewares ?? [])]
    : [...(extras.priorMiddlewares ?? []), unwrapMiddleware(opts)];

  let testApp: TestApplication;
  try {
    testApp = await Tck.createApplication({
      adapterConfig: {
        HttpAdapter: {
          middlewares: {
            [HttpAdapterPhase.BeforeResponse]: middlewares,
          },
        },
      },
      register: (app) => {
        captured = app.attach(HttpAdapter, { port: 0 });
      },
    });
  } catch (error) {
    // 부팅 실패 시에도 전역 handlerIndex가 이후 테스트로 새지 않게 비운다
    clearBootstrapRoutes();
    throw error;
  }

  if (captured === undefined) {
    await testApp.close();
    clearBootstrapRoutes();
    throw new Error('register did not attach HttpAdapter');
  }
  const server = captured.getServer();
  if (server === undefined || typeof server.port !== 'number') {
    await testApp.close();
    clearBootstrapRoutes();
    throw new Error('http server not booted');
  }

  const port = server.port;
  const base = `http://127.0.0.1:${port}`;

  return {
    testApp,
    port,
    url: (path) => `${base}${path}`,
    fetch: (path, init) => fetch(`${base}${path}`, init),
    fetchRaw: (path, init) =>
      fetch(`${base}${path}`, { ...init, decompress: false } as RequestInit),
    close: async () => {
      await testApp.close();
      clearBootstrapRoutes();
    },
  };
}

/** 전역 bootstrap state의 라우트 관련 필드를 비운다 — registerBootstrapState는
 *  생략된 필드를 이전 값으로 보존하므로 명시적으로 빈 값을 등록해야 한다. */
function clearBootstrapRoutes(): void {
  registerBootstrapState({ handlerIndex: [], controllerFactories: new Map() });
}

export function setupSilentLogger(): void {
  beforeAll(() => { Tck.silenceLogger(); });
  afterAll(() => { Tck.restoreLogger(); });
}

export interface RawResponse {
  status: number;
  headers: Record<string, string[]>;
  body: Uint8Array;
}

/** fetch를 우회하는 raw HTTP/1.1 요청 — 다중 field line(E2E-NG-05)·헤더 완전 부재처럼
 *  fetch API가 표현할 수 없는 wire 형태를 전송하고, 응답을 가공 없이 파싱한다. */
export async function rawRequest(
  port: number,
  path: string,
  headerLines: string[],
): Promise<RawResponse> {
  const chunks: Uint8Array[] = [];
  let done: (v: RawResponse) => void;
  let fail: (e: Error) => void;
  const promise = new Promise<RawResponse>((resolve, reject) => { done = resolve; fail = reject; });

  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, data) { chunks.push(new Uint8Array(data)); },
      close() {
        try {
          const total = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
          let off = 0;
          for (const c of chunks) { total.set(c, off); off += c.byteLength; }
          const sep = findHeaderEnd(total);
          const head = new TextDecoder().decode(total.subarray(0, sep));
          const rawLines = head.split('\r\n');
          const statusLine = rawLines[0] ?? '';
          const status = Number.parseInt(statusLine.split(' ')[1] ?? '0', 10);
          // RFC 9112 §5.2 obs-fold: SP/HTAB로 시작하는 라인은 직전 field line의 연속
          const lines: string[] = [];
          for (const line of rawLines.slice(1)) {
            if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
              lines[lines.length - 1] += ` ${line.trim()}`;
            } else {
              lines.push(line);
            }
          }
          const headers: Record<string, string[]> = {};
          for (const line of lines) {
            const idx = line.indexOf(':');
            if (idx < 0) continue;
            const name = line.slice(0, idx).trim().toLowerCase();
            const value = line.slice(idx + 1).trim();
            (headers[name] ??= []).push(value);
          }
          let body: Uint8Array = total.subarray(sep + 4);
          if ((headers['transfer-encoding'] ?? []).some((v) => v.toLowerCase().includes('chunked'))) {
            body = dechunk(body);
          }
          done({ status, headers, body });
        } catch (e) {
          fail(e as Error);
        }
      },
      error(_socket, error) { fail(error); },
    },
  });

  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headerLines.map((l) => `${l}\r\n`).join('')}Connection: close\r\n\r\n`);
  socket.flush();
  return promise;
}

function findHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.byteLength; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  throw new Error('malformed HTTP response: no header terminator');
}

function dechunk(body: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < body.byteLength) {
    let lineEnd = i;
    while (lineEnd + 1 < body.byteLength && !(body[lineEnd] === 13 && body[lineEnd + 1] === 10)) lineEnd++;
    const sizeHex = new TextDecoder().decode(body.subarray(i, lineEnd)).split(';')[0] ?? '';
    if (!/^[0-9a-fA-F]+$/.test(sizeHex)) {
      throw new Error(`malformed chunk-size line: ${JSON.stringify(sizeHex)}`);
    }
    const size = Number.parseInt(sizeHex, 16);
    if (size === 0) break; // last-chunk — trailer는 이 테스트 파서의 관심 밖
    const start = lineEnd + 2;
    if (start + size + 2 > body.byteLength) {
      throw new Error('truncated chunk: data exceeds buffer');
    }
    for (let j = start; j < start + size; j++) out.push(body[j]!);
    // RFC 9112 §7.1: chunk-data 뒤에는 반드시 CRLF
    if (!(body[start + size] === 13 && body[start + size + 1] === 10)) {
      throw new Error('malformed chunk: missing CRLF after chunk-data');
    }
    i = start + size + 2;
  }
  return new Uint8Array(out);
}

export const LARGE_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
export const LARGE_OBJ = { data: 'x'.repeat(2048), items: Array.from({ length: 32 }, (_, i) => ({ i })) };
