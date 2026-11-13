import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  DialogueConfigSchema,
  DialogueUnitSchema,
  EntityPageSchema,
  type AuthenticatedContext,
  type DialogueConfig,
  type StaffUnit,
} from '../../packages/contracts/src/index';
import { fieldTone, menuEligible, placesOf, viewProblem, type Actor } from '../../packages/connectors/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import { memoryDialogueStore, type MemoryDialogueStore } from '../../apps/server/src/modules/dialogue/adapters/memory';
import {
  MyActivitiesOutputSchema,
  UnitDialogueOutputSchema,
  dialogueConnector,
  unitDialogueView,
} from '../../apps/server/src/modules/dialogue/capabilities';
import {
  normaliseText,
  openWords,
  overdueWords,
  questionsFor,
  worst,
} from '../../apps/server/src/modules/dialogue/domain';
import { followedFrom } from '../../apps/server/src/modules/dialogue/domain';
import type { FollowedUnit } from '../../apps/server/src/modules/dialogue/model';
import { dialogueUsecases, type DialogueUsecases } from '../../apps/server/src/modules/dialogue/usecases';
import { Registry } from '../registry';

/**
 * The follow-up dialogue's use cases (D118) on the memory adapter, with a clock, ids and a reach the test owns: every
 * change's audit row and that none carries a text, a note, a comment or a name; an activity and its card roll back
 * together; who follows up which unit is read when asked; the newest assessment counts and an area with dimensions shows
 * the worst; and the built-in connector answers through the registry.
 */
const ORG = 'org-1';
function personaOf(id: string, role: 'manager' | 'employee', name = id): AuthenticatedContext {
  return {
    id,
    name,
    unitId: 'u-top',
    unitLabel: 'Grundskola',
    role,
    organisationId: ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-12-31T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
}
// Ingrid leads Grundskola; Hillevi leads Bergsåker below it and reports to Ingrid; Olle leads a unit elsewhere.
const ingrid = personaOf('ingrid', 'manager', 'Ingrid Holm');
const hillevi = personaOf('hillevi', 'manager', 'Hillevi Berg');
const olle = personaOf('olle', 'manager', 'Olle Chef');
const anna = personaOf('anna', 'employee', 'Anna Lind');
const CONFIG: DialogueConfig = {
  areas: [
    {
      key: 'economy',
      title: 'Ekonomi',
      kind: 'measured',
      measure: 'qlik.economyUnit',
      questions: [{ text: 'Vad ligger bakom avvikelsen?' }],
    },
    {
      key: 'operations',
      title: 'Verksamhet',
      kind: 'assessed',
      dimensions: [
        { key: 'mission', title: 'Grunduppdrag' },
        { key: 'council-goals', title: 'Fullmäktigemål' },
      ],
      questions: [
        { heading: 'Uppdraget', text: 'Klarar enheten sitt uppdrag?' },
        { heading: 'Särskilt', text: 'En fråga bara för Bergsåker.', basedOn: 'Ett påstående.', units: ['u-skola'] },
      ],
    },
    { key: 'digital', title: 'Digital transformation', kind: 'assessed' },
  ],
};

let now: Date;
let n: number;
let followed: Map<string, FollowedUnit[]>;
let store: MemoryDialogueStore;
let dialogue: DialogueUsecases;
beforeEach(async () => {
  now = new Date('2026-11-13T09:00:00.000Z');
  n = 0;
  followed = new Map([
    [
      'ingrid',
      [
        { unitId: 'u-top', label: 'Grundskola', relation: 'own', managerId: 'ingrid' },
        { unitId: 'u-skola', label: 'Bergsåkers skola', relation: 'below', managerId: 'hillevi' },
      ],
    ],
    ['hillevi', [{ unitId: 'u-skola', label: 'Bergsåkers skola', relation: 'own', managerId: 'hillevi' }]],
    ['olle', [{ unitId: 'u-other', label: 'Annan enhet', relation: 'own', managerId: 'olle' }]],
  ]);
  store = memoryDialogueStore({
    persons: { ingrid: 'Ingrid Holm', hillevi: 'Hillevi Berg', olle: 'Olle Chef' },
    units: { 'u-top': 'Grundskola', 'u-skola': 'Bergsåkers skola', 'u-other': 'Annan enhet' },
  });
  dialogue = dialogueUsecases({
    store,
    followed: async p => followed.get(p.id) ?? [],
    clock: () => now,
    ids: () => 'id-' + ++n,
  });
  await dialogue.replaceConfig('operator:cli', ORG, CONFIG);
});
const at = () => now.toISOString();
const later = (minutes: number) => {
  now = new Date(now.getTime() + minutes * 60_000);
};

describe('the configuration', () => {
  test('an operator replaces the areas and questions whole, audited with counts', async () => {
    expect(checkContract(DialogueConfigSchema, CONFIG)).toBe(true);
    expect(store.audit()).toEqual([
      {
        actor: 'operator:cli',
        action: 'dialogue.config_replaced',
        subject: 'organisation:' + ORG,
        at: at(),
        details: { areas: 3, questions: 3 },
      },
    ]);
    expect(await dialogue.hasAreas(ORG)).toBe(true);
    expect(await dialogue.hasAreas('elsewhere')).toBe(false);
    // A second load replaces the first: one area left.
    await dialogue.replaceConfig('operator:cli', ORG, { areas: [CONFIG.areas[2]!] });
    expect(store.state.areas.map(a => a.key)).toEqual(['digital']);
    expect(store.state.questions).toEqual([]);
  });

  test('a repeated area or dimension, or a measured area in parts, is refused and nothing changes', async () => {
    const twice = { areas: [CONFIG.areas[0]!, CONFIG.areas[0]!] };
    await expect(dialogue.replaceConfig('operator:cli', ORG, twice)).rejects.toThrow(
      'An area appears twice in the file.',
    );
    const parts = { areas: [{ ...CONFIG.areas[0]!, dimensions: [{ key: 'a', title: 'A' }] }] };
    await expect(dialogue.replaceConfig('operator:cli', ORG, parts)).rejects.toThrow(
      'Area "economy" is measured and cannot be assessed in dimensions.',
    );
    expect(store.state.areas.map(a => a.key)).toEqual(['economy', 'operations', 'digital']);
  });

  test('an area with open activities cannot be left out of a new file; one whose activities are done can', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', { area: 'digital', text: 'Pröva verktyget' });
    const withoutDigital = { areas: CONFIG.areas.slice(0, 2) };
    await expect(dialogue.replaceConfig('operator:cli', ORG, withoutDigital)).rejects.toThrow(
      'The file leaves out "digital", which still has open activities. Keep the area until they are done.',
    );
    expect(store.state.areas.map(a => a.key)).toEqual(['economy', 'operations', 'digital']);
    expect(store.audit().filter(a => a.action === 'dialogue.config_replaced')).toHaveLength(1);
    await dialogue.completeActivity(ingrid, id);
    await dialogue.replaceConfig('operator:cli', ORG, withoutDigital);
    expect(store.state.areas.map(a => a.key)).toEqual(['economy', 'operations']);
  });

  test('a unit sees the questions written for it in place of the general ones', () => {
    const qs = store.state.questions;
    expect(questionsFor(qs, 'operations', 'u-skola').map(q => q.text)).toEqual(['En fråga bara för Bergsåker.']);
    expect(questionsFor(qs, 'operations', 'u-top').map(q => q.text)).toEqual(['Klarar enheten sitt uppdrag?']);
  });
});

describe('reach', () => {
  test('a manager follows up their own units and the units of the managers who report to them, one level', () => {
    const managed: StaffUnit[] = [
      {
        unitId: 'u-top',
        unitLabel: 'Grundskola',
        people: [
          { id: 'anna', name: 'Anna', userName: 'anna', email: null, role: 'employee', enabled: true },
          {
            id: 'hillevi',
            name: 'Hillevi',
            userName: 'hillevi',
            email: null,
            role: 'manager',
            enabled: true,
            below: [{ unitId: 'u-skola', unitLabel: 'Bergsåkers skola', role: 'manager' }],
          },
          {
            id: 'gone',
            name: 'Gone',
            userName: 'gone',
            email: null,
            role: 'manager',
            enabled: false,
            below: [{ unitId: 'u-gone', unitLabel: 'Avslutad', role: 'manager' }],
          },
          {
            id: 'placed',
            name: 'Placed',
            userName: 'placed',
            email: null,
            role: 'employee',
            enabled: true,
            below: [{ unitId: 'u-leaderless', unitLabel: 'Utan chef', role: 'employee' }],
          },
        ],
      },
    ];
    expect(followedFrom('ingrid', managed)).toEqual([
      { unitId: 'u-top', label: 'Grundskola', relation: 'own', managerId: 'ingrid' },
      { unitId: 'u-skola', label: 'Bergsåkers skola', relation: 'below', managerId: 'hillevi' },
    ]);
    expect(followedFrom('ingrid', [])).toEqual([]);
  });

  test('a unit nobody follows up, and a person who manages nothing, are refused', async () => {
    await expect(dialogue.unit(olle, 'u-skola')).rejects.toThrow(ForbiddenError);
    await expect(dialogue.unit(olle, 'u-skola')).rejects.toThrow('Enheten finns inte bland dem du följer upp.');
    await expect(dialogue.unit(anna, 'u-skola')).rejects.toThrow('Dialogstödet är för den som är chef för en enhet.');
    // The reach is read when asked: once Hillevi no longer reports to Ingrid, Bergsåker is closed to her.
    followed.set('ingrid', followed.get('ingrid')!.slice(0, 1));
    await expect(dialogue.unit(ingrid, 'u-skola')).rejects.toThrow(ForbiddenError);
  });
});

describe('assessments', () => {
  test('the newest per dimension counts, an area shows its worst, and the history is kept, newest first', async () => {
    await dialogue.assess(ingrid, 'u-skola', { area: 'operations', dimension: 'mission', tone: 'alert' });
    later(5);
    await dialogue.assess(ingrid, 'u-skola', {
      area: 'operations',
      dimension: 'mission',
      tone: 'ok',
      comment: '  Bättre nu.  ',
    });
    later(5);
    await dialogue.assess(hillevi, 'u-skola', { area: 'operations', dimension: 'council-goals', tone: 'warn' });
    const read = await dialogue.unit(ingrid, 'u-skola');
    expect(checkContract(DialogueUnitSchema, { ...read, writable: true })).toBe(true);
    const ops = read.areas.find(a => a.key === 'operations')!;
    expect(ops.tone).toBe('warn');
    expect(ops.dimensions.map(d => [d.key, d.history.map(h => [h.tone, h.comment, h.by])])).toEqual([
      [
        'mission',
        [
          ['ok', 'Bättre nu.', 'Ingrid Holm'],
          ['alert', undefined, 'Ingrid Holm'],
        ],
      ],
      ['council-goals', [['warn', undefined, 'Hillevi Berg']]],
    ]);
    expect(read.areas.find(a => a.key === 'digital')!.tone).toBeUndefined();
    // Another unit is untouched.
    expect((await dialogue.unit(ingrid, 'u-top')).areas.find(a => a.key === 'operations')!.tone).toBeUndefined();
  });

  test('each assessment is audited with its keys and tone, never its comment or a name', async () => {
    const id = await dialogue.assess(ingrid, 'u-skola', {
      area: 'operations',
      dimension: 'mission',
      tone: 'warn',
      comment: 'Hemlig kommentar om Hillevi Berg',
    });
    await dialogue.assess(ingrid, 'u-top', { area: 'digital', tone: 'ok' });
    expect(store.audit().filter(a => a.action === 'dialogue.assessed')).toEqual([
      {
        actor: 'person:ingrid',
        action: 'dialogue.assessed',
        subject: 'dialogue-assessment:' + id,
        at: at(),
        details: { unitId: 'u-skola', area: 'operations', dimension: 'mission', tone: 'warn', comment: true },
      },
      {
        actor: 'person:ingrid',
        action: 'dialogue.assessed',
        subject: 'dialogue-assessment:id-5',
        at: at(),
        details: { unitId: 'u-top', area: 'digital', tone: 'ok', comment: false },
      },
    ]);
    expect(JSON.stringify(store.audit())).not.toContain('Hemlig');
    expect(JSON.stringify(store.audit())).not.toContain('Hillevi Berg');
  });

  test('a measured area, an unknown area, and a wrong or missing dimension are refused', async () => {
    await expect(dialogue.assess(ingrid, 'u-skola', { area: 'economy', tone: 'ok' })).rejects.toThrow(
      'Området bedöms inte för hand.',
    );
    await expect(dialogue.assess(ingrid, 'u-skola', { area: 'nope', tone: 'ok' })).rejects.toThrow(
      'Området finns inte i dialogen.',
    );
    await expect(dialogue.assess(ingrid, 'u-skola', { area: 'operations', tone: 'ok' })).rejects.toThrow(
      'Välj vilken del av området bedömningen gäller.',
    );
    await expect(
      dialogue.assess(ingrid, 'u-skola', { area: 'digital', dimension: 'mission', tone: 'ok' }),
    ).rejects.toThrow('Välj vilken del');
    await expect(
      dialogue.assess(ingrid, 'u-skola', { area: 'digital', tone: 'ok', comment: 'x'.repeat(2001) }),
    ).rejects.toThrow('Högst 2000 tecken.');
    expect(store.state.assessments.size).toBe(0);
  });
});

describe('activities', () => {
  test('an activity on a unit below goes to that unit’s manager as a card about the unit, audited without its text', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', {
      area: 'operations',
      text: 'Ta fram en plan för\r\nbemanningen',
      dueOn: '2026-12-01',
    });
    expect(store.state.activities.get(id)).toMatchObject({
      unitId: 'u-skola',
      areaKey: 'operations',
      ownerId: 'hillevi',
      createdBy: 'ingrid',
      text: 'Ta fram en plan för\nbemanningen',
      dueOn: '2026-12-01',
      threadId: 'id-5',
    });
    expect(store.calls()).toEqual([
      {
        op: 'open',
        threadId: 'id-5',
        personId: 'hillevi',
        activityId: id,
        dueOn: '2026-12-01',
        at: at(),
        subject: { entity: 'unit', key: 'u-skola' },
      },
    ]);
    expect(store.audit().filter(a => a.action === 'dialogue.activity_added')).toEqual([
      {
        actor: 'person:ingrid',
        action: 'dialogue.activity_added',
        subject: 'dialogue-activity:' + id,
        at: at(),
        details: { unitId: 'u-skola', area: 'operations', dueOn: '2026-12-01', owner: 'unit-manager' },
      },
    ]);
    // On her own unit the reader owns it, and without a date it has no timer.
    const own = await dialogue.addActivity(ingrid, 'u-top', { area: 'digital', text: 'Pröva verktyget' });
    expect(store.state.activities.get(own)).toMatchObject({ ownerId: 'ingrid', dueOn: null });
    expect(store.audit().at(-1)!.details).toMatchObject({ owner: 'self', dueOn: null });
    expect(JSON.stringify(store.audit())).not.toContain('bemanningen');
    expect(JSON.stringify(store.audit())).not.toContain('Pröva');
  });

  test('the card and the activity roll back together', async () => {
    store.sink.throwOn = 'open';
    await expect(dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'X' })).rejects.toThrow(
      'card sink failed',
    );
    expect(store.state.activities.size).toBe(0);
    expect(store.audit().filter(a => a.action.startsWith('dialogue.activity'))).toEqual([]);
  });

  test('blank text, a bad date, an unknown area and another manager’s unit are refused', async () => {
    await expect(dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: '   ' })).rejects.toThrow(
      'Skriv vad som ska göras.',
    );
    await expect(
      dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'X', dueOn: '2026-02-30' }),
    ).rejects.toThrow('Ange ett giltigt datum.');
    await expect(dialogue.addActivity(ingrid, 'u-skola', { area: 'nope', text: 'X' })).rejects.toThrow(
      'Området finns inte i dialogen.',
    );
    await expect(dialogue.addActivity(olle, 'u-skola', { area: 'operations', text: 'X' })).rejects.toThrow(
      ForbiddenError,
    );
    expect(store.state.activities.size).toBe(0);
  });

  test('done with a note, opened again, edited and removed, each with its card and its audit row', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', {
      area: 'operations',
      text: 'Plan',
      dueOn: '2026-12-01',
    });
    const threadId = store.state.activities.get(id)!.threadId!;
    // Removing an open activity is refused.
    await expect(dialogue.removeActivity(ingrid, id)).rejects.toThrow('Markera aktiviteten som klar innan');
    later(1);
    // The owner, Hillevi, marks it done with a note.
    await dialogue.completeActivity(hillevi, id, { note: 'Klar enligt plan.' });
    expect(store.state.activities.get(id)).toMatchObject({ doneBy: 'hillevi', doneNote: 'Klar enligt plan.' });
    expect(store.state.cards.get(threadId)!.state).toBe('handled');
    // A repeat is no change and no audit row.
    const rows = store.audit().length;
    await dialogue.completeActivity(hillevi, id);
    expect(store.audit().length).toBe(rows);
    later(1);
    await dialogue.reopenActivity(ingrid, id);
    expect(store.state.activities.get(id)).toMatchObject({ doneAt: null, doneBy: null, doneNote: null });
    expect(store.state.cards.get(threadId)!.state).toBe('open');
    later(1);
    await dialogue.editActivity(ingrid, id, { text: 'Ny plan', dueOn: null });
    expect(store.state.activities.get(id)).toMatchObject({ text: 'Ny plan', dueOn: null });
    expect(store.calls().at(-1)).toEqual({ op: 'retime', threadId, dueOn: null, at: at() });
    // Only the text changed: the card's date is left alone.
    await dialogue.editActivity(ingrid, id, { text: 'Ny plan igen', dueOn: null });
    expect(store.calls().filter(c => c.op === 'retime').length).toBe(1);
    later(1);
    await dialogue.completeActivity(ingrid, id);
    await dialogue.removeActivity(ingrid, id);
    expect(store.state.activities.has(id)).toBe(false);
    expect(store.state.cards.has(threadId)).toBe(false);
    expect(
      store
        .audit()
        .filter(a => a.subject === 'dialogue-activity:' + id)
        .map(a => [a.actor, a.action, a.details]),
    ).toEqual([
      [
        'person:ingrid',
        'dialogue.activity_added',
        { unitId: 'u-skola', area: 'operations', dueOn: '2026-12-01', owner: 'unit-manager' },
      ],
      ['person:hillevi', 'dialogue.activity_done', { unitId: 'u-skola', area: 'operations', by: 'owner', note: true }],
      ['person:ingrid', 'dialogue.activity_reopened', { unitId: 'u-skola', area: 'operations', by: 'manager' }],
      [
        'person:ingrid',
        'dialogue.activity_edited',
        { unitId: 'u-skola', area: 'operations', dueOn: null, text: true, by: 'manager' },
      ],
      [
        'person:ingrid',
        'dialogue.activity_edited',
        { unitId: 'u-skola', area: 'operations', dueOn: null, text: true, by: 'manager' },
      ],
      [
        'person:ingrid',
        'dialogue.activity_done',
        { unitId: 'u-skola', area: 'operations', by: 'manager', note: false },
      ],
      ['person:ingrid', 'dialogue.activity_removed', { unitId: 'u-skola', area: 'operations', by: 'manager' }],
    ]);
    expect(JSON.stringify(store.audit())).not.toContain('Klar enligt plan');
  });

  test('someone who neither follows up the unit nor owns the activity cannot change it', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'Plan' });
    await expect(dialogue.completeActivity(olle, id)).rejects.toThrow('Du kan inte ändra den här aktiviteten.');
    await expect(dialogue.completeActivity(olle, 'nope')).rejects.toThrow('Du kan inte ändra den här aktiviteten.');
    // The owner keeps their own activity even after the unit is no longer theirs to follow up.
    followed.set('hillevi', []);
    await dialogue.completeActivity(hillevi, id);
    expect(store.state.activities.get(id)!.doneBy).toBe('hillevi');
  });

  test('the timer brings an open dated activity back; a done one stays put', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', {
      area: 'operations',
      text: 'Plan',
      dueOn: '2026-11-20',
    });
    const threadId = store.state.activities.get(id)!.threadId!;
    later(60 * 24 * 10);
    expect(await dialogue.activityDue(threadId, 1)).toBe(true);
    expect(store.audit().at(-1)).toEqual({
      actor: 'system:scheduler',
      action: 'dialogue.activity_due',
      subject: 'dialogue-activity:' + id,
      at: at(),
      details: { unitId: 'u-skola', area: 'operations', dueOn: '2026-11-20', generation: 1 },
    });
    await dialogue.completeActivity(hillevi, id);
    expect(await dialogue.activityDue(threadId, 2)).toBe(false);
    expect(await dialogue.activityDue('unknown', 1)).toBe(false);
  });

  test('the unit lists open activities first by date, then the done ones, and says whose they are', async () => {
    const late = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'B', dueOn: '2026-12-20' });
    later(1);
    const soon = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'A', dueOn: '2026-11-20' });
    later(1);
    const undated = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'C' });
    later(1);
    const done = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'D' });
    await dialogue.completeActivity(ingrid, done, { note: 'Gjort.' });
    const asIngrid = (await dialogue.unit(ingrid, 'u-skola')).areas.find(a => a.key === 'operations')!;
    expect(asIngrid.activities.map(a => [a.id, a.owner, a.mine, a.doneNote])).toEqual([
      [soon, 'Hillevi Berg', false, undefined],
      [late, 'Hillevi Berg', false, undefined],
      [undated, 'Hillevi Berg', false, undefined],
      [done, 'Hillevi Berg', false, 'Gjort.'],
    ]);
    const asHillevi = (await dialogue.unit(hillevi, 'u-skola')).areas.find(a => a.key === 'operations')!;
    expect(asHillevi.activities.every(a => a.mine)).toBe(true);
    expect((await dialogue.mine(hillevi)).map(a => [a.text, a.unit, a.area, a.dueOn])).toEqual([
      ['A', 'Bergsåkers skola', 'Verksamhet', '2026-11-20'],
      ['B', 'Bergsåkers skola', 'Verksamhet', '2026-12-20'],
      ['C', 'Bergsåkers skola', 'Verksamhet', null],
    ]);
  });
});

describe('erasure and export', () => {
  test('erasing a person clears them from every row and removes the cards they owned; counts only in the audit', async () => {
    const id = await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'Plan' });
    await dialogue.assess(hillevi, 'u-skola', { area: 'digital', tone: 'warn' });
    const threadId = store.state.activities.get(id)!.threadId!;
    const auditBefore = store.audit();
    expect(await dialogue.erasePerson('operator:cli', 'Hillevi Berg')).toEqual({ refused: 'unknown' });
    expect(await dialogue.erasePerson('operator:cli', 'hillevi')).toEqual({ refused: 'active' });
    expect(store.audit()).toEqual(auditBefore);
    expect(store.state.cards.has(threadId)).toBe(true);
    store.addPerson('hillevi', 'Hillevi Berg', false);
    expect(await dialogue.erasePerson('operator:cli', 'hillevi')).toEqual({ cleared: 2, cards: 1 });
    expect(store.state.activities.get(id)).toMatchObject({ ownerId: null, threadId: null, createdBy: 'ingrid' });
    expect(store.state.cards.has(threadId)).toBe(false);
    expect([...store.state.assessments.values()].map(a => a.authorId)).toEqual([null]);
    expect(store.audit().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'dialogue.person_erased',
      subject: 'person:hillevi',
      at: at(),
      details: { cleared: 2, cards: 1 },
    });
  });

  test('the export holds the whole dialogue as clew.dialogue/1, audited with counts', async () => {
    await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'Plan' });
    await dialogue.assess(hillevi, 'u-skola', { area: 'digital', tone: 'warn', comment: 'Text' });
    const doc = await dialogue.exportDomain('operator:cli', ORG);
    expect(doc).toMatchObject({ format: 'clew.dialogue/1', organisationId: ORG, exportedAt: at() });
    expect([doc.areas.length, doc.questions.length, doc.assessments.length, doc.activities.length]).toEqual([
      3, 3, 1, 1,
    ]);
    expect(doc.activities[0]!.text).toBe('Plan');
    expect(store.audit().at(-1)).toMatchObject({
      action: 'dialogue.exported',
      details: { areas: 3, assessments: 1, activities: 1 },
    });
  });
});

describe('domain words', () => {
  test('the worst of states, the counts in words, and text as it is kept', () => {
    expect(worst(['ok', 'alert', 'warn'])).toBe('alert');
    expect(worst([])).toBeUndefined();
    expect([0, 1, 3].map(openWords)).toEqual(['Inga öppna aktiviteter', '1 öppen aktivitet', '3 öppna aktiviteter']);
    expect([0, 1, 2].map(overdueWords)).toEqual([undefined, '1 försenad', '2 försenade']);
    expect(normaliseText('\r\n  a\r\nb  \n')).toBe('a\nb');
  });
});

describe('the built-in connector', () => {
  const actor = (p: AuthenticatedContext): Actor => ({
    id: p.id,
    name: p.name,
    unitId: p.unitId,
    unitLabel: p.unitLabel,
    role: p.role,
  });
  const personas = new Map([ingrid, hillevi, olle, anna].map(p => [p.id, p]));
  const registry = () =>
    new Registry().register(
      dialogueConnector(dialogue, async a => {
        const p = personas.get(a.id);
        if (!p) throw new Error('unknown');
        return p;
      }),
    );

  test('it passes the registry validation, its reads are no model tools, and the unit read opens the dialogue drawer', () => {
    const connector = dialogueConnector(dialogue, async () => ingrid);
    expect(() => registry()).not.toThrow();
    expect(connector).toMatchObject({ id: 'dialogue', kind: 'core', source: 'Uppföljningsdialog' });
    const reads = connector.capabilities;
    expect(reads.map(c => [c.name, c.kind, c.model, menuEligible(c)])).toEqual([
      ['dialogue.unit', 'read', false, false],
      ['dialogue.activities', 'read', false, true],
    ]);
    for (const c of reads) {
      expect(viewProblem(c, reads)).toBeUndefined();
      expect(c.view && 'ref' in c.view).toBe(false);
    }
    const unit = reads[0]!;
    expect(unit.about).toEqual({ entity: 'unit', page: { title: 'Öppna dialogen', href: '?dialog={key}' } });
    expect(checkContract(EntityPageSchema, unit.about!.page)).toBe(true);
    expect(placesOf(unit)).toContain('section');
    // Action before watching before the calm states: the first state with a value is the cell's badge, word included.
    const fields = unitDialogueView.kind === 'list' ? unitDialogueView.fields : [];
    const tone = (key: string, value: string) =>
      fieldTone(
        fields.find(f => f.key === key)!,
        value,
      );
    expect(fields.map(f => f.key)).toEqual(['open', 'alert', 'warn', 'state', 'overdue']);
    expect([
      tone('alert', 'Åtgärd krävs: Verksamhet'),
      tone('warn', 'Bevaka: Digital transformation'),
      tone('state', 'Bra'),
      tone('state', 'Inte bedömd'),
    ]).toEqual(['alert', 'warn', 'ok', 'none']);
    expect(registry().tools(actor(ingrid))).toEqual([]);
  });

  test('dialogue.unit answers one row per unit the reader follows up, naming the areas that need action or watching', async () => {
    const r = registry();
    await dialogue.assess(ingrid, 'u-skola', { area: 'operations', dimension: 'mission', tone: 'alert' });
    await dialogue.assess(ingrid, 'u-skola', { area: 'digital', tone: 'warn' });
    await dialogue.assess(olle, 'u-other', { area: 'digital', tone: 'ok' });
    await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'A', dueOn: '2026-11-01' });
    await dialogue.addActivity(ingrid, 'u-skola', { area: 'digital', text: 'B' });
    const output = await r.run(actor(ingrid), 'dialogue.unit', { keys: ['u-top', 'u-skola', 'u-other', 'nope'] });
    expect(checkContract(UnitDialogueOutputSchema, output)).toBe(true);
    expect(output).toEqual({
      rows: [
        // Nothing open: no value, so the unit's page draws no key-figure tile; the state says nothing is assessed.
        { key: 'u-top', state: 'Inte bedömd' },
        {
          key: 'u-skola',
          open: '2 öppna aktiviteter',
          alert: 'Åtgärd krävs: Verksamhet',
          warn: 'Bevaka: Digital transformation',
          overdue: '1 försenad',
        },
      ],
    });
    // Assessed and nothing to act on or watch: "Bra".
    followed.set('ingrid', [
      ...followed.get('ingrid')!,
      { unitId: 'u-other', label: 'Annan enhet', relation: 'below', managerId: 'olle' },
    ]);
    expect(await r.run(actor(ingrid), 'dialogue.unit', { keys: ['u-other'] })).toEqual({
      rows: [{ key: 'u-other', state: 'Bra' }],
    });
    expect(await r.run(actor(olle), 'dialogue.unit', { keys: ['u-skola'] })).toEqual({ rows: [] });
    await expect(r.run(actor(anna), 'dialogue.unit', { keys: ['u-skola'] })).rejects.toThrow(
      'Du saknar behörighet för åtgärden.',
    );
  });

  test('dialogue.activities answers the reader’s own open activities, with the date in words or none', async () => {
    const r = registry();
    await dialogue.addActivity(ingrid, 'u-skola', { area: 'operations', text: 'A', dueOn: '2026-12-01' });
    await dialogue.addActivity(ingrid, 'u-skola', { area: 'digital', text: 'B' });
    const output = await r.run(actor(hillevi), 'dialogue.activities', {});
    expect(checkContract(MyActivitiesOutputSchema, output)).toBe(true);
    expect(output).toEqual({
      rows: [
        { text: 'A', unit: 'Bergsåkers skola', area: 'Verksamhet', dueOn: '2026-12-01', due: '1 december' },
        { text: 'B', unit: 'Bergsåkers skola', area: 'Digital transformation', due: 'Inget datum' },
      ],
    });
    expect(await r.run(actor(ingrid), 'dialogue.activities', {})).toEqual({ rows: [] });
  });
});
