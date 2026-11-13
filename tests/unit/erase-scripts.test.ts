import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/**
 * The arguments of the operator's erasures of a leaver's talks and competence (D116 item 7, D117 item 3), held as
 * `tests/unit/person-erase.test.ts` holds person-erase's: every malformed call is refused with exit code 2 and the usage
 * line before the database is asked anything, an option given twice and a stray argument among them, so that a copied
 * line cannot erase the wrong person. The database each script is given cannot be reached, so a call that got that far
 * would end with exit code 1 instead. What the scripts answer from a database is `tests/db/erase-scripts.test.ts`.
 */
type Answer = { code: number; out: string; err: string };
async function run(script: string, args: string[]): Promise<Answer> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../scripts', script), ...args], {
    env: { ...process.env, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nothing' },
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
    script: 'competence-erase.ts',
    unconfirmed:
      'Erasing person "p1" from the competence domain removes every holding they have and their competence cards, and cannot be undone. Run again with --confirm to erase.',
  },
];
for (const { script, unconfirmed } of SCRIPTS)
  describe(`scripts/${script} refuses, asking the database nothing,`, () => {
    const usage = `Usage: bun scripts/${script} --person <person id> --confirm`;
    // Every call starts at once and each test waits for its own: one process at a time would take seconds.
    const answers = new Map<string, Promise<Answer>>();
    beforeAll(() => {
      for (const [name, args] of MALFORMED) answers.set(name, run(script, args));
      answers.set('unconfirmed', run(script, ['--person', 'p1']));
    });
    for (const [name] of MALFORMED)
      test(name, async () => expect(await answers.get(name)).toEqual({ code: 2, out: '', err: usage }));
    test('a call without --confirm, saying what it would erase', async () =>
      expect(await answers.get('unconfirmed')).toEqual({ code: 2, out: '', err: unconfirmed + '\n' + usage }));
  });
