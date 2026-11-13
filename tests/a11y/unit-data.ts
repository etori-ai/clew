import type { Page, Route } from '@playwright/test';
import type {
  EntityAction,
  EntityCard,
  EntityDetail,
  EntityRef,
  EntitySection,
  EntitySource,
  PanelViewSpec,
  SearchResult,
} from '@clew/contracts';
import type { MockApi } from './support';
import { ENTITY_UNIT, TALKS_SOURCE, TALK_LENS } from './data';

/**
 * The unit as an entity (D97, artboard E) as the suite draws Bergsåkers skola: the school the session person manages
 * (the shared mock's list of people has its five), two sources about a unit (sick leave from Qlik with its trend as the
 * fuller read, and Clew's own talks with the way into Personal's lens), and a unit the reader belongs to without
 * managing it. The spec registers these routes over the shared mock, which answers the list of people and the rest.
 */
export const SICK_UNIT = 'qlik.unit';
export const TREND = 'qlik.sickLeaveTrend';
export const TALK_UNITS = 'clew.talkUnits';
/** A unit the reader belongs to and does not manage: no Personal, no "du är chef". */
export const MEMBER_UNIT = { id: 'unit-ledning', label: 'Rektorernas ledningsgrupp' };
/** A unit under the school whose manager reports to the reader (D117): its page says so, and the school lists it. */
export const BELOW_UNIT = { id: 'unit-skola-fritids', label: 'Bergsåkers fritidshem' };
/** A unit as `GET /api/entities/unit` lists it: one key for Clew and the source alike, its id (`unitRef` on the server). */
const unitEntity = (id: string, name: string): EntityRef => ({ kind: 'unit', key: id, sourceKey: id, name, id });

/** The Qlik connector's read about a unit (`connectors/qlik/manifest.mjs`), under its own name. */
export const sickSource: EntitySource = {
  capability: SICK_UNIT,
  connector: 'qlik',
  source: 'Qlik',
  title: 'Sjukfrånvaro',
  view: {
    kind: 'list',
    title: 'total',
    empty: 'Statistiken har ingen uppgift om enheten.',
    open: { capability: TREND, title: 'Visa utvecklingen', params: { unit: 'ref' } },
    fields: [
      { key: 'total', label: 'Sjukfrånvaro', format: 'number', unit: { one: '%', other: '%' } },
      { key: 'watch', label: 'Läge', format: 'status', tones: { Bevaka: 'warn' } },
      { key: 'month', label: 'Avser' },
      {
        key: 'change',
        label: 'Mot samma månad i fjol',
        format: 'number',
        unit: { one: 'procentenhet', other: 'procentenheter' },
      },
    ],
  },
};
/** The talks module's read about a unit (`talks.unit`), with its way into the lens on Personal. */
export const talkUnitSource: EntitySource = {
  capability: TALK_UNITS,
  connector: 'clew',
  source: TALKS_SOURCE,
  title: 'Utvecklingssamtal',
  view: {
    kind: 'list',
    title: 'held',
    noun: { one: 'enhet', other: 'enheter' },
    fields: [
      { key: 'held', label: 'Hållna' },
      { key: 'missing', label: 'Saknas', format: 'status', tones: { '*': 'warn' } },
      { key: 'booked', label: 'Bokade' },
    ],
  },
  page: { title: 'Visa i Personal', href: `/staff?show=${TALK_LENS}` },
  // Clew's own domain (a core connector): its section is captioned "Clew".
  own: true,
};
/**
 * An action about a unit (D97, D111 rule 4). No connector in the repository offers one yet; the suite's is the
 * calendar's, as a source would declare it with `about: { entity: 'unit', param }`.
 */
export const unitAction: EntityAction = {
  capability: 'calendar.bookWorkplaceMeeting',
  connector: 'calendar',
  source: 'Kalendern',
  title: 'Boka arbetsplatsträff',
  kind: 'propose',
  param: 'unit',
};
/** A card of the reader's whose rows name the school: Behöver dig on the unit's page. */
export const unitCard: EntityCard = {
  threadId: 'tillbud',
  title: 'Tillbud 2026-1182, halkolycka i duschen',
  source: 'Avvikelsesystemet',
  kind: 'act',
};
const rows: Record<string, Record<string, Record<string, unknown>>> = {
  [SICK_UNIT]: {
    [ENTITY_UNIT.id]: {
      key: ENTITY_UNIT.id,
      ref: 'u1',
      unit: ENTITY_UNIT.label,
      month: 'oktober 2026',
      total: 4.2,
      watch: 'Bevaka',
      change: 0.3,
    },
  },
  [TALK_UNITS]: {
    [ENTITY_UNIT.id]: { key: ENTITY_UNIT.id, held: '1 av 5 hållna', missing: '1 saknas', booked: '3 bokade' },
  },
};
export const trendSpec: PanelViewSpec = {
  kind: 'list',
  capability: TREND,
  connector: 'qlik',
  source: 'Qlik',
  chip: false,
  title: 'month',
  noun: { one: 'månad', other: 'månader' },
  fields: [
    { key: 'month', label: 'Månad' },
    { key: 'total', label: 'Sjukfrånvaro', format: 'number', unit: { one: '%', other: '%' } },
  ],
};
export const trendOutput = {
  rows: [
    { month: 'oktober 2026', total: 4.2 },
    { month: 'september 2026', total: 3.9 },
    { month: 'augusti 2026', total: 3.1 },
  ],
};

/**
 * The unit routes for one test: the opened unit, each section's answer (a silence per source, and a count of the
 * reads), the trend as the sick-leave section's fuller read, and a unit outside the reader's reach as a 404.
 */
export class Units {
  /** Sources that do not answer, by capability. */
  silent: Record<string, 'unavailable' | 'timeout'> = {};
  /** Every section read, by capability, in order. */
  reads: string[] = [];
  /** The school's actions and the reader's cards about it; none unless a test gives them (`unitAction`, `unitCard`). */
  actions: EntityAction[] = [];
  cards: EntityCard[] = [];
  /** Whether the school has the fritidshem under it in the reader's reporting line (D117); none unless a test says so. */
  withBelow = false;
  detail(id: string): EntityDetail | undefined {
    if (id === ENTITY_UNIT.id)
      return {
        entity: {
          kind: 'unit',
          key: ENTITY_UNIT.id,
          sourceKey: ENTITY_UNIT.id,
          name: ENTITY_UNIT.label,
          id: ENTITY_UNIT.id,
        },
        relation: 'member',
        ...(this.withBelow ? { below: [{ key: BELOW_UNIT.id, name: BELOW_UNIT.label }] } : {}),
        actions: this.actions,
        sections: [sickSource, talkUnitSource],
        cards: this.cards,
      };
    if (this.withBelow && id === BELOW_UNIT.id)
      return {
        entity: {
          kind: 'unit',
          key: BELOW_UNIT.id,
          sourceKey: BELOW_UNIT.id,
          name: BELOW_UNIT.label,
          id: BELOW_UNIT.id,
        },
        relation: 'below',
        above: { key: ENTITY_UNIT.id, name: ENTITY_UNIT.label },
        actions: [],
        sections: [talkUnitSource],
        cards: [],
      };
    if (id === MEMBER_UNIT.id)
      return {
        entity: {
          kind: 'unit',
          key: MEMBER_UNIT.id,
          sourceKey: MEMBER_UNIT.id,
          name: MEMBER_UNIT.label,
          id: MEMBER_UNIT.id,
        },
        relation: 'member',
        actions: [],
        // A source about a unit that has no row for this one says nothing; the page then has nothing more to show.
        sections: [talkUnitSource],
        cards: [],
      };
    return undefined;
  }
  private section(id: string, capability: string): EntitySection {
    const silent = this.silent[capability];
    if (silent) return { capability, status: silent };
    const row = rows[capability]?.[id];
    return { capability, status: 'ok', ...(row ? { row } : {}) };
  }
  /** `api`, when given, starts an action from the unit's header against this unit's actions, as the server does. */
  async route(page: Page, api?: MockApi) {
    if (api) api.unitDetailOf = id => this.detail(id);
    const missing = (route: Route) =>
      route.fulfill({ status: 404, json: { error: 'Enheten finns inte.', code: 'not_found' } });
    // The units the reader follows up (D117), for the trail's menu: the school, and with `withBelow` two units below it.
    await page.route(
      url => url.pathname === '/api/entities/unit',
      route =>
        route.fulfill({
          json: {
            kind: 'unit',
            groups: [
              {
                id: 'units',
                label: 'Mina enheter',
                entities: [unitEntity(ENTITY_UNIT.id, ENTITY_UNIT.label)],
              },
              ...(this.withBelow
                ? [
                    {
                      id: 'below',
                      label: 'Enheter under dig',
                      entities: [
                        unitEntity(BELOW_UNIT.id, BELOW_UNIT.label),
                        unitEntity('unit-skola-haga', 'Hagaskolan'),
                      ],
                    },
                  ]
                : []),
            ],
            lenses: [],
            columns: [],
            actions: [],
            attention: [],
          },
        }),
    );
    await page.route(
      url => /^\/api\/entities\/unit\/[^/]+(\/section)?$/.test(url.pathname),
      async route => {
        const url = new URL(route.request().url());
        const [, , , , id, sub] = url.pathname.split('/');
        const detail = this.detail(decodeURIComponent(id ?? ''));
        if (!detail) return missing(route);
        if (!sub) return route.fulfill({ json: detail });
        const capability = url.searchParams.get('capability') ?? '';
        if (!detail.sections.some(s => s.capability === capability)) return missing(route);
        this.reads.push(capability);
        return route.fulfill({ json: this.section(detail.entity.key, capability) });
      },
    );
    await page.route(
      url => url.pathname === `/api/cap/${TREND}`,
      route => route.fulfill({ json: { output: trendOutput, source: 'Qlik', view: trendSpec } }),
    );
  }
}

/**
 * Search (D97 item 6, artboard P): one hit about a person that two sources answered for, merged into one, and one plain
 * document. No source answers a subject on a hit yet, so the suite is where this is seen.
 */
export const mergedSearch: SearchResult = {
  rows: [
    {
      ref: 'person:p1003',
      connector: 'phonebook',
      kind: 'person',
      label: 'Johan Byström',
      snippet: 'Lärare 4–6 · Bergsåkers skola',
      source: 'Telefonboken',
      link: 'https://phonebook.kommun.example/personer/p1003',
      stale: null,
      view: {
        capability: 'phonebook.person',
        input: { ref: 'person:p1003' },
        title: 'Kontaktkort',
        source: 'Telefonboken',
      },
      subject: { entity: 'person', key: 'johan' },
      sources: [
        { connector: 'phonebook', source: 'Telefonboken' },
        { connector: 'hr', source: 'Personalsystemet' },
      ],
    },
    {
      ref: 'rutin-12',
      connector: 'intranat',
      kind: 'document',
      label: 'Rutin för medarbetarsamtal',
      snippet: 'Samtalen hålls en gång per år och följs upp med åtgärdspunkter.',
      source: 'Intranätet',
      owner: 'HR-avdelningen',
      reviewedAt: '2026-03-12T00:00:00.000Z',
      link: 'https://intra.example/rutin-samtal',
      stale: false,
    },
  ],
  sources: [
    { id: 'phonebook', source: 'Telefonboken', status: 'ok' },
    { id: 'hr', source: 'Personalsystemet', status: 'ok' },
    { id: 'intranat', source: 'Intranätet', status: 'ok' },
  ],
};
