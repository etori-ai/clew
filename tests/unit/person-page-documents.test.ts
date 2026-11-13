import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The documents that describe the person page name the sections the page draws of its own, in the order it draws them,
 * before the one section per source (O1 of the review of users and the organisation): "Behöver dig", then the
 * directory's "Anställningar" and "Kontaktuppgifter" (D114). A section the page gains or renames fails here until the
 * documents say so too. How the page itself orders them is the person scenarios' (`EVERY_SECTION` in
 * tests/a11y/person.spec.ts).
 */
const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
/** The titles of the page's own sections as the page writes them, in the order it draws them; a source's is its own. */
const drawn = [...read('apps/web/src/pages/person.tsx').matchAll(/<PageSection\b[^>]*?\btitle="([^"]+)"/g)].map(
  match => match[1]!,
);
/** The one paragraph or table row of a document that holds `marker`. */
function line(path: string, marker: string): string {
  const found = read(path)
    .split('\n')
    .filter(text => text.includes(marker));
  expect({ path, marker, lines: found.length }).toEqual({ path, marker, lines: 1 });
  return found[0]!;
}

describe('the person page as the documents describe it', () => {
  test('the page writes out the titles of its own sections', () => {
    expect(drawn).toContain('Behöver dig');
  });

  for (const [path, marker] of [
    ['docs/architecture/entities.md', 'The opened entity starts with'],
    ['docs/reference/vocabulary.md', '| Section |'],
    ['docs/reference/status/people.md', 'A person is a page (`/people/<personId>`'],
  ] as const)
    test(`${path} names them in the order the page draws them`, () => {
      const text = line(path, marker);
      const at = drawn.map(title => text.indexOf(title));
      expect({ path, missing: drawn.filter((_, i) => at[i] === -1) }).toEqual({ path, missing: [] });
      expect(at).toEqual([...at].sort((a, b) => a - b));
    });
});
