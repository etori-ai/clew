import type { Page, Route } from '@playwright/test';
import type { MockApi } from './support';
import type { EntityDetail, EntitySection, EntitySource, PanelViewSpec, View } from '@clew/contracts';
import { PRESENCE_LENS, SILENT_SECTION, TALK_LENS, entityDetail, entityList, entityRows, talkSource } from './data';

/**
 * The opened person (D97 item 5) as artboards C, C2, D and G draw Johan Byström: the mock's sources (`data.ts`) and two
 * more the person slice needs and the list does not, Kontakt from the directory and the talk's action points as the
 * talk section's fuller read. The spec registers these routes over the shared mock, which answers everything else.
 */
export const CONTACT = 'directory.contact';
export const POINTS = 'clew.talkPoints';
export const COMPETENCE_SOURCE = 'Kompetenssystemet';
const withOpen = (view: View): View =>
  view.kind === 'table' || view.kind === 'list'
    ? { ...view, open: { capability: POINTS, title: 'Alla åtgärdspunkter', params: { person: 'key' } } }
    : view;
/** The talk section with its action points as its fuller read (artboard C). */
export const talkWithPoints: EntitySource = { ...talkSource, view: withOpen(talkSource.view) };
export const contactSource: EntitySource = {
  capability: CONTACT,
  connector: 'directory',
  source: 'Katalogen',
  title: 'Kontakt',
  view: {
    kind: 'list',
    title: 'email',
    fields: [
      { key: 'email', label: 'E-post', format: 'email' },
      { key: 'phone', label: 'Telefon', format: 'phone' },
      { key: 'place', label: 'Arbetsplats' },
    ],
  },
};
/** Each source's row by the person's user name, the key it was asked with (D116). */
const contactRows: Record<string, Record<string, unknown>> = {
  'johan.bystrom': { key: 'johan.bystrom', email: 'johan@clew.test', phone: '060-00 00 00', place: 'Hus B, plan 2' },
  'anna.lindqvist': { key: 'anna.lindqvist', email: 'anna@clew.test', phone: '060-00 00 01' },
};
/** What the competence system answers once it answers again. */
const competenceRows: Record<string, Record<string, unknown>> = {
  'johan.bystrom': { key: 'johan.bystrom', name: 'HLR vuxen', validTo: '2026-09-15' },
};
export const pointsSpec: PanelViewSpec = {
  kind: 'list',
  capability: POINTS,
  connector: 'clew',
  source: 'Utvecklingssamtal',
  chip: false,
  title: 'text',
  noun: { one: 'åtgärdspunkt', other: 'åtgärdspunkter' },
  fields: [
    { key: 'text', label: 'Åtgärdspunkt' },
    { key: 'owner', label: 'Ansvarig' },
    { key: 'dueOn', label: 'Klar senast', format: 'date' },
    { key: 'state', label: 'Läge', format: 'status', tones: { Försenad: 'warn' } },
  ],
};
export const pointsOutput = {
  rows: [
    { text: 'Boka kurs i NPF-anpassningar', owner: 'Johan', dueOn: '2026-10-30', state: 'Försenad' },
    { text: 'Skicka underlag om schemaläggning', owner: 'Du', dueOn: '2026-11-03', state: 'Försenad' },
    { text: 'Prova ämnesövergripande tema i åk 5', owner: 'Johan', dueOn: '2026-12-18' },
  ],
};

/**
 * The person routes for one test: the opened person with the extra sections, each section's answer (with a delay or
 * a silence per source, and a count of the reads), the talk's action points, and a colleague's reading (artboard G).
 */
export class People {
  /** The reader is a colleague (artboard G): one action, the directory's section, no cards. */
  colleague = false;
  /** How long a source takes to answer, by capability. */
  delay: Record<string, number> = {};
  /** Sources that do not answer, by capability. */
  silent: Record<string, 'unavailable' | 'timeout'> = { [SILENT_SECTION]: 'unavailable' };
  /** Sources that answer without a row for the person, by capability: their sections are left out. */
  empty: string[] = [];
  /** Every section read, by capability, in order. */
  reads: string[] = [];
  detail(key: string): EntityDetail | undefined {
    const base = entityDetail(entityList(), key);
    if (!base) return undefined;
    const competence = base.sections.find(s => s.capability === SILENT_SECTION)!;
    if (this.colleague)
      return {
        ...base,
        relation: 'colleague',
        actions: [
          {
            capability: 'calendar.bookMeeting',
            connector: 'calendar',
            source: 'Kalendern',
            title: 'Boka möte',
            kind: 'propose',
            param: 'person',
          },
        ],
        sections: [contactSource],
        cards: [],
      };
    return {
      ...base,
      actions: [
        {
          capability: 'calendar.bookMeeting',
          connector: 'calendar',
          source: 'Kalendern',
          title: 'Boka möte',
          kind: 'propose',
          param: 'person',
        },
        ...base.actions.filter(a => a.capability !== 'clew.bookTalk').reverse(),
        ...base.actions.filter(a => a.capability === 'clew.bookTalk'),
      ],
      sections: [
        talkWithPoints,
        ...base.sections.filter(s => s.capability === PRESENCE_LENS),
        contactSource,
        competence,
      ],
    };
  }
  private section(key: string, capability: string): EntitySection {
    const silent = this.silent[capability];
    if (silent) return { capability, status: silent };
    if (this.empty.includes(capability)) return { capability, status: 'ok' };
    const rows = entityRows();
    const row =
      capability === CONTACT
        ? contactRows[key]
        : capability === SILENT_SECTION
          ? competenceRows[key]
          : capability === TALK_LENS || capability === PRESENCE_LENS
            ? rows[capability]?.rows.find(r => r.key === key)
            : undefined;
    return { capability, status: 'ok', ...(row ? { row } : {}) };
  }
  /** `api`, when given, starts an action from the person's menu against this person's actions, as the server does. */
  async route(page: Page, api?: MockApi) {
    if (api) api.entityDetailOf = key => this.detail(key);
    const handle = async (route: Route) => {
      const url = new URL(route.request().url());
      const [, , , , key, sub] = url.pathname.split('/');
      const name = decodeURIComponent(key ?? '');
      const detail = this.detail(name);
      if (!detail) return route.fulfill({ status: 404, json: { error: 'Personen finns inte.', code: 'not_found' } });
      if (!sub) return route.fulfill({ json: detail });
      const capability = url.searchParams.get('capability') ?? '';
      if (!detail.sections.some(s => s.capability === capability))
        return route.fulfill({ status: 404, json: { error: 'Personen finns inte.', code: 'not_found' } });
      this.reads.push(capability);
      const wait = this.delay[capability];
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      // A section asks the source with the person's user name (D116).
      return route.fulfill({ json: this.section(detail.entity.sourceKey, capability) });
    };
    await page.route(
      url => /^\/api\/entities\/person\/[^/]+(\/section)?$/.test(url.pathname) && !url.pathname.endsWith('/rows'),
      handle,
    );
    await page.route(
      url => url.pathname === `/api/cap/${POINTS}`,
      route => route.fulfill({ json: { output: pointsOutput, source: 'Utvecklingssamtal', view: pointsSpec } }),
    );
  }
}
