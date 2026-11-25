import { describe, expect, test } from 'bun:test';
import { previewManifest } from '../../../packages/connectors/src/preview';
import { appraisals } from '../../../tests/a11y/protocol-preview-data';
import {
  aboutText,
  actionsAbout,
  declarationOf,
  parseDocument,
  placesLabel,
  placesText,
  problemsSummary,
  sourceOf,
  type ManifestPreview,
} from '../src/pages/protocol-preview-model';

/**
 * The manifest preview's words (D60, D97 slice 9), read from the dry run the server really runs over artboard I's
 * manifest: the page restates the answer's shape rather than depending on the connector package, so this holds the two
 * together.
 */
const preview = previewManifest(appraisals) as ManifestPreview;
const manifest = preview.manifest!;
const all = manifest.capabilities;
const named = (name: string) => all.find(c => c.name === name)!;

describe('the manifest preview, in words (artboard J)', () => {
  test('what each capability is about and where it shows', () => {
    expect(all.map(c => [c.name, aboutText(c, all), placesText(c, all)])).toEqual([
      ['appraisals.person', 'person', 'Lens, row mark, section'],
      [
        'appraisals.commitments',
        'opened from the section of appraisals.person',
        "Under the section, and in full on the person's page",
      ],
      ['appraisals.book', 'person', 'Menu, after a human decision'],
    ]);
    const plain = {
      ...named('appraisals.commitments'),
      openedFrom: [],
      menu: { label: 'X', icon: 'document' },
      tool: true,
    };
    expect(aboutText(plain, all)).toBe('nothing');
    expect(placesText(plain, all)).toBe(
      'Menu row, once an administrator adds it; Model tool, once an administrator enables tools',
    );
  });
  test('who would see it, labelled by place', () => {
    expect(named('appraisals.person').audience.map(a => placesLabel(a.places))).toEqual([
      'Lens and row mark',
      'Section',
      'Model tool',
    ]);
    expect(placesLabel(['lens', 'mark', 'section'])).toBe('Lens, row mark and section');
  });
  test("the product's menu and section are fed from the answer and the document", () => {
    expect(actionsAbout(manifest, 'person')).toEqual([
      {
        capability: 'appraisals.book',
        connector: 'appraisals',
        source: 'Samtalssystemet',
        title: 'Boka samtal',
        kind: 'propose',
        param: 'person',
      },
    ]);
    expect(actionsAbout(manifest, 'unit')).toEqual([]);
    const view = declarationOf(appraisals, 'appraisals.person')!.view!;
    expect(view.kind).toBe('list');
    expect(sourceOf(manifest, named('appraisals.person'), view)).toEqual({
      capability: 'appraisals.person',
      connector: 'appraisals',
      source: 'Samtalssystemet',
      title: 'Utvecklingssamtal',
      view,
    });
    expect(declarationOf('not a manifest', 'appraisals.person')).toBeUndefined();
  });
  test('a document that is not JSON is said with the parser, and the problems are counted', () => {
    expect(parseDocument('{"a":1}')).toEqual({ ok: true, document: { a: 1 } });
    expect(parseDocument('{ "a": ')).toEqual({ ok: false, message: expect.any(String) });
    expect(problemsSummary(1)).toBe('1 problem, the manifest would be refused');
    expect(problemsSummary(3)).toBe('3 problems, the manifest would be refused');
  });
});
