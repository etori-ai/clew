import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/**
 * The rebind script's arguments (Q8 of the 2026-11-12 users review): every malformed call is refused with exit code 2
 * and the usage line before the database is asked anything, an option given twice among them, so that a copied line
 * cannot rebind the wrong person. The database it is given cannot be reached, so a call that got that far would end
 * with exit code 1 instead. The rebind itself is tested on PostgreSQL in `tests/db/identity-rebind.test.ts`.
 */
const script = join(import.meta.dir, '../../scripts/identity-rebind.ts');
function run(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    env: { ...process.env, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nothing' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString().trim() };
}
const usage =
  'Usage: bun scripts/identity-rebind.ts --person <person id> (--subject <new subject> | --release) --operator "<your name>" [--issuer <issuer>]';
const rest = ['--operator', 'Synthetic Operator', '--issuer', 'https://idp.example.test'];
describe('scripts/identity-rebind.ts refuses, asking the database nothing,', () => {
  const malformed: Array<[string, string[]]> = [
    ['a person given twice', ['--person', 'p1', '--person', 'p2', '--subject', 's1', ...rest]],
    ['a subject given twice', ['--person', 'p1', '--subject', 's1', '--subject', 's2', ...rest]],
    ['--release given twice', ['--person', 'p1', '--release', '--release', ...rest]],
    ['a subject and --release together', ['--person', 'p1', '--subject', 's1', '--release', ...rest]],
    ['neither a subject nor --release', ['--person', 'p1', ...rest]],
    ['no operator', ['--person', 'p1', '--subject', 's1', '--issuer', 'https://idp.example.test']],
    ['an option where a value belongs', ['--person', '--subject', 's1', ...rest]],
    ['a stray argument', ['--person', 'p1', '--subject', 's1', 'p2', ...rest]],
  ];
  for (const [name, args] of malformed)
    test(name, () => expect(run(...args)).toEqual({ code: 2, out: '', err: usage }));
  test('a subject that cannot be an ID token sub', () => {
    for (const subject of ['two words', 'ä', 'x'.repeat(256)])
      expect(run('--person', 'p1', '--subject', subject, ...rest)).toEqual({
        code: 2,
        out: '',
        err: 'The subject is the ID token\'s "sub": printable ASCII without spaces, at most 255 characters.',
      });
  });
  test('an issuer that is not a URL', () => {
    expect(run('--person', 'p1', '--release', '--operator', 'Synthetic Operator', '--issuer', 'idp')).toEqual({
      code: 2,
      out: '',
      err: 'No issuer: set OIDC_ISSUER as the server has it, or name it with --issuer.',
    });
  });
});
