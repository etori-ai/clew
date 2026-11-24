import { describe, expect, test } from 'bun:test';
import {
  calendarEntryHref,
  cardOverPage,
  pageOnly,
  panelRedirect,
  panelSearch,
  readOf,
  viewSearch,
  withCard,
  withEntry,
  withView,
  withoutPanel,
  withoutRead,
  withoutView,
} from '../src/panel-address';

describe('a work item opened from a page is its own page (D126 rule 1)', () => {
  test('the page it was opened from is the way back, without what lay over it or a way back of its own', () => {
    expect(withCard('/people/johan', '?section=needs-you&from=%2Fstaff', 'samtal-svar')).toBe(
      '/items/samtal-svar?from=%2Fpeople%2Fjohan%3Fsection%3Dneeds-you',
    );
    expect(withCard('/calendar', '', 'ledighet')).toBe('/items/ledighet?from=%2Fcalendar');
    expect(withCard('/staff', '?show=x&card=t1&open-card=t1&open-action=pattern&talk=anna', 't2')).toBe(
      '/items/t2?from=%2Fstaff%3Fshow%3Dx',
    );
    // On the item's own page the item is the page.
    expect(withCard('/items/ledighet', '?from=%2Fstaff&review=ledighet', 'ledighet')).toBe(
      '/items/ledighet?from=%2Fstaff',
    );
  });
  test('beside a conversation the item is the thing beside the transcript, in the place of what was there (rule 2)', () => {
    expect(withCard('/conversations/c1', '?open=hr.whoIsOn&open-title=Bemanning&via=1', 'ledighet')).toBe(
      '/conversations/c1?card=ledighet',
    );
    expect(withCard('/conversations/c1', '?card=fakturor&open-card=fakturor&open-action=pattern', 'ledighet')).toBe(
      '/conversations/c1?card=ledighet',
    );
  });
  test('from the bell, a toast or the search: the reading pane in Att göra, else the item’s page', () => {
    expect(cardOverPage('/admin/connectors', '', 'ledighet')).toBe('/items/ledighet?from=%2Fadmin%2Fconnectors');
    expect(cardOverPage('/', '?review=fakturor&step=2', 'ledighet')).toBe('/items/ledighet?from=%2F');
    expect(cardOverPage('/todo', '?tab=waiting&item=fakturor&review=fakturor&step=2', 'ledighet')).toBe(
      '/todo?tab=waiting&item=ledighet',
    );
    expect(cardOverPage('/items/ledighet', '?from=%2Fstaff&review=ledighet', 'ledighet')).toBe(
      '/items/ledighet?from=%2Fstaff',
    );
    expect(cardOverPage('/items/fakturor', '?from=%2Ftodo', 'ledighet')).toBe(
      '/items/ledighet?from=%2Fitems%2Ffakturor',
    );
    expect(cardOverPage('/people/karin', '?from=%2Fstaff&talk=karin', 'ledighet')).toBe(
      '/items/ledighet?from=%2Fpeople%2Fkarin',
    );
  });
});

describe('a view opened from a page is its own page (D126 rule 1)', () => {
  test('with the page it was opened from as the way back', () => {
    expect(
      withView('/', '?open=phonebook.directory&open-title=Telefonbok&via=1', {
        capability: 'phonebook.person',
        title: 'Kontaktkort',
        input: { ref: 'p1' },
      }),
    ).toBe('/tools/phonebook.person?input=%7B%22ref%22%3A%22p1%22%7D&title=Kontaktkort&from=%2F');
    expect(withView('/calendar', '?ask=1', { capability: 'calendar.rooms', title: 'Mötesrum' })).toBe(
      '/tools/calendar.rooms?title=M%C3%B6tesrum&from=%2Fcalendar',
    );
  });
  test('beside a conversation one thing stands beside the transcript, and an old drill-in mark is let go of', () => {
    expect(
      withView('/conversations/c1', '?open=phonebook.directory&open-title=Telefonbok&via=1', {
        capability: 'phonebook.person',
        title: 'Kontaktkort',
        input: { ref: 'p1' },
      }),
    ).toBe('/conversations/c1?open=phonebook.person&open-title=Kontaktkort&open-input=%7B%22ref%22%3A%22p1%22%7D');
  });
  test('without the view the page keeps everything else', () => {
    expect(withoutView('/', '?card=t1&open=a.b&open-title=A&open-input=%7B%7D&via=1')).toBe('/?card=t1');
    expect(withoutView('/people/anna', '?from=%2Fstaff')).toBe('/people/anna?from=%2Fstaff');
  });
  test("a view's part of the conversation page's address: the view beside the transcript", () => {
    expect(viewSearch({ capability: 'calendar.week', title: 'Vecka 45', input: { from: '2026-11-02' } })).toBe(
      '?open=calendar.week&open-title=Vecka+45&open-input=%7B%22from%22%3A%222026-11-02%22%7D',
    );
  });
});

describe('a calendar entry drawn on another page leads to its own place on Kalender (D112 item 9)', () => {
  test('the day is the entry’s day in Clew’s zone, never the day of its instant in UTC', () => {
    // 23:30 UTC on Tuesday 24 November is half past midnight on Wednesday in Stockholm.
    expect(calendarEntryHref({ id: 'e1', start: '2026-11-24T23:30:00.000Z' }, 'day')).toBe(
      '/calendar?date=2026-11-25&view=day&entry=e1',
    );
    expect(calendarEntryHref({ id: 'e1', start: '2026-11-24T22:30:00.000Z' }, 'week')).toBe(
      '/calendar?date=2026-11-24&view=week&entry=e1',
    );
  });
  test('an all-day entry is at its own date, which no zone moves', () => {
    expect(calendarEntryHref({ id: 'memory:ledig', start: '2026-11-24' }, 'week')).toBe(
      '/calendar?date=2026-11-24&view=week&entry=memory%3Aledig',
    );
  });
});

describe('an address that opened a thing over a page leads to its page (D126 rule 3)', () => {
  test('a card to the item’s page, a view to the view’s page, the page it lay over as the way back', () => {
    expect(panelRedirect('/', '?card=ledighet')).toBe('/items/ledighet?from=%2F');
    expect(panelRedirect('/staff', '?show=x&card=t1&review=t1')).toBe('/items/t1?from=%2Fstaff%3Fshow%3Dx');
    expect(panelRedirect('/tools/phonebook.directory', '?input=%7B%7D&open=phonebook.person&open-title=Anna')).toBe(
      '/tools/phonebook.person?title=Anna&from=%2Ftools%2Fphonebook.directory%3Finput%3D%257B%257D',
    );
  });
  test('a card’s unfolded read goes along, so the item’s page leads on to the read’s page', () => {
    expect(panelRedirect('/staff', '?card=t1&open-card=t1&open-action=pattern')).toBe(
      '/items/t1?from=%2Fstaff&open-card=t1&open-action=pattern',
    );
  });
  test('in Att göra a card is the item in the reading pane; on its own page it is that page', () => {
    expect(panelRedirect('/todo', '?tab=waiting&card=t1')).toBe('/todo?tab=waiting&item=t1');
    expect(panelRedirect('/items/t1', '?from=%2Ftodo&card=t1')).toBe('/items/t1?from=%2Ftodo');
  });
  test('nothing on the conversation’s page, in an address with nothing of the kind, or Kalender’s own entry', () => {
    expect(panelRedirect('/conversations/c1', '?card=t1')).toBeNull();
    expect(panelRedirect('/staff', '?show=x')).toBeNull();
    expect(panelRedirect('/calendar', '?date=2026-11-09&entry=p1')).toBeNull();
  });
});

describe('the addresses from before that still mean something', () => {
  test('a card’s read from before is named, so the item can lead it to the read’s page', () => {
    const q = new URLSearchParams('?show=x&card=t1&open-card=t1&open-action=pattern');
    expect(readOf(q)).toEqual({ threadId: 't1', actionId: 'pattern' });
    expect(readOf(new URLSearchParams('?card=t1&open-card=t1'))).toBeNull();
    expect(withoutRead('/staff', '?show=x&card=t1&open-card=t1&open-action=pattern')).toBe('/staff?show=x&card=t1');
  });
  test("Kalender's entry is the page's own thing", () => {
    expect(withEntry('/calendar', '?date=2026-11-09&view=week&ask=1', 'p1')).toBe(
      '/calendar?date=2026-11-09&view=week&entry=p1',
    );
    expect(withoutPanel('/calendar', '?date=2026-11-09&entry=p1')).toBe('/calendar?date=2026-11-09');
  });
  test('the page’s own address keeps nothing of what lay beside or over it, nor "Fråga assistenten" from before', () => {
    expect(pageOnly('/staff', '?show=x&card=t1&open-card=t1&open-action=pattern')).toBe('/staff?show=x');
    expect(pageOnly('/', '?tab=done&card=f&review=f&step=2')).toBe('/?tab=done');
    expect(pageOnly('/calendar', '?date=2026-11-09&entry=p1&ask=1')).toBe('/calendar?date=2026-11-09');
  });
  test('a conversation takes the thing along, never a page’s own thing', () => {
    expect(panelSearch('?show=x&card=t1&open-card=t1&open-action=pattern')).toBe(
      '?card=t1&open-card=t1&open-action=pattern',
    );
    expect(panelSearch('?entry=p1&ask=1&card=c1')).toBe('?card=c1');
  });
});
