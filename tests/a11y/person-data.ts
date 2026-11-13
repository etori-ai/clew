import type { Page, Route } from '@playwright/test';
import type { MockApi } from './support';
import type { EntityDetail, EntitySection, EntitySource, PanelViewSpec, PersonProfile, View } from '@clew/contracts';
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
/** Each source's row by the person's user name, the key it was asked with (D122). */
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

/** A long category the directory may send for a number (D114 item 3): it wraps and narrows no value (W2). */
export const LONG_PHONE_CATEGORY = 'Beredskapstelefon för elevhälsan och fritidshemmet';
/** An address of an ordinary length, 33 characters: on one line at 320 px (W2). */
export const JOHAN_EMAIL = 'johan.bystrom@bergsaker.clew.test';
/**
 * Johan's profile as the directory sent it (D114): a core title and two employments without titles of their own, the
 * second on a unit since removed, and his e-mail and three numbers, the third under a long category, so that every run
 * of the page (axe, keyboard, reflow) draws both sections. The percentage is a 0–1 fraction multiplied by 100, as a
 * provisioner sends it: 0.57 × 100 is 56.99999999999999 in binary floating point.
 */
export const johanProfile = (): PersonProfile => ({
  email: JOHAN_EMAIL,
  title: 'Lärare 4–6',
  phoneNumbers: [
    { type: 'work', value: '060-19 20 00' },
    { type: 'mobile', value: '070-000 00 00' },
    { type: LONG_PHONE_CATEGORY, value: '070-000 00 03' },
  ],
  employments: [
    {
      unitId: 'unit-skola',
      unitLabel: 'Bergsåkers skola',
      employmentType: 'Tillsvidare',
      startDate: '2018-08-15',
      employmentPercentage: 0.57 * 100,
    },
    { unitId: 'unit-nedlagd', employmentType: 'Vikariat', employmentPercentage: 0.43 * 100 },
  ],
});
/**
 * The unit Johan leads when he reports to the reader from below (D99): not one the reader manages or belongs to, but one
 * below whose manager reports to them, which they follow up (D117), so its page opens for them.
 */
export const FRITIDS = { id: 'unit-fritidshem', label: 'Bergsåkers fritidshem' };
/**
 * The unit Johan is placed on when it has no manager of its own, so that he reports to the reader from below (D99 item
 * 4): not one the reader follows up, since D117 follows the units the managers below lead, so its page does not open.
 */
export const MELLANSTADIET = { id: 'unit-mellanstadiet', label: 'Bergsåkers mellanstadium' };

/**
 * The person routes for one test: the opened person with the extra sections, each section's answer (with a delay or
 * a silence per source, and a count of the reads), the talk's action points, and a colleague's reading (artboard G).
 */
export class People {
  /** The reader is a colleague (artboard G): one action, the directory's section, no cards. */
  colleague = false;
  /**
   * Johan reports to the reader from below (D99): he leads a unit under one the reader manages, so the server names his
   * own unit, which the reader follows up and may open (D117), and the reader is still his manager.
   */
  fromBelow = false;
  /**
   * Johan reports to the reader from below as someone placed on a unit under one the reader manages that has no manager
   * of its own (D99 item 4): the server names that unit, which the reader does not follow up and may not open (D117),
   * and the reader is his manager.
   */
  placedBelow = false;
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
        // The colleague's unit is not one the reader manages or belongs to, so its page does not open for them.
        entity: { ...base.entity, unit: { id: base.entity.unit!.id, label: base.entity.unit!.label } },
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
    const managed: EntityDetail = {
      ...base,
      ...(key === 'johan' ? { profile: johanProfile() } : {}),
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
    const below = this.fromBelow ? { ...FRITIDS, opens: true as const } : this.placedBelow ? MELLANSTADIET : undefined;
    if (!below) return managed;
    const profile = managed.profile ?? johanProfile();
    return {
      ...managed,
      entity: { ...managed.entity, detail: `Lärare 4–6 · ${below.label}`, unit: below },
      profile: {
        ...profile,
        employments: [
          { unitId: below.id, unitLabel: below.label, employmentType: 'Tillsvidare', employmentPercentage: 100 },
        ],
      },
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
      // A section asks the source with the person's user name (D122).
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
