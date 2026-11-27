import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import { applyGroupPatch, groupFields, unitIdentifierList } from '../../apps/server/src/modules/people/domain';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * What other systems know a unit by (D148), over SCIM on the memory adapter: a `unit:` group carries a list of
 * identifiers in the unit extension, the list is sent whole and stored exactly as sent, a change is audited with the
 * list before and after, and nobody's grant follows from one.
 */
const BASE = 'https://clew.test/scim/v2';
const ORG = 'sundsvall';
const IDENTIFIERS = SCIM.unit + ':identifiers';
const ANSVAR = { type: 'ansvar', value: '11110000' };
const SECOND = { type: 'ansvar', value: '11110001' };
const QLIK = { type: 'qlik', value: 'ORG-714' };

function harness() {
  const store = memoryProvisionStore();
  let tick = 0,
    seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date(Date.UTC(2026, 10, 27, 6, 0, tick++)),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  const p = { id: 'metakatalogen', organisationId: ORG, label: 'Metakatalogen' };
  const unit = (unitId: string, extension?: Record<string, unknown>, members: string[] = []) =>
    scim.createGroup(
      p,
      {
        schemas: extension ? [SCIM.group, SCIM.unit] : [SCIM.group],
        externalId: 'unit:' + unitId,
        displayName: 'Enhet ' + unitId,
        members: members.map(value => ({ value })),
        ...(extension ? { [SCIM.unit]: extension } : {}),
      },
      BASE,
    );
  const patch = (id: string, Operations: Array<{ op: string; path?: string; value?: unknown }>) =>
    scim.patchGroup(p, id, { schemas: [SCIM.patch], Operations }, BASE);
  const audit = (id: string) => store.state.audit.filter(a => a.subject === 'group:' + id);
  return { store, scim, p, unit, patch, audit };
}
const refused = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return error as { status: number; scimType?: string; detail: string };
  }
  throw new Error('The request was accepted.');
};

describe('a unit carries what other systems know it by (D148)', () => {
  test('a unit is created with its identifiers, reads them back in the order sent, and its audit row holds them', async () => {
    const { unit, scim, p, audit } = harness();
    const made = await unit('gata', { identifiers: [ANSVAR, QLIK, SECOND] });
    expect(made.schemas).toEqual([SCIM.group, SCIM.unit]);
    expect(made[SCIM.unit]).toEqual({ identifiers: [ANSVAR, QLIK, SECOND] });
    expect((await scim.getGroup(p, made.id, BASE))[SCIM.unit]).toEqual({ identifiers: [ANSVAR, QLIK, SECOND] });
    expect(audit(made.id).at(-1)).toMatchObject({
      action: 'scim.group.created',
      details: { externalId: 'unit:gata', identifiers: [ANSVAR, QLIK, SECOND] },
    });
    // A unit with neither a unit above it nor an identifier carries no extension, and its audit row names none.
    const bare = await unit('park');
    expect(bare.schemas).toEqual([SCIM.group]);
    expect(bare[SCIM.unit]).toBeUndefined();
    expect(audit(bare.id).at(-1)?.details).not.toHaveProperty('identifiers');
  });

  test('the parent and the identifiers stand side by side, and each is read without regard to the case of its name', async () => {
    const { unit } = harness();
    await unit('sbk');
    const made = await unit('gata', { Parent: 'unit:sbk', Identifiers: [{ Type: 'ansvar', VALUE: '11110000' }] });
    expect(made[SCIM.unit]).toEqual({ parent: 'unit:sbk', identifiers: [ANSVAR] });
  });

  test('a PUT sends the list whole: what it leaves out is gone, and one that changes nothing writes nothing', async () => {
    const { unit, scim, p, audit, store } = harness();
    const made = await unit('gata', { identifiers: [ANSVAR, QLIK] });
    const put = (extension?: Record<string, unknown>) =>
      scim.replaceGroup(
        p,
        made.id,
        { externalId: 'unit:gata', displayName: 'Enhet gata', ...(extension ? { [SCIM.unit]: extension } : {}) },
        BASE,
      );
    const before = store.state.audit.length;
    const same = await put({ identifiers: [ANSVAR, QLIK] });
    expect(same.meta.lastModified).toBe(made.meta.lastModified);
    expect(store.state.audit.length).toBe(before);
    const fewer = await put({ identifiers: [QLIK] });
    expect(fewer[SCIM.unit]).toEqual({ identifiers: [QLIK] });
    expect(fewer.meta.lastModified).not.toBe(made.meta.lastModified);
    expect(audit(made.id).at(-1)).toMatchObject({
      action: 'scim.group.replaced',
      details: { identifiers: { before: [ANSVAR, QLIK], after: [QLIK] }, added: 0, removed: 0 },
    });
    // The order is the directory's, so the same entries in another order are a change.
    await put({ identifiers: [QLIK, ANSVAR] });
    expect((await put({ identifiers: [ANSVAR, QLIK] }))[SCIM.unit]).toEqual({ identifiers: [ANSVAR, QLIK] });
    expect(audit(made.id).at(-1)?.details).toMatchObject({
      identifiers: { before: [QLIK, ANSVAR], after: [ANSVAR, QLIK] },
    });
    // Without the extension the unit has no identifiers, as it has no unit above it.
    const none = await put();
    expect(none[SCIM.unit]).toBeUndefined();
    expect(none.schemas).toEqual([SCIM.group]);
  });

  test('PATCH replaces the list, adds to it and clears it, by its path, in the extension and in a path-less value', async () => {
    const { unit, patch } = harness();
    await unit('sbk');
    const made = await unit('gata', { parent: 'unit:sbk' });
    const list = async (Operations: Array<{ op: string; path?: string; value?: unknown }>) =>
      (await patch(made.id, Operations))[SCIM.unit];
    expect(await list([{ op: 'replace', path: IDENTIFIERS, value: [ANSVAR] }])).toEqual({
      parent: 'unit:sbk',
      identifiers: [ANSVAR],
    });
    // An add appends, keeps what is there once, and takes one entry by itself.
    expect(await list([{ op: 'add', path: IDENTIFIERS.toUpperCase(), value: [ANSVAR, QLIK] }])).toEqual({
      parent: 'unit:sbk',
      identifiers: [ANSVAR, QLIK],
    });
    expect((await list([{ op: 'add', path: IDENTIFIERS, value: SECOND }]))?.identifiers).toEqual([
      ANSVAR,
      QLIK,
      SECOND,
    ]);
    // In the extension's object only what the object names is set: the unit above stays.
    expect(await list([{ op: 'replace', path: SCIM.unit, value: { identifiers: [QLIK] } }])).toEqual({
      parent: 'unit:sbk',
      identifiers: [QLIK],
    });
    expect(await list([{ op: 'replace', value: { [SCIM.unit]: { identifiers: [ANSVAR] } } }])).toEqual({
      parent: 'unit:sbk',
      identifiers: [ANSVAR],
    });
    // And the other way round: a move leaves the identifiers alone.
    expect(await list([{ op: 'replace', path: SCIM.unit + ':parent', value: null }])).toEqual({
      identifiers: [ANSVAR],
    });
    expect(await list([{ op: 'replace', path: 'displayName', value: 'Gata och park' }])).toEqual({
      identifiers: [ANSVAR],
    });
    // Cleared by a remove, by null on the list, and by null inside the extension's object.
    expect(await list([{ op: 'remove', path: IDENTIFIERS }])).toBeUndefined();
    await list([{ op: 'replace', path: IDENTIFIERS, value: [ANSVAR] }]);
    expect(await list([{ op: 'replace', path: IDENTIFIERS, value: null }])).toBeUndefined();
    await list([{ op: 'replace', path: IDENTIFIERS, value: [ANSVAR] }]);
    expect(await list([{ op: 'add', path: SCIM.unit, value: { identifiers: null } }])).toBeUndefined();
  });

  test('a remove of the whole extension takes the parent and the identifiers; null for it does the same', () => {
    const fields = { externalId: 'unit:gata', label: 'Gata', parent: 'sbk', identifiers: [ANSVAR], members: [] };
    for (const operation of [
      { op: 'remove', path: SCIM.unit },
      { op: 'replace', path: SCIM.unit, value: null },
      { op: 'add', value: { [SCIM.unit]: null } },
    ])
      expect(applyGroupPatch(fields, [operation])).toMatchObject({ parent: null, identifiers: [] });
    expect(applyGroupPatch(fields, [{ op: 'remove', path: SCIM.unit + ':parent' }])).toMatchObject({
      parent: null,
      identifiers: [ANSVAR],
    });
    expect(applyGroupPatch(fields, [{ op: 'remove', path: IDENTIFIERS }])).toMatchObject({
      parent: 'sbk',
      identifiers: [],
    });
  });

  test('an identifier is stored exactly or not at all: a part that is missing, empty, padded, too long or no text refuses the group', async () => {
    const { unit, store } = harness();
    const wrong: Array<[unknown, string]> = [
      [{ type: 'ansvar' }, IDENTIFIERS + '.value'],
      [{ value: '11110000' }, IDENTIFIERS + '.type'],
      [{ type: '', value: '11110000' }, IDENTIFIERS + '.type'],
      [{ type: 'ansvar', value: '   ' }, IDENTIFIERS + '.value'],
      [{ type: ' ansvar', value: '11110000' }, IDENTIFIERS + '.type'],
      [{ type: 'ansvar', value: '11110000 ' }, IDENTIFIERS + '.value'],
      [{ type: 'ansvar', value: '1111\t0000' }, IDENTIFIERS + '.value'],
      [{ type: 'ansvar', value: '1111\u00000000' }, IDENTIFIERS + '.value'],
      [{ type: 'ansvar', value: 11110000 }, IDENTIFIERS + '.value'],
      [{ type: 'a'.repeat(65), value: '1' }, IDENTIFIERS + '.type'],
      [{ type: 'ansvar', value: '1'.repeat(257) }, IDENTIFIERS + '.value'],
    ];
    for (const [entry, named] of wrong) {
      const error = await refused(unit('gata', { identifiers: [ANSVAR, entry] }));
      expect(error).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(error.detail).toContain(named);
    }
    expect((await refused(unit('gata', { identifiers: ['11110000'] }))).status).toBe(400);
    expect(store.state.groups.size).toBe(0);
    // The longest that is held, and a null entry, which is no identifier.
    const held = await unit('gata', {
      identifiers: [{ type: 'a'.repeat(64), value: '1'.repeat(256) }, null],
    });
    expect(held[SCIM.unit]?.identifiers).toHaveLength(1);
  });

  test('a type or a value sent decomposed is refused, never composed: Clew would store another text than the one sent (D148)', async () => {
    // The same word in two forms: composed here, the decomposed one would no longer be the text the other system holds.
    const composed = 'kostnadsst\u00e4lle',
      decomposed = 'kostnadssta\u0308lle';
    expect(decomposed.normalize('NFC')).toBe(composed);
    expect(unitIdentifierList([{ type: composed, value: '\u00c5-1' }])).toEqual([
      { type: composed, value: '\u00c5-1' },
    ]);
    for (const [entry, part] of [
      [{ type: decomposed, value: 'K-1' }, 'type'],
      [{ type: 'ansvar', value: 'A\u030a-1' }, 'value'],
    ] as const) {
      const { unit, store } = harness();
      const rows = store.state.audit.length;
      expect(await refused(unit('gata', { identifiers: [entry] }))).toMatchObject({
        status: 400,
        scimType: 'invalidValue',
        detail: `Attribute '${IDENTIFIERS}.${part}' needs text in composed form (NFC). It was sent decomposed, and composed by Clew it would be stored as another text than the one sent. The group was not stored.`,
      });
      expect(store.state.audit.length).toBe(rows);
    }
  });
  test('a remove of the whole extension takes no value, and a unit that is removed says what it was known by (D148)', async () => {
    const { unit, patch, scim, p, audit } = harness();
    const made = await unit('gata', { identifiers: [ANSVAR, QLIK] });
    // A value would be read as "take this one away"; what the operation does is clear everything, so it is refused.
    for (const value of [{ identifiers: [ANSVAR] }, [ANSVAR], 'ansvar'])
      expect(await refused(patch(made.id, [{ op: 'remove', path: SCIM.unit, value }]))).toMatchObject({
        status: 400,
        scimType: 'invalidValue',
        detail: `A remove on '${SCIM.unit}' takes no value: it makes the unit a root and clears its identifiers. To take one identifier away, replace '${SCIM.unit}:identifiers' with those that remain.`,
      });
    expect((await scim.getGroup(p, made.id, BASE))[SCIM.unit]).toEqual({ identifiers: [ANSVAR, QLIK] });
    // The removal's audit row carries the list it took away, as every change of it does.
    await scim.deleteGroup(p, made.id);
    expect(audit(made.id).at(-1)).toMatchObject({
      action: 'scim.group.removed',
      details: { externalId: 'unit:gata', identifiers: { before: [ANSVAR, QLIK], after: [] } },
    });
    // A group that carried none says nothing of them.
    const plain = await unit('park');
    await scim.deleteGroup(p, plain.id);
    expect(audit(plain.id).at(-1)?.details).not.toHaveProperty('identifiers');
  });

  test('the same entry twice is kept once, two values of one type are two entries, and fifty is the most', async () => {
    const { unit } = harness();
    const made = await unit('gata', { identifiers: [ANSVAR, SECOND, ANSVAR, { type: 'Ansvar', value: '11110000' }] });
    expect(made[SCIM.unit]?.identifiers).toEqual([ANSVAR, SECOND, { type: 'Ansvar', value: '11110000' }]);
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({ type: 'ansvar', value: String(i) }));
    expect((await unit('fifty', { identifiers: many(50) }))[SCIM.unit]?.identifiers).toHaveLength(50);
    const over = await refused(unit('over', { identifiers: many(51) }));
    expect(over).toMatchObject({ status: 400, scimType: 'invalidValue' });
    expect(over.detail).toContain('at most 50');
    // An add that would pass the limit is refused too, and leaves the list as it was.
    const { unit: again, patch, scim, p } = harness();
    const full = await again('full', { identifiers: many(50) });
    expect(await refused(patch(full.id, [{ op: 'add', path: IDENTIFIERS, value: QLIK }]))).toMatchObject({
      status: 400,
    });
    expect((await scim.getGroup(p, full.id, BASE))[SCIM.unit]?.identifiers).toHaveLength(50);
  });

  test('only a unit group carries identifiers: on any other group they are refused, and a unit that stops being one loses them', async () => {
    const { scim, p, unit, patch } = harness();
    for (const externalId of ['unit-manager:gata', 'ad:ekonomi', 'position:rektor'])
      expect(
        await refused(
          scim.createGroup(p, { externalId, displayName: 'Other', [SCIM.unit]: { identifiers: [ANSVAR] } }, BASE),
        ),
      ).toMatchObject({ status: 400, scimType: 'invalidValue' });
    const made = await unit('gata', { identifiers: [ANSVAR] });
    // The key goes, and what the unit was known by goes with it.
    const plain = await patch(made.id, [{ op: 'replace', path: 'externalId', value: 'ad:gata' }]);
    expect(plain[SCIM.unit]).toBeUndefined();
    // A patch that takes the key and names identifiers in the same breath is refused where it stands.
    const other = await unit('park', { identifiers: [ANSVAR] });
    expect(
      await refused(
        patch(other.id, [
          { op: 'replace', path: 'externalId', value: 'ad:park' },
          { op: 'replace', path: IDENTIFIERS, value: [QLIK] },
        ]),
      ),
    ).toMatchObject({ status: 400, scimType: 'invalidValue' });
  });

  test('a path into the list, a remove with a value and the bare name are refused, never accepted and ignored', async () => {
    const { unit, patch, scim, p } = harness();
    const made = await unit('gata', { identifiers: [ANSVAR, QLIK] });
    for (const path of [IDENTIFIERS + '[type eq "ansvar"]', IDENTIFIERS + '.value', IDENTIFIERS + '[0]'])
      for (const op of ['replace', 'add', 'remove'])
        expect(await refused(patch(made.id, [{ op, path, ...(op === 'remove' ? {} : { value: '1' }) }]))).toMatchObject(
          { status: 400, scimType: 'invalidPath' },
        );
    expect(await refused(patch(made.id, [{ op: 'remove', path: IDENTIFIERS, value: [ANSVAR] }]))).toMatchObject({
      status: 400,
      scimType: 'invalidValue',
    });
    for (const operation of [
      { op: 'replace', path: 'identifiers', value: [QLIK] },
      { op: 'remove', path: 'Identifiers' },
      { op: 'replace', value: { identifiers: [QLIK] } },
    ])
      expect(await refused(patch(made.id, [operation]))).toMatchObject({ status: 400, scimType: 'invalidPath' });
    expect(
      await refused(scim.createGroup(p, { externalId: 'unit:park', displayName: 'Park', identifiers: [ANSVAR] }, BASE)),
    ).toMatchObject({ status: 400, scimType: 'invalidPath' });
    // On a group that is no unit the bare name is an attribute Clew does not hold, ignored as any other.
    const plain = await scim.createGroup(p, { externalId: 'ad:lokal', displayName: 'Lokal' }, BASE);
    expect((await patch(plain.id, [{ op: 'replace', path: 'identifiers', value: [QLIK] }])).externalId).toBe(
      'ad:lokal',
    );
    // Nothing above changed the unit.
    expect((await scim.getGroup(p, made.id, BASE))[SCIM.unit]).toEqual({ identifiers: [ANSVAR, QLIK] });
  });

  test("an add or replace without a value is refused, and an extension's object that names neither attribute says nothing", () => {
    const fields = { externalId: 'unit:gata', label: 'Gata', parent: null, identifiers: [ANSVAR], members: [] };
    expect(() => applyGroupPatch(fields, [{ op: 'replace', path: IDENTIFIERS }])).toThrow('requires a value');
    expect(() => applyGroupPatch(fields, [{ op: 'add', path: SCIM.unit, value: {} }])).toThrow(
      "requires a value for 'parent' or 'identifiers'.",
    );
    expect(() => groupFields({ externalId: 'unit:gata', displayName: 'Gata', [SCIM.unit]: [] })).toThrow(
      'needs an object value',
    );
  });

  test("identifiers move nobody's grant: a member is derived when they come, and never for what the unit is known by", async () => {
    const { scim, p, unit, patch, store } = harness();
    const user = await scim.createUser(
      p,
      {
        externalId: 'mk-anna',
        userName: 'anna',
        displayName: 'Anna',
        emails: [{ value: 'anna@sundsvall.test', type: 'work' }],
      },
      BASE,
    );
    const made = await unit('gata', undefined, [user.id]);
    const grant = store.state.grants.get(user.id),
      rows = store.state.audit.length,
      member = await scim.getUser(p, user.id, BASE);
    await patch(made.id, [{ op: 'replace', path: IDENTIFIERS, value: [ANSVAR] }]);
    expect(store.state.grants.get(user.id)).toEqual(grant);
    // One row, the group's own; the member's resource does not list a unit's identifiers, so its time stands.
    expect(store.state.audit.slice(rows).map(a => a.action)).toEqual(['scim.group.patched']);
    expect((await scim.getUser(p, user.id, BASE)).meta.lastModified).toBe(member.meta.lastModified);
  });
});
