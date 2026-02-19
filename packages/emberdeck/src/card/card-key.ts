import { join } from 'node:path';

const CARD_SLUG_RE =
  /^(?![A-Za-z]:)(?!.*::)(?!.*:)(?!.*\/\/)(?!\.{1,2}$)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export class CardKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardKeyError';
  }
}

function assertValidSlug(slug: string): void {
  if (!CARD_SLUG_RE.test(slug)) {
    throw new CardKeyError(`Invalid card slug: ${slug}`);
  }
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  assertValidSlug(normalized);
  return normalized;
}

export function parseFullKey(fullKey: string): string {
  if (typeof fullKey !== 'string' || fullKey.length === 0) {
    throw new CardKeyError('Invalid card key: empty');
  }
  return normalizeSlug(fullKey);
}

/**
 * cardsDir + slug → 카드 파일 절대 경로.
 * 기존 cardPathFromFullKey(projectRoot, fullKey) 대체.
 * projectRoot → cardsDir 변환은 CLI 어댑터 책임.
 */
export function buildCardPath(cardsDir: string, slug: string): string {
  return join(cardsDir, `${slug}.card.md`);
}
