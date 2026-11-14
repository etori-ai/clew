import { describe, expect, test } from 'bun:test';
import type { Area, MenuEntry, SiteHeaderView, SystemMark } from '@clew/contracts';
import { narrowTools, toolboxPage, toolGroups, toolsOf, whatItIs } from '../src/tool-catalogue';

const entry = (capability: string, label: string, connector: string, source: string, title = label): MenuEntry => ({
  connector,
  source,
  capability,
  title,
  label,
  icon: 'document',
});
/** An area as `/api/areas` gives it, offering one standing read. */
const area = (id: string, capability: string, label: string): Area => ({
  id,
  title: label,
  connector: 'clew',
  source: 'Startsidan',
  icon: 'clock',
  figure: null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [{ capability, label, kind: 'read' }],
  schedules: [],
});
const phonebook = entry('phonebook.directory', 'Telefonbok', 'phonebook', 'Telefonboken', 'Sök i telefonboken');
const team = entry('phonebook.team', 'Mitt team', 'phonebook', 'Telefonboken', 'Mitt teams kontaktlista');
const sick = entry('qlik.sickLeaveByUnit', 'Sjukfrånvaro', 'qlik', 'Qlik', 'Sjukfrånvaro per enhet');
const requests = area('requests', 'clew.requests', 'Beställningar och felanmälningar');
const errands = area('arenden', 'clew.errands', 'Mina ärenden');

describe('toolsOf', () => {
  test('the placed views, in Swedish alphabetical order', () => {
    expect(toolsOf([phonebook, team], []).map(t => t.label)).toEqual(['Mitt team', 'Telefonbok']);
  });

  test("Clew's own lists the person has are tools, named as their capabilities name them for the menu", () => {
    const tools = toolsOf([phonebook], [requests, errands]);
    expect(tools.map(t => t.label)).toEqual(['Mina beställningar', 'Mina ärenden', 'Telefonbok']);
    expect(tools.find(t => t.capability === 'clew.requests')).toEqual({
      connector: 'clew',
      source: 'Startsidan',
      capability: 'clew.requests',
      title: 'Beställningar och felanmälningar',
      label: 'Mina beställningar',
      icon: 'clock',
    });
  });

  test('a list an administrator placed is listed once, as the menu has it', () => {
    const placed = entry('clew.errands', 'Mina ärenden', 'clew', 'Startsidan');
    expect(toolsOf([placed], [errands]).filter(t => t.capability === 'clew.errands')).toEqual([placed]);
  });

  test('without the area, the person has no such list and no such tool', () => {
    expect(toolsOf([], [])).toEqual([]);
    expect(toolsOf([], [area('other', 'hr.absence', 'Frånvaro')])).toEqual([]);
  });
});

describe('toolGroups', () => {
  const systems: SystemMark[] = [
    { connector: 'qlik', source: 'Qlik', ordinal: 2 },
    { connector: 'phonebook', source: 'Telefonboken', ordinal: 1 },
    { connector: 'clew', source: 'Startsidan', ordinal: null },
  ];

  test("by system: Clew's own first, then the order the systems were registered in, the tools' order kept", () => {
    const tools = toolsOf([phonebook, team, sick], [requests]);
    const groups = toolGroups(tools, systems);
    expect(groups.map(g => g.source)).toEqual(['Startsidan', 'Telefonboken', 'Qlik']);
    expect(groups[1]!.tools.map(t => t.label)).toEqual(['Mitt team', 'Telefonbok']);
  });

  test('a system the marks do not list comes last', () => {
    const other = entry('x.open', 'Avtal', 'avtal', 'Avtalsregistret');
    expect(toolGroups([other, sick], systems).map(g => g.connector)).toEqual(['qlik', 'avtal']);
  });
});

describe('narrowTools', () => {
  const tools = [phonebook, team, sick];

  test('every word typed, in any case, in the name, what it is or the system, the order kept', () => {
    // "Mitt team" by its system, Telefonboken.
    expect(narrowTools(tools, 'TELE').map(t => t.label)).toEqual(['Telefonbok', 'Mitt team']);
    expect(narrowTools(tools, 'per enhet').map(t => t.label)).toEqual(['Sjukfrånvaro']);
    expect(narrowTools(tools, 'qlik sjuk').map(t => t.label)).toEqual(['Sjukfrånvaro']);
    expect(narrowTools(tools, 'qlik tele')).toEqual([]);
  });

  test('nothing typed is every tool', () => {
    expect(narrowTools(tools, '  ')).toEqual(tools);
  });
});

describe('whatItIs', () => {
  test("the read's title when it says more than the name, else nothing", () => {
    expect(whatItIs(phonebook)).toBe('Sök i telefonboken');
    expect(whatItIs(entry('a.b', 'Nyheter', 'a', 'A', 'nyheter'))).toBeNull();
  });
});

describe('toolboxPage', () => {
  const header = (items: SiteHeaderView['menu']['items']): SiteHeaderView => ({
    menu: { version: 1, site: { name: 'Startsidan', href: '/' }, items },
    logo: null,
    source: { id: 'intranet', label: 'Intranätet' },
  });

  test('the first place or page the installation marked as its page of tools', () => {
    const page = {
      id: 'verktyg',
      label: 'Verktyg',
      href: 'https://intranat.example/verktyg',
      purpose: 'toolbox' as const,
    };
    expect(
      toolboxPage(
        header([
          { id: 'start', label: 'Start', href: '/' },
          { id: 'personal', label: 'Personal', href: '/intranat/personal', children: [page] },
        ]),
      ),
    ).toEqual(page);
  });

  test('none without a marked page, and none without a header', () => {
    expect(toolboxPage(header([{ id: 'start', label: 'Start', href: '/' }]))).toBeNull();
    expect(toolboxPage(undefined)).toBeNull();
  });
});
