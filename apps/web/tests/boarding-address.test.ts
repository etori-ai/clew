import { describe, expect, test } from 'bun:test';
import type { BoardingPlanOutput, BoardingPreview } from '@clew/contracts';
import {
  BOARDING_LENS_HREF,
  boardingHref,
  boardingPersonOf,
  personReadOf,
  planOf,
  planReadOf,
  startOf,
  withPlan,
  withStart,
  withoutStart,
} from '../src/boarding-address';
import {
  conditionWords,
  unitLabelOf,
  counts,
  daysBetween,
  distanceWords,
  hasOpen,
  itemLine,
  ownerWords,
  phaseWhen,
  planCounts,
  planTitle,
  previewOwners,
  layerCounts,
  withTicked,
} from '../src/boarding';
import { sourcePageHref } from '../src/talk-address';
import { originLabel } from '../src/person-address';

describe("one person's introduction and leaving is a page with an address (D124, D116)", () => {
  test('the page is the person by Clew’s id, with a plan chosen, the start dialog and the way back', () => {
    expect(boardingHref('p1')).toBe('/boarding/p1');
    expect(boardingHref('a b/c')).toBe('/boarding/a%20b%2Fc');
    expect(boardingHref('p1', { plan: 'plan-1', from: '/staff?show=boarding.person' })).toBe(
      '/boarding/p1?plan=plan-1&from=%2Fstaff%3Fshow%3Dboarding.person',
    );
    expect(boardingHref('p1', { start: 'leaving' })).toBe('/boarding/p1?start=leaving');
    // `from` never holds a `from` of its own, and never another site.
    expect(boardingHref('p1', { from: '/people/anna?from=%2Fstaff' })).toBe('/boarding/p1?from=%2Fpeople%2Fanna');
    expect(boardingHref('p1', { from: '//evil.example' })).toBe('/boarding/p1');
  });
  test('the page names its person, or none', () => {
    expect(boardingPersonOf('/boarding/p1')).toBe('p1');
    expect(boardingPersonOf('/boarding/a%20b')).toBe('a b');
    expect(boardingPersonOf('/boarding/')).toBeNull();
    expect(boardingPersonOf('/boarding/p1/x')).toBeNull();
    expect(boardingPersonOf('/people/p1')).toBeNull();
    expect(boardingPersonOf('/boarding/' + 'x'.repeat(81))).toBeNull();
  });
  test('the plan the address chooses: 1 to 80 characters, else the page chooses', () => {
    expect(planOf('?plan=plan-1')).toBe('plan-1');
    expect(planOf('?plan=')).toBeNull();
    expect(planOf('')).toBeNull();
    expect(planOf('?plan=' + 'x'.repeat(81))).toBeNull();
    // Choosing a plan keeps the way back and lets go of the start dialog.
    expect(withPlan('/boarding/p1', '?from=%2Fstaff&start=leaving', 'plan-2')).toBe(
      '/boarding/p1?from=%2Fstaff&plan=plan-2',
    );
  });
  test('the start dialog is `start` over the page, for one of the two events; closing drops it alone', () => {
    expect(startOf('?start=introduction')).toBe('introduction');
    expect(startOf('?start=leaving')).toBe('leaving');
    expect(startOf('?start=other')).toBeNull();
    expect(startOf('')).toBeNull();
    expect(withStart('/boarding/p1', '?from=%2Fstaff', 'introduction')).toBe(
      '/boarding/p1?from=%2Fstaff&start=introduction',
    );
    expect(withoutStart('/boarding/p1', '?from=%2Fstaff&start=introduction&plan=x')).toBe(
      '/boarding/p1?from=%2Fstaff&plan=x',
    );
    expect(withoutStart('/boarding/p1', '?start=leaving')).toBe('/boarding/p1');
  });
  test("an item's card leads to the plan's read; its page names the plan and the way back", () => {
    const input = encodeURIComponent(JSON.stringify({ plan: 'plan-1' }));
    expect(planReadOf(`?input=${input}&from=%2Ftodo%3Fitem%3Dt1`)).toEqual({ plan: 'plan-1', from: '/todo?item=t1' });
    expect(planReadOf('?input=%7Bnot%20json')).toEqual({ plan: null, from: null });
    expect(planReadOf(`?input=${encodeURIComponent(JSON.stringify({ plan: 3 }))}`)).toEqual({ plan: null, from: null });
    expect(planReadOf(`?input=${input}&from=https%3A%2F%2Fevil.example`)).toEqual({ plan: 'plan-1', from: null });
  });
  test("the suggestion's card reads one person; its page names their user name, and more than one is Personal's lens", () => {
    const one = encodeURIComponent(JSON.stringify({ keys: ['sara.holm'] }));
    expect(personReadOf(`?input=${one}&from=%2F`)).toEqual({ key: 'sara.holm', from: '/' });
    const two = encodeURIComponent(JSON.stringify({ keys: ['a', 'b'] }));
    expect(personReadOf(`?input=${two}`)).toEqual({ key: null, from: null });
    expect(personReadOf('')).toEqual({ key: null, from: null });
    expect(BOARDING_LENS_HREF).toBe('/staff?show=boarding.person');
  });
  test("a person's page and Personal's lens lead to the plan's page with the page they are on as the way back", () => {
    const plan = { title: 'Öppna planen', href: '/boarding/{id}' };
    const sara = { key: 'sara.holm', id: 'p-sara' };
    expect(
      sourcePageHref(plan, sara, { pathname: '/people/sara.holm', search: '?from=%2Fstaff' }, '/people/sara.holm'),
    ).toBe('/boarding/p-sara?from=%2Fpeople%2Fsara.holm');
    expect(
      sourcePageHref(
        plan,
        sara,
        { pathname: '/staff', search: '?show=boarding.person' },
        '/staff?show=boarding.person',
      ),
    ).toBe('/boarding/p-sara?from=%2Fstaff%3Fshow%3Dboarding.person');
    // A place in the rail is a destination and names no way back; neither does a way in without one given.
    const lens = { title: 'Visa i Personal', href: '/staff?show=talks.person' };
    expect(sourcePageHref(lens, { key: 'u', id: 'u1' }, { pathname: '/units/u1', search: '' }, '/units/u1')).toBe(
      '/staff?show=talks.person',
    );
    expect(sourcePageHref(plan, sara, { pathname: '/staff', search: '' })).toBe('/boarding/p-sara');
  });
  test("the person's page opened from the plan's Tillhör names the plan's page as its way back", () => {
    expect(originLabel('/boarding/p-sara?plan=plan-1')).toBe('Introduktion och avslut');
  });
});

describe('the words the plan says things in (D124)', () => {
  test('the heading and how far the day is', () => {
    expect(planTitle('introduction', 'Sara Holm')).toBe('Introduktion för Sara Holm');
    expect(planTitle('leaving', 'Lena Ek')).toBe('Avslut för Lena Ek');
    expect(daysBetween('2026-11-13', '2026-12-01')).toBe(18);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(distanceWords('introduction', '2026-12-01', '2026-11-13')).toBe('Börjar om 18 dagar');
    expect(distanceWords('introduction', '2026-11-14', '2026-11-13')).toBe('Börjar i morgon');
    expect(distanceWords('introduction', '2026-11-13', '2026-11-13')).toBe('Börjar i dag');
    expect(distanceWords('introduction', '2026-11-12', '2026-11-13')).toBe('Började i går');
    expect(distanceWords('introduction', '2026-11-03', '2026-11-13')).toBe('Började för 10 dagar sedan');
    expect(distanceWords('leaving', '2026-11-28', '2026-11-13')).toBe('Slutar om 15 dagar');
    expect(distanceWords('leaving', '2026-11-10', '2026-11-13')).toBe('Slutade för 3 dagar sedan');
  });
  test('a phase says the days the server counts into it', () => {
    expect(phaseWhen('beforeStart', '2026-12-01')).toBe('senast måndag 30 november');
    expect(phaseWhen('firstDay', '2026-12-01')).toBe('tisdag 1 december');
    expect(phaseWhen('firstWeek', '2026-12-01')).toBe('onsdag 2 december till måndag 7 december');
    expect(phaseWhen('later', '2026-12-01')).toBe('från måndag 1 mars');
    expect(phaseWhen('lastWeek', '2026-11-28')).toBe('söndag 22 november till fredag 27 november');
    expect(phaseWhen('afterLeaving', '2026-11-28')).toBe('från söndag 29 november');
  });
  test('an item says its kind, who does it and its day; whom a layer applies to is said in words', () => {
    const row = { kindLabel: 'Möte', mine: false, owner: 'Erik Nyström', ownerLabel: 'Fadder', dueOn: '2026-12-05' };
    expect(ownerWords(row)).toBe('Fadder, Erik Nyström');
    expect(ownerWords({ ...row, mine: true })).toBe('Du');
    expect(ownerWords({ mine: false, ownerLabel: 'Chef' })).toBe('Chef');
    expect(itemLine(row)).toBe('Möte · Fadder, Erik Nyström · senast lör 5 dec.');
    expect(conditionWords('all', null)).toBe('Alla anställda');
    // A unit by the name the server gives it, else by its id as the file wrote it.
    expect(conditionWords('unit', 'unit-skola', 'Sköndals skola')).toBe(
      'Enhet: Sköndals skola och enheterna under den',
    );
    expect(conditionWords('unit', 'unit-omsorg')).toBe('Enhet: unit-omsorg och enheterna under den');
    expect(unitLabelOf({ condition: 'unit', unitLabel: 'Sköndals skola' })).toBe('Sköndals skola');
    expect(unitLabelOf({ condition: 'unit' })).toBeUndefined();
    expect(unitLabelOf({ unitLabel: '' })).toBeUndefined();
    expect(conditionWords('position', 'underskoterska')).toBe('Befattning: underskoterska');
    expect(conditionWords('employment_type', 'Konsult')).toBe('Anställningsform: Konsult');
  });
});

const row = (
  id: string,
  values: Partial<BoardingPlanOutput['rows'][number]> = {},
): BoardingPlanOutput['rows'][number] => ({
  id,
  title: 'Punkt ' + id,
  kind: 'todo',
  kindLabel: 'Att göra',
  ownerRole: 'manager',
  ownerLabel: 'Chef',
  mine: true,
  dueOn: '2026-11-20',
  phase: 'beforeStart',
  phaseLabel: 'Före första dagen',
  done: false,
  status: 'Att göra',
  added: false,
  canTick: true,
  ...values,
});
describe('a tick is drawn before the server answers, and the counts follow it', () => {
  const rows = [
    row('a', { done: true, status: 'Klar', doneAt: '2026-11-10T08:00:00.000Z' }),
    row('b', { dueOn: '2026-11-01', status: 'Försenad' }),
    row('c', { mine: false }),
  ];
  const plan: BoardingPlanOutput = {
    plan: {
      id: 'plan-1',
      personId: 'p1',
      name: 'Sara Holm',
      userName: 'sara.holm',
      event: 'introduction',
      anchorOn: '2026-12-01',
      buddy: null,
      startedBy: null,
      startedAt: '2026-11-01T08:00:00.000Z',
      closedAt: null,
      done: 1,
      total: 3,
      access: 'manager',
    },
    phases: [{ phase: 'beforeStart', label: 'Före första dagen', items: rows }],
    rows,
  };
  test('the counts: done of all, what waits for the reader, what is past its day', () => {
    expect(counts(rows)).toEqual({ done: 1, total: 3, waiting: 1, overdue: 1 });
    // The header's done of all is the server's; a tick drawn at once moves it with the row.
    expect(planCounts({ ...plan, plan: { ...plan.plan, done: 4, total: 9 } })).toEqual({
      done: 4,
      total: 9,
      waiting: 1,
      overdue: 1,
    });
    expect(planCounts(withTicked(plan, 'b', true, '2026-11-13'))).toEqual({
      done: 2,
      total: 3,
      waiting: 0,
      overdue: 0,
    });
  });
  test('ticking off an overdue item makes it done; opening one again makes it overdue or to do by its day', () => {
    const ticked = withTicked(plan, 'b', true, '2026-11-13');
    expect(ticked.rows.find(r => r.id === 'b')).toMatchObject({ done: true, status: 'Klar' });
    expect(ticked.phases[0]!.items.find(r => r.id === 'b')).toMatchObject({ done: true, status: 'Klar' });
    expect(ticked.plan.done).toBe(2);
    const opened = withTicked(plan, 'a', false, '2026-11-13');
    expect(opened.rows.find(r => r.id === 'a')).toMatchObject({ done: false, status: 'Att göra' });
    expect(opened.rows.find(r => r.id === 'a')!.doneAt).toBeUndefined();
    expect(opened.plan.done).toBe(0);
    expect(withTicked(plan, 'a', false, '2026-11-21').rows.find(r => r.id === 'a')!.status).toBe('Försenad');
    // A tick that changes nothing counts nothing.
    expect(withTicked(plan, 'a', true, '2026-11-13').plan.done).toBe(1);
  });
  test('an open plan of an event is one a second start would be refused for', () => {
    const summary = { ...plan.plan, waiting: 0, overdue: 0, state: 'open' as const };
    expect(hasOpen([summary], 'introduction')).toBe(true);
    expect(hasOpen([summary], 'leaving')).toBe(false);
    expect(hasOpen([{ ...summary, closedAt: '2026-11-12T08:00:00.000Z' }], 'introduction')).toBe(false);
  });
});

describe("the start dialog's last step says who gets what from which layers", () => {
  const preview: BoardingPreview = {
    person: { id: 'p1', name: 'Sara Holm' },
    event: 'introduction',
    anchorOn: '2026-12-01',
    buddy: { id: 'b1', name: 'Erik Nyström' },
    layers: [
      { id: 'all', name: 'Alla anställda', condition: 'all', value: null },
      { id: 'it', name: 'IT-avdelningen', condition: 'unit', value: 'unit-it' },
    ],
    items: [
      {
        title: 'Dator',
        kind: 'order',
        ownerRole: 'manager',
        owner: { id: 'm1', name: 'Anna Berg' },
        dueOn: '2026-11-17',
        phase: 'beforeStart',
        layerId: 'all',
      },
      {
        title: 'Rundvandring',
        kind: 'todo',
        ownerRole: 'buddy',
        owner: { id: 'b1', name: 'Erik Nyström' },
        dueOn: '2026-12-01',
        phase: 'firstDay',
        layerId: 'all',
      },
      {
        title: 'Logga in',
        kind: 'todo',
        ownerRole: 'person',
        owner: { id: 'p1', name: 'Sara Holm' },
        dueOn: '2026-12-01',
        phase: 'firstDay',
        layerId: 'it',
      },
      {
        title: 'Avstämning',
        kind: 'meeting',
        ownerRole: 'manager',
        owner: { id: 'm1', name: 'Anna Berg' },
        dueOn: '2026-12-31',
        phase: 'first90Days',
        layerId: 'it',
      },
    ],
  };
  test('each owner with how many and the first due, the reader as Du, in the order the first is due', () => {
    expect(previewOwners(preview, 'm1')).toEqual([
      { id: 'm1', name: 'Anna Berg', you: true, count: 2, first: '2026-11-17' },
      { id: 'b1', name: 'Erik Nyström', you: false, count: 1, first: '2026-12-01' },
      { id: 'p1', name: 'Sara Holm', you: false, count: 1, first: '2026-12-01' },
    ]);
    expect([...layerCounts(preview)]).toEqual([
      ['all', 2],
      ['it', 2],
    ]);
  });
});
