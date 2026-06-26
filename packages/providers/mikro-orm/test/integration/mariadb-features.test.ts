// Feature-parity coverage for the MariaDB driver: the DB-agnostic ORM surface that the postgres
// lane covers (relations, inheritance, composite PK, embeddables, locking, QB, upsert, hooks,
// filters) re-proven end-to-end against real MariaDB through BunMariaDbDriver — so MariaDB's own
// SchemaHelper / QueryBuilder / SQL dialect is exercised across the whole feature set, not just CRUD.
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import {
  Collection,
  MikroORM,
  type Options,
  LockMode,
  OptimisticLockError,
  raw,
} from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/sql';

import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  ManyToOne,
  OneToOne,
  ManyToMany,
  Embedded,
  Embeddable,
  Enum,
  Filter,
  BeforeCreate,
} from '../../src/entity';
import { BunMariaDbDriver } from '../../src/driver';
import { MARIADB_URL, describeMariadb } from './helpers';

// --- relations ---
@Entity()
class MfAuthor {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) name!: string;
  @OneToMany({ entity: () => MfBook, mappedBy: 'author' }) books = new Collection<MfBook>(this);
  @OneToOne({ entity: () => MfProfile, mappedBy: 'author', nullable: true }) profile?: MfProfile;
}

@Entity()
class MfBook {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) title!: string;
  @Property({ type: 'number' }) pages!: number;
  @ManyToOne({ entity: () => MfAuthor }) author!: MfAuthor;
  @ManyToMany({ entity: () => MfTag }) tags = new Collection<MfTag>(this);
}

@Entity()
class MfProfile {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) bio!: string;
  @OneToOne({ entity: () => MfAuthor }) author!: MfAuthor;
}

@Entity()
class MfTag {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string', unique: true }) label!: string;
}

// --- single-table inheritance ---
@Entity({ discriminatorColumn: 'kind', abstract: true })
abstract class MfAnimal {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Enum({ items: ['cat', 'dog'] }) kind!: 'cat' | 'dog';
  @Property({ type: 'string' }) name!: string;
}
@Entity({ discriminatorValue: 'cat' })
class MfCat extends MfAnimal {
  @Property({ type: 'boolean', nullable: true }) indoor?: boolean;
}
@Entity({ discriminatorValue: 'dog' })
class MfDog extends MfAnimal {
  @Property({ type: 'number', nullable: true }) legs?: number;
}

// --- composite PK ---
@Entity()
class MfMembership {
  @PrimaryKey({ type: 'number' }) orgId!: number;
  @PrimaryKey({ type: 'number' }) userId!: number;
  @Property({ type: 'string' }) role!: string;
}

// --- embeddable ---
@Embeddable()
class MfAddress {
  @Property({ type: 'string' }) city!: string;
  @Property({ type: 'string' }) zip!: string;
}
@Entity()
class MfContact {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) name!: string;
  @Embedded({ entity: () => MfAddress }) address!: MfAddress;
}

// --- locking (optimistic + pessimistic) ---
@Entity()
class MfCounter {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'number' }) value!: number;
  @Property({ type: 'number', version: true }) version!: number;
}

// --- upsert ---
@Entity()
class MfItem {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string', unique: true }) code!: string;
  @Property({ type: 'number' }) qty!: number;
}

// --- lifecycle hook ---
@Entity()
class MfHooked {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) name!: string;
  @Property({ type: 'string', nullable: true }) slug?: string;
  @BeforeCreate()
  setSlug(): void {
    this.slug = this.name.toLowerCase();
  }
}

// --- filter / soft delete ---
@Filter({ name: 'notDeleted', cond: { deletedAt: null }, default: true })
@Entity()
class MfDoc {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) title!: string;
  @Property({ type: 'Date', nullable: true }) deletedAt?: Date | null;
}

const ENTITIES = [
  MfAuthor, MfBook, MfProfile, MfTag,
  MfAnimal, MfCat, MfDog,
  MfMembership, MfAddress, MfContact,
  MfCounter, MfItem, MfHooked, MfDoc,
];

describeMariadb('mariadb feature parity — relations, inheritance, locking, QB, upsert', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunMariaDbDriver, clientUrl: MARIADB_URL, entities: ENTITIES } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });
  const sqlEm = (): SqlEntityManager => orm.em.fork() as unknown as SqlEntityManager;

  // --- relations ---
  test('1:n + n:1 round-trips with populate', async () => {
    const em = orm.em.fork();
    const author = em.create(MfAuthor, { name: 'Ann' });
    em.persist(author);
    em.persist(em.create(MfBook, { title: 'B1', pages: 100, author }));
    em.persist(em.create(MfBook, { title: 'B2', pages: 200, author }));
    await em.flush();

    const loaded = await orm.em.fork().findOneOrFail(MfAuthor, { name: 'Ann' }, { populate: ['books'] });
    expect(loaded.books.length).toBe(2);
    const book = await orm.em.fork().findOneOrFail(MfBook, { title: 'B1' }, { populate: ['author'] });
    expect(book.author.name).toBe('Ann');
  });

  test('1:1 round-trips both directions', async () => {
    const em = orm.em.fork();
    const author = em.create(MfAuthor, { name: 'Bea' });
    const profile = em.create(MfProfile, { bio: 'hi', author });
    author.profile = profile;
    em.persist(author);
    em.persist(profile);
    await em.flush();

    const loaded = await orm.em.fork().findOneOrFail(MfAuthor, { name: 'Bea' }, { populate: ['profile'] });
    expect(loaded.profile?.bio).toBe('hi');
  });

  test('m:n round-trips through the pivot table', async () => {
    const em = orm.em.fork();
    const author = em.create(MfAuthor, { name: 'Cy' });
    const book = em.create(MfBook, { title: 'M', pages: 10, author });
    const t1 = em.create(MfTag, { label: 'sci' });
    const t2 = em.create(MfTag, { label: 'fi' });
    book.tags.add(t1, t2);
    em.persist([author, book, t1, t2]);
    await em.flush();

    const loaded = await orm.em.fork().findOneOrFail(MfBook, { title: 'M' }, { populate: ['tags'] });
    expect(loaded.tags.getItems().map((t) => t.label).sort()).toEqual(['fi', 'sci']);
  });

  // --- inheritance ---
  test('single-table inheritance discriminates subtypes on read', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MfCat, { kind: 'cat', name: 'Tom', indoor: true }));
    em.persist(em.create(MfDog, { kind: 'dog', name: 'Rex', legs: 4 }));
    await em.flush();

    const all = await orm.em.fork().find(MfAnimal, {}, { orderBy: { name: 'asc' } });
    expect(all.find((a) => a.name === 'Tom')).toBeInstanceOf(MfCat);
    expect(all.find((a) => a.name === 'Rex')).toBeInstanceOf(MfDog);
  });

  // --- composite PK ---
  test('composite primary key persists and is fetched by both columns', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MfMembership, { orgId: 1, userId: 2, role: 'admin' }));
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(MfMembership, { orgId: 1, userId: 2 });
    expect(found.role).toBe('admin');
  });

  // --- embeddable ---
  test('embeddable flattens to columns and round-trips', async () => {
    const em = orm.em.fork();
    const c = em.create(MfContact, { name: 'Z', address: { city: 'Seoul', zip: '04524' } });
    em.persist(c);
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(MfContact, { name: 'Z' });
    expect(found.address.city).toBe('Seoul');
    expect(found.address.zip).toBe('04524');
  });

  // --- locking ---
  test('optimistic lock: a stale version write throws OptimisticLockError', async () => {
    const seed = orm.em.fork();
    seed.persist(seed.create(MfCounter, { value: 1 } as MfCounter));
    await seed.flush();

    const emA = orm.em.fork();
    const emB = orm.em.fork();
    const a = await emA.findOneOrFail(MfCounter, { value: 1 });
    const b = await emB.findOneOrFail(MfCounter, { value: 1 });
    a.value = 2;
    await emA.flush();
    b.value = 3;
    await expect(emB.flush()).rejects.toBeInstanceOf(OptimisticLockError);
  });

  test('pessimistic write lock (FOR UPDATE) executes inside a transaction', async () => {
    const seed = orm.em.fork();
    seed.persist(seed.create(MfCounter, { value: 9 } as MfCounter));
    await seed.flush();

    await orm.em.fork().transactional(async (em) => {
      const row = await em.findOneOrFail(MfCounter, { value: 9 }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      row.value = 10;
    });
    expect((await orm.em.fork().findOneOrFail(MfCounter, { value: 10 })).value).toBe(10);
  });

  // --- query builder ---
  test('QB: join + group by + having aggregates per author', async () => {
    const em = orm.em.fork();
    const a1 = em.create(MfAuthor, { name: 'P' });
    const a2 = em.create(MfAuthor, { name: 'Q' });
    em.persist([a1, a2]);
    em.persist(em.create(MfBook, { title: 'p1', pages: 1, author: a1 }));
    em.persist(em.create(MfBook, { title: 'p2', pages: 1, author: a1 }));
    em.persist(em.create(MfBook, { title: 'q1', pages: 1, author: a2 }));
    await em.flush();

    const rows = (await sqlEm()
      .createQueryBuilder(MfBook, 'b')
      .select(raw('author_id, count(*) as cnt'))
      .groupBy('author')
      .having('count(*) > 1')
      .execute('all')) as Array<{ cnt: number | string }>;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.cnt)).toBe(2);
  });

  test('QB: a correlated subquery filters rows', async () => {
    const em = orm.em.fork();
    const a1 = em.create(MfAuthor, { name: 'R' });
    em.persist(a1);
    em.persist(em.create(MfBook, { title: 'big', pages: 500, author: a1 }));
    em.persist(em.create(MfBook, { title: 'small', pages: 5, author: a1 }));
    await em.flush();

    const found = await sqlEm()
      .createQueryBuilder(MfBook, 'b')
      .where('b.pages > (select avg(pages) from mf_book)')
      .getResultList();
    expect(found.map((b) => b.title)).toEqual(['big']);
  });

  // --- upsert ---
  test('upsert inserts then updates on the unique key conflict', async () => {
    await orm.em.fork().upsert(MfItem, { code: 'u', qty: 1 });
    await orm.em.fork().upsert(MfItem, { code: 'u', qty: 42 });
    const rows = await orm.em.fork().find(MfItem, { code: 'u' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.qty).toBe(42);
  });

  // --- lifecycle hook ---
  test('@BeforeCreate hook runs before insert', async () => {
    const em = orm.em.fork();
    const h = em.create(MfHooked, { name: 'Hello' });
    em.persist(h);
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(MfHooked, { id: h.id })).slug).toBe('hello');
  });

  // --- filter / soft delete ---
  test('default filter excludes soft-deleted rows', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MfDoc, { title: 'live', deletedAt: null }));
    em.persist(em.create(MfDoc, { title: 'gone', deletedAt: new Date('2026-01-01T00:00:00.000Z') }));
    await em.flush();

    const visible = await orm.em.fork().find(MfDoc, {});
    expect(visible.map((d) => d.title)).toEqual(['live']);
    const all = await orm.em.fork().find(MfDoc, {}, { filters: false });
    expect(all.length).toBe(2);
  });
});
