import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Collection, MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, ManyToMany } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class Author {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @OneToMany({ entity: () => Book, mappedBy: 'author' })
  books = new Collection<Book>(this);
}

@Entity()
class Tag {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  label!: string;
}

@Entity()
class Book {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @ManyToOne({ entity: () => Author })
  author!: Author;

  @ManyToMany({ entity: () => Tag })
  tags = new Collection<Tag>(this);
}

describePg('relations (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [Author, Book, Tag],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    const em = orm.em.fork();
    const author = em.create(Author, { name: 'Ada' });
    const t1 = em.create(Tag, { label: 'sci-fi' });
    const t2 = em.create(Tag, { label: 'classic' });
    const book = em.create(Book, { title: 'Engine', author });
    book.tags.add(t1, t2);
    em.persist([author, book, t1, t2]);
    await em.flush();
  });

  test('n:1 — a book loads its author', async () => {
    const book = await orm.em.fork().findOneOrFail(Book, { title: 'Engine' }, { populate: ['author'] });
    expect(book.author.name).toBe('Ada');
  });

  test('1:n — an author loads its books collection', async () => {
    const author = await orm.em.fork().findOneOrFail(Author, { name: 'Ada' }, { populate: ['books'] });
    expect(author.books.getItems().map((b) => b.title)).toEqual(['Engine']);
  });

  test('m:n — a book loads its tags via the pivot table', async () => {
    const book = await orm.em.fork().findOneOrFail(Book, { title: 'Engine' }, { populate: ['tags'] });
    expect(book.tags.getItems().map((t) => t.label).sort()).toEqual(['classic', 'sci-fi']);
  });

  test('m:n — querying by a related tag returns the book', async () => {
    const books = await orm.em.fork().find(Book, { tags: { label: 'sci-fi' } });
    expect(books.map((b) => b.title)).toEqual(['Engine']);
  });
});
