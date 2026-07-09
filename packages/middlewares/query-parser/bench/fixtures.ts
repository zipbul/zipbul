// Shared benchmark inputs for self.bench.ts and competitive.bench.ts.
// Kept dependency-free (no parser imports) so both runners can import it without
// a cycle; each runner builds its own parser instances.

export function generateFlat(count: number): string {
  return Array.from({ length: count }, (_, i) => `a${i}=v${i}`).join('&');
}

export function generateDuplicates(count: number): string {
  return Array.from({ length: count }, (_, i) => `a=${i}`).join('&');
}

// ── Flat ──
export const FLAT_1 = 'a=1';
export const FLAT_5 = 'a=1&b=2&c=3&d=4&e=5';
export const FLAT_10 = generateFlat(10);
export const FLAT_50 = generateFlat(50);
export const FLAT_100 = generateFlat(100);

// ── Nested ──
export const NESTED_1 = 'a[b]=1';
export const NESTED_2 = 'a[b][c]=1';
export const NESTED_3 = 'a[b][c][d]=1';
export const NESTED_5 = 'a[b][c][d][e][f]=1';

// ── Arrays ──
export const ARRAY_PUSH_10 = Array.from({ length: 10 }, (_, i) => `a[]=${i}`).join('&');
export const ARRAY_INDEX_10 = Array.from({ length: 10 }, (_, i) => `a[${i}]=${i}`).join('&');
export const ARRAY_MIXED = 'a[0][name]=x&a[0][value]=y&a[1][name]=z';

// ── Duplicates (HPP) ──
export const HPP_20 = generateDuplicates(20);

// ── Percent encoding ──
export const NO_ENCODING = 'name=hello&city=seoul';
export const ENCODED_VALUES = 'name=hello%20world&city=%EC%84%9C%EC%9A%B8';
export const ENCODED_KEYS = '%EC%9D%B4%EB%A6%84=hello%20world&%EB%8F%84%EC%8B%9C=%EC%84%9C%EC%9A%B8';
export const ENCODED_5 = 'key%201=val%201&key%202=val%202&key%203=val%203&key%204=val%204&key%205=val%205';

// ── Realistic payloads ──
export const SEARCH_FORM = 'q=typescript&page=1&limit=20&sort=relevance&lang=ko';
export const FILTER_API = 'filter[status]=active&filter[role]=admin&page=1&per_page=50';
// NOTE: contains duplicate array keys (brand[], size[]) — parsers with different
// duplicate-key semantics produce different SHAPES here. Used only where that
// divergence is called out, never in a headline "who is fastest" flat table.
export const ECOMMERCE =
  'category=shoes&brand[]=nike&brand[]=adidas&price_min=50&price_max=200&size[]=9&size[]=10&sort=price_asc';

// ── + as space (form-urlencoded) ──
export const FORM_ENCODED = 'username=john+doe&password=p%40ss+word&remember=on&redirect=%2Fdashboard';
export const PLUS_HEAVY = 'q=hello+world+foo+bar+baz&lang=en&page=1';
