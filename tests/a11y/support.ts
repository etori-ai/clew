import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ItemEvent, MenuEntry, PanelViewSpec, Thread, SiteHeaderView, ViewEntry } from '@clew/contracts';
import {
  NEXT_WEEK,
  NOW,
  WEEK,
  areas,
  systems,
  attention,
  checkReport,
  connectorDetail,
  connectorPreview,
  connectors,
  conversation,
  handedConversation,
  events,
  searchOutput,
  snoozePresets,
  threads,
  today,
  units,
  groups,
  user,
  siteHeader,
} from './data';
import { newsItemOutput, newsItemSpec, newsSpec } from './data';
import type { NewsResult } from '@clew/contracts';
import {
  assistantStatus,
  modelDetail,
  modelProviders,
  models,
  providerDetail,
  providerReport,
  usersOverview,
  usersPeople,
  organisationOverview,
  organisationPeople,
  organisationReports,
  staffOverview,
  entityDetail,
  entityList,
  entityRows,
  meetingSlots,
  ownDay,
  SILENT_SECTION,
  TALKS_FAIL_ERROR,
  TODAY,
  USER_NAME,
  allCommitments,
  changeable,
  commitmentsFor,
  myCommitments,
  readOnlyCommitments,
  readOnlyTalks,
  talkRound,
  talkRows,
  talksResult,
  type CommitmentEntry,
  type TalkEntry,
} from './data';
import type {
  AppearanceAdminView,
  Capability,
  CompetenceApproval,
  CompetenceDecisionBody,
  CompetenceHoldingBody,
  CompetenceImportBody,
  CompetenceMergeBody,
  CompetenceMergePreview,
  CompetenceOwnOutput,
  CompetenceSkillBody,
  CompetenceSkillChangeBody,
  CompetenceSkillRatingBody,
  CompetenceSkillValidation,
  CompetenceValidationBody,
  CompetenceMappingBody,
  CompetenceMatrixCell,
  CompetenceMatrixOutput,
  CompetenceRequirementBody,
  CompetenceRequirementsOutput,
  CompetenceSearchBody,
  CompetenceSearchFileBody,
  CompetenceSearchRow,
  CompetenceShareTarget,
  CompetenceShareTargetBody,
  CompetenceSource,
  CompetenceType,
  CompetenceTypeBody,
  CompetenceTypePatch,
  CompetenceValidityImpact,
  AppearanceLogoInputType,
  CommitmentAddBody,
  CommitmentsInput,
  EntityDetail,
  EntityList,
  EntityRows,
  EntitySection,
  ModelSummary,
  ProviderSummary,
  TalkHeldBody,
  TalkRound,
  RelationGrant,
  UsersAdminQueryType,
} from '@clew/contracts';
import { THEME_BASE_COLORS, parseThemeFile, themeFileOf } from '../../packages/contracts/src/theme-file';
import { personSearch, phonebook } from './phonebook';
import { rooms, roomsSpec } from './rooms';
import { fixtureViews } from './view-catalogue';
import {
  attentionOutput,
  attentionSpec,
  competenceMatrix,
  holdingsOutput,
  holdingsSpec,
  matrixAnswer,
} from './competence';
import { errandsOutput, errandsSpec, smErrandOutput, smErrandSpec } from './errands';
import { deskRequestOutput, deskRequestSpec, requestsOutput, requestsSpec } from './requests';
import { BoardingMock, boardingOff, equipmentAnswer, orderReceipt } from './boarding';
import { manifestReference } from '../../packages/connectors/src/reference';
import { previewManifest } from '../../packages/connectors/src/preview';
import { parseManifest } from '../../packages/connectors/src/remote';
import { manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { manifest as phonebookManifest } from '../../connectors/phonebook/connector.mjs';
/** The manifest reference as the server builds it (D60): the real walk over the real schema, so the page is tested on what it will draw. */
export const reference = manifestReference([
  parseManifest(phonebookManifest, 'phonebook'),
  parseManifest(helloManifest, 'hello'),
]);

export const desktop = { width: 1280, height: 800 };
export const phone = { width: 375, height: 667 };
/** 1.4.10: 320 CSS px wide and 256 high are the two reflow limits; 256 is a landscape phone or 400 % zoom. */
export const narrow = { width: 320, height: 640 };
export const short = { width: 320, height: 256 };

const session = { csrfToken: 'test', sessionKey: 'test', expiresAt: '2026-11-04T16:00:00.000Z', user };
import type { ConnectorSummary } from '@clew/contracts';

/**
 * What a thread's audit rows would say about it (D112 item 4), newest first: created by Clew, set aside or dismissed by
 * the person, and a decision with the source's answer when it has a receipt.
 */
export function eventsOf(t: Thread): ItemEvent[] {
  const events: ItemEvent[] = [{ at: t.createdAt, by: 'clew', kind: 'created' }];
  if (t.receipt) {
    const action = t.actions.find(a => a.kind === 'execute' && a.role === 'primary');
    const failed = t.receipt.rows.some(r => r.outcome === 'failed'),
      unknown = t.receipt.rows.some(r => r.outcome === 'unknown');
    events.push(
      { at: t.receipt.at, by: 'you', kind: 'decided', ...(action ? { action: action.label } : {}) },
      {
        at: t.receipt.at,
        by: 'clew',
        kind: 'answered',
        outcome: failed ? 'failed' : unknown ? 'unknown' : 'succeeded',
      },
    );
  }
  if (t.state === 'open' && t.snoozedUntil)
    events.push({ at: t.updatedAt, by: 'you', kind: 'snoozed', until: t.snoozedUntil });
  if (t.state === 'dismissed' && t.handledAt) events.push({ at: t.handledAt, by: 'you', kind: 'dismissed' });
  return events.reverse();
}

/** A talk's time as the HR fixture writes it: "torsdag 5 november kl. 13:15". */
const talkTime = (instant: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));

/** The API as the browser sees it, held in memory per test. `/api/**` never leaves the page. */
export class MockApi {
  threads = threads();
  /** The areas and the systems behind them with their marks' ordinals (D71); a test may add a system's area. */
  areas = [...areas];
  systems = [...systems];
  deliveries: Array<{ id: string; threadId: string; kind: 'automatic' | 'reminder' }> = [];
  deliveryClaims: string[] = [];
  sources: Array<{ connector: string; state: string; lastSuccess: string | null; error: string | null }> = [];

  answerDelay = 0;
  private answerHeld?: Promise<void>;
  /** Every question the box sent, as it was sent: the text, the conversation it continues, and what went along as chips. */
  asked: {
    text: string;
    conversationId?: string;
    chips?: { ref: string }[];
    assistant?: string;
    suggested?: boolean;
    own?: boolean;
    confirmed?: boolean;
  }[] = [];
  /** How long the first read of the cards takes, so a test can see the page while they load (D36). */
  threadsDelay = 0;
  /** How long the areas take, so a test can see Läget's tiles in their shape (D54). */
  areasDelay = 0;
  /** How long Avfärda, Inte nu and Ta upp nu take to answer, and whether the server refuses, so a test can see the card as the person's action leaves it (D64). */
  mutationDelay = 0;
  mutationFails = false;
  /**
   * The action dialog (D112 item 10). Every decision that reached `act`, as its body; the next decision refused with this
   * Swedish sentence (it resets itself after that one); every effect read, as its thread and body, and whether they fail
   * or wait; the free times the person's calendar answers (null: no calendar, so no times and no day), and every read of
   * them as its query.
   */
  acted: Array<{ threadId: string; body: Record<string, unknown> }> = [];
  actRefusal: string | null = null;
  effectReads: Array<{ threadId: string; body: Record<string, unknown> }> = [];
  effectFails = false;
  effectDelay = 0;
  freeTimes: Array<{ start: string; end: string }> | null = meetingSlots();
  timesReads: string[] = [];
  sessionDelay = 0;
  signedIn = true;
  /** The development sign-in (D6): the personas the sign-in page lists, or undefined for the server's 404 when it is off. */
  devAccounts: { userName: string; name: string }[] | undefined = undefined;
  /** The session says the person may administer connectors (D23). Off by default so the other suites see the ordinary page. */
  admin = false;
  /**
   * The administration capabilities the session says the person holds (D85) while `admin` is on: which rows the rail
   * draws under Administration. Every one by default; a test narrows it.
   */
  capabilities: Capability[] = ['admin.connectors', 'admin.users', 'admin.appearance', 'admin.competence'];
  /** D121: the relations to people the session says the person holds by grant: `registrar` opens Kompetenssökning. */
  relations: RelationGrant[] = [];
  /**
   * Kompetenssökning (D121): the people who hold each type, by type id, as the server would find them; every body the
   * page asked a search with, every file asked for, and whether the search fails (a 503).
   */
  competenceSearch: Record<string, CompetenceSearchRow[]> = {};
  searchBodies: CompetenceSearchBody[] = [];
  /** How often the search page's options were read: an ordinary read, which a shown tab reads again once it has aged. */
  searchOptionsReads = 0;
  searchFiles: CompetenceSearchFileBody[] = [];
  searchFails = false;
  /** The type ids the search page asked the catalogue to name (an address opened from a link or a reload; no log). */
  typesNamed: string[] = [];
  /**
   * The person's calendar (D116, amended 2026-11-12): `ok` answers; `silent` does not (the calendar's own 400, as when its
   * server fails); `unbound` is an account with no calendar bound to it; `hidden` is a calendar the registry does not
   * show the person (D23), so it is not among their systems and its routes answer 404.
   */
  calendar: 'ok' | 'silent' | 'unbound' | 'hidden' = 'ok';
  /**
   * "Vem ser det" on Anslutna system and Modeller (D23, D24, D68): the units and the provisioned groups the audience
   * editor offers (`GET /api/admin/units` and `/api/admin/groups`), and whether both reads fail (503, after the page's
   * one retry). `holdAudienceLists` keeps both reads on their way.
   */
  audienceUnits = [...units];
  audienceGroups = [...groups];
  audienceListsFail = false;
  private audienceListsHeld?: Promise<void>;
  /** Användare (D85): the people and the group-capability rows the users page shows; the rows change with the page's actions. */
  users = usersOverview();
  /** Användare (D100): the people the list is read from, a page at a time, and every question the page has asked. */
  people = usersPeople();
  peopleQueries: UsersAdminQueryType[] = [];
  /** Användare: the list cannot be read, while the rest of the page can. A 400, which the page does not ask twice. */
  peopleRefused = false;
  /** The users page for someone with `admin.connectors` but not `admin.users`: the server refuses. */
  usersForbidden = false;
  /** Användare: the overview cannot be read (503, after the page's one retry), while the people list can. */
  usersFails = false;
  /**
   * Användare (D85): groups the organisation holds beyond the first that the overview offers. Only the group picker's
   * server search finds them, and every text it sent is kept.
   */
  groupsBeyond: Array<{ id: string; label: string }> = [];
  groupSearches: string[] = [];
  /** Användare: the group picker's server search cannot be answered (503, every time it is asked). */
  groupSearchFails = false;
  /** Organisation (D99): the tree the organisation page shows; it shares `usersForbidden`, as the two share a capability. */
  organisation = organisationOverview();
  /** The people of each unit and who reports to it from below, as the unit's page reads them; a test may add a unit. */
  organisationPeople = { ...organisationPeople };
  organisationReports = { ...organisationReports };
  /** Organisation: the tree and every unit's people fail to be read (503, after the page's one retry). */
  organisationFails = false;
  /**
   * The installation's appearance (D98): Astryx Neutral with no logo until a test saves or sets one. The public read
   * every page makes and Administration › Utseende share it, as they share the one row on the server.
   */
  appearance: AppearanceAdminView = { revision: 0, theme: null, logo: null, updatedAt: null, updatedBy: null };
  /** The logo images a test has uploaded, by variant, as the mock would serve them. */
  logos: Partial<Record<'light' | 'dark', { mediaType: string; data: string }>> = {};
  /** Utseende for someone without `admin.appearance`: the server refuses. */
  appearanceForbidden = false;
  /** Personal (D94): the units the test person manages and their people. */
  staff = staffOverview();
  /** Personal for someone who manages no unit: the server refuses whatever the session's role says. */
  staffForbidden = false;
  /**
   * Entities (D97): the list of people, each source's rows over them, and the opened person, as `data.ts` draws the
   * canvas. A test may replace any of them.
   */
  entityList: EntityList = entityList();
  entityRows: Record<string, EntityRows> = entityRows();
  /** The reader may ask about nobody (manages no unit): the list answers with no groups, as the server does. */
  entitiesEmpty = false;
  /** Sources that do not answer, by capability: their rows and sections come back with this status and nothing else. */
  entitySilent: Record<string, 'unavailable' | 'timeout'> = { [SILENT_SECTION]: 'unavailable' };
  /** How long one source's rows take, by capability, so a test can see the page while a lens loads. */
  entityRowsDelay: Record<string, number> = {};
  /** Every entities read that reached the mock, as path and query, in order. */
  entityReads: string[] = [];
  /** Every action started from an entity's menu (D97), as the entity's key and capability, in order. */
  entityStarts: Array<{ key: string; capability: string; values?: Record<string, string> }> = [];
  /** Actions the source refuses, by capability, with its Swedish sentence (a 400, as the server passes it on). */
  entityRefusals: Record<string, string> = {};
  /**
   * The opened person, when a spec answers them itself: what the person's read answers (unless the spec routes it
   * itself, as `person-data.ts` does) and whose actions a start is checked against.
   */
  entityDetailOf?: (key: string) => EntityDetail | undefined;
  /** The opened unit whose actions a start is checked against; the unit's routes set it (`unit-data.ts`). */
  unitDetailOf?: (id: string) => EntityDetail | undefined;
  /**
   * The session person is an employee who manages nobody: the session's role is `employee`, Personal is refused, the
   * round lists nobody and their own action points are only the ones about them. For Hem without Personal.
   */
  employee = false;
  /**
   * Kompetens (D108): the catalogue a certificate is registered from. Null: the module is switched off for the person,
   * so its routes are refused and Personal offers no registration.
   */
  competenceTypes: CompetenceType[] | null = null;
  /** Every write to the catalogue, in order: the method, the path and the body. */
  catalogueWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  /** What the server answers a new validity would do. */
  validityImpact: CompetenceValidityImpact = { holdings: 3, expiredBefore: 0, expiredAfter: 2 };
  /** The next write to the catalogue answers 400 with this sentence; it resets itself after that one. */
  catalogueFail: string | null = null;
  /** The catalogue cannot be read (a 503), while the rest of the module answers. */
  catalogueReadFails = false;
  /**
   * The catalogue at scale (D120 item 7, D108 item 2): every part of an import as it was sent, and what a merge would
   * move as the server counts it. An import adds the rows the catalogue does not hold, by address or name, as the server
   * does; a part answers 400 with `importFail` once `importFailAfter` parts were saved, and it resets itself after that.
   */
  importWrites: CompetenceImportBody[] = [];
  importFail: string | null = null;
  importFailAfter = 0;
  mergePreview: CompetenceMergePreview = {
    holdings: 12,
    people: 9,
    requirements: 2,
    requirementsFolded: 1,
    shareTargets: 0,
    shareTargetsFolded: 0,
    mappings: 1,
    skillsSetAside: 0,
    ruled: 0,
    waiting: false,
  };
  /** What the registrations sent, in order. */
  registered: Array<{ personId: string; body: CompetenceHoldingBody }> = [];
  /** The next registration answers 400 with this sentence; it resets itself after that one. */
  registerFail: string | null = null;
  /** Kompetens › Källor (D108 item 9): the systems whose holdings are copied in, while the module is on. */
  competenceSources: CompetenceSource[] = [];
  /** Every write to the sources' mappings and every read started by hand, in order. */
  sourceWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  /** The next write to a source answers 400 with this sentence; it resets itself after that one. */
  sourceFail: string | null = null;
  /**
   * Kompetens › Krav (D108 item 6): the requirements on positions and units with the positions and units to choose
   * from, and the share targets, while the module is on.
   */
  competenceRequirements: CompetenceRequirementsOutput = { rows: [], positions: [], units: [] };
  competenceShareTargets: CompetenceShareTarget[] = [];
  /** Every write to the requirements and the share targets, in order: the method, the path and the body. */
  requirementWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  /** The next write to a requirement or a share target answers 400 with this sentence; it resets itself after that one. */
  requirementFail: string | null = null;
  /** The person's own holdings as `competence.holdings` answers them while the module is on. */
  competenceHoldings: unknown = holdingsOutput;
  /**
   * Kompetens › Medarbetare (D108 item 11): the manager's matrix as the server answers it, changed by the writes from it
   * as the server would change it; with `competenceMatrixSets` more is required than ten columns hold, so it is offered
   * in sets (`matrixAnswer`).
   */
  competenceMatrix: CompetenceMatrixOutput = competenceMatrix();
  competenceMatrixSets = false;
  /** How long the matrix's read takes to answer, in milliseconds: a hard load waits for it as the server's would. */
  matrixDelay = 0;
  /** Every read of the matrix and every download of its file, as the query, in order. */
  matrixReads: string[] = [];
  matrixDownloads: string[] = [];
  /** Every revocation of a holding, in order. */
  holdingWrites: Array<{ method: string; path: string }> = [];
  /**
   * The reader's own registration (D108 item 7): whether anyone would decide it, and the ones that wait, as the writes
   * from the page change them. Every write to them in order; the next registration answers 400 with `ownFail`.
   */
  competenceOwn: CompetenceOwnOutput = { approver: true, pending: [], rejected: [], skills: [] };
  ownWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  ownFail: string | null = null;
  /**
   * The registrations of the reports' own that wait for the reader's decision, by holding id; an id not here is refused
   * as the server refuses one the reader may not decide. Every decision in order; a decided one leaves this map.
   */
  competenceApprovals: Record<string, CompetenceApproval> = {};
  approvalWrites: Array<{ path: string; body: CompetenceDecisionBody }> = [];
  /**
   * Skills (D120): the reports' skills the reader may confirm, by holding id (an id not here is refused as the server
   * refuses one the reader may not confirm), and every write to a skill in order: the reader's own ratings and removals,
   * a manager's registration and confirmation.
   */
  competenceSkills: Record<string, CompetenceSkillValidation> = {};
  skillWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  /**
   * Introduktion och avslut (D124): the module's state and routes (`boarding.ts`). Null: the module is switched off, so
   * every route is refused as the server's guard refuses it, and the system is not among the person's.
   */
  boarding: BoardingMock | null = null;
  /** Utvecklingssamtal (D96). False: the person has no talks system, so both reads are refused as the registry refuses them. */
  talksOffered = true;
  /** False: another system answers the profile; the reads are read-only (no `id`, a `link` on every row) and the writes refused. */
  talksWritable = true;
  /** The open round; null for none (the round then lists nobody). */
  talksRound: TalkRound | null = talkRound();
  /** The calendar did not answer: booked rows read as missing and the answer says `bookedUnknown`. */
  talksBookedUnknown = false;
  /** The next talk write answers 400 with `TALKS_FAIL_ERROR`; it resets itself after that one. */
  talksFail = false;
  /** The round's rows and every action point, as the writes leave them. A test may replace either. */
  talkRows: Array<Omit<TalkEntry, 'openCommitments'>> = talkRows();
  commitments: CommitmentEntry[] = allCommitments();
  /** Every talk write that reached the mock, in order. */
  talkWrites: Array<{ method: string; path: string; body: unknown }> = [];
  private heldBefore = new Map<string, Omit<TalkEntry, 'openCommitments'>>();
  private nextCommitment = 1;
  /** The shared header (D88) every page draws: Clew's default until a test gives the person a connector's header. */
  header: SiteHeaderView = siteHeader();
  /**
   * The combined news list (D112, amended 2026-11-11). Null: the person has no news source, so `clew.news` is refused
   * as the registry refuses it and Hem draws no "Nyheter"; a test gives the person news with `newsOutput()`.
   */
  news: NewsResult | null = null;
  connectors: ConnectorSummary[] = connectors();
  /** The rows under Verktyg in the menu (D40): none until a test puts one there, as none is shown until an administrator switches one on. */
  menu: MenuEntry[] = [];
  /** Every read the person may open (D116), with the kind of its view: a table or a list opens on its own page. */
  views: ViewEntry[] = fixtureViews();
  /** The views an administrator has put in the menu on the admin pages, by capability name. */
  menuOn: string[] = [];
  /** The areas whose figure an administrator switched off on the admin pages (D54), by area id. */
  figuresOff: string[] = [];
  /** Modeller (D24): the providers and models the admin pages show, and how many models the person may pick in the box (two shows the menu). */
  providers: ProviderSummary[] = modelProviders();
  models: ModelSummary[] = models();
  modelChoices = 1;
  /** The assistants of other systems the person may hand a conversation to; none unless a spec lists one. */
  handoverAssistants: import('@clew/contracts').HandoverAssistant[] = [];
  /** The other system does not answer a handed-over question. */
  handoverFails = false;
  /** The assistant returns the conversation: it hands the question back, or answers and is done (D125 item 12). */
  handoverReturns: 'declined' | 'completed' | undefined = undefined;
  /** Clew's own assistant hands a question that matches to the listed assistant, as its model would (D125 item 11). */
  routes: RegExp | undefined = undefined;
  /** A question to the assistant that matches is held for naming the person's staff (D125 item 13). */
  holds: RegExp | undefined = undefined;
  currentModel = 'gpt-oss-120b';
  output: unknown = {
    date: '2026-11-04',
    onDuty: ['Anna Lindqvist 07:00–16:00'],
    absent: [{ name: 'Sara Nyström', kind: 'short' }],
  };
  /** A card's read that answers with a declared view (D38), by the action's id; any other read answers `output`. */
  cardReads: Record<string, { output: unknown; view?: PanelViewSpec }> = {};
  /** How long a card's read waits before it answers, in ms: for a test that sees it on its way. */
  cardReadDelay = 0;
  /** Every card's read fails as a source that does not answer does. */
  cardReadFails = false;
  /** A work item's Händelser (D112 item 4), by thread id; without one, the facts the thread itself holds (`eventsOf`). */
  itemEvents: Record<string, ItemEvent[]> = {};
  /** Händelser cannot be read. */
  itemEventsFail = false;
  unmocked: string[] = [];
  /** Keeps every turn pending until the returned function is called, for a test that works while the answer is on its way: `answerDelay` can run out first on a slow machine. */
  holdAnswer() {
    let release = () => {};
    this.answerHeld = new Promise<void>(resolve => {
      release = resolve;
    });
    return release;
  }
  /** Every cell of the matrix through `change`; a column required of nobody and held by nobody goes, as the server's would. */
  private changeMatrix(change: (cell: CompetenceMatrixCell, personId: string) => CompetenceMatrixCell) {
    const m = this.competenceMatrix;
    const rows = m.rows.map(r => ({ ...r, cells: r.cells.map(c => change(c, r.personId)) }));
    const keep = m.columns.map((_, i) => rows.some(r => r.cells[i]!.required));
    this.competenceMatrix = {
      ...m,
      columns: m.columns.filter((_, i) => keep[i]),
      rows: rows.map(r => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })),
      required: keep.filter(Boolean).length,
    };
  }
  /** A manager's requirement on one person: their cell is required by it, a column added for a type not shown yet. */
  private requirePerson(personId: string, typeId: string, requirementId: string) {
    const m = this.competenceMatrix;
    if (!m.columns.some(c => c.typeId === typeId)) {
      const type = this.competenceTypes?.find(t => t.id === typeId);
      if (!type) return;
      this.competenceMatrix = {
        ...m,
        columns: [...m.columns, { typeId, name: type.name, area: type.area, kind: type.kind }],
        rows: m.rows.map(r => ({
          ...r,
          cells: [...r.cells, { typeId, status: 'none', required: false, through: [], revocable: false }],
        })),
      };
    }
    this.changeMatrix((c, p) =>
      p === personId && c.typeId === typeId
        ? {
            ...c,
            required: true,
            status: c.status === 'none' ? 'missing' : c.status,
            through: [...c.through, { on: 'person', requirementId }],
          }
        : c,
    );
  }
  /** The requirement on one person removed: their cell is no longer required by it. */
  private unrequire(requirementId: string) {
    this.changeMatrix(c => {
      if (!c.through.some(r => r.requirementId === requirementId)) return c;
      const through = c.through.filter(r => r.requirementId !== requirementId);
      return {
        ...c,
        through,
        required: through.length > 0,
        status: !through.length && c.status === 'missing' ? 'none' : c.status,
      };
    });
  }
  /** Keeps the audience editor's reads of the units and the groups pending until the returned function is called. */
  holdAudienceLists() {
    let release = () => {};
    this.audienceListsHeld = new Promise<void>(resolve => {
      release = resolve;
    });
    return release;
  }
  private update(id: string, change: Partial<Thread>) {
    this.threads = this.threads.map(t => (t.id === id ? { ...t, ...change, updatedAt: NOW } : t));
    return this.threads.find(t => t.id === id)!;
  }
  async handle(route: Route) {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api', ''),
      post = request.method() === 'POST';
    const json = (body: unknown) => route.fulfill({ json: body });
    const id = path.split('/')[2] ?? '';
    if (path === '/protocol/manifest-reference.json') return json(reference);
    // The manifest dry run (D60, D97) as the server runs it: the real preview over the posted document.
    if (path === '/protocol/manifest' && post) {
      let document: unknown;
      try {
        document = JSON.parse(request.postData() ?? '');
      } catch {
        return route.fulfill({ status: 400, json: { error: 'The body is not JSON.' } });
      }
      return json(previewManifest(document, url.searchParams.get('id') ? { id: url.searchParams.get('id')! } : {}));
    }
    if (path === '/changes')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
    if (path === `/threads/${id}/execution/check`) return json(this.threads.find(t => t.id === id));
    if (path === '/auth/session') {
      if (this.sessionDelay) await new Promise(resolve => setTimeout(resolve, this.sessionDelay));
      return this.signedIn
        ? json({
            ...session,
            ...(this.employee ? { user: { ...user, role: 'employee' } } : {}),
            admin: this.admin && this.capabilities.length > 0,
            capabilities: this.admin ? this.capabilities : [],
            // D121: a relation to people by grant is never an admin flag; it only draws Kompetenssökning.
            relations: this.relations,
          })
        : route.fulfill({ status: 401, json: { error: 'Ingen session' } });
    }
    if (path === '/auth/activity') return json({ expiresAt: session.expiresAt });
    if (path === '/auth/dev')
      return this.devAccounts ? json({ accounts: this.devAccounts }) : route.fulfill({ status: 404, body: '' });
    // The installation's appearance (D98), public: the theme and the logo's address, and the logo itself.
    if (path === '/appearance') {
      const { revision, theme, logo } = this.appearance;
      return json({ revision, theme, logo });
    }
    if (path === '/appearance/theme-file')
      return json(
        themeFileOf(this.appearance.theme ?? { name: 'Mall: Clews standardfärger', colors: THEME_BASE_COLORS }),
      );
    if (path.startsWith('/appearance/logo/')) {
      const image = this.logos[path.endsWith('/dark') ? 'dark' : 'light'];
      return image
        ? route.fulfill({ status: 200, contentType: image.mediaType, body: Buffer.from(image.data, 'base64') })
        : route.fulfill({ status: 404, json: { error: 'Logotypen finns inte.' } });
    }
    // The shared header (D88): what the person's header connector lists for them, Clew's default until a test says otherwise.
    if (path === '/header') return json(this.header);
    // Entities (D97): the people the reader may ask about, one source over them, the opened person and one source's
    // answer for them. A key the reader may not ask about answers 404 as if it did not exist.
    if (path.startsWith('/entities/') && !post) return this.entities(route, path, url);
    if (path.startsWith('/entities/') && post) return this.entityStart(route, path);
    // Personal (D94): the manager's units and their people, or the server's refusal.
    if (path === '/staff')
      return this.staffForbidden || this.employee
        ? route.fulfill({
            status: 403,
            json: { error: 'Sidan Personal är för den som är chef för en enhet.', code: 'denied' },
          })
        : json(this.staff);
    if (path.startsWith('/admin/')) {
      if (!this.admin)
        return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
      const method = request.method();
      const cid = path.split('/')[3] ?? '';
      const found = () => this.connectors.find(c => c.id === cid);
      if (path.startsWith('/admin/appearance')) {
        if (this.appearanceForbidden)
          return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
        const saved = (change: Partial<AppearanceAdminView>) => {
          const revision = this.appearance.revision + 1;
          this.appearance = { ...this.appearance, ...change, revision, updatedAt: NOW, updatedBy: 'Mikael Lund' };
          if (this.appearance.logo)
            this.appearance.logo = {
              alt: this.appearance.logo.alt,
              src: `/api/appearance/logo/light?v=${revision}`,
              ...(this.logos.dark ? { darkSrc: `/api/appearance/logo/dark?v=${revision}` } : {}),
            };
          return json(this.appearance);
        };
        if (path === '/admin/appearance' && method === 'GET') return json(this.appearance);
        if (path === '/admin/appearance/theme' && method === 'PUT') {
          // The same check the server makes, so a spec sees the server's refusal for a file the page let through.
          const parsed = parseThemeFile((request.postDataJSON() as { file: unknown }).file);
          return parsed.ok
            ? saved({ theme: parsed.theme })
            : route.fulfill({
                status: 400,
                json: { error: 'Temafilen kan inte användas.', problems: parsed.problems },
              });
        }
        if (path === '/admin/appearance/theme' && method === 'DELETE') return saved({ theme: null });
        if (path === '/admin/appearance/logo' && method === 'PUT') {
          const input = request.postDataJSON() as AppearanceLogoInputType;
          if (input.light) this.logos.light = input.light;
          if (input.dark) this.logos.dark = input.dark;
          if (input.dark === null) delete this.logos.dark;
          return saved({ logo: { alt: input.alt, src: '' } });
        }
        if (path === '/admin/appearance/logo' && method === 'DELETE') {
          this.logos = {};
          return saved({ logo: null });
        }
      }
      if (path === '/admin/units' || path === '/admin/groups') {
        await this.audienceListsHeld;
        if (this.audienceListsFail)
          return route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } });
        return path === '/admin/units' ? json({ units: this.audienceUnits }) : json({ groups: this.audienceGroups });
      }
      if (path === '/admin/users' && method === 'GET')
        return this.usersForbidden
          ? route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } })
          : this.usersFails
            ? route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } })
            : json(this.users);
      // The group picker's search (D85): the organisation's groups whose name or external id holds every word, the
      // first ten by name, as the server answers it.
      if (path === '/admin/users/groups/search' && method === 'POST') {
        const { text } = request.postDataJSON() as { text: string },
          words = text.normalize('NFC').toLocaleLowerCase('sv').split(/\s+/).filter(Boolean);
        this.groupSearches.push(text);
        if (this.groupSearchFails)
          return route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } });
        return json({
          groups: [...this.users.groups, ...this.groupsBeyond]
            .filter(g =>
              words.every(w => [g.label, g.id].some(v => v.normalize('NFC').toLocaleLowerCase('sv').includes(w))),
            )
            .sort((a, b) => a.label.localeCompare(b.label, 'sv'))
            .slice(0, 10),
        });
      }
      if (path === '/admin/users/search' && method === 'POST') {
        if (this.usersForbidden)
          return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
        // The server's reading of a question (D100), on the suite's people: every part narrows, then one page.
        const asked = request.postDataJSON() as UsersAdminQueryType,
          words = (asked.text ?? '').normalize('NFC').toLocaleLowerCase('sv').split(/\s+/).filter(Boolean),
          status = (u: (typeof this.people)[number]) =>
            !u.enabled ? 'disabled' : !u.active ? 'no-access' : u.bound ? 'signed-in' : 'not-signed-in';
        this.peopleQueries.push(asked);
        if (this.peopleRefused) return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
        const matching = this.people.filter(
          u =>
            words.every(w =>
              [u.name, u.title, u.userName, u.email].some(v =>
                (v ?? '').normalize('NFC').toLocaleLowerCase('sv').includes(w),
              ),
            ) &&
            (!(asked.unitId || asked.role) ||
              u.assignments.some(
                a => (!asked.unitId || a.unitId === asked.unitId) && (!asked.role || a.role === asked.role),
              )) &&
            (!asked.status || status(u) === asked.status) &&
            (!asked.capability || u.capabilities.includes(asked.capability)),
        );
        const pageSize = asked.pageSize ?? 25,
          page = Math.min(asked.page ?? 1, Math.max(1, Math.ceil(matching.length / pageSize)));
        return json({
          rows: matching.slice((page - 1) * pageSize, page * pageSize),
          total: matching.length,
          all: this.people.length,
          page,
          pageSize,
        });
      }
      if (path === '/admin/organisation' && method === 'GET')
        return this.usersForbidden
          ? route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } })
          : this.organisationFails
            ? route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } })
            : json(this.organisation);
      const unitPeople = /^\/admin\/organisation\/units\/([^/]+)$/.exec(path);
      if (unitPeople && method === 'GET' && this.organisationFails)
        return route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } });
      if (unitPeople && method === 'GET') {
        const unitId = decodeURIComponent(unitPeople[1]!),
          unit = this.organisation.units.find(u => u.unitId === unitId);
        return unit
          ? json({
              unitId,
              unitLabel: unit.unitLabel,
              people: this.organisationPeople[unitId] ?? [],
              reports: this.organisationReports[unitId] ?? [],
            })
          : route.fulfill({ status: 400, json: { error: 'Enheten finns inte.', code: 'invalid' } });
      }
      // The catalogues' keys (D107): the answer that issues or rotates one carries the key, once.
      if (path === '/admin/users/provisioners' && method === 'POST') {
        const input = request.postDataJSON() as { id: string; label: string };
        // The contract's label is one line without a control character (PROVISIONER_LABEL_PATTERN).
        if (/\p{Cc}/u.test(input.label)) return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
        if (this.users.provisioners.some(p => p.id === input.id))
          return route.fulfill({
            status: 400,
            json: { error: 'Det finns redan en katalog med det id:t.', code: 'invalid' },
          });
        const provisioner = {
          id: input.id,
          label: input.label,
          lastSeenAt: null,
          silent: true,
          previousValidUntil: null,
        };
        this.users.provisioners.push(provisioner);
        return json({
          id: input.id,
          token: 'a11y-key-' + input.id,
          address: 'https://clew.test/scim/v2',
          overview: this.users,
        });
      }
      const keyed = /^\/admin\/users\/provisioners\/([^/]+)\/(rotate|revoke)$/.exec(path);
      if (keyed && method === 'POST') {
        const provisioner = this.users.provisioners.find(p => p.id === decodeURIComponent(keyed[1]!));
        if (!provisioner)
          return route.fulfill({ status: 400, json: { error: 'Katalogen finns inte.', code: 'invalid' } });
        if (keyed[2] === 'revoke') {
          this.users.provisioners = this.users.provisioners.filter(p => p !== provisioner);
          return json(this.users);
        }
        const { graceHours } = request.postDataJSON() as { graceHours: number },
          // One replaced key is kept (D107 item 5): one still answering is ended, and the answer says until when.
          before = provisioner.previousValidUntil;
        provisioner.previousValidUntil = graceHours ? '2026-11-12T05:00:00.000Z' : null;
        return json({
          id: provisioner.id,
          token: 'a11y-key-rotated',
          address: 'https://clew.test/scim/v2',
          overview: this.users,
          ...(before && before > NOW ? { endedEarlier: before } : {}),
        });
      }
      if (path === '/admin/users/group-capabilities' && method === 'POST') {
        const input = request.postDataJSON() as {
          groupExternalId: string;
          capability: 'admin.connectors' | 'admin.users';
        };
        if (
          !this.users.groupCapabilities.some(
            m => m.groupExternalId === input.groupExternalId && m.capability === input.capability,
          )
        )
          this.users.groupCapabilities.push({
            groupExternalId: input.groupExternalId,
            groupLabel:
              [...this.users.groups, ...this.groupsBeyond].find(g => g.id === input.groupExternalId)?.label ?? null,
            capability: input.capability,
          });
        return json(this.users);
      }
      // D121: a group gives Kompetenssökning, mapped beside the capabilities by calls of its own.
      if (path === '/admin/users/group-relations' && method === 'POST') {
        const input = request.postDataJSON() as { groupExternalId: string; relation: RelationGrant };
        if (!this.users.groupRelations.some(m => m.groupExternalId === input.groupExternalId))
          this.users.groupRelations.push({
            groupExternalId: input.groupExternalId,
            groupLabel: this.users.groups.find(g => g.id === input.groupExternalId)?.label ?? null,
            relation: input.relation,
          });
        return json(this.users);
      }
      if (path === '/admin/users/group-relations/remove' && method === 'POST') {
        const input = request.postDataJSON() as { groupExternalId: string; relation: string };
        this.users.groupRelations = this.users.groupRelations.filter(
          m => !(m.groupExternalId === input.groupExternalId && m.relation === input.relation),
        );
        return json(this.users);
      }
      if (path === '/admin/users/group-capabilities/remove' && method === 'POST') {
        const input = request.postDataJSON() as { groupExternalId: string; capability: string };
        this.users.groupCapabilities = this.users.groupCapabilities.filter(
          m => !(m.groupExternalId === input.groupExternalId && m.capability === input.capability),
        );
        return json(this.users);
      }
      if (path.startsWith('/admin/models') || path.startsWith('/admin/providers'))
        return this.handleModels(route, method, path);
      if (path === '/admin/connectors' && method === 'GET') return json({ connectors: this.connectors });
      if (path === '/admin/connectors' && method === 'POST') {
        const input = request.postDataJSON() as { id: string; url: string };
        const c: ConnectorSummary = {
          ...connectorDetail({
            ...this.connectors[2]!,
            id: input.id,
            source: 'Nytt system',
            url: input.url,
            state: 'draft',
            registered: false,
            health: { status: 'ok', at: NOW },
          }),
        };
        this.connectors = [...this.connectors, c];
        return route.fulfill({
          status: 201,
          json: {
            connector: connectorDetail(c),
            report: { ok: true, items: checkReport.items.filter(i => i.level === 'ok') },
          },
        });
      }
      if (path === `/admin/connectors/${cid}/test`)
        return json({ ...checkReport, health: { status: 'secret-rejected', at: NOW } });
      if (path === `/admin/connectors/${cid}/refresh`) {
        const c = found();
        return c
          ? json({
              diff: {
                added: ['hello.remind'],
                removed: ['hello.openItems'],
                changed: [],
                areasAdded: [],
                areasRemoved: [],
                same: false,
              },
              connector: connectorDetail(c),
            })
          : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
      }
      if (path === `/admin/connectors/${cid}/preview`)
        return json(connectorPreview(url.searchParams.get('role') === 'employee' ? 'employee' : 'manager'));
      if (path === `/admin/connectors/${cid}/secret`) {
        const c = found();
        return c
          ? json(connectorDetail({ ...c, secretChangedAt: NOW }))
          : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
      }
      if (path === `/admin/connectors/${cid}`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        if (method === 'DELETE') {
          this.connectors = this.connectors.filter(x => x.id !== cid);
          return json({ closedCards: 1 });
        }
        if (method === 'PATCH') {
          const patch = request.postDataJSON() as Partial<ConnectorSummary>;
          const next = {
            ...c,
            ...('state' in patch ? { state: patch.state! } : {}),
            ...('audience' in patch ? { audience: patch.audience! } : {}),
            ...('scanEnabled' in patch ? { scanEnabled: patch.scanEnabled! } : {}),
            ...('toolsEnabled' in patch ? { toolsEnabled: patch.toolsEnabled! } : {}),
            ...('header' in patch ? { header: patch.header! } : {}),
            updatedAt: NOW,
          };
          // The header is exclusive (D88): the new holder takes it from the previous one.
          if ('header' in patch && patch.header)
            this.connectors = this.connectors.map(x => (x.id === cid ? x : { ...x, header: false }));
          if ('menu' in patch)
            for (const [name, on] of Object.entries((patch as { menu: Record<string, boolean> }).menu))
              this.menuOn = on ? [...new Set([...this.menuOn, name])] : this.menuOn.filter(n => n !== name);
          if ('figures' in patch)
            for (const [area, on] of Object.entries((patch as { figures: Record<string, boolean> }).figures))
              this.figuresOff = on ? this.figuresOff.filter(a => a !== area) : [...new Set([...this.figuresOff, area])];
          this.connectors = this.connectors.map(x => (x.id === cid ? next : x));
          return json(connectorDetail(next, this.menuOn, this.figuresOff));
        }
        return json(connectorDetail(c, this.menuOn, this.figuresOff));
      }
    }
    if (path === '/threads') {
      if (this.threadsDelay) await new Promise(resolve => setTimeout(resolve, this.threadsDelay));
      return json({ threads: this.threads, deliveries: this.deliveries, sources: this.sources });
    }
    if (path.startsWith('/deliveries/') && path.endsWith('/claim') && post) {
      const deliveryId = decodeURIComponent(path.split('/')[2]!);
      const claimed = !this.deliveryClaims.includes(deliveryId);
      if (claimed) this.deliveryClaims.push(deliveryId);
      return json({ claimed });
    }
    if (path === '/areas') {
      if (this.areasDelay) await new Promise(resolve => setTimeout(resolve, this.areasDelay));
      // The person sees the systems the registry shows them (D23): the calendar unless it is hidden from them, and
      // Kompetens while the module is switched on (D108 item 13).
      const systems = [
        ...this.systems.filter(s => s.connector !== 'calendar' || this.calendar !== 'hidden'),
        ...(this.competenceTypes ? [{ connector: 'competence', source: 'Kompetens', ordinal: null }] : []),
        ...(this.boarding ? [{ connector: 'boarding', source: 'Clew', ordinal: null }] : []),
      ];
      return json({ areas: this.areas, menu: this.menu, systems, views: this.views });
    }
    // The calendar's own reads (D116, amended 2026-11-12): hidden is the route's 404, unbound and silent its 400s.
    if (/^\/(today|calendar)(\/|$)/.test(path) && this.calendar !== 'ok') {
      if (this.calendar === 'hidden') return route.fulfill({ status: 404, json: { error: 'Okänd förmåga.' } });
      return route.fulfill({
        status: 400,
        json: {
          error:
            this.calendar === 'unbound'
              ? 'Ditt konto har ingen kalender kopplad.'
              : 'Kalenderkontot är inte tillgängligt.',
        },
      });
    }
    if (path === '/today') return json(today);
    // A meeting ask's free times and the person's own day (D112), as `GET /api/asks/times` answers them.
    if (path === '/asks/times') {
      this.timesReads.push(url.search);
      const date = url.searchParams.get('date');
      return json({
        durationMinutes: 45,
        slots: this.freeTimes ?? [],
        ...(date && this.freeTimes ? { day: ownDay(date) } : {}),
      });
    }
    if (path === '/attention') return json(attention);
    if (path === '/assistant/status') return json(assistantStatus(this.modelChoices, this.currentModel));
    if (path === '/assistant/handover') return json({ assistants: this.handoverAssistants });
    if (path === '/assistant/model' && request.method() === 'PATCH') {
      this.currentModel = (request.postDataJSON() as { modelId: string }).modelId;
      return json(assistantStatus(this.modelChoices, this.currentModel));
    }
    if (path === '/calendar') {
      const from = url.searchParams.get('from') ?? '2026-11-02';
      return json({
        from,
        events: events(from),
        proposals: from === NEXT_WEEK ? (this.threads.find(t => t.id === 'samtal')?.proposals ?? []) : [],
      });
    }
    // A person's own bookings and proposal moves (D32): the form's lists, the free-busy check, and the writes answered as the server would.
    if (path === '/calendar/members')
      return json({
        members: [
          { name: 'Anna Lindqvist', email: 'anna@clew.test' },
          { name: 'Erik Sandström', email: 'erik@clew.test' },
        ],
      });
    if (path === '/calendar/rooms')
      return json({ rooms: [{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: ['skärm'] }] });
    if (path === '/calendar/availability' && post)
      return json({
        mine: 'free',
        participants: [{ email: 'anna@clew.test', name: 'Anna Lindqvist', state: 'busy' }],
        room: { ref: 'room:a12', name: 'A12', state: 'free' },
      });
    if (['/calendar/events', '/calendar/events/reschedule', '/calendar/events/cancel'].includes(path) && post) {
      const b = request.postDataJSON() as { decisionId: string; title?: string };
      const card: Thread = {
        ...this.threads[0]!,
        id: 'calendar:' + b.decisionId,
        topic: 'calendar:' + b.decisionId,
        connector: 'calendar',
        area: 'calendar',
        title: b.title ?? 'Kalenderändring',
        summary: 'Beslutet är sparat.',
        state: 'open',
        items: [],
        actions: [],
        proposals: [],
        receipt: null,
        waitingOn: 'kalenderns besked',
        execution: {
          id: b.decisionId,
          decisionId: b.decisionId,
          operation: 'calendar.createEvent',
          state: 'pending',
          reason: null,
          compensates: null,
        },
      };
      this.threads.push(card);
      return route.fulfill({ status: 202, json: card });
    }
    if (/^\/threads\/[^/]+\/proposals\/[^/]+\/move$/.test(path) && post) {
      const b = request.postDataJSON() as { start: string; end: string };
      const pid = path.split('/')[4];
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, { proposals: t.proposals.map(p => (p.id === pid ? { ...p, start: b.start, end: b.end } : p)) }),
      );
    }
    if (path === '/cap/calendar.today') return json({ output: today });
    if (path === '/cap/calendar.week') {
      const from = (JSON.parse(url.searchParams.get('input') ?? '{}') as { from?: string }).from ?? '2026-11-02';
      return json({ output: { from, events: events(from) } });
    }
    if (path === '/cap/calendar.day') {
      const date = (JSON.parse(url.searchParams.get('input') ?? '{}') as { date?: string }).date ?? '2026-11-04';
      return json({
        output: { from: date, events: events(date).filter(e => e.start.startsWith(date)), proposals: [] },
      });
    }
    // The calendar's rooms (D69, amended): the one calendar read with a declared view, drawn by the one renderer.
    if (path === '/cap/calendar.rooms') return json({ output: { rows: rooms }, source: 'Kalendern', view: roomsSpec });
    // The combined errand list (D35 item 4, D89) and one errand in the system a row came from.
    if (path === '/cap/clew.errands') return json({ output: errandsOutput, source: 'Startsidan', view: errandsSpec });
    if (path === '/cap/sm.errand')
      return json({ output: smErrandOutput, source: 'Ärendesystemet', view: smErrandSpec });
    // What the person ordered or reported (D123), and one request in the service desk a row came from.
    if (path === '/cap/clew.requests')
      return json({ output: requestsOutput, source: 'Startsidan', view: requestsSpec });
    if (path === '/cap/servicedesk.request')
      return json({ output: deskRequestOutput, source: 'IT-servicedesken', view: deskRequestSpec });
    // The combined news list (D112, amended 2026-11-11), refused without a news source as the registry refuses an
    // out-of-scope read, and one piece of news opened in the source it came from.
    if (path === '/cap/clew.news')
      return this.news
        ? json({ output: this.news, source: 'Startsidan', view: newsSpec })
        : route.fulfill({ status: 400, json: { error: 'Du saknar behörighet för åtgärden.' } });
    if (path === '/cap/communication.newsItem')
      return json({ output: newsItemOutput, source: 'Kommunikation', view: newsItemSpec });
    // Kompetens (D108): the catalogue and a manager's registration.
    if (path.startsWith('/competence/') && !this.competenceTypes)
      return route.fulfill({
        status: 403,
        json: { error: 'Kompetens är inte påslaget i den här installationen.', code: 'denied' },
      });
    if (path === '/competence/types' && route.request().method() === 'GET')
      return this.catalogueReadFails
        ? route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } })
        : json({ rows: this.competenceTypes });
    // An import's part (D120 item 7): what the catalogue holds already, by address or name, is skipped.
    if (path === '/competence/types/import' && this.competenceTypes && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as CompetenceImportBody;
      if (this.importFail && this.importWrites.length >= this.importFailAfter) {
        const error = this.importFail;
        this.importFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      this.importWrites.push(body);
      const types = this.competenceTypes;
      let added = 0,
        skipped = 0;
      for (const row of body.rows) {
        const held = types.some(
          t =>
            (row.uri !== null && t.uri === row.uri) ||
            ((!t.archived || !!t.mergedInto) && t.name.toLowerCase() === row.name.toLowerCase()),
        );
        if (held) {
          skipped++;
          continue;
        }
        added++;
        types.push({
          id: `t-imp-${types.length + 1}`,
          name: row.name,
          area: row.area,
          kind: row.kind,
          ...(row.validityMonths ? { validityMonths: row.validityMonths } : {}),
          archived: false,
          ...(row.uri ? { uri: row.uri } : {}),
        });
      }
      return json({ added, skipped });
    }
    const typePath = /^\/competence\/types(?:\/([^/]+))?(\/archive|\/validity|\/merge|\/restore)?$/.exec(path);
    if (typePath && this.competenceTypes && path !== '/competence/types') {
      const id = decodeURIComponent(typePath[1]!),
        method = route.request().method();
      if (typePath[2] === '/validity') return json(this.validityImpact);
      const found = this.competenceTypes.find(t => t.id === id);
      if (!found) return route.fulfill({ status: 400, json: { error: 'Kompetensen finns inte i katalogen.' } });
      if (typePath[2] === '/merge' && method === 'GET') return json(this.mergePreview);
      if (this.catalogueFail) {
        const error = this.catalogueFail;
        this.catalogueFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      if (typePath[2] === '/archive' && method === 'POST') {
        found.archived = true;
        this.catalogueWrites.push({ method, path });
        return route.fulfill({ status: 204, body: '' });
      }
      if (typePath[2] === '/restore' && method === 'POST') {
        found.archived = false;
        this.catalogueWrites.push({ method, path });
        return route.fulfill({ status: 204, body: '' });
      }
      if (typePath[2] === '/merge' && method === 'POST') {
        const body = route.request().postDataJSON() as CompetenceMergeBody;
        Object.assign(found, { archived: true, mergedInto: body.into });
        this.catalogueWrites.push({ method, path, body });
        return json(this.mergePreview);
      }
      if (method === 'PATCH') {
        const body = route.request().postDataJSON() as CompetenceTypePatch;
        const { validityMonths, ...rest } = body;
        Object.assign(found, rest);
        if (validityMonths === null) delete found.validityMonths;
        else if (validityMonths !== undefined) found.validityMonths = validityMonths;
        this.catalogueWrites.push({ method, path, body });
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (path === '/competence/types' && this.competenceTypes && route.request().method() === 'POST') {
      if (this.catalogueFail) {
        const error = this.catalogueFail;
        this.catalogueFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      const body = route.request().postDataJSON() as CompetenceTypeBody;
      const id = 't-new-' + (this.catalogueWrites.length + 1);
      this.competenceTypes.push({
        id,
        name: body.name,
        area: body.area,
        kind: body.kind,
        ...(body.validityMonths ? { validityMonths: body.validityMonths } : {}),
        archived: false,
      });
      this.catalogueWrites.push({ method: 'POST', path, body });
      return route.fulfill({ status: 201, json: { id } });
    }
    // Kompetens › Källor (D108 item 9): the sources, a mapping and a read started by hand.
    if (path === '/competence/sources' && route.request().method() === 'GET')
      return json({ rows: this.competenceSources });
    const sourcePath = /^\/competence\/sources\/([^/]+)\/(mapping|read)$/.exec(path);
    if (sourcePath) {
      const source = this.competenceSources.find(s => s.connectorId === decodeURIComponent(sourcePath[1]!)),
        method = route.request().method();
      if (this.sourceFail) {
        const error = this.sourceFail;
        this.sourceFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      if (!source) return route.fulfill({ status: 400, json: { error: 'Källan svarar inte om intyg just nu.' } });
      if (sourcePath[2] === 'read' && method === 'POST') {
        source.reading = true;
        this.sourceWrites.push({ method, path });
        return route.fulfill({ status: 202, body: '' });
      }
      if (sourcePath[2] === 'mapping' && method === 'PUT') {
        const body = route.request().postDataJSON() as CompetenceMappingBody;
        const type = source.types.find(t => t.sourceType === body.sourceType);
        if (type) {
          if (body.typeId === null) delete type.typeId;
          else type.typeId = body.typeId;
        }
        this.sourceWrites.push({ method, path, body });
        return json({ holdings: type?.holdings ?? 0 });
      }
    }
    // Kompetenssökning (D121): refused to anyone without the relation, as the server refuses; the type field asks the
    // catalogue, by words or by the ids an address names; a search and its file are asked in a body, every chosen type
    // held, filtered and sorted before a page is cut, as the server does.
    if (path === '/competence/search/types' && route.request().method() === 'POST') {
      const asked = route.request().postDataJSON() as { text?: string; ids?: string[] };
      this.typesNamed.push(...(asked.ids ?? []));
      // By the ids an address names, archived ones too, in the order asked; an unknown id is left out.
      if (asked.ids)
        return json({
          rows: asked.ids.flatMap(id => (this.competenceTypes ?? []).filter(t => t.id === id)),
          more: false,
        });
      const words = (asked.text ?? '').toLocaleLowerCase('sv').split(/\s+/).filter(Boolean);
      const found = (this.competenceTypes ?? []).filter(
        t => !t.archived && words.every(w => (t.name + ' ' + t.area).toLocaleLowerCase('sv').includes(w)),
      );
      return json({ rows: found.slice(0, 20), more: found.length > 20 });
    }
    if (path === '/competence/search' || path === '/competence/search.csv') {
      if (!this.relations.includes('registrar'))
        return route.fulfill({
          status: 403,
          json: {
            error: 'Kompetenssökning är inte tilldelad dig. En administratör ger den genom en grupp.',
            code: 'denied',
          },
        });
      if (route.request().method() === 'GET') {
        this.searchOptionsReads++;
        return json({
          units: [
            { id: 'unit-skola', label: 'Bergsåkers skola', parentLabel: 'Grundskola' },
            { id: 'unit-omsorg', label: 'Hemtjänst Centrum', parentLabel: null },
          ],
        });
      }
      if (this.searchFails) return route.fulfill({ status: 503, json: { error: 'Något gick fel. Försök igen.' } });
      const body = route.request().postDataJSON() as CompetenceSearchBody;
      // As the server: every type is the catalogue's, or nothing is read or logged.
      const types = body.typeIds.map(id => this.competenceTypes?.find(t => t.id === id));
      if (types.some(t => !t))
        return route.fulfill({ status: 400, json: { error: 'Kompetensen finns inte i katalogen.' } });
      const chosen = types as NonNullable<(typeof types)[number]>[];
      const skill = (typeId: string) => chosen.find(t => t.id === typeId)?.kind === 'skill';
      const today = NOW.slice(0, 10);
      const days = (end: string) => Math.round((Date.parse(end) - Date.parse(today)) / 86_400_000);
      // One row per person who holds every chosen type, their types as held in the order chosen.
      const [first, ...rest] = chosen.map(t => this.competenceSearch[t.id] ?? []);
      const all = (first ?? [])
        .filter(r => rest.every(rows => rows.some(o => o.personId === r.personId)))
        .map(r => ({
          ...r,
          held: [r, ...rest.map(rows => rows.find(o => o.personId === r.personId)!)].flatMap(o => o.held),
        }))
        .filter(
          r =>
            (!body.unitId ||
              r.units.includes(body.unitId === 'unit-skola' ? 'Bergsåkers skola' : 'Hemtjänst Centrum')) &&
            r.held.every(h => !skill(h.typeId) || !body.minLevel || (h.level ?? 0) >= body.minLevel),
        );
      const narrowed = all.filter(r =>
        r.held.every(
          h =>
            skill(h.typeId) ||
            ((!body.status || body.status.includes(h.status)) &&
              (!body.until ||
                (h.expiresOn !== undefined && days(h.expiresOn) >= 0 && days(h.expiresOn) <= body.until))),
        ),
      );
      const rank = { expired: 0, expiring: 1, valid: 2 } as const;
      const value = (r: CompetenceSearchRow): string | number | undefined =>
        body.sort === 'unit'
          ? r.units.join(', ') || undefined
          : body.sort === 'status'
            ? Math.min(...r.held.map(h => rank[h.status]))
            : body.sort === 'until'
              ? r.held.flatMap(h => (h.expiresOn ? [h.expiresOn] : [])).sort()[0]
              : body.sort === 'level'
                ? Math.min(...r.held.flatMap(h => (h.level ? [h.level] : [9])))
                : r.name;
      const sign = body.order === 'desc' ? -1 : 1;
      const held = [...narrowed].sort((a, b) => {
        const x = value(a),
          y = value(b);
        const by =
          x === y
            ? 0
            : x === undefined
              ? 1
              : y === undefined
                ? -1
                : typeof x === 'number'
                  ? x - (y as number)
                  : String(x).localeCompare(String(y), 'sv');
        return sign * by || a.name.localeCompare(b.name, 'sv') || a.personId.localeCompare(b.personId);
      });
      if (path === '/competence/search.csv') {
        this.searchFiles.push(body);
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="kompetenssokning-2026-11-04.csv"',
          },
          body: '\ufeffNamn;Användarnamn;Enhet;Status;Giltigt till\r\n',
        });
      }
      this.searchBodies.push(body);
      const pageSize = body.pageSize ?? 25,
        last = Math.max(1, Math.ceil(held.length / pageSize)),
        at = Math.min(body.page ?? 1, last);
      return json({
        types: chosen.map(t => ({ id: t.id, name: t.name, area: t.area, kind: t.kind })),
        rows: held.slice((at - 1) * pageSize, at * pageSize),
        total: held.length,
        unfiltered: all.length,
        page: at,
        pageSize,
      });
    }
    // Kompetens › Medarbetare (D108 item 11): the manager's matrix, its file, and a holding revoked from a cell. Someone
    // who manages nobody is refused as the server refuses them.
    if (path === '/competence/matrix' || path === '/competence/matrix.csv') {
      if (this.matrixDelay) await new Promise(resolve => setTimeout(resolve, this.matrixDelay));
      if (this.employee || this.staffForbidden)
        return route.fulfill({
          status: 403,
          json: { error: 'Medarbetarnas kompetens visas för den som är chef för en enhet.', code: 'denied' },
        });
      const answer = matrixAnswer(this.competenceMatrix, this.competenceMatrixSets, url.searchParams.get('by'));
      if (path === '/competence/matrix') {
        this.matrixReads.push(url.search);
        return json(answer);
      }
      this.matrixDownloads.push(url.search);
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="kompetens-2026-11-04.csv"',
        },
        body: '\ufeff' + ['Namn', 'Användarnamn', ...answer.columns.map(c => c.name)].join(';') + '\r\n',
      });
    }
    const revoking = /^\/competence\/holdings\/([^/]+)$/.exec(path);
    if (revoking && route.request().method() === 'DELETE') {
      const holdingId = decodeURIComponent(revoking[1]!);
      this.holdingWrites.push({ method: 'DELETE', path });
      this.changeMatrix(c =>
        c.holdingId === holdingId
          ? {
              typeId: c.typeId,
              status: c.required ? 'missing' : 'none',
              required: c.required,
              through: c.through,
              revocable: false,
            }
          : c,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    // Kompetens › Krav (D108 item 6): the requirements and the share targets, each listed, added and removed.
    const requirementPath = /^\/competence\/(requirements|share-targets)(?:\/([^/]+))?$/.exec(path);
    if (requirementPath) {
      const method = route.request().method(),
        targets = requirementPath[1] === 'share-targets',
        id = requirementPath[2] ? decodeURIComponent(requirementPath[2]) : undefined;
      if (method === 'GET' && !id)
        return json(targets ? { rows: this.competenceShareTargets } : this.competenceRequirements);
      if (this.requirementFail) {
        const error = this.requirementFail;
        this.requirementFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      const { positions, units } = this.competenceRequirements;
      if (method === 'POST' && !id) {
        const body = route.request().postDataJSON() as CompetenceRequirementBody & CompetenceShareTargetBody;
        const created = `${targets ? 'target' : 'requirement'}-new-${this.requirementWrites.length + 1}`;
        this.requirementWrites.push({ method, path, body });
        // A manager's requirement on one person (D118): the person's cell in the matrix is required by it.
        if (!targets && body.personId) {
          this.requirePerson(body.personId, body.typeId, created);
          return route.fulfill({ status: 201, json: { id: created } });
        }
        const position = positions.find(p => p.code === body.positionCode),
          unit = units.find(u => u.id === body.unitId);
        if (targets)
          this.competenceShareTargets.push({
            id: created,
            typeId: body.typeId,
            positionCode: body.positionCode!,
            positionLabel: position?.label ?? body.positionCode!,
            ...(unit ? { unitId: unit.id, unitLabel: unit.label } : {}),
            minShare: body.minShare,
          });
        else
          this.competenceRequirements.rows.push({
            id: created,
            typeId: body.typeId,
            on: body.unitId ? 'unit' : 'position',
            targetId: (body.unitId ?? body.positionCode)!,
            targetLabel: (unit?.label ?? position?.label)!,
            ...(body.minLevel !== undefined ? { minLevel: body.minLevel } : {}),
          });
        return route.fulfill({ status: 201, json: { id: created } });
      }
      if (method === 'DELETE' && id) {
        this.requirementWrites.push({ method, path });
        if (!targets) this.unrequire(id);
        if (targets) this.competenceShareTargets = this.competenceShareTargets.filter(t => t.id !== id);
        else this.competenceRequirements.rows = this.competenceRequirements.rows.filter(r => r.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    // Skills (D120): the reader's own rating, added once, changed by its holding and removed; a manager's registration
    // and confirmation from the matrix, which change the cell as the server's would.
    if (path === '/competence/own/skills' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as CompetenceSkillRatingBody;
      if (this.competenceOwn.skills.some(k => k.typeId === body.typeId))
        return route.fulfill({
          status: 400,
          json: { error: 'Du har redan den färdigheten. Ändra nivån under Färdigheter i stället.' },
        });
      this.skillWrites.push({ method: 'POST', path, body });
      const type = this.competenceTypes?.find(t => t.id === body.typeId);
      const id = 'skill-' + this.skillWrites.length;
      this.competenceOwn = {
        ...this.competenceOwn,
        skills: [
          ...this.competenceOwn.skills,
          {
            holdingId: id,
            typeId: body.typeId,
            competence: type?.name ?? body.typeId,
            area: type?.area ?? '',
            level: body.level,
            validated: false,
            interest: body.interest,
          },
        ],
      };
      return route.fulfill({ status: 201, json: { id } });
    }
    const ownSkill = /^\/competence\/own\/skills\/([^/]+)$/.exec(path);
    if (ownSkill && route.request().method() === 'PUT') {
      const id = decodeURIComponent(ownSkill[1]!);
      const body = route.request().postDataJSON() as CompetenceSkillChangeBody;
      const held = this.competenceOwn.skills.find(k => k.holdingId === id);
      if (!held) return route.fulfill({ status: 403, json: { error: 'Du har ingen sådan färdighet.' } });
      this.skillWrites.push({ method: 'PUT', path, body });
      this.competenceOwn = {
        ...this.competenceOwn,
        skills: this.competenceOwn.skills.map(k =>
          k.holdingId === id
            ? { ...k, level: body.level, interest: body.interest, validated: k.validated && k.level === body.level }
            : k,
        ),
      };
      return route.fulfill({ status: 204, body: '' });
    }
    if (ownSkill && route.request().method() === 'DELETE') {
      const id = decodeURIComponent(ownSkill[1]!);
      this.skillWrites.push({ method: 'DELETE', path });
      this.competenceOwn = { ...this.competenceOwn, skills: this.competenceOwn.skills.filter(k => k.holdingId !== id) };
      return route.fulfill({ status: 204, body: '' });
    }
    const registeringSkill = /^\/competence\/people\/([^/]+)\/skills$/.exec(path);
    if (registeringSkill && route.request().method() === 'POST') {
      const personId = decodeURIComponent(registeringSkill[1]!);
      const body = route.request().postDataJSON() as CompetenceSkillBody;
      this.skillWrites.push({ method: 'POST', path, body });
      const id = 'skill-new-' + this.skillWrites.length;
      this.changeMatrix((c, p) =>
        p === personId && c.typeId === body.typeId
          ? {
              ...c,
              status: c.least !== undefined && body.level < c.least ? 'missing' : 'valid',
              holdingId: id,
              evidence: 'manager',
              revocable: true,
              level: body.level,
              validated: true,
            }
          : c,
      );
      return route.fulfill({ status: 201, json: { id } });
    }
    const skillPath = /^\/competence\/skills\/([^/]+?)(\/validation)?$/.exec(path);
    if (skillPath) {
      const id = decodeURIComponent(skillPath[1]!);
      const found = this.competenceSkills[id];
      if (!found)
        return route.fulfill({ status: 403, json: { error: 'Färdigheten finns inte bland dem du kan bekräfta.' } });
      if (route.request().method() === 'GET' && !skillPath[2]) return json(found);
      const body = route.request().postDataJSON() as CompetenceValidationBody;
      this.skillWrites.push({ method: 'POST', path, body });
      const level = body.level ?? found.level;
      this.competenceSkills[id] = { ...found, level, validated: true };
      this.changeMatrix(c =>
        c.holdingId === id
          ? { ...c, level, validated: true, status: c.least !== undefined && level < c.least ? 'missing' : 'valid' }
          : c,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    // A person's own registration (D108 item 7): what waits, a new one and one taken back.
    if (path === '/competence/own' && route.request().method() === 'GET') return json(this.competenceOwn);
    if (path === '/competence/own/types' && route.request().method() === 'GET')
      return json({ rows: this.competenceTypes });
    if (path === '/competence/own/holdings' && route.request().method() === 'POST') {
      if (this.ownFail) {
        const error = this.ownFail;
        this.ownFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      const body = route.request().postDataJSON() as CompetenceHoldingBody;
      this.ownWrites.push({ method: 'POST', path, body });
      const id = 'own-' + this.ownWrites.length;
      const type = this.competenceTypes?.find(t => t.id === body.typeId);
      this.competenceOwn = {
        ...this.competenceOwn,
        pending: [
          ...this.competenceOwn.pending,
          {
            holdingId: id,
            typeId: body.typeId,
            competence: type?.name ?? body.typeId,
            issuedOn: body.issuedOn,
            ...(body.expiresOn ? { expiresOn: body.expiresOn } : {}),
          },
        ],
      };
      return route.fulfill({ status: 201, json: { id } });
    }
    const withdrawing = /^\/competence\/own\/holdings\/([^/]+)$/.exec(path);
    if (withdrawing && route.request().method() === 'DELETE') {
      const id = decodeURIComponent(withdrawing[1]!);
      this.ownWrites.push({ method: 'DELETE', path });
      this.competenceOwn = {
        ...this.competenceOwn,
        pending: this.competenceOwn.pending.filter(p => p.holdingId !== id),
      };
      return route.fulfill({ status: 204, body: '' });
    }
    // One the manager rejected, removed by the person.
    const removingRejected = /^\/competence\/own\/rejected\/([^/]+)$/.exec(path);
    if (removingRejected && route.request().method() === 'DELETE') {
      const id = decodeURIComponent(removingRejected[1]!);
      this.ownWrites.push({ method: 'DELETE', path });
      this.competenceOwn = {
        ...this.competenceOwn,
        rejected: this.competenceOwn.rejected.filter(p => p.holdingId !== id),
      };
      return route.fulfill({ status: 204, body: '' });
    }
    // Its decision by the manager the person reports to: the registration read, and approved or rejected.
    const approvalPath = /^\/competence\/approvals\/([^/]+)$/.exec(path);
    if (approvalPath) {
      const id = decodeURIComponent(approvalPath[1]!);
      const found = this.competenceApprovals[id];
      if (!found)
        return route.fulfill({ status: 403, json: { error: 'Registreringen finns inte bland dem du kan granska.' } });
      if (route.request().method() === 'GET') return json(found);
      const body = route.request().postDataJSON() as CompetenceDecisionBody;
      this.approvalWrites.push({ path, body });
      delete this.competenceApprovals[id];
      this.competenceMatrix = {
        ...this.competenceMatrix,
        awaiting: this.competenceMatrix.awaiting.filter(a => a.holdingId !== id),
      };
      // Approved, the registration decides the cell; rejected, the cell is as it was without it.
      this.changeMatrix(c => {
        if (c.pending !== id) return c;
        const { pending: _pending, ...rest } = c;
        return body.decision === 'approve'
          ? { ...rest, status: 'valid', holdingId: id, evidence: 'self', revocable: true }
          : rest;
      });
      return route.fulfill({ status: 204, body: '' });
    }
    const registering = /^\/competence\/people\/([^/]+)\/holdings$/.exec(path);
    if (registering && route.request().method() === 'POST') {
      if (this.registerFail) {
        const error = this.registerFail;
        this.registerFail = null;
        return route.fulfill({ status: 400, json: { error } });
      }
      const body = route.request().postDataJSON() as CompetenceHoldingBody;
      this.registered.push({ personId: decodeURIComponent(registering[1]!), body });
      return route.fulfill({ status: 201, json: { id: 'holding-' + this.registered.length } });
    }
    // Kompetens (D108): one person's holdings, the view the person's section opens; refused while the module is off, as
    // the registry refuses a read of a connector that is switched off: `GET /api/cap` answers it 404, as a name nobody
    // registered.
    // What needs doing among a manager's reports, as the card under an answer reads it again.
    if (path === '/cap/competence.attention')
      return this.competenceTypes
        ? json({ output: attentionOutput, source: 'Kompetens', view: attentionSpec })
        : route.fulfill({ status: 404, json: { error: 'Okänd förmåga.' } });
    if (path === '/cap/competence.holdings')
      return this.competenceTypes
        ? json({ output: this.competenceHoldings, source: 'Kompetens', view: holdingsSpec })
        : route.fulfill({ status: 404, json: { error: 'Okänd förmåga.' } });
    // Introduktion och avslut (D124): the module's own routes, refused while it is off; the layers are an
    // administrator's with `admin.boarding` alone.
    if (path.startsWith('/boarding/')) {
      if (!this.boarding) return boardingOff(route);
      if (path.startsWith('/boarding/layers') && !(this.admin && this.capabilities.includes('admin.boarding')))
        return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
      const answered = await this.boarding.handle(route, path);
      if (answered !== null) return answered;
    }
    // The IT service desk's equipment on a person, a read a plan's item opens (D124).
    if (path === '/cap/servicedesk.equipment') return json(equipmentAnswer);
    // Utvecklingssamtal (D96): the two composites and the built-in module's writes.
    if (path === '/cap/clew.talks' || path === '/cap/clew.commitments' || path.startsWith('/talks/'))
      return this.handleTalks(route, path, url);
    // `@` as the server answers it: with nothing typed only the context the box sends (`near`), with text everything open, the context first.
    if (path === '/objects') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase(),
        near = (url.searchParams.get('near') ?? '').split(',');
      const all = this.threads
        .filter(t => t.state === 'open' && t.kind === 'pushed')
        .flatMap(t => [
          {
            ref: 'thread:' + t.id,
            kind: 'thread',
            label: t.title,
            detail: 'kort',
            threadId: t.id,
            visible: near.includes('thread:' + t.id),
          },
          ...t.items.map(i => ({
            ref: i.ref,
            kind: 'item',
            label: i.label,
            detail: 'rad',
            threadId: t.id,
            visible: near.includes('thread:' + t.id),
          })),
        ]);
      const hits = q ? all.filter(o => o.label.toLowerCase().includes(q)) : all.filter(o => o.visible);
      return json({ objects: [...hits.filter(o => o.visible), ...hits.filter(o => !o.visible)].slice(0, 12) });
    }
    // A name finds a person (D38): the hit carries its contact card as a view. Anything else finds the routine.
    if (path === '/cap/clew.search')
      return json({ output: /lindqvist/i.test(url.searchParams.get('input') ?? '') ? personSearch : searchOutput });
    // The phone book's declared views, answered by the connector itself.
    if (path.startsWith('/cap/phonebook.')) {
      const answer = await phonebook(path.slice('/cap/'.length), JSON.parse(url.searchParams.get('input') ?? '{}'));
      return route.fulfill({ status: answer.status, json: answer.body });
    }
    if (path === '/cap/clew.cardFromAnswer' && post) return json({ output: { threadId: 'rutin' } });
    if (path.startsWith('/cap/')) return json({ output: this.output, source: 'Personalsystemet' });
    // A turn as the server streams it (D36): a read as a step, the answer in two deltas, then the finished turn. Playwright
    // answers in one piece, so the pending turn is what `answerDelay` and `holdAnswer` hold open.
    if (path === '/conversation/stream') {
      const body = request.postDataJSON() as {
        text: string;
        conversationId?: string;
        chips?: { ref: string }[];
        assistant?: string;
        suggested?: boolean;
        own?: boolean;
        confirmed?: boolean;
      };
      this.asked.push(body);
      await this.answerHeld;
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      // Clew's assistant suggests the listed assistant for a question that matches, and the person is asked first
      // (D125 item 11): nothing is saved, and the turn ends as an offer.
      if (!body.assistant && !body.own && this.routes?.test(body.text) && this.handoverAssistants[0]) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'offer', assistant: this.handoverAssistants[0] })}\n\n`,
        });
        return;
      }
      // A question on its way to the assistant that names the person's staff is held, and they are asked (D125 item 13).
      if (body.assistant && !body.confirmed && this.holds?.test(body.text) && this.handoverAssistants[0]) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'hold', assistant: this.handoverAssistants[0], about: 'person' })}\n\n`,
        });
        return;
      }
      const handed = !!body.assistant;
      const response = handed
        ? handedConversation(this.threads, body.text, body.conversationId, this.handoverFails, {
            routed: !!body.suggested,
            ...(this.handoverReturns ? { returns: this.handoverReturns } : {}),
          })
        : conversation(this.threads, body.text, body.conversationId);
      const step = handed
        ? { id: 'steg-1', capability: 'clew.handover', title: 'Frågar HR-assistenten', source: 'Kunskapsbanken' }
        : { id: 'steg-1', capability: 'mock.read', title: 'Läser', source: response.answer.source };
      const half = Math.ceil(response.answer.body.length / 2);
      const events = [
        ...(handed
          ? [{ type: 'handed', assistant: { id: 'kunskap:hr', name: 'HR-assistenten', source: 'Kunskapsbanken' } }]
          : []),
        { type: 'step', step: { ...step, status: 'running' } },
        { type: 'step', step: { ...step, status: 'complete', ms: 800 } },
        { type: 'text', delta: response.answer.body.slice(0, half) },
        { type: 'text', delta: response.answer.body.slice(half) },
        { type: 'done', response },
      ];
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
        });
      } catch {
        return;
      }
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return;
    }
    if (path === '/conversation') {
      const body = request.postDataJSON() as { text: string; conversationId?: string };
      await this.answerHeld;
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return json(response);
    }
    if (path.endsWith('/verbs')) return json({ verbs: [] });
    if (path === '/snooze/presets') return json({ presets: snoozePresets });
    if (post && /^\/threads\/[^/]+\/(dismiss|snooze|reopen)$/.test(path)) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
    }
    if (path.endsWith('/snooze') && post) {
      const body = (request.postDataJSON() ?? {}) as { preset?: string; until?: string; text?: string };
      const until = body.until ?? snoozePresets.find(p => p.id === body.preset)?.at ?? '2026-11-05T05:00:00.000Z';
      return json(this.update(id, { snoozedUntil: until }));
    }
    if (path.endsWith('/dismiss') && post) return json(this.update(id, { state: 'dismissed', handledAt: NOW }));
    if (path.endsWith('/remind-invitees') && post) {
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, {
          proposals: t.proposals.map(p =>
            p.status === 'confirmed' ? { ...p, reminders: p.reminders + 1, remindedAt: NOW } : p,
          ),
        }),
      );
    }
    if (path.endsWith('/reopen') && post)
      return json(this.update(id, { state: 'open', handledAt: null, snoozedUntil: null }));
    // Confirming proposals (D70 amended): the calendar reads the invitations back, the card stays open and waits on the
    // invitees, and its receipt carries the way back for ten minutes.
    if (path.endsWith('/confirm') && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      const body = (request.postDataJSON() ?? {}) as { proposalIds?: string[] };
      const t = this.threads.find(t => t.id === id)!;
      const ids = body.proposalIds ?? [];
      const sent = t.proposals.filter(p => ids.includes(p.id));
      return json(
        this.update(id, {
          waitingOn: 'svar från medarbetarna',
          proposals: t.proposals.map(p =>
            ids.includes(p.id)
              ? { ...p, status: 'confirmed', eventRef: `memory:${p.id}`, undoUntil: '2026-11-04T08:10:00.000Z' }
              : p,
          ),
          receipt: {
            at: NOW,
            headline: `${sent.length} av ${sent.length} kalenderändringar är bekräftade.`,
            undoUntil: '2026-11-04T08:10:00.000Z',
            undoCapability: 'calendar.undoProposals',
            rows: sent.map(p => ({
              ref: p.id,
              label: p.participant.name,
              outcome: 'done',
              detail: 'Kontrollerat i kalendern.',
            })),
          },
        }),
      );
    }
    // The receipt's way back (D70): the card is as it was before the decision, its proposals proposed again. A proposal
    // card's own "Ångra allt" (`/undo`) is the same way back, from the card rather than from its row.
    if ((path.endsWith('/undo-receipt') || path.endsWith('/undo')) && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      const t = this.threads.find(t => t.id === id)!;
      return json(
        this.update(id, {
          state: 'open',
          handledAt: null,
          waitingOn: null,
          receipt: null,
          proposals: t.proposals.map(p =>
            p.status === 'confirmed' ? { ...p, status: 'proposed', eventRef: null, undoUntil: null } : p,
          ),
        }),
      );
    }
    // One item's document for the review flow (D70): an SVG the way the finance fixture draws one.
    if (path.endsWith('/preview') && !post) {
      const ref = url.searchParams.get('ref') ?? '';
      const item = this.threads.find(t => t.id === id)?.items.find(i => i.ref === ref);
      if (!item) return route.fulfill({ status: 400, json: { error: 'Raden finns inte på kortet.' } });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" role="img" aria-label="${item.label}"><rect width="640" height="400" fill="#fff"/><text x="48" y="64" font-size="22" font-weight="700">${item.label}</text><text x="48" y="120" font-size="14">${item.detail}</text></svg>`;
      return json({
        title: `Faktura · ${item.label}`,
        mediaType: 'image/svg+xml',
        data: Buffer.from(svg).toString('base64'),
      });
    }
    // "Det här händer" (D112): the HR fixture's effect read for exactly the values the dialog holds; writes nothing.
    if (path.endsWith('/effect') && post) {
      const body = (request.postDataJSON() ?? {}) as { actionId?: string; values?: Record<string, string> };
      this.effectReads.push({ threadId: id, body });
      if (this.effectDelay) await new Promise(resolve => setTimeout(resolve, this.effectDelay));
      if (this.effectFails) return route.fulfill({ status: 503, json: { error: 'Personalsystemet svarade inte.' } });
      const values = body.values ?? {};
      const details = [values.when ? talkTime(values.when) : 'nästa lediga tid', values.place].filter(Boolean);
      return json({
        rows: [
          {
            label: 'Omtankesamtalet registreras',
            detail: `På medarbetaren, ${details.join(', ')}${values.message ? ', med ditt meddelande' : ''}`,
          },
        ],
        undoMinutes: 10,
        source: 'Personalsystemet',
      });
    }
    if (path.endsWith('/act') && post) {
      // An execute answers with the card as the source read it back (D70): here at once, with the refs the person approved.
      const body = (request.postDataJSON() ?? {}) as {
        actionId?: string;
        refs?: string[];
        values?: Record<string, string>;
      };
      const t = this.threads.find(t => t.id === id);
      const action = t?.actions.find(a => a.id === body.actionId);
      if (t && action?.kind === 'execute') {
        this.acted.push({ threadId: id, body });
        if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
        if (this.mutationFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
        // The answers are checked against the asks as the server checks them (`answersOf`), and a refusal is its sentence.
        const values = body.values ?? {};
        const missing = (action.path?.asks ?? []).find(a => a.required && !values[a.property]);
        const refusal =
          this.actRefusal ??
          (missing ? `${missing.label} behöver fyllas i.` : undefined) ??
          (Object.keys(values).some(k => !(action.path?.asks ?? []).some(a => a.property === k))
            ? 'Åtgärden frågar inte efter det värdet.'
            : undefined);
        this.actRefusal = null;
        if (refusal) return route.fulfill({ status: 400, json: { error: refusal } });
        const refs = body.refs ?? t.items.filter(i => i.selected).map(i => i.ref);
        const receipt: Thread['receipt'] =
          action.capability === 'servicedesk.order'
            ? orderReceipt(values.item)
            : action.capability === 'hr.bookTalk'
              ? {
                  at: NOW,
                  headline: 'Samtalet är registrerat i personalsystemet.',
                  undoUntil: '2026-11-04T08:10:00.000Z',
                  undoCapability: 'hr.unbookTalk',
                  rows: [
                    {
                      ref: 'hr:emp:anna',
                      label: 'Omtankesamtal',
                      outcome: 'done',
                      detail: ['registrerat i personalsystemet', values.when && talkTime(values.when), values.place]
                        .filter(Boolean)
                        .join(', '),
                    },
                  ],
                }
              : action.capability === 'hr.decideLeave'
                ? {
                    at: NOW,
                    headline: 'Ansökan är godkänd.',
                    undoUntil: '2026-11-04T08:10:00.000Z',
                    undoCapability: 'hr.undecideLeave',
                    rows: [
                      {
                        ref: 'hr:leave:1',
                        label: 'Ansökan 21–22 dec',
                        outcome: 'done',
                        detail: 'godkänd i personalsystemet, medarbetaren meddelad',
                      },
                    ],
                  }
                : action.capability === 'communication.acknowledge'
                  ? // A read receipt (D112, amended 2026-11-11), as the communication fixture answers it: no way back.
                    {
                      at: NOW,
                      headline: 'Läskvittot är registrerat.',
                      undoUntil: null,
                      undoCapability: null,
                      rows: refs.map(ref => ({
                        ref,
                        label: t.items.find(i => i.ref === ref)?.label ?? t.title,
                        outcome: 'done' as const,
                        detail: 'kvitterat 09:00',
                      })),
                    }
                  : {
                      at: NOW,
                      headline: `${refs.length} ${refs.length === 1 ? 'faktura attesterad' : 'fakturor attesterade'}`,
                      undoUntil: '2026-11-04T08:10:00.000Z',
                      undoCapability: 'finance.unapprove',
                      rows: refs.map(ref => ({
                        ref,
                        label: t.items.find(i => i.ref === ref)?.label ?? ref,
                        outcome: 'done',
                        detail: 'Läst tillbaka från ekonomisystemet',
                      })),
                    };
        const decided = this.update(id, { state: 'handled', handledAt: NOW, receipt });
        // A decision through the dialog is a new version of the item, so its Händelser are read again (D112 item 4).
        if (action.path) decided.updatedAt = '2026-11-04T08:00:01.000Z';
        return json({ kind: 'execute', thread: decided });
      }
      if (this.cardReadDelay) await new Promise(resolve => setTimeout(resolve, this.cardReadDelay));
      if (this.cardReadFails) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      const read = body.actionId ? this.cardReads[body.actionId] : undefined;
      return json(read ? { kind: 'read', ...read } : { kind: 'read', output: this.output });
    }
    // A work item's Händelser (D112 item 4), as the audit rows of what the thread shows would read back.
    if (/^\/threads\/[^/]+\/events$/.test(path) && !post) {
      const t = this.threads.find(t => t.id === id);
      if (!t) return route.fulfill({ status: 404, json: { error: 'Ärendet finns inte.' } });
      if (this.itemEventsFail) return route.fulfill({ status: 503, json: { error: 'Källan svarade inte.' } });
      return json({ events: this.itemEvents[id] ?? eventsOf(t) });
    }
    if (path.startsWith('/threads/') && !post) {
      const t = this.threads.find(t => t.id === id);
      return t ? json(t) : route.fulfill({ status: 404, json: { error: 'Ärendet finns inte.' } });
    }
    this.unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: 'Inte mockat' } });
  }
  /**
   * Entities (D97), answered as the `entities` module would: only `person` is listed here; a person outside the list is
   * a 404, a source in `entitySilent` answers with that status and no rows, and someone who manages nobody gets a list
   * with no groups (no refusal).
   */
  /**
   * An action from an entity's menu (D97, D8), answered as the server would: an action the opened person or unit does
   * not offer is a 404, a refusal is the source's sentence as a 400, and otherwise the card it became, which joins the
   * stream and opens beside the page it was started on. The same start while that card is open gives the same card.
   */
  private entityStart(route: Route, path: string) {
    const [, , kind, key = '', sub] = path.split('/');
    const posted = route.request().postDataJSON() as { capability?: string; values?: Record<string, string> } | null;
    const capability = posted?.capability ?? '';
    const opened = decodeURIComponent(key);
    const detail =
      sub !== 'actions'
        ? undefined
        : kind === 'person'
          ? (this.entityDetailOf?.(opened) ?? entityDetail(this.entityList, opened))
          : kind === 'unit'
            ? this.unitDetailOf?.(opened)
            : undefined;
    const action = detail?.actions.find(a => a.capability === capability);
    if (!detail || !action) return route.fulfill({ status: 404, json: { error: 'Okänd adress.' } });
    this.entityStarts.push({
      key: detail.entity.key,
      capability,
      ...(posted?.values ? { values: posted.values } : {}),
    });
    const refusal = this.entityRefusals[capability];
    if (refusal) return route.fulfill({ status: 400, json: { error: refusal } });
    const id = `entity-${capability.replace(/\W/g, '-')}-${detail.entity.key}`;
    if (!this.threads.some(t => t.id === id))
      this.threads.push({
        ...this.threads[0]!,
        id,
        topic: id,
        connector: action.connector,
        area: 'personal',
        title: `${action.title}: ${detail.entity.name}`,
        trigger: {
          ...this.threads[0]!.trigger,
          reason: `Du valde ${action.title} för ${detail.entity.name}`,
          source: action.source,
        },
        summary: 'Inget har gjorts ännu. Du bestämmer på kortet.',
        state: 'open',
        items: [],
        // An execute is the item's one button (`decide`), its path resolved as the server resolves it (D112): the entity's
        // key is the action's own input, never asked. A propose's draft is the source's; here it has no button.
        actions:
          action.kind === 'execute'
            ? [
                {
                  id: 'decide',
                  label: action.title,
                  capability: action.capability,
                  kind: 'execute',
                  role: 'primary',
                  input: { [action.param]: detail.entity.key },
                  ...(action.path ? { path: action.path } : {}),
                },
              ]
            : [],
        proposals: [],
        receipt: null,
        deadline: null,
      });
    return route.fulfill({ json: { threadId: id } });
  }
  private async entities(route: Route, path: string, url: URL) {
    const json = (body: unknown) => route.fulfill({ json: body });
    const missing = () => route.fulfill({ status: 404, json: { error: 'Personen finns inte.', code: 'not_found' } });
    this.entityReads.push(path + url.search);
    const [, , kind, key, sub] = path.split('/');
    if (kind !== 'person') return route.fulfill({ status: 404, json: { error: 'Sidan finns inte.' } });
    const list: EntityList = this.entitiesEmpty || this.employee ? { ...this.entityList, groups: [] } : this.entityList;
    const capability = url.searchParams.get('capability') ?? '';
    const silent = this.entitySilent[capability];
    if (key === undefined) return json(list);
    if (key === 'rows') {
      const delay = this.entityRowsDelay[capability];
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      // A source is asked with each person's user name and answers with it (D122).
      const known = new Set(list.groups.flatMap(g => g.entities.map(e => e.sourceKey)));
      const rows = this.entityRows[capability];
      const answer: EntityRows = silent
        ? { capability, status: silent, rows: [] }
        : rows
          ? { ...rows, rows: rows.rows.filter(r => known.has(String(r.key))) }
          : { capability, status: 'ok', rows: [] };
      return json(answer);
    }
    const detail = this.entityDetailOf?.(decodeURIComponent(key)) ?? entityDetail(list, decodeURIComponent(key));
    if (!detail) return missing();
    if (sub === undefined) return json(detail);
    if (sub !== 'section' || !detail.sections.some(s => s.capability === capability)) return missing();
    const row = this.entityRows[capability]?.rows.find(r => r.key === detail.entity.sourceKey);
    const section: EntitySection = silent
      ? { capability, status: silent }
      : { capability, status: 'ok', ...(row ? { row } : {}) };
    return json(section);
  }
  /**
   * Utvecklingssamtal (D96), answered as the server would: the reads through the capability route (refused for a person
   * without a talks system, read-only when another system answers), and the five writes over the mock's own state, so a
   * spec sees the lists change on the next read.
   */
  private handleTalks(route: Route, path: string, url: URL) {
    const request = route.request(),
      method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const fail = (status: number, error: string) => route.fulfill({ status, json: { error } });
    const empty = () => route.fulfill({ status: 204, body: '' });
    // The registry's own refusal for a capability outside the person's scope: a 400 with its sentence and no code.
    if (!this.talksOffered) return fail(path.startsWith('/cap/') ? 400 : 403, 'Du saknar behörighet för åtgärden.');
    if (path === '/cap/clew.talks') {
      const result = talksResult({
        round: this.talksRound,
        rows: this.employee ? [] : this.talkRows,
        commitments: this.commitments,
        bookedUnknown: this.talksBookedUnknown,
      });
      return json({ output: this.talksWritable ? result : readOnlyTalks(result), source: result.source });
    }
    if (path === '/cap/clew.commitments') {
      const input = JSON.parse(url.searchParams.get('input') ?? '{}') as CommitmentsInput;
      // `person` is a user name (or an id for someone without one); an employee reads nobody's but their own.
      const about =
        this.staff.units.flatMap(u => u.people).find(p => (p.userName ?? p.id) === input.person)?.id ??
        (input.person === USER_NAME ? user.id : null);
      const result =
        input.person === undefined
          ? myCommitments(this.commitments, this.employee)
          : commitmentsFor(about && (!this.employee || about === user.id) ? about : '', this.commitments);
      return json({ output: this.talksWritable ? result : readOnlyCommitments(result), source: result.source });
    }
    const body = method === 'POST' ? (request.postDataJSON() ?? {}) : null;
    this.talkWrites.push({ method, path, body });
    if (!this.talksWritable) return fail(403, 'Du saknar behörighet för åtgärden.');
    const done = /^\/talks\/commitments\/([^/]+)\/done$/.exec(path);
    // The owner of an action point marks it done and opens it again whatever their role (D96 item 4); someone who
    // manages nobody may do nothing else here.
    if (this.employee && !done) return fail(403, 'Du saknar behörighet för åtgärden.');
    if (this.talksFail) {
      this.talksFail = false;
      return fail(400, TALKS_FAIL_ERROR);
    }
    if (done) {
      const id = decodeURIComponent(done[1]!);
      const row = this.commitments.find(c => c.id === id);
      if (!row) return fail(400, 'Åtgärdspunkten finns inte.');
      if (!changeable(row)) return fail(403, 'Bara den som äger åtgärdspunkten kan markera den som klar.');
      this.commitments = this.commitments.map(c => {
        if (c.id !== id) return c;
        if (method === 'POST') return { ...c, done: true, doneAt: NOW };
        const { doneAt: _doneAt, ...open } = c;
        return { ...open, done: false };
      });
      return empty();
    }
    const [, , personId = '', what] = path.split('/').map(decodeURIComponent);
    const row = this.talkRows.find(r => r.personId === personId);
    if (what === 'held') {
      if (!row) return fail(400, 'Personen finns inte i samtalsomgången.');
      if (method === 'POST') {
        const heldOn = (body as TalkHeldBody).heldOn ?? TODAY;
        if (row.state !== 'held') this.heldBefore.set(personId, row);
        this.talkRows = this.talkRows.map(r => (r.personId === personId ? { ...r, state: 'held', at: heldOn } : r));
        return json({ id: `held-${personId}`, heldOn });
      }
      if (row.state !== 'held') return fail(400, 'Samtalet är inte markerat som hållet.');
      const { at: _at, ...missing } = row;
      const before = this.heldBefore.get(personId) ?? { ...missing, state: 'missing' as const };
      this.heldBefore.delete(personId);
      this.talkRows = this.talkRows.map(r => (r.personId === personId ? before : r));
      return empty();
    }
    if (what === 'commitments' && method === 'POST') {
      const staff = this.staff.units.flatMap(u => u.people).find(p => p.id === personId);
      if (!staff) return fail(400, 'Personen finns inte på dina enheter.');
      const input = body as Partial<CommitmentAddBody>;
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return fail(400, 'Skriv vad åtgärdspunkten gäller.');
      if (
        text.length > 280 ||
        !['employee', 'manager'].includes(input.owner ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn ?? '')
      )
        return fail(400, 'Ogiltig förfrågan.');
      const id = `c-new-${this.nextCommitment++}`;
      this.commitments = [
        ...this.commitments,
        {
          id,
          ref: `commitment:talks:${id}`,
          personId,
          userName: staff.userName ?? staff.id,
          name: staff.name,
          owner: input.owner!,
          mine: input.owner === 'manager',
          text,
          dueOn: input.dueOn!,
          done: false,
          carried: false,
        },
      ];
      return json({ id }, 201);
    }
    this.unmocked.push(`${method} ${path}`);
    return fail(500, 'Inte mockat');
  }
  /** Modeller (D24), answered as the server would: the list, one model or provider, the writes, and a test that lists three models. */
  private handleModels(route: Route, method: string, path: string) {
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const missing = (what: string) => route.fulfill({ status: 400, json: { error: `${what} finns inte.` } });
    const [, , kind, id = '', action] = path.split('/');
    const body = () => (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const counted = () => {
      this.providers = this.providers.map(p => ({
        ...p,
        models: this.models.filter(m => m.providerId === p.id).length,
        enabledModels: this.models.filter(m => m.providerId === p.id && m.state === 'enabled').length,
      }));
    };
    // A model whose id starts with "trasig" plays one the provider refuses, so a failed test on add can be heard.
    const answered = (m: ModelSummary) =>
      m.model.startsWith('trasig')
        ? {
            ok: false,
            models: [],
            health: { status: 'ok', at: NOW },
            findings: [{ level: 'fail', text: 'Leverantören svarar men vägrar anropet.' }],
          }
        : {
            ok: true,
            models: [],
            health: { status: 'ok', at: NOW },
            findings: [{ level: 'ok', text: `${m.title} svarar.` }],
          };
    if (kind === 'models') {
      if (!id && method === 'GET') return json({ providers: this.providers, models: this.models });
      if (!id && method === 'POST') {
        const input = body() as {
          providerId: string;
          model: string;
          title?: string;
          description?: string;
          mayProcessPersonalData?: unknown;
        };
        // As the server's contract does (D122 item 1): no model without the administrator's statement.
        if (input.mayProcessPersonalData !== true)
          return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
        const p = this.providers.find(x => x.id === input.providerId)!;
        const m: ModelSummary = {
          ...this.models[0]!,
          id: input.model.replace(/[^a-z0-9]+/g, '-'),
          model: input.model,
          title: input.title ?? input.model,
          description: input.description ?? '',
          providerId: p.id,
          providerTitle: p.title,
          state: 'disabled',
          isDefault: false,
          audience: { mode: 'all' },
        };
        this.models = [...this.models, m];
        counted();
        return json({ model: modelDetail(m), report: answered(m) }, 201);
      }
      const m = this.models.find(x => x.id === id);
      if (!m) return missing('Modellen');
      if (action === 'test') return json(answered(m));
      if (method === 'DELETE') {
        this.models = this.models.filter(x => x.id !== id);
        counted();
        return json({ removed: true });
      }
      if (method === 'PATCH') {
        const patch = body() as Partial<ModelSummary>;
        if (patch.isDefault) this.models = this.models.map(x => ({ ...x, isDefault: false }));
        const next = {
          ...m,
          ...patch,
          ...(patch.state === 'disabled' ? { isDefault: false } : {}),
          updatedAt: new Date().toISOString(),
        };
        this.models = this.models.map(x => (x.id === id ? next : x));
        counted();
        return json(modelDetail(next));
      }
      return json(modelDetail(m));
    }
    if (!id && method === 'POST') {
      const input = body() as { id: string; title: string; baseUrl: string; apiKey?: string };
      const p: ProviderSummary = {
        ...this.providers[0]!,
        id: input.id,
        title: input.title,
        baseUrl: input.baseUrl,
        hasKey: !!input.apiKey,
        models: 0,
        enabledModels: 0,
      };
      this.providers = [...this.providers, p];
      return json({ provider: providerDetail(p), report: providerReport }, 201);
    }
    const p = this.providers.find(x => x.id === id);
    if (!p) return missing('Leverantören');
    if (action === 'test') return json(providerReport);
    if (action === 'key') {
      const next = { ...p, hasKey: !!body().apiKey, keyChangedAt: NOW };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    if (method === 'DELETE') {
      this.providers = this.providers.filter(x => x.id !== id);
      return json({ removed: true });
    }
    if (method === 'PATCH') {
      const next = { ...p, ...(body() as Partial<ProviderSummary>), updatedAt: new Date().toISOString() };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    return json(providerDetail(p));
  }
}

/** Records text that changes inside a live region. A region mounted together with its text is not announced, so it is not recorded. */
function recordAnnouncements() {
  const log: string[] = [];
  Object.assign(window, { announcements: log });
  const live = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const node = mutation.target;
      const region = (node instanceof Element ? node : node.parentElement)?.closest(live);
      const text = region?.textContent?.trim();
      if (text && log.at(-1) !== text) log.push(text);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript(recordAnnouncements);
    await page.route('**/api/**', route => api.handle(route));
    await use(api);
    expect(api.unmocked).toEqual([]);
  },
});
export { expect };

export const answer = (page: Page) =>
  page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' });
/** The box: named after the landing's heading, "Svara i samtalet" once a conversation is open (the scope line, H3.3). */
export const composer = (page: Page) => page.getByRole('combobox', { name: /^(Vad vill du göra|Svara i samtalet)$/ });
/** A heading by the level assistive technology gets: `aria-level` when Astryx separates it from the visual level. */
/** "Inte nu" on the first work item, the way a person does it (D29): open the picker, choose "I morgon". */
export async function snoozeFirst(page: Page) {
  // A card keeps Inte nu in view; a row is one link to its work item (D112), so the first row's item is opened first:
  // from Hem in the panel beside Hem or the drawer over it (D112, amended 2026-11-12), from Att göra in the reading pane,
  // each an article named by the item, or alone as its page where neither fits. Inte nu stands among its buttons there.
  const button = page.getByRole('main').getByRole('button', { name: 'Inte nu', exact: true }).first();
  if (await button.isVisible()) await button.click();
  else {
    const row = page.getByRole('main').getByRole('listitem').getByRole('link').first();
    const title = ((await row.textContent()) ?? '').trim();
    await row.click();
    const article = page.getByRole('article', { name: `Ärende: ${title}`, exact: true });
    const alone = page.getByRole('main').getByRole('heading', { level: 1, name: title, exact: true });
    await expect(article.or(alone).first()).toBeVisible();
    const item = (await article.isVisible()) ? article : page.getByRole('main');
    const own = item.getByRole('button', { name: 'Inte nu', exact: true }).first();
    // The item has its buttons once Fler val is there, in every layout.
    await expect(item.getByRole('button', { name: 'Fler val' }).first()).toBeVisible();
    // On a phone the item's page has the next step pinned to the foot and Inte nu under Fler val (D112 item 12).
    if (await own.isVisible()) await own.click();
    else {
      await item.getByRole('button', { name: 'Fler val' }).first().click();
      await page.getByRole('menuitem', { name: 'Inte nu' }).click();
    }
  }
  await page.getByRole('menuitem', { name: /^I morgon/ }).click();
  await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(/^Jag påminner dig/)).toBeVisible();
  // Att göra lets go of the item with its row (D112). Beside Hem the panel keeps it, set aside, until the person closes
  // it (D112, amended 2026-11-12), as they do here, so the toast and the page are reachable again.
  const close = page.getByRole('button', { name: 'Stäng panelen' });
  if (await close.isVisible()) await close.click();
  await expect(page.getByRole('dialog', { name: 'Ärende', exact: true })).toBeHidden();
  await expect(page).not.toHaveURL(/[?&](item|card)=/);
}
/**
 * Where the page says that a system does not answer (D116, amended 2026-11-12): for each visible "… svarar inte", the
 * name of the place it stands in (the section, region, article or dialog named by its label or heading), or
 * "outside main" when it stands above or beside the page's content as a banner did. What a live region holds for a
 * screen reader is not drawn and is left out.
 */
export const silentSaidIn = (page: Page) =>
  page.getByText(/svarar inte/).evaluateAll(els =>
    els
      .filter(el => !el.closest('[aria-live]') && (el as HTMLElement).checkVisibility())
      .map(el => {
        if (!el.closest('main, [role="main"], [role="dialog"], [role="complementary"]')) return 'outside main';
        const place = el.closest('section, article, [role="region"], [role="dialog"], [role="complementary"], header');
        const by = place?.getAttribute('aria-labelledby');
        return (
          place?.getAttribute('aria-label') ??
          (by ? document.getElementById(by)?.textContent?.trim() : undefined) ??
          place?.tagName.toLowerCase() ??
          'main'
        );
      }),
  );
export const heading = (page: Page, level: number, name: string) =>
  page.locator(`h${level}:not([aria-level]), [aria-level="${level}"]`).filter({ hasText: name });
export const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);
/** The areas live in the shell's SideNav (D31); below the shell's breakpoint AppShell keeps it in a modal drawer that this opens. */
export async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Öppna navigering' });
  if (!(await toggle.isVisible())) return page.getByRole('navigation', { name: 'Sidonavigering' });
  await toggle.click();
  return page.getByRole('dialog', { name: 'Navigering' });
}
/** The surface that docks the composer: ChatLayout's sticky wrapper (D31), or null when the row is in the page flow. */
const dockOf = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
    while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position)) el = el.parentElement;
    return el ? (el.getBoundingClientRect().toJSON() as DOMRect) : null;
  });
export { dockOf };

/** Renders a route and waits for its data, so a check never runs against the empty shell. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Every rule tagged for WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices: landmarks, headings and regions.
 * `without` leaves a rule out for a page where the rule cannot read the structure; the spec that passes it says why and
 * checks the criterion itself in the rule's place. The page is read once its running entrances have ended.
 */
export async function expectNoAxeViolations(page: Page, { without = [] }: { without?: string[] } = {}) {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  // A dialog still fading in is not a contrast fault: axe reads the text half transparent and reports it one run in
  // a few. The animations that are running and will end are let end first, for a second at most: an entrance is over
  // well inside it, and a notice's countdown or a paused animation is not waited for at all or not for long, so no
  // page can hold a check up.
  await page.evaluate(
    limit =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
            .map(a => a.finished.catch(() => undefined)),
        ),
        new Promise(resolve => setTimeout(resolve, limit)),
      ]).then(() => undefined),
    1000,
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(tags)
    .disableRules(['target-size', ...without])
    .analyze();
  // 2.5.8 is about the targets themselves: measured with the dock in the flow, so a row that has scrolled under the sticky dock is not read as too close to its buttons.
  const undock = (on: boolean) =>
    page.evaluate(on => {
      let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
      while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position) && !el.dataset.undocked)
        el = el.parentElement;
      if (!el) return;
      if (on) {
        el.dataset.undocked = el.style.position;
        el.style.position = 'static';
      } else {
        el.style.position = el.dataset.undocked ?? '';
        delete el.dataset.undocked;
      }
    }, on);
  await undock(true);
  const { violations: sizes } = await new AxeBuilder({ page }).withTags(tags).withRules(['target-size']).analyze();
  await undock(false);
  expect(
    [...violations, ...sizes].map(
      v =>
        `${v.id}: ${v.help}\n  ${v.nodes
          .slice(0, 4)
          .map(n => n.target.join(' ') + '\n  ' + n.html)
          .join('\n  ')}`,
    ),
  ).toEqual([]);
}

/**
 * The supporting line of each work item's row in `rows` (`#work-<id>`): its words, and whether any of it is cut.
 * `reflowProblems` sees what is cut sideways, not what a line clamp cuts downwards, so this looks at the line itself:
 * the element that holds the state's separator, and every box around it inside the row that clamps or clips. A row
 * without such a line counts as cut.
 */
export const workRowLines = (rows: Locator) =>
  rows.evaluateAll(list =>
    list.map(row => {
      const line = [...row.querySelectorAll<HTMLElement>('*')].find(el =>
        [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && /\u00a0· /.test(n.textContent ?? '')),
      );
      let cut = !line;
      for (let el = line ?? null; el && row.contains(el) && !cut; el = el.parentElement) {
        const s = getComputedStyle(el);
        const clips = s.webkitLineClamp !== 'none' || s.overflowX !== 'visible' || s.overflowY !== 'visible';
        cut = clips && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      }
      return { text: line?.textContent ?? '', cut };
    }),
  );

/**
 * 1.4.10: nothing may need sideways scrolling, and no text may be clipped to fit. A drawer still sliding in is not a
 * reflow fault, so finite animations settle first. `scope` limits the text to one surface, for a check made with the
 * rail open: the rail ends a long row with an ellipsis on purpose, and the page's width is still checked. `table` names a
 * data table that 1.4.10 lets scroll in two dimensions: what lies beyond the edge inside it is not counted while the
 * table's own scroll region ends inside the window; the page's width and every other part are still checked.
 */
export async function reflowProblems(page: Page, scope?: Locator, { table }: { table?: Locator } = {}) {
  const root = scope ? await scope.elementHandle() : null;
  const exempt = table ? await table.elementHandle() : null;
  return page.evaluate(
    async ([root, exempt]) => {
      await Promise.all(
        document
          .getAnimations()
          .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
          .map(a => a.finished.catch(() => undefined)),
      );
      const width = document.documentElement.clientWidth;
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        if (!(r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none')) return false;
        // Astryx keeps hidden section headings in the accessibility tree. Their
        // descendants have text dimensions but are deliberately clipped by the
        // VisuallyHidden ancestor; they are not visible reflow failures.
        for (let parent: Element | null = el; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return false;
        }
        return true;
      };
      const label = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 50)}"`;
      const problems: string[] = [];
      if (document.documentElement.scrollWidth > width)
        problems.push(`page is ${document.documentElement.scrollWidth} px wide at ${width} px`);
      /** The data table's own sideways scroll region, when the table has one: its overflow is the exception, not the page's. */
      const region = (() => {
        for (let at = exempt?.parentElement ?? null; at && at !== document.body; at = at.parentElement) {
          const x = getComputedStyle(at).overflowX;
          if (x === 'auto' || x === 'scroll') return at;
        }
        return null;
      })();
      for (const el of (root ?? document.body).querySelectorAll('*')) {
        if (!visible(el)) continue;
        const position = getComputedStyle(el).position;
        if (position === 'absolute' && el.getBoundingClientRect().width <= 1) continue;
        const inTable = !!region && !!exempt?.contains(el) && region.getBoundingClientRect().right <= width + 1;
        if (
          el.getBoundingClientRect().right > width + 1 &&
          el.children.length === 0 &&
          el.textContent?.trim() &&
          !inTable
        )
          problems.push(`beyond the edge: ${label(el)}`);
        const style = getComputedStyle(el);
        const clips = style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
        const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        if (clips && hasText && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${label(el)}`);
      }
      return [...new Set(problems)];
    },
    [root, exempt] as const,
  );
}

/** Tabs through the page and names every stop entirely hidden by sticky or fixed content (2.4.11) or without a focus ring (2.4.7). */
export async function hiddenFocusStops(page: Page, limit = 150) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    Object.assign(window, { unmarked: [], visited: [] });
  });
  const hidden: string[] = [];
  const seen = new Set<string>();
  for (let stop = 0; stop < limit; stop++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(async () => {
      // A tooltip closes about 100 ms after the focus leaves its button: what is measured is what stays, not the last frames of what is leaving.
      if ([...document.querySelectorAll('.astryx-tooltip')].some(tip => tip.getBoundingClientRect().width > 0))
        await new Promise(resolve => setTimeout(resolve, 150));
      // A ring that animates in (an Astryx field's border and inset shadow, 125 ms) is measured once it has settled, not in the instant of the Tab.
      await Promise.all(
        document
          .getAnimations()
          .filter(a => a instanceof CSSTransition && a.playState === 'running')
          .map(a => a.finished.catch(() => undefined)),
      );
      const { unmarked, visited } = window as unknown as { unmarked: string[]; visited: Element[] };
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      // The element itself decides whether the walk has come round, not its label and place: a row that scrolls into the previous row's spot is still a new stop.
      const again = visited.includes(active);
      visited.push(active);
      const r = active.getBoundingClientRect();
      const name = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 50)}" at ${Math.round(r.left)},${Math.round(r.top)}`;
      const ring = (el: Element | null, depth: number): boolean => {
        if (!el || depth > 3) return false;
        const s = getComputedStyle(el);
        // An Astryx field (TextInput, Typeahead) draws its ring as an inset shadow on the wrapper around the input; an elevation shadow is never inset.
        const fieldRing =
          el !== active &&
          /inset/.test(s.boxShadow) &&
          !/^rgba\(0, 0, 0, 0\)/.test(s.boxShadow) &&
          !/ 0px 0px 0px 0px inset/.test(s.boxShadow);
        return (
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          (el === active && s.boxShadow !== 'none') ||
          fieldRing ||
          ring(el.parentElement, depth + 1)
        );
      };
      // A tree row (Astryx TreeList) takes the focus on its list item and draws the ring on the row inside it, so that
      // the ring goes round the row and not round the rows nested under it.
      const ownRow =
        active.getAttribute('role') === 'treeitem'
          ? active.querySelector(':scope > [data-astryx-pressable], :scope > * > [data-astryx-pressable]')
          : null;
      const drawn = (el: Element | null) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      };
      if (!ring(active, 0) && !drawn(ownRow)) unmarked.push(name);
      const box = {
        left: Math.max(r.left, 0),
        right: Math.min(r.right, innerWidth),
        top: Math.max(r.top, 0),
        bottom: Math.min(r.bottom, innerHeight),
      };
      if (box.right <= box.left || box.bottom <= box.top) return { name, again, covered: 'outside the viewport' };
      // The top layer (an open popover: the toast stack, a dialog) paints over everything else, so nothing below can obscure it.
      if (active.closest(':popover-open, dialog[open]')) return { name, again, covered: null };
      const layer = (e: Element) => parseInt(getComputedStyle(e).zIndex) || 0;
      const a = getComputedStyle(active);
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'sticky' && s.position !== 'fixed') continue;
        if (el.contains(active) || s.visibility === 'hidden') continue;
        // A stop that is itself lifted above the surface (the shell's skip link over its header) is on top, not under it.
        if ((a.position === 'fixed' || a.position === 'absolute') && layer(active) > layer(el)) continue;
        // A frosted layer (ChatLayout's dock) hides what is under it as surely as a painted one (D31).
        const frosted = (e: Element) =>
          getComputedStyle(e).backdropFilter !== 'none' ||
          [...e.children].some(c => getComputedStyle(c).backdropFilter !== 'none');
        const paints = s.backgroundImage !== 'none' || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || frosted(el);
        const o = el.getBoundingClientRect();
        if (paints && box.top >= o.top && box.bottom <= o.bottom && box.left >= o.left && box.right <= o.right)
          return { name, again, covered: el.className.toString().slice(0, 40) || el.tagName };
      }
      return { name, again, covered: null };
    });
    if (!result) {
      if (seen.size) break;
      continue;
    }
    if (result.again) break;
    seen.add(result.name);
    if (result.covered) hidden.push(`${result.name} is under ${result.covered}`);
  }
  expect(seen.size, 'the walk reached the controls').toBeGreaterThan(3);
  const unmarked = await page.evaluate(() => (window as unknown as { unmarked: string[] }).unmarked);
  return { hidden, unmarked, stops: [...seen] };
}

/** The focused element, as a person using a screen reader would be told about it. `body` means focus was lost. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName.toLowerCase(),
      text: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim(),
    };
  });
