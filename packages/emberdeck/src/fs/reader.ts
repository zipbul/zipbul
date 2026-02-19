import type { CardFile } from '../card/types';
import { parseCardMarkdown } from '../card/markdown';

export async function readCardFile(filePath: string): Promise<CardFile> {
  const text = await Bun.file(filePath).text();
  const parsed = parseCardMarkdown(text);
  return { ...parsed, filePath };
}
