import { describe, it, expect } from 'bun:test';
import { parseCardMarkdown, serializeCardMarkdown } from './markdown';
import { CardValidationError } from './errors';
import type { CardFrontmatter } from './types';

// ---- Helpers ----

function makeMarkdown(
  overrides: Partial<Record<string, unknown>> = {},
  body = '',
): string {
  const fm: Record<string, unknown> = {
    key: 'test/card',
    summary: 'A test card',
    status: 'draft',
    ...overrides,
  };
  const yaml = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        const items = v.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return `  - ${Object.entries(item).map(([ik, iv]) => `${ik}: ${iv}`).join('\n    ')}`;
          }
          return `  - ${item}`;
        });
        return `${k}:\n${items.join('\n')}`;
      }
      if (typeof v === 'object' && v !== null) {
        return `${k}: ${JSON.stringify(v)}`;
      }
      return `${k}: ${v}`;
    })
    .join('\n');
  return `---\n${yaml}\n---\n${body}`;
}

// ---- Tests ----

describe('parseCardMarkdown', () => {
  // HP — Happy Path
  it('should parse frontmatter when minimal valid markdown given', () => {
    // Arrange
    const md = makeMarkdown();
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.key).toBe('test/card');
    expect(result.frontmatter.summary).toBe('A test card');
    expect(result.frontmatter.status).toBe('draft');
  });

  it('should parse status=draft when status is draft', () => {
    const md = makeMarkdown({ status: 'draft' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('draft');
  });

  it('should parse status=accepted when status is accepted', () => {
    const md = makeMarkdown({ status: 'accepted' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('accepted');
  });

  it('should parse status=implementing when status is implementing', () => {
    const md = makeMarkdown({ status: 'implementing' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('implementing');
  });

  it('should parse status=implemented when status is implemented', () => {
    const md = makeMarkdown({ status: 'implemented' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('implemented');
  });

  it('should parse status=deprecated when status is deprecated', () => {
    const md = makeMarkdown({ status: 'deprecated' });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.status).toBe('deprecated');
  });

  it('should parse tags when tags array given', () => {
    // Arrange
    const md = makeMarkdown({ tags: ['alpha', 'beta'] });
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('should parse keywords as array when keywords is array', () => {
    const md = makeMarkdown({ keywords: ['foo', 'bar'] });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.keywords).toEqual(['foo', 'bar']);
  });

  it('should parse keywords as single-element array when keywords is single string', () => {
    // Build markdown manually to inject string value
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nkeywords: singleword\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.keywords).toEqual(['singleword']);
  });

  it('should return undefined keywords when keywords is null in YAML', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nkeywords: null\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.keywords).toBeUndefined();
  });

  it('should parse relations when relations array given', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nrelations:\n  - type: depends-on\n    target: other/card\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.relations).toEqual([{ type: 'depends-on', target: 'other/card' }]);
  });

  it('should parse constraints when constraints given', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nconstraints:\n  maxSize: 10\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.constraints).toBeDefined();
  });

  it('should return body when body is present after frontmatter', () => {
    // Arrange
    const md = makeMarkdown({}, '## Section\nsome content');
    // Act
    const result = parseCardMarkdown(md);
    // Assert
    expect(result.body).toBe('## Section\nsome content');
  });

  it('should return empty string body when no body after frontmatter', () => {
    const md = makeMarkdown({}, '');
    const result = parseCardMarkdown(md);
    expect(result.body).toBe('');
  });

  it('should normalize CRLF to LF when CRLF line endings given', () => {
    const md = '---\r\nkey: k\r\nsummary: s\r\nstatus: draft\r\n---\r\nbody text';
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.key).toBe('k');
    expect(result.body).toBe('body text');
  });

  it('should include --- in body when --- appears after second delimiter', () => {
    const md = '---\nkey: k\nsummary: s\nstatus: draft\n---\n---\nThis is body\n---';
    const result = parseCardMarkdown(md);
    expect(result.body).toContain('---');
  });

  it('should return empty tags when tags is empty array', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntags: []\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('should return empty relations when relations is empty array', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nrelations: []\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.relations).toEqual([]);
  });

  it('should return single-item tags array when single tag given', () => {
    const md = makeMarkdown({ tags: ['only-one'] });
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual(['only-one']);
  });

  it('should parse constraints=0 when constraints is number zero', () => {
    const md = `---\nkey: k\nsummary: s\nstatus: draft\nconstraints: 0\n---\n`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.constraints).toBe(0);
  });

  it('should parse all optional fields together when tags+keywords+relations+constraints given', () => {
    // CO — all optional fields
    const md = `---\nkey: k\nsummary: s\nstatus: draft\ntags:\n  - t1\nkeywords:\n  - kw1\nrelations:\n  - type: related\n    target: other\nconstraints: true\n---\nbody`;
    const result = parseCardMarkdown(md);
    expect(result.frontmatter.tags).toEqual(['t1']);
    expect(result.frontmatter.keywords).toEqual(['kw1']);
    expect(result.frontmatter.relations).toEqual([{ type: 'related', target: 'other' }]);
    expect(result.frontmatter.constraints).toBe(true);
    expect(result.body).toBe('body');
  });

  // ID
  it('should return identical result when called twice with same input', () => {
    const md = makeMarkdown({ tags: ['x'] }, 'body');
    const first = parseCardMarkdown(md);
    const second = parseCardMarkdown(md);
    expect(first.frontmatter).toEqual(second.frontmatter);
    expect(first.body).toBe(second.body);
  });

  // NE — Negative/Error
  it('should throw CardValidationError when empty string given', () => {
    expect(() => parseCardMarkdown('')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when no --- header', () => {
    expect(() => parseCardMarkdown('no frontmatter here')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when unterminated frontmatter', () => {
    expect(() => parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft')).toThrow(
      CardValidationError,
    );
  });

  it('should throw CardValidationError when status is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when status is unknown value', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: unknown\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when key is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nsummary: s\nstatus: draft\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when summary is missing', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nstatus: draft\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when key is empty string', () => {
    expect(() =>
      parseCardMarkdown("---\nkey: ''\nsummary: s\nstatus: draft\n---\n"),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when summary is empty string', () => {
    expect(() =>
      parseCardMarkdown("---\nkey: k\nsummary: ''\nstatus: draft\n---\n"),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when type field is present in frontmatter', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntype: card\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when frontmatter is YAML array', () => {
    expect(() =>
      parseCardMarkdown('---\n- item1\n- item2\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw when YAML is invalid syntax', () => {
    // Invalid YAML will throw an error (not necessarily CardValidationError)
    expect(() =>
      parseCardMarkdown('---\n{invalid yaml: [unclosed\n---\n'),
    ).toThrow();
  });

  it('should throw CardValidationError when tags is not array', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntags: 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when tags contains non-string', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\ntags:\n  - 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when keywords contains empty string', () => {
    expect(() =>
      parseCardMarkdown("---\nkey: k\nsummary: s\nstatus: draft\nkeywords:\n  - ''\n---\n"),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when keywords is object', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\nkeywords:\n  foo: bar\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations is not array', () => {
    expect(() =>
      parseCardMarkdown('---\nkey: k\nsummary: s\nstatus: draft\nrelations: 123\n---\n'),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is missing type', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\nrelations:\n  - target: other\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is missing target', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\nrelations:\n  - type: related\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when relations item is null', () => {
    expect(() =>
      parseCardMarkdown(
        '---\nkey: k\nsummary: s\nstatus: draft\nrelations:\n  - null\n---\n',
      ),
    ).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when frontmatter is scalar YAML', () => {
    expect(() => parseCardMarkdown('---\njust a string\n---\n')).toThrow(CardValidationError);
  });

  it('should throw CardValidationError when first line has trailing space (not exactly ---)', () => {
    expect(() => parseCardMarkdown('--- \nkey: k\nsummary: s\nstatus: draft\n---\n')).toThrow(
      CardValidationError,
    );
  });
});

describe('serializeCardMarkdown', () => {
  // HP
  it('should return header+body format when called with frontmatter and body', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft' };
    const body = 'body content';
    // Act
    const result = serializeCardMarkdown(fm, body);
    // Assert
    expect(result).toContain('---\n');
    expect(result).toContain('body content');
  });

  it('should output --- delimiters when serializing frontmatter', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft' };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result.startsWith('---\n')).toBe(true);
    const secondDelim = result.indexOf('---\n', 4);
    expect(secondDelim).toBeGreaterThan(0);
  });

  it('should return header only when body is empty string', () => {
    // Arrange
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft' };
    // Act
    const result = serializeCardMarkdown(fm, '');
    // Assert
    expect(result).toMatch(/^---\n[\s\S]+---\n$/);
  });

  it('should include tags when tags present in frontmatter', () => {
    const fm: CardFrontmatter = { key: 'k', summary: 's', status: 'draft', tags: ['t1', 't2'] };
    const result = serializeCardMarkdown(fm, '');
    expect(result).toContain('t1');
    expect(result).toContain('t2');
  });

  // CO — round-trip
  it('should yield same frontmatter after round-trip parse→serialize→parse', () => {
    // Arrange
    const original: CardFrontmatter = {
      key: 'spec/api',
      summary: 'API spec',
      status: 'accepted',
      tags: ['api', 'v2'],
      keywords: ['rest'],
      relations: [{ type: 'depends-on', target: 'core/module' }],
    };
    const body = '## Details\ncontent here';
    // Act
    const serialized = serializeCardMarkdown(original, body);
    const reparsed = parseCardMarkdown(serialized);
    // Assert
    expect(reparsed.frontmatter.key).toBe(original.key);
    expect(reparsed.frontmatter.summary).toBe(original.summary);
    expect(reparsed.frontmatter.status).toBe(original.status);
    expect(reparsed.frontmatter.tags).toEqual(original.tags);
    expect(reparsed.frontmatter.keywords).toEqual(original.keywords);
    expect(reparsed.frontmatter.relations).toEqual(original.relations);
    expect(reparsed.body).toBe(body);
  });

  it('should preserve constraints after round-trip when constraints given', () => {
    // Arrange
    const fm: CardFrontmatter = {
      key: 'k',
      summary: 's',
      status: 'draft',
      constraints: { maxSize: 10, required: true },
    };
    // Act
    const serialized = serializeCardMarkdown(fm, '');
    const reparsed = parseCardMarkdown(serialized);
    // Assert
    expect(reparsed.frontmatter.constraints).toEqual(fm.constraints);
  });
});
