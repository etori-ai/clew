import { describe, expect, test } from 'bun:test';
import type { MessageMeta, ViewEntry } from '@clew/contracts';
import { leadsElsewhere, namedInConversation, type NamedItem } from '../../apps/web/src/conversation-named';
import { NOTHING_SHOWN, withShown } from '../../apps/web/src/conversation-shown';

const items: Record<string, NamedItem> = {
  leave: { title: 'Ledighetsansökan från Anna Lindqvist', proposal: false, source: 'Personalsystemet', icon: 'people' },
  move: { title: 'Flytta samtalet', proposal: true, source: 'Kalender' },
};
const views: ViewEntry[] = [
  { capability: 'calendar.day', title: 'Dag', kind: 'detail' },
  { capability: 'hr.leave', title: 'Ledigheter', kind: 'table' },
  { capability: 'competence.attention', title: 'Krav', kind: 'detail', page: '/competence/matrix?only=attention' },
] as ViewEntry[];
const known = { item: (id: string) => items[id], views };
const view = (capability: string, title: string, input: Record<string, unknown> = {}) => ({
  capability,
  title,
  input,
  source: 'Kalender',
});
const hr = { assistant: 'eneo:hr', name: 'HR-assistenten', source: 'Eneo' };
const said = (...metas: MessageMeta[]) => metas.map(meta => ({ meta }));
const at = (search = '') => ({ pathname: '/conversations/c1', search });

describe('what a conversation has named, for the menu on the pane beside it', () => {
  test('work items, views that are one thing and assistants, each once, in the order they were named', () => {
    const sections = namedInConversation(
      said(
        { cards: ['leave'] },
        { view: view('calendar.day', 'Tisdag 25 november', { date: '2026-11-25' }) },
        { cards: ['move', 'leave'] },
        { view: view('calendar.day', 'Tisdag 25 november', { date: '2026-11-25' }) },
        { handed: hr },
        { handover: hr },
      ),
      at('?card=leave'),
      known,
    );
    expect(sections.map(s => s.title)).toEqual(['Ärenden · 2', 'Vyer · 1', 'Assistenter · 1']);
    expect(sections[0]!.things.map(t => [t.label, t.detail, t.current, t.icon])).toEqual([
      ['Ledighetsansökan från Anna Lindqvist', 'Ärende · Personalsystemet', true, 'people'],
      ['Flytta samtalet', 'Förslag · Kalender', false, undefined],
    ]);
    expect(sections[1]!.things[0]).toMatchObject({
      label: 'Tisdag 25 november',
      detail: 'Vy · Kalender',
      current: false,
    });
    expect(sections[2]!.things[0]).toMatchObject({
      label: 'HR-assistenten',
      detail: 'Assistent · Eneo',
      current: false,
    });
    expect(leadsElsewhere(sections)).toBe(true);
  });

  test('a row leads to the same conversation with that thing alone beside it', () => {
    const sections = namedInConversation(
      said(
        { cards: ['leave', 'move'] },
        { view: view('calendar.day', 'Tisdag', { date: '2026-11-25' }) },
        { handover: hr },
      ),
      at('?card=leave&assistant=eneo%3Ahr&from=%2Ftodo'),
      known,
    );
    const href = (label: string) => sections.flatMap(s => s.things).find(t => t.label === label)!.href;
    expect(href('Flytta samtalet')).toBe('/conversations/c1?from=%2Ftodo&card=move');
    const day = new URL(href('Tisdag'), 'http://clew.test').searchParams;
    expect([day.get('open'), day.get('open-input'), day.get('card'), day.get('assistant')]).toEqual([
      'calendar.day',
      '{"date":"2026-11-25"}',
      null,
      null,
    ]);
    // An assistant stands in the place of the thing the conversation is about, which stays in the address.
    expect(href('HR-assistenten')).toBe('/conversations/c1?card=leave&assistant=eneo%3Ahr&from=%2Ftodo');
  });

  test('the assistant beside the transcript is the current thing, not the item it stands in the place of', () => {
    const sections = namedInConversation(
      said({ cards: ['leave'] }, { handover: hr }),
      at('?card=leave&assistant=eneo%3Ahr'),
      known,
    );
    expect(sections.flatMap(s => s.things).map(t => [t.label, t.current])).toEqual([
      ['Ledighetsansökan från Anna Lindqvist', false],
      ['HR-assistenten', true],
    ]);
  });

  test('a view that answers with rows, declares no kind or has a page of its own is not listed', () => {
    const sections = namedInConversation(
      said(
        { view: view('hr.leave', 'Ledigheter') },
        { view: view('competence.attention', 'Krav') },
        // A read that declares no kind may answer with rows: not known to be one thing, so not listed.
        { view: view('clew.search', 'Källor', { query: 'semester' }) },
      ),
      at(),
      known,
    );
    expect(sections).toEqual([]);
  });

  test('the item the address names is listed though no message names it; alone, the menu leads nowhere', () => {
    const sections = namedInConversation(said({}), at('?card=leave'), known);
    expect(sections.map(s => s.title)).toEqual(['Ärenden · 1']);
    expect(leadsElsewhere(sections)).toBe(false);
  });

  test('what the person has put beside the conversation is listed though no message names it, each thing once', () => {
    // An answer that names its items only through a list's rows keeps no item by name.
    const before = withShown(withShown(NOTHING_SHOWN, '?card=leave'), '?open=clew.search&open-title=K%C3%A4llor');
    const sections = namedInConversation(
      said({ cards: ['leave'] }, {}),
      at('?card=move'),
      { ...known, source: () => 'Startsidan' },
      before,
    );
    expect(sections.map(s => s.title)).toEqual(['Ärenden · 2', 'Vyer · 1']);
    expect(sections[0]!.things.map(t => [t.label, t.current])).toEqual([
      ['Ledighetsansökan från Anna Lindqvist', false],
      ['Flytta samtalet', true],
    ]);
    // A view the person opened has stood beside the transcript, whatever its kind says; its system is the word after "Vy".
    expect(sections[1]!.things[0]).toMatchObject({ label: 'Källor', detail: 'Vy · Startsidan', current: false });
    expect(leadsElsewhere(sections)).toBe(true);
  });

  test('what has been shown keeps each thing once, the latest last, and never an assistant', () => {
    const shown = [
      '?card=a',
      '?card=b',
      '?card=a',
      '?card=c&assistant=eneo%3Ahr',
      '?open=v&open-input=%7B%22d%22%3A1%7D',
    ].reduce(withShown, NOTHING_SHOWN);
    expect(shown).toEqual({ items: ['b', 'a'], views: [{ capability: 'v', title: 'v', input: { d: 1 } }] });
  });

  test('the work items an answer names among the rows of a list it draws are listed at once, before any is opened', () => {
    // "Vilka är försenade?": the answer draws Att göra and names two of its rows; no card, nothing opened yet.
    const sections = namedInConversation(said({ viewItems: ['leave', 'move'] }), at(), known);
    expect(sections.map(s => s.title)).toEqual(['Ärenden · 2']);
    expect(sections[0]!.things.map(t => [t.label, t.current])).toEqual([
      ['Ledighetsansökan från Anna Lindqvist', false],
      ['Flytta samtalet', false],
    ]);
    // With one of them beside the transcript the menu leads to the other.
    const beside = namedInConversation(said({ viewItems: ['leave', 'move'] }), at('?card=leave'), known);
    expect(beside[0]!.things.map(t => t.current)).toEqual([true, false]);
    expect(leadsElsewhere(beside)).toBe(true);
  });

  test('an item the person cannot be shown by name is left out', () => {
    expect(namedInConversation(said({ cards: ['gone'] }), at(), known)).toEqual([]);
  });

  test('the view beside the transcript is checked by its capability and its input', () => {
    const sections = namedInConversation(
      said(
        { view: view('calendar.day', 'Måndag', { date: '2026-11-24' }) },
        { view: view('calendar.day', 'Tisdag', { date: '2026-11-25' }) },
      ),
      at('?open=calendar.day&open-title=Tisdag&open-input=' + encodeURIComponent('{"date":"2026-11-25"}')),
      known,
    );
    expect(sections[0]!.things.map(t => [t.label, t.current])).toEqual([
      ['Måndag', false],
      ['Tisdag', true],
    ]);
  });
});
