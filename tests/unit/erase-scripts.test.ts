import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/**
 * The arguments of the operator's erasures of a leaver's talks, competence and follow-up dialogue (D122 item 7, D123 item 3), held as
 * `tests/unit/person-erase.test.ts` holds person-erase's: every malformed call is refused with exit code 2 and the usage
 * line before the database is asked anything, an option given twice and a stray argument among them, so that a copied
 * line cannot erase the wrong person. The database each script is given cannot be reached, so a call that got that far
 * would end with exit code 1 instead. A confirmed call does get that far, and each of the five erasures of the
 * runbook's steps 4 and 5 answers it alike: the error's own message and that nothing was written. What the scripts
 * answer from a database is `tests/db/erase-scripts.test.ts`.
 */
type Answer = { code: number; out: string; err: string };
async function run(script: string, args: string[]): Promise<Answer> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../scripts', script), ...args], {
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nothing',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out, err: err.trim() };
}
const MALFORMED: Array<[string, string[]]> = [
  ['no arguments', []],
  ['no person', ['--confirm']],
  ['a person given twice', ['--person', 'p1', '--person', 'p2', '--confirm']],
  ['--confirm given twice', ['--person', 'p1', '--confirm', '--confirm']],
  ['an option where a value belongs', ['--person', '--confirm']],
  ['an empty person id', ['--person', '', '--confirm']],
  ['a stray argument', ['--person', 'p1', 'p2', '--confirm']],
  ['an option it does not take', ['--person', 'p1', '--confirm', '--force']],
];
const SCRIPTS: Array<{ script: string; unconfirmed: string }> = [
  {
    script: 'talks-erase.ts',
    unconfirmed:
      'Erasing person "p1" from the talks domain removes their talks, every action point about them and the cards of those and of the ones they own, and cannot be undone. Run again with --confirm to erase.',
  },
  {
    script: 'dialogue-erase.ts',
    unconfirmed:
      'Erasing person "p1" from the follow-up dialogue clears their id from assessments and activities and removes their private notes and owned activity cards. It cannot be undone. Run again with --confirm to erase.',
  },
  {
    script: 'competence-erase.ts',
    unconfirmed:
      'Erasing person "p1" from the competence domain removes every holding they have and their competence cards, and cannot be undone. Run again with --confirm to erase.',
  },
];
for (const { script, unconfirmed } of SCRIPTS)
  describe(`scripts/${script} refuses, asking the database nothing,`, () => {
    const usage = `Usage: bun scripts/${script} --person <person id> --confirm`;
    for (const [name, args] of MALFORMED)
      test(name, async () => expect(await run(script, args)).toEqual({ code: 2, out: '', err: usage }));
    test('a call without --confirm, saying what it would erase', async () =>
      expect(await run(script, ['--person', 'p1'])).toEqual({ code: 2, out: '', err: unconfirmed + '\n' + usage }));
  });

/** Each erasure's confirmed call as the runbook writes it; the database fails before the id is checked. */
const CONFIRMED: Array<[string, string[]]> = [
  ['subject-erase.ts', ['person', 'p1', '--confirm']],
  ['talks-erase.ts', ['--person', 'p1', '--confirm']],
  ['competence-erase.ts', ['--person', 'p1', '--confirm']],
  ['dialogue-erase.ts', ['--person', 'p1', '--confirm']],
  ['person-erase.ts', ['--person', 'p1', '--confirm']],
];
describe('each erasure, when its database cannot be reached, says why in one line and that nothing was written:', () => {
  // subject-erase asks whether the person is active before its transaction, in a query that the ORM wraps in a message
  // of its own (the statement, then a line of its parameters); the others fail as their transaction begins.
  for (const [script, args] of CONFIRMED)
    test(`scripts/${script}`, async () =>
      expect(await run(script, args)).toEqual({
        code: 1,
        out: '',
        err: 'Could not erase: connect ECONNREFUSED 127.0.0.1:1. Nothing was written.',
      }));
});
