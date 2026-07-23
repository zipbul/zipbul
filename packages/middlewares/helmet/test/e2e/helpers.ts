import { afterAll, beforeAll } from 'bun:test';

import { registerBootstrapState } from '@zipbul/core';
import { Tck } from '@zipbul/tck';
import { HttpAdapter, HttpAdapterPhase, HttpAdapterStep } from '@zipbul/http-adapter';

import type { CompiledHandlerEntry, MiddlewareDefinition } from '@zipbul/common';
import type { HttpContext } from '@zipbul/http-adapter';
import type { TestApplication } from '@zipbul/tck';

import { helmetMiddleware } from '../../index';

import type { HelmetOptions } from '../../index';

export interface HelmetTestApp {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export type RouteHandlers = Record<string, (ctx: HttpContext) => unknown>;

export interface BootHelmetAppExtras {
  /** Registered before helmet in the `OnRequest` phase. */
  prior?: MiddlewareDefinition[];
  /** Registered after helmet in the `OnRequest` phase. */
  subsequent?: MiddlewareDefinition[];
}

const CONTROLLER_KEY = 'HelmetE2EController';

/** 수동 handlerIndex 엔트리 — AOT 컴파일러가 생성하는 형태를 재현한다
 *  (compression `test/e2e/helpers.ts` 선례와 동일한 모양). */
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

/**
 * Boots a real zipbul app: manual handlerIndex routes (so `ok`/`redirect`
 * shapes go through the actual `WriteResponse → Serialize` path, not a
 * terminal middleware `send()`) + helmet at the `OnRequest` phase — the phase
 * it actually registers at, unlike compression's `BeforeResponse` precedent.
 * `prior`/`subsequent` let tests place other `OnRequest` middlewares around
 * helmet (ordering, error-status, throw).
 */
export async function bootHelmetApp(
  routes: RouteHandlers,
  opts?: Partial<HelmetOptions>,
  extras: BootHelmetAppExtras = {},
): Promise<HelmetTestApp> {
  const methodNames = Object.keys(routes);
  const entries = methodNames.map((name) => makeEntry(`/${name}`, name));
  const controller: Record<string, (ctx: HttpContext) => unknown> = { ...routes };

  registerBootstrapState({
    handlerIndex: entries,
    controllerFactories: new Map([[CONTROLLER_KEY, () => controller]]),
  });

  const middlewares: MiddlewareDefinition[] = [
    ...(extras.prior ?? []),
    helmetMiddleware(opts),
    ...(extras.subsequent ?? []),
  ];

  let captured: HttpAdapter | undefined;
  let testApp: TestApplication;
  try {
    testApp = await Tck.createApplication({
      adapterConfig: {
        HttpAdapter: {
          middlewares: {
            [HttpAdapterPhase.OnRequest]: middlewares,
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

  // Every teardown path — the two boot-sanity failures below and the returned
  // close() — closes the app then clears routes, and a throwing close() must
  // never skip the clear (it would leak this app's routes into the next test's
  // boot). One helper owns that finally-guaranteed order.
  const closeAndClear = async (): Promise<void> => {
    try {
      await testApp.close();
    } finally {
      clearBootstrapRoutes();
    }
  };

  if (captured === undefined) {
    await closeAndClear();
    throw new Error('register did not attach HttpAdapter');
  }
  const server = captured.getServer();
  if (server === undefined || typeof server.port !== 'number') {
    await closeAndClear();
    throw new Error('http server not booted');
  }

  const base = `http://127.0.0.1:${server.port}`;

  return {
    fetch: (path, init) => fetch(`${base}${path}`, init),
    close: closeAndClear,
  };
}

/** 전역 bootstrap state의 라우트 관련 필드를 비운다 — registerBootstrapState는
 *  생략된 필드를 이전 값으로 보존하므로 명시적으로 빈 값을 등록해야 한다. */
function clearBootstrapRoutes(): void {
  registerBootstrapState({ handlerIndex: [], controllerFactories: new Map() });
}

/**
 * Silences the logger for the suite and owns booted-app teardown so the two
 * happen in the right order: every app is closed *inside* the silenced window,
 * then the logger is restored. Registering `afterAll(close)` separately in each
 * file raced this — restore ran first and the adapter's "Server stopped" logs
 * leaked. `apps` is closed in reverse boot order.
 */
export function setupSilentLogger(apps: readonly Pick<HelmetTestApp, 'close'>[]): void {
  beforeAll(() => { Tck.silenceLogger(); });
  afterAll(async () => {
    for (const app of [...apps].reverse()) {
      await app.close();
    }
    Tck.restoreLogger();
  });
}
