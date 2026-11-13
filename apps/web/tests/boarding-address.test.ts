import { describe, expect, test } from 'bun:test';
import type { BoardingPlanOutput, BoardingPreview, EntitySource } from '@clew/contracts';
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
  needsPersonPage,
  rowControl,
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

describe('what an item’s row opens, from what it is tied to (D124)', () => {
  const order = {
    capability: 'servicedesk.order',
    connector: 'servicedesk',
    source: 'IT-servicedesken',
    title: 'Beställ från IT-servicedesken',
    kind: 'execute' as const,
    param: 'person',
  };
  const holdings = {
    capability: 'competence.holdings',
    title: 'Mina kompetenser',
    kind: 'list' as const,
    person: 'person',
    admits: ['self', 'managed', 'registrar'],
  };
  /** A section of the person's page whose way in is the holdings, as `competence.person` declares it. */
  const competenceSection: EntitySource = {
    capability: 'competence.person',
    connector: 'competence',
    source: 'Clew',
    title: 'Kompetens',
    view: {
      kind: 'list',
      title: 'status',
      fields: [{ key: 'status', label: 'Kompetens' }],
      open: { capability: 'competence.holdings', title: 'Kompetenser', params: { person: 'key' } },
    },
  };
  const context = {
    actions: [order],
    views: [
      {
        capability: 'servicedesk.equipment',
        title: 'IT-utrustning',
        kind: 'list' as const,
        person: 'person',
        admits: ['self', 'managed'],
      },
      { capability: 'phonebook.directory', title: 'Telefonboken', kind: 'table' as const },
      holdings,
    ],
    person: 'anna',
    standing: { relation: 'managed' as const, grants: [] },
    sections: [competenceSection],
    from: '/boarding/anna?plan=plan-1&from=%2Fstaff',
  };
  const item = (tiedTo: string | undefined, values: { done?: boolean; canTick?: boolean } = {}) => ({
    canTick: true,
    done: false,
    ...(tiedTo === undefined ? {} : { tiedTo }),
    ...values,
  });
  test('an action the reader may start for the person: a button with the answers its dialog starts from', () => {
    expect(rowControl(item('servicedesk.order?item=laptop'), context)).toEqual({
      kind: 'action',
      action: order,
      values: { item: 'laptop' },
    });
    // Done, it starts nothing again.
    expect(rowControl(item('servicedesk.order?item=laptop', { done: true }), context)).toBeNull();
  });
  test('a read the reader may open: its page with the person as its input where it takes one, this page as the way back', () => {
    expect(rowControl(item('servicedesk.equipment'), context)).toEqual({
      kind: 'read',
      title: 'IT-utrustning',
      href: '/tools/servicedesk.equipment?input=%7B%22person%22%3A%22anna%22%7D&title=IT-utrustning&from=%2Fboarding%2Fanna%3Fplan%3Dplan-1',
    });
    expect(rowControl(item('phonebook.directory'), context)).toEqual({
      kind: 'read',
      title: 'Telefonboken',
      href: '/tools/phonebook.directory?title=Telefonboken&from=%2Fboarding%2Fanna%3Fplan%3Dplan-1',
    });
    // A done item keeps a read's link; a read that takes a person needs their user name.
    expect(rowControl(item('servicedesk.equipment', { done: true }), context)?.kind).toBe('read');
    expect(rowControl(item('servicedesk.equipment'), { ...context, person: null })).toBeNull();
  });
  test('a read about the person only where it admits how the reader stands to them, named as their page names it', () => {
    // About a report, the read is named as the person's page names its way in, never by the reader's own title.
    expect(rowControl(item('competence.holdings'), context)).toEqual({
      kind: 'read',
      title: 'Kompetenser',
      href: '/tools/competence.holdings?input=%7B%22person%22%3A%22anna%22%7D&title=Kompetenser&from=%2Fboarding%2Fanna%3Fplan%3Dplan-1',
    });
    // About themself, the reader's own title is right.
    const self = { ...context, standing: { relation: 'self' as const, grants: [] } };
    expect(rowControl(item('competence.holdings'), self)).toMatchObject({ kind: 'read', title: 'Mina kompetenser' });
    // A buddy is a colleague: neither read admits one, so neither is offered, nor anything before the page has answered.
    const buddy = { ...context, standing: { relation: 'colleague' as const, grants: [] } };
    expect(rowControl(item('servicedesk.equipment'), buddy)).toBeNull();
    expect(rowControl(item('competence.holdings'), buddy)).toBeNull();
    expect(rowControl(item('servicedesk.equipment'), { ...context, standing: null })).toBeNull();
    // A colleague who holds `registrar` by grant is admitted where the read admits it (D121); a read that takes no
    // person is no one's to admit.
    const registrar = { ...context, standing: { relation: 'colleague' as const, grants: ['registrar'] } };
    expect(rowControl(item('competence.holdings'), registrar)).toMatchObject({ kind: 'read', title: 'Kompetenser' });
    expect(rowControl(item('servicedesk.equipment'), registrar)).toBeNull();
    expect(rowControl(item('phonebook.directory'), { ...buddy, standing: null })).toMatchObject({ kind: 'read' });
    // A read that says nothing of whom it admits admits the person themself and their manager (D117's default).
    const { admits: _admits, ...undeclared } = holdings;
    expect(rowControl(item('competence.holdings'), { ...buddy, views: [undeclared] })).toBeNull();
    expect(rowControl(item('competence.holdings'), { ...context, views: [undeclared] })?.kind).toBe('read');
    // Without a section that names it, a read about someone else keeps its own title.
    expect(rowControl(item('competence.holdings'), { ...context, sections: [] })).toMatchObject({
      title: 'Mina kompetenser',
    });
  });
  test('an https address: a link out, done or not', () => {
    expect(rowControl(item('https://intranet.example.org/vardegrund', { done: true }), context)).toEqual({
      kind: 'link',
      href: 'https://intranet.example.org/vardegrund',
      host: 'intranet.example.org',
    });
  });
  test('nothing for a capability the reader may not use, plain words, no tie, or a reader who may not act on the item', () => {
    expect(rowControl(item('hr.registerAbsence'), context)).toBeNull();
    expect(rowControl(item('Kursen i HLR'), context)).toBeNull();
    expect(rowControl(item(undefined), context)).toBeNull();
    expect(rowControl(item('servicedesk.order?item=laptop', { canTick: false }), context)).toBeNull();
    expect(rowControl(item('https://intranet.example.org/', { canTick: false }), context)).toBeNull();
    // The person's page is read where a row names an action, or a read that takes the person, which it admits through.
    expect(needsPersonPage([item('phonebook.directory'), item('https://intranet.example.org/')], context.views)).toBe(
      false,
    );
    expect(needsPersonPage([item('servicedesk.equipment')], context.views)).toBe(true);
    expect(needsPersonPage([item('servicedesk.equipment', { done: true })], context.views)).toBe(true);
    expect(needsPersonPage([item('servicedesk.equipment', { canTick: false })], context.views)).toBe(false);
    expect(needsPersonPage([item('servicedesk.order?item=laptop')], context.views)).toBe(true);
    expect(needsPersonPage([item('servicedesk.order?item=laptop', { done: true })], context.views)).toBe(false);
  });
});
