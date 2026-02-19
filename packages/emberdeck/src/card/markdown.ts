import type { CardFile, CardFrontmatter, CardRelation, CardStatus } from './types';
import { CardValidationError } from './errors';

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function isCardStatus(value: unknown): value is CardStatus {
  return (
    value === 'draft' ||
    value === 'accepted' ||
    value === 'implementing' ||
    value === 'implemented' ||
    value === 'deprecated'
  );
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CardValidationError(`Invalid frontmatter field: ${field}`);
  }
  return value;
}

function normalizeKeywords(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item.length === 0) {
        throw new CardValidationError('Invalid frontmatter field: keywords');
      }
      out.push(item);
    }
    return out;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return [trimmed];
  }

  throw new CardValidationError('Invalid frontmatter field: keywords');
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: tags');
  }

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new CardValidationError('Invalid frontmatter field: tags');
    }
    out.push(item);
  }

  return out;
}

function normalizeRelations(value: unknown): CardRelation[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new CardValidationError('Invalid frontmatter field: relations');
  }

  const out: CardRelation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new CardValidationError('Invalid frontmatter field: relations');
    }
    const rel = item as Record<string, unknown>;
    const type = asString(rel.type, 'relations[].type');
    out.push({
      type,
      target: asString(rel.target, 'relations[].target'),
    });
  }
  return out;
}

function coerceFrontmatter(doc: unknown): CardFrontmatter {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: expected YAML object');
  }

  const fm = doc as Record<string, unknown>;

  if (fm['type'] !== undefined) {
    throw new CardValidationError('Invalid frontmatter field: type');
  }

  const status = fm['status'];
  if (!isCardStatus(status)) {
    throw new CardValidationError('Invalid frontmatter field: status');
  }

  const out: CardFrontmatter = {
    key: asString(fm['key'], 'key'),
    summary: asString(fm['summary'], 'summary'),
    status,
  };

  const tags = normalizeTags(fm['tags']);
  if (tags !== undefined) {
    out.tags = tags;
  }

  const keywords = normalizeKeywords(fm['keywords']);
  if (keywords !== undefined) {
    out.keywords = keywords;
  }

  if (fm['constraints'] !== undefined) {
    out.constraints = fm['constraints'];
  }

  const relations = normalizeRelations(fm['relations']);
  if (relations !== undefined) {
    out.relations = relations;
  }

  return out;
}

export function parseCardMarkdown(markdown: string): CardFile {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split('\n');

  if (lines[0] !== '---') {
    throw new CardValidationError('Missing YAML frontmatter');
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) {
    throw new CardValidationError('Unterminated YAML frontmatter');
  }

  const yamlText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');

  let doc: unknown;
  try {
    doc = Bun.YAML.parse(yamlText);
  } catch (err) {
    throw err;
  }

  if (Array.isArray(doc)) {
    throw new CardValidationError('Invalid frontmatter: multi-document YAML is not allowed');
  }

  const frontmatter = coerceFrontmatter(doc);
  return { frontmatter, body };
}

export function serializeCardMarkdown(frontmatter: CardFrontmatter, body: string): string {
  const yaml = (Bun.YAML.stringify(frontmatter) ?? '').trimEnd();
  const header = `---\n${yaml}\n---\n`;
  return header + body;
}
