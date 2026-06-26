import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import { SqlSchemaGenerator } from '@mikro-orm/sql';
import type { Options } from '@mikro-orm/core';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpAdapterPhase, HttpContext, HttpStatus } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver, BunMariaDbDriver } from '../../src/driver';
import { ConnectionRegistry } from '../../src/connection';
import { MikroOrmService } from '../../src/orm';
import { BaseRepository } from '../../src/repository';
import type { ZipbulMikroOrmOptions } from '../../src/orm/interfaces';

// E2E: a TCK-booted zipbul HTTP app exercising the provider's framework
// integration over real HTTP — the per-request EntityManager fork (AsyncLocalStorage) and the
// DI-style `MikroOrmService` / `BaseRepository`. The load-bearing claim re-proved here, that the
// unit tests can only assert with a mocked ALS, is: under concurrent HTTP requests, each request
// gets its OWN forked EM (distinct identity), so writes never bleed across requests.
//
// Routes are expressed in a single OnRequest middleware that dispatches on the `x-op` header and
// commits via `response.send()` — the framework's no-AOT e2e pattern (same as the cors/query-parser
// e2e), so no `zb build`/compiled route manifest is needed.
//
// Parametrized per driver so the framework plumbing is proven end-to-end against each backend; each
// lane skips cleanly when its DB URL env is absent.

const PG_URL = process.env.DB_URL_PG;
const MARIADB_URL = process.env.DB_URL_MARIADB;
const describePg = PG_URL ? describe : describe.skip;
const describeMariadb = MARIADB_URL ? describe : describe.skip;

@Entity()
class E2eUser {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  tag!: string;
}

/** The MikroORM `schema` generator surface wired by the SqlSchemaGenerator extension. */
type SchemaGen = { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> };

interface E2eApp {
  app: TestApplication;
  fetch(init: { op: string; tag?: string; id?: string }): Promise<Response>;
  close(): Promise<void>;
}

function requestIsolationSuite(
  label: string,
  gate: typeof describe,
  driver: NonNullable<Options['driver']>,
  url: string | undefined,
): void {
  /** Concrete DI service a consumer would write: subclass + supply `options`. */
  class Database extends MikroOrmService {
    protected readonly options: ZipbulMikroOrmOptions = {
      driver,
      clientUrl: url!,
      entities: [E2eUser],
      extensions: [SqlSchemaGenerator],
    } as unknown as ZipbulMikroOrmOptions;
  }

  /** Concrete repository a consumer would write: subclass + supply `entity`. The Proxy resolves the
   *  request-scoped EM per access, so it operates on the current request's fork. */
  class UserRepository extends BaseRepository<E2eUser> {
    protected readonly entity = E2eUser;
  }

  const schemaOf = (svc: Database): SchemaGen => (svc.orm as unknown as { schema: SchemaGen }).schema;

  gate(`e2e: request-scoped EM over HTTP (${label})`, () => {
    let db: Database;
    let repo: UserRepository;
    let booted: E2eApp;

    beforeAll(async () => {
      Tck.silenceLogger();
      db = new Database();
      await db.onInit(); // MikroORM.init + ConnectionRegistry.set('default')
      repo = new UserRepository();
      await schemaOf(db).drop({ dropForeignKeys: true });
      await schemaOf(db).create();

      // One OnRequest middleware = the whole "API". Enters the per-request context, then dispatches.
      const api = defineMiddleware([HttpAdapter], () => async (ctx) => {
        const http = ctx.to(HttpContext);
        const op = http.request.headers.get('x-op');
        if (op === null) {
          return;
        }
        db.enter(); // RequestContext.enter → forked EM bound to this request's ALS context
        const res = http.response;

        const em = db.em;
        if (op === 'create') {
          const user = repo.create({ tag: http.request.headers.get('x-tag') ?? '' });
          em.persist(user);
          await em.flush();
          res.setHeader('x-id', String(user.id));
        } else if (op === 'read') {
          const found = await repo.findOne({ id: Number(http.request.headers.get('x-id')) });
          res.setHeader('x-tag', found?.tag ?? '');
        } else if (op === 'iso') {
          const tag = http.request.headers.get('x-tag') ?? '';
          const user = repo.create({ tag });
          em.persist(user);
          await em.flush();
          await new Promise((r) => setTimeout(r, 15)); // widen the interleave window
          const mine = await em.find(E2eUser, { tag });
          res.setHeader('x-em-id', String((em as unknown as { _id: number })._id));
          res.setHeader('x-mine', String(mine.length));
        }
        res.setStatus(HttpStatus.Ok);
        res.send();
      });

      let captured: HttpAdapter | undefined;
      const app = await Tck.createApplication({
        adapterConfig: {
          HttpAdapter: {
            middlewares: {
              [HttpAdapterPhase.OnRequest]: [api],
            },
          },
        },
        register: (a) => {
          captured = a.attach(HttpAdapter, { port: 0 });
        },
      });
      const port = captured?.getServer()?.port;
      if (port === undefined) {
        await app.close();
        throw new Error('http server not booted');
      }
      const base = `http://127.0.0.1:${port}`;
      booted = {
        app,
        fetch: ({ op, tag, id }) =>
          fetch(`${base}/api`, {
            headers: {
              'x-op': op,
              ...(tag !== undefined ? { 'x-tag': tag } : {}),
              ...(id !== undefined ? { 'x-id': id } : {}),
            },
          }),
        close: () => app.close(),
      };
    });

    afterAll(async () => {
      await booted?.close();
      await schemaOf(db).drop({ dropForeignKeys: true }).catch(() => undefined);
      ConnectionRegistry.delete('default');
      await db.onDestroy();
      Tck.restoreLogger();
    });

    test('a row written by one request is readable by a later request', async () => {
      const createRes = await booted.fetch({ op: 'create', tag: 'roundtrip-1' });
      expect(createRes.status).toBe(200);
      const id = createRes.headers.get('x-id');
      expect(id).toBeTruthy();

      const readRes = await booted.fetch({ op: 'read', id: id! });
      expect(readRes.status).toBe(200);
      expect(readRes.headers.get('x-tag')).toBe('roundtrip-1');
    });

    test('20 concurrent requests each get a distinct forked EM and see only their own write', async () => {
      const N = 20;
      const responses = await Promise.all(
        Array.from({ length: N }, (_, i) => booted.fetch({ op: 'iso', tag: `iso-${i}` })),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const emIds = responses.map((r) => r.headers.get('x-em-id'));
      expect(new Set(emIds).size).toBe(N); // every request ran on its own EM fork

      const globalId = String((db.orm.em as unknown as { _id: number })._id);
      expect(emIds.includes(globalId)).toBe(false); // none reused the global EM

      // each forked EM, filtering by its own tag, sees exactly its single row
      expect(responses.every((r) => r.headers.get('x-mine') === '1')).toBe(true);
    });
  });
}

requestIsolationSuite('postgres', describePg, BunPostgreSqlDriver, PG_URL);
requestIsolationSuite('mariadb', describeMariadb, BunMariaDbDriver, MARIADB_URL);
