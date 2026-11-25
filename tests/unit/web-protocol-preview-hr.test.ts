import { describe, expect, test } from 'bun:test';
import { previewManifest } from '../../packages/connectors/src/preview';
import { manifest as hrManifest } from '../../connectors/hr/connector.mjs';
import {
  START_WORDS,
  STEP_WORDS,
  drawnText,
  fillerText,
  schemaText,
  stateWords,
  type ManifestPreview,
} from '../../apps/web/src/pages/protocol-preview-model';

/**
 * The manifest preview's words for every write (D60, D112 item 11), read from the dry run the server really runs over
 * the HR fixture's manifest. Here and not beside the page's other tests in `apps/web/tests`: nothing under `apps/`
 * imports a connector (D61, the rule `clew-does-not-import-connectors`), and the fixture is what holds the words to a
 * manifest a connector really serves.
 */
describe('every write, both halves (D112 item 11, board Entrypoints), from the dry run over the HR fixture', () => {
  const hr = previewManifest(hrManifest, { id: 'hr' }) as ManifestPreview;
  const write = (name: string) => hr.manifest!.capabilities.find(c => c.name === name)!;
  test("the restated path is the dry run's: where it starts, the steps, the input", () => {
    const book = write('hr.bookTalk');
    expect(book.path!.starts.map(s => [START_WORDS[s.place].where, stateWords(s.state, book.kind).label])).toEqual([
      ['On a work item', 'Declared'],
      ['On a person or a unit', 'Not declared'],
      ['Typing in the question box', 'Not declared'],
      ['In a conversation', 'Never for an execute'],
      ['After something happened elsewhere', 'Declared'],
    ]);
    expect(book.path!.steps.map(s => [STEP_WORDS[s.step].name, stateWords(s.state, book.kind).label])).toEqual([
      ['Fill in', 'Declared'],
      ['See what happens', 'Declared'],
      ['Ask first', "On the work item's action"],
      ['One at a time', "On the work item's action"],
      ['Receipt and undo', 'Always'],
    ]);
    expect(book.path!.input.map(i => [i.property, schemaText(i), fillerText(i), drawnText(i)])).toEqual([
      [
        'refs',
        'array of string, required',
        'The selected rows of the work item',
        'Nothing; the checkboxes on the work item',
      ],
      [
        'when',
        'string, date-time, optional',
        'The person, in the dialog',
        "“När”: three free 45-minute times from the person's own calendar, “Annan tid” and the day",
      ],
      ['place', 'string, optional', 'The person, in the dialog', '“Plats”, optional: a text field'],
      [
        'message',
        'string, optional',
        'The person, in the dialog',
        '“Meddelande till medarbetaren”, optional: a text area',
      ],
    ]);
  });
  test('a propose about a person: its entity fills the key, nothing fills the rest, and it never has an effect step', () => {
    const prepare = write('hr.prepareAbsence');
    expect(prepare.path!.input.map(i => fillerText(i))).toEqual([
      'The key of the person or unit',
      'Nobody: your default, unless a draft gives it',
    ]);
    expect(stateWords('never', prepare.kind)).toEqual({ label: 'Never for a propose', variant: 'neutral' });
    const decide = write('hr.decideLeave');
    expect(decide.path!.input.map(i => fillerText(i))).toEqual([
      'The selected rows of the work item',
      "The action's own input on the draft",
      'The person, in the dialog',
    ]);
    expect(write('hr.whoIsOn').path).toBeUndefined();
  });
});
