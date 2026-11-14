import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The documents that describe the person page name what the page draws of its own, in the order it draws it (O1 of the
 * review of users and the organisation; D126 rule 1, board Person): its own tabs ("Översikt" first, a source's tab
 * between them is the source's own name), the overview's own section ("Behöver dig") before the sources' rows, and the
 * facts of the end panel ("Anställning", "Kontakt", "Enhet", D114, D124 item 6). A tab, section or fact the page gains or
 * renames fails here until the documents say so too. How the page itself draws them is the person scenarios'
 * (tests/a11y/person.spec.ts).
 */
const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const page = read('apps/web/src/pages/person.tsx');
const labels = (text: string) => [...text.matchAll(/\bvalue: [A-Z_]+,\s*label: '([^']+)'/g)].map(match => match[1]!);
/**
 * The labels of the page's own tabs, in the order it draws them: `entityTabs` writes its own around the tabs the page
 * adds (`...own`, the reader's own Kompetens and Introduktion, given where the page calls it), so the order in the file
 * is not the order on the page.
 */
const tabsFn = page.slice(page.indexOf('export function entityTabs'));
const [beforeOwn = '', afterOwn = ''] = tabsFn.slice(0, tabsFn.indexOf('\n}\n')).split('...own');
const ownList = page.slice(page.indexOf('entityTabs(detail, drawn, ['));
const tabs = [...labels(beforeOwn), ...labels(ownList.slice(0, ownList.indexOf('])'))), ...labels(afterOwn)];
/** The titles of the page's own sections; the tab "Ärenden" draws one of its own name, the overview the rest. */
const sections = [...page.matchAll(/<PageSection\b[^>]*?\btitle="([^"]+)"/g)]
  .map(match => match[1]!)
  .filter(title => !tabs.includes(title));
/** The titles of the end panel's facts, in the order the page draws them. */
const facts = [...page.matchAll(/<RailSection\b[^>]*?\btitle="([^"]+)"/g)].map(match => match[1]!);

/** The one paragraph or table row of a document that holds `marker`. */
function line(path: string, marker: string): string {
  const found = read(path)
    .split('\n')
    .filter(text => text.includes(marker));
  expect({ path, marker, lines: found.length }).toEqual({ path, marker, lines: 1 });
  return found[0]!;
}

describe('the person page as the documents describe it', () => {
  test('the page writes out its own tabs, the overview section and the facts', () => {
    expect(tabs[0]).toBe('Översikt');
    expect(tabs.at(-1)).toBe('Ärenden');
    expect(sections).toContain('Behöver dig');
    expect(facts).toEqual(expect.arrayContaining(['Anställning', 'Kontakt']));
  });

  for (const [path, marker] of [
    ['docs/architecture/entities.md', 'The opened entity starts with'],
    ['docs/reference/vocabulary.md', '| Section |'],
    ['docs/reference/status/people.md', 'A person is a page (`/people/<personId>`'],
  ] as const)
    for (const [what, titles] of [
      ['tabs', tabs],
      ['overview sections', sections],
      ['facts', facts],
    ] as const)
      test(`${path} names the ${what} in the order the page draws them`, () => {
        const text = line(path, marker);
        const at = titles.map(title => text.indexOf(title));
        expect({ path, missing: titles.filter((_, i) => at[i] === -1) }).toEqual({ path, missing: [] });
        expect(at).toEqual([...at].sort((a, b) => a - b));
      });
});
