import { describe, expect, it } from 'bun:test';

import { deleteCardFile, readCardFile, writeCardFile } from '../src/mcp/card/card-fs';

let seq = 0;

function getTempDir() {
  return process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp';
}

function makeTempPath(prefix: string) {
  seq += 1;
  const name = `${prefix}_${process.pid}_${seq}_${crypto.randomUUID()}.card.md`;
  return `${getTempDir()}/${name}`;
}

describe('mcp/card — fs helpers (integration)', () => {
  it('writes then reads a card file', async () => {
    const path = makeTempPath('zipbul_card');

    try {
      await writeCardFile(path, {
        filePath: path,
        frontmatter: {
          key: 'a',
          summary: 'A',
          status: 'draft',
        },
        body: 'Body\n',
      });

      const card = await readCardFile(path);
      expect(card.filePath).toBe(path);
      expect(card.frontmatter.key).toBe('a');
      expect(card.body).toBe('Body\n');
    } finally {
      await deleteCardFile(path);
    }
  });

  it('deleteCardFile is idempotent', async () => {
    const path = makeTempPath('zipbul_missing');

    await deleteCardFile(path);
    await deleteCardFile(path);

    const exists = await Bun.file(path).exists();
    expect(exists).toBe(false);
  });
});
