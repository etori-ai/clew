import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { journal, position, upgradeDatabase } from './upgrade';

/**
 * Migration 0089 folds the names of boarding layers and competence types by ICU (DE-L8). The indexes before it folded
 * with the database's own `lower`, which under the locale C folds only A to Z, so such a database may hold two names
 * that differ only in Å, Ä or Ö case, which ICU's unique index refuses. 0089 looks for each pair before its index and
 * refuses the upgrade naming the table and the names, renaming nothing; the runbook's preflight finds the same pairs
 * beforehand. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

/** What a refused migration says: the error's kind and its words, through Drizzle's wrapping if there is one. */
async function refusal(run: Promise<void>) {
  return run.then(
    () => undefined,
    (error: {
      code?: string;
      message?: string;
      hint?: string;
      cause?: { code?: string; message?: string; hint?: string };
    }) => ({
      code: error.cause?.code ?? error.code,
      message: error.cause?.message ?? error.message,
      hint: error.cause?.hint ?? error.hint,
    }),
  );
}

test('0089 refuses a C-locale database whose names differ only in Å, Ä or Ö case, names them, and runs once they differ', async () => {
  const own = await upgradeDatabase({ locale: 'C' });
  try {
    const entries = await journal(),
      at = position(entries, 'change_signals_and_indexes');
    await own.migrate(entries.slice(0, at));
    const recorded = async () =>
      (await own.db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]!.n;
    const before = await recorded();
    // The old indexes take both of each pair on this database.
    await own.db.execute(sql`insert into boarding_layer (id, organisation_id, event, name, condition_kind, created_by)
      values ('layer-1', 'org-1', 'introduction', 'Kök', 'all', 'test'),
             ('layer-2', 'org-1', 'introduction', 'KÖK', 'all', 'test'),
             ('layer-3', 'org-1', 'leaving', 'KÖK', 'all', 'test')`);
    await own.db.execute(sql`insert into competence_type (id, organisation_id, name, area, kind, created_by)
      values ('type-1', 'org-1', 'Åtgärd', 'Akut', 'course', 'test'),
             ('type-2', 'org-1', 'åtgärd', 'Akut', 'course', 'test'),
             ('type-3', 'org-2', 'ÅTGÄRD', 'Akut', 'course', 'test')`);

    expect(await refusal(own.migrate(entries.slice(0, at + 1)))).toEqual({
      code: '23505',
      message:
        'Migration 0089 cannot fold the names of boarding_layer by ICU: these layers of one organisation and event ' +
        "differ only in case: 'KÖK' and 'Kök' in org-1 (introduction)",
      hint: 'Rename one layer of each pair on Administration › Introduktion, then run bun run db:init again.',
    });
    // Nothing of 0089 ran, and nothing was renamed.
    expect(await recorded()).toBe(before);
    expect(
      (await own.db.execute<{ name: string }>(sql`select name from boarding_layer order by id`)).map(r => r.name),
    ).toEqual(['Kök', 'KÖK', 'KÖK']);

    await own.db.execute(sql`update boarding_layer set name = 'Kök, kvällen' where id = 'layer-2'`);
    expect(await refusal(own.migrate(entries.slice(0, at + 1)))).toMatchObject({
      code: '23505',
      message:
        'Migration 0089 cannot fold the names of competence_type by ICU: these active types of one organisation ' +
        "differ only in case: 'Åtgärd' and 'åtgärd' in org-1",
    });
    // An archived type takes no name.
    await own.db.execute(sql`update competence_type set archived_at = now() where id = 'type-2'`);
    await own.migrate(entries.slice(0, at + 1));
    expect(await recorded()).toBe(before + 1);
    const indexes = await own.db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where indexname in ('boarding_layer_name', 'competence_type_name') order by indexname`,
    );
    expect(indexes.map(i => [i.indexname, i.indexdef.includes('"und-x-icu"')])).toEqual([
      ['boarding_layer_name', true],
      ['competence_type_name', true],
    ]);
  } finally {
    await own.drop();
  }
}, 120_000);
