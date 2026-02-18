import { zipbulCardMarkdownPath } from '../../common/zipbul-paths';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Slug-only key: a slash-separated path of safe segments.
// Intentionally kept as a single regex gate after normalization.
//
// Disallows:
// - empty
// - :: (reserved)
// - colon / drive / scheme-like strings
// - empty segments (//)
// - dot segments (./, ../, or segment == . / ..)
const CARD_SLUG_RE =
  /^(?![A-Za-z]:)(?!.*::)(?!.*:)(?!.*\/\/)(?!\.{1,2}$)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function assertValidSlug(slug: string): void {
  if (!CARD_SLUG_RE.test(slug)) {
    throw new Error('Invalid card slug');
  }
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  assertValidSlug(normalized);
  return normalized;
}

export function parseFullKey(fullKey: string): string {
  if (!isNonEmptyString(fullKey)) {
    throw new Error('Invalid card key');
  }

  return normalizeSlug(fullKey);
}

export function cardPathFromFullKey(projectRoot: string, fullKey: string): string {
  const slug = parseFullKey(fullKey);
  return zipbulCardMarkdownPath(projectRoot, slug);
}
