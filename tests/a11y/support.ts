import {
  test as base,
  expect,
  type BrowserContext,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Route,
  type Worker,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {
  Chip,
  EffectPreview,
  ExecutionSummary,
  ItemEvent,
  MenuEntry,
  PanelViewSpec,
  Thread,
  SiteHeaderView,
  UserAssignment,
  ViewEntry,
} from '@clew/contracts';
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
import { providerAddressProblem } from '@clew/contracts';
import type { AssistantReach, NewsResult, RecordAction } from '@clew/contracts';
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
  TalkBookingBody,
  TalkCalendarBody,
  TalkHeldBody,
  TalkRound,
  RelationGrant,
  UsersAdminQueryType,
} from '@clew/contracts';
import { THEME_BASE_COLORS, parseThemeFile, themeFileOf } from '../../packages/contracts/src/theme-file';
import { personSearch, phonebook } from './phonebook';
import { rooms, roomsSpec } from './rooms';
import { fixtureViews, manifestView } from './view-catalogue';
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
/** The authority the change stream says (D46); it never changes in the suite unless a spec sends its own. */
const CHANGE_POLICY = '1:1';
/** The system each fixture connector stands for, as its manifest names its `source`. */
const SOURCES: Record<string, string> = {
  hr: 'Personalsystemet',
  communication: 'Kommunikation',
  incidents: 'Avvikelsesystemet',
  finance: 'Ekonomisystemet',
};
/** The reads of the development stack's connectors and Clew's own, as `/api/areas` lists them (`fixtureViews`). */
const CATALOGUED = new Set(fixtureViews().map(v => v.capability));
/** The routes' answer to a failure that is nobody's input (`apps/server/src/context.ts`). */
export const FAILED = 'Något gick fel. Försök igen.';
/** The end of a decision's ten-minute way back, from the suite's now. */
const UNDO_UNTIL = '2026-11-04T08:10:00.000Z';
import type { ConnectorSummary } from '@clew/contracts';

/**
 * What a thread's audit rows would say about it (D112 item 4), newest first: created by Clew, set aside or dismissed by
 * the person, and a decision with the source's answer when it has a receipt.
 */
export function eventsOf(t: Thread): ItemEvent[] {
  const events: ItemEvent[] = [{ at: t.createdAt, by: 'clew', kind: 'created' }];
  const action = t.actions.find(a => a.kind === 'execute' && a.role === 'primary');
  if (t.receipt) {
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
  } else if (t.execution && !t.execution.compensates)
    // Decided, and the source has not answered yet.
    events.push({ at: t.updatedAt, by: 'you', kind: 'decided', ...(action ? { action: action.label } : {}) });
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

/**
 * What a fixture connector answers for a read a spec opens, for the suite's manager on 4 November (the connectors'
 * fixtures in `connectors/`): answered with the view the manifest declares (`manifestView`), as the registry passes it.
 */
const READS: Record<string, unknown> = {
  'hr.absencePattern': {
    name: 'Anna Lindqvist',
    periods: [
      { from: '2026-06-12', to: '2026-06-13', kind: 'sick' },
      { from: '2026-09-03', to: '2026-09-04', kind: 'sick' },
      { from: '2026-10-28', to: '2026-10-29', kind: 'sick' },
    ],
    rule: 'Rutin 4.2: samtal inom två veckor efter tredje korta frånvaron på sex månader.',
  },
  'finance.budget': {
    label: 'Kostnadsställe KS-4410',
    deviationPct: -1.9,
    driver: 'vikarier −710 tkr',
    budget: 37_400_000,
    forecast: 38_110_000,
  },
  'incidents.deviations': {
    rows: [
      {
        ref: 'incidents:dev:2026-1182',
        title: 'Tillbud 2026-1182, halkolycka i duschen',
        state: 'waiting-safety-rep',
        waitingOn: 'skyddsombudets yttrande',
        dueBy: '2026-11-06',
      },
      {
        ref: 'incidents:dev:2026-1141',
        title: 'Tillbud 2026-1141, trasig grind mot parkeringen',
        state: 'investigating',
        waitingOn: 'fastighetens åtgärd',
        dueBy: '2026-11-08',
      },
    ],
  },
};
/** The API as the browser sees it, held in memory per test. `/api/**` never leaves the page. */
/** One action about a record as it reached the mock (`RecordActionInput`, D137), with the read it was posted to. */
export interface RecordActed {
  read: string;
  input: Record<string, unknown>;
  capability: string;
  values?: Record<string, string>;
  draft?: { conversationId: string; messageId: string };
}

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
    /** The one of `chips` that stands open where the question was asked (`ConversationInput.beside`). */
    beside?: string;
    assistant?: string;
    suggested?: boolean;
    own?: boolean;
    confirmed?: boolean;
    /** The page the question was asked beside (`ConversationInput.page`, D141): its subject and its words. */
    page?: { subject: string; label: string };
    /** The thing that stands open where the question was asked (`ConversationInput.thing`, D136 item 1). */
    thing?: { kind: string; id?: string; capability?: string; input?: Record<string, unknown> };
  }[] = [];
  /** The conversations the conversation's page marked as opened (`POST /conversations/:id/opened`, D141 rule 6). */
  opened: string[] = [];
  /** The work items the next answers name (`MessageMeta.cards`); none unless a test sets them. */
  answerCards: string[] | undefined;
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
  /** The items whose decision in doubt the person let go (DE-M2). */
  released: string[] = [];
  /** Rows an earlier decision on the item got done, which the server's ledger keeps across decisions (DE-M1). */
  carried: Record<string, string[]> = {};
  actRefusal: string | null = null;
  /**
   * A decision as the server makes one (D45, D47): `act`, `confirm`, `undo` and `undo-receipt` record it and answer with
   * the item waiting on its source (`execution.state: 'pending'`, "källans besked"); the source's answer comes after, is
   * written into the item the way `execution-projection.ts` writes it, and reaches the page as a notice on the change
   * stream (D46). It comes `settleDelay` ms later, or, with `holdSettle`, only when the test calls `settle()`.
   */
  settleDelay = 100;
  holdSettle = false;
  /**
   * The source answers without a certain result: a decision's receipt comes with every row in doubt and its execution
   * `unknown`, and the item stays open, as `execution-projection.ts` leaves it.
   */
  sourceInDoubt = false;
  private unsettled: Array<() => void> = [];
  private decisions = 0;
  /** The latest version the suite has given an item, in seconds after its now. */
  private versions = 0;
  /** The change stream's revision (D46): said first on every connection, and again with each notice. */
  revision = 1;
  /** The page the stream's notices go to; the fixture sets it. */
  page?: Page;
  effectReads: Array<{ threadId: string; body: Record<string, unknown> }> = [];
  effectFails = false;
  effectDelay = 0;
  freeTimes: Array<{ start: string; end: string }> | null = meetingSlots();
  timesReads: string[] = [];
  sessionDelay = 0;
  signedIn = true;
  /** The session's authorization version (`policyVersion`): a spec moves it as a change of the person's access does. */
  policyVersion = 'test';
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
  /**
   * Every propose started from an entity's action dialog (D97, D126 item 7), as the entity's key, the capability and the
   * answers, in order. An execute is never started: its last button decides (`entityDecides`).
   */
  entityStarts: Array<{ key: string; capability: string; values?: Record<string, string> }> = [];
  /** Every "Det här händer" read for an action about an entity before anything exists (`.../effect`), in order. */
  entityEffects: Array<{ key: string; capability: string; values?: Record<string, string> }> = [];
  /** Every execute about an entity sent from its dialog's last button (`.../decide`, D126 item 7), in order. */
  entityDecides: Array<{ key: string; capability: string; values?: Record<string, string> }> = [];
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
   * Every unit of a session person who holds more than one (D135), as `GET /api/auth/session` gives them; undefined for
   * the ordinary person with one unit.
   */
  assignments: UserAssignment[] | undefined = undefined;
  /**
   * Kompetens (D108): the catalogue a certificate is registered from. Null: the module is switched off for the person,
   * so its routes are refused and Personal offers no registration.
   */
  competenceTypes: CompetenceType[] | null = null;
  /** Every write to the catalogue, in order: the method, the path and the body. */
  catalogueWrites: Array<{ method: string; path: string; body?: unknown }> = [];
  /** What the server answers a new validity would do: a count of what changes is rounded down to five. */
  validityImpact: CompetenceValidityImpact = { holdings: 12, turnExpired: 5, turnValid: 0 };
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
  /** What the assistant may fill in for what stands open (`POST /api/assistant/reach`, D138 item 7): none by default. */
  reach: AssistantReach = { prepares: [] };
  /** Every body sent to `POST /api/assistant/reach`. */
  reachAsked: unknown[] = [];
  /** A record's actions by its read (`GET /api/records/:read/actions`, D137): none by default; `null` answers 404. */
  recordActions: Record<string, RecordAction[] | null> = {};
  /**
   * Every action about a record that reached the mock (D137), by its route: `effect` (what an execute would write),
   * `decide` (the human decision) and `actions` (a propose's start), each with the read, the record's input, the
   * person's answers and the assistant's draft it was sent from.
   */
  recordEffects: RecordActed[] = [];
  recordDecides: RecordActed[] = [];
  recordStarts: RecordActed[] = [];
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
  /**
   * A change to an item, committed as the server commits one: the item is a new version, later than the one it had and
   * than every version the suite has given out, so a version never goes back.
   */
  private update(id: string, change: Partial<Thread>) {
    this.threads = this.threads.map(t => {
      if (t.id !== id) return t;
      const at = Math.max(Date.parse(t.updatedAt), Date.parse(NOW) + this.versions * 1000) + 1000;
      this.versions = (at - Date.parse(NOW)) / 1000;
      return { ...t, ...change, updatedAt: new Date(at).toISOString() };
    });
    return this.threads.find(t => t.id === id)!;
  }
  /**
   * Records a decision as the server's projection does at its approval: the item waits on its source and is a new
   * version, and nothing the source will answer is in it yet. `answer` is what the source's answer makes of the item,
   * applied when the decision settles; a decision overtaken by another before then is not applied.
   */
  private approve(
    id: string,
    operation: string,
    answer: (t: Thread) => Partial<Thread>,
    compensates: string | null = null,
    decisionId?: string,
  ): Thread {
    const n = ++this.decisions;
    const execution: ExecutionSummary = {
      id: `execution:${id}:${n}`,
      decisionId: decisionId ?? (compensates ? `undo:${compensates}` : `card:${id}:${n}`),
      operation,
      state: 'pending',
      reason: null,
      compensates,
    };
    const approved = this.update(id, { execution, waitingOn: 'källans besked' });
    this.revision++;
    this.unsettled.push(() => {
      const t = this.threads.find(t => t.id === id);
      if (t?.execution?.id !== execution.id) return;
      const answered = answer(t);
      this.update(
        id,
        this.sourceInDoubt && answered.receipt
          ? {
              waitingOn: null,
              receipt: {
                ...answered.receipt,
                rows: answered.receipt.rows.map(row => ({
                  ...row,
                  outcome: 'unknown' as const,
                  detail: `Väntar på svar från ${t.trigger.source.toLocaleLowerCase('sv-SE')}`,
                })),
              },
              execution: { ...execution, state: 'unknown' },
            }
          : { waitingOn: null, ...answered, execution: { ...execution, state: 'succeeded' } },
      );
    });
    if (!this.holdSettle) setTimeout(() => void this.settle(), this.settleDelay);
    return approved;
  }
  /** Every source answers the decisions still waiting on it, and the change stream says so (D46). */
  async settle() {
    const answers = this.unsettled.splice(0);
    if (!answers.length) return;
    for (const answer of answers) answer();
    this.revision++;
    await this.notify();
  }
  /** Something of the person's changed outside the page (a source's scan): the change stream says so (D46). */
  async changed() {
    this.revision++;
    await this.notify();
  }
  /** A notice on the open change stream (D46), as the server sends one when something of the person's is committed. */
  private async notify() {
    const data = JSON.stringify({ revision: String(this.revision), policy: CHANGE_POLICY });
    try {
      await this.page?.evaluate(data => {
        const open = (window as unknown as { changeStreams?: Set<EventSource> }).changeStreams;
        for (const stream of open ?? []) stream.dispatchEvent(new MessageEvent('message', { data }));
      }, data);
    } catch {
      // The page has closed or is between documents; its next connection starts from the current revision.
    }
  }
  async handle(route: Route) {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api', ''),
      post = request.method() === 'POST';
    const json = (body: unknown) => route.fulfill({ json: body });
    // What a read is read with: its body, never its address (WD-M4: the address is in every access log on the way).
    const input = <T = Record<string, unknown>>() => (request.postDataJSON() ?? {}) as T;
    const id = path.split('/')[2] ?? '';
    // A read and `@`'s search are POSTs with their input as the body (WD-M4): any other method is no route, as the
    // server answers it, and a test that asks one fails.
    if ((path.startsWith('/cap/') || path === '/objects') && !post) {
      this.unmocked.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 404, json: { error: 'Okänd adress.' } });
    }
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
    // The change stream (D46): a connection starts by saying the current revision, as the server's does; what is
    // committed later is a notice on the open stream (`notify`). The connection is answered at once, so a page is idle.
    if (path === '/changes')
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `retry: 60000\n\ndata: ${JSON.stringify({ revision: String(this.revision), policy: CHANGE_POLICY })}\n\n`,
      });
    if (path === `/threads/${id}/execution/check`) return json(this.threads.find(t => t.id === id));
    // A decision in doubt the person lets go (DE-M2), refused as the server refuses it: one being read back now (the mock
    // knows no lease, so a running one is always being read), one no longer in doubt, an undo. It ends in the person's
    // name, a new version of the item, and the item is decided again from there (DE-M1): partial when the source had
    // confirmed rows, which stay done, failed when it had confirmed none.
    if (path === `/threads/${id}/execution/release` && post) {
      const t = this.threads.find(t => t.id === id);
      if (!t) return route.fulfill({ status: 404, json: { error: 'Ärendet finns inte.' } });
      if (t.execution?.state === 'running')
        return route.fulfill({
          status: 400,
          json: { error: 'Beslutet kontrolleras just nu. Försök igen om en stund.' },
        });
      if (!t.execution || t.execution.state !== 'unknown' || t.execution.compensates)
        return route.fulfill({ status: 400, json: { error: 'Beslutet väntar inte längre på besked.' } });
      this.released.push(id);
      const done = t.receipt?.rows.some(row => row.outcome === 'done') ?? false;
      return json(
        this.update(id, {
          execution: { ...t.execution, state: done ? 'partial' : 'failed', reason: 'released-by-person' },
        }),
      );
    }
    if (path === '/auth/session') {
      if (this.sessionDelay) await new Promise(resolve => setTimeout(resolve, this.sessionDelay));
      return this.signedIn
        ? json({
            ...session,
            policyVersion: this.policyVersion,
            ...(this.employee || this.assignments
              ? {
                  user: {
                    ...user,
                    ...(this.employee ? { role: 'employee' } : {}),
                    ...(this.assignments ? { assignments: this.assignments } : {}),
                  },
                }
              : {}),
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
            (!asked.personId || u.id === asked.personId) &&
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
        return json({ ...checkReport, health: { status: 'secret-rejected', at: NOW }, offered: false });
      if (path === `/admin/connectors/${cid}/refresh`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        const diff = {
          added: ['hello.remind'],
          removed: ['hello.openItems'],
          changed: [],
          areasAdded: [],
          areasRemoved: [],
          areasChanged: [],
          usesAdded: [],
          usesRemoved: [],
          fields: [],
          same: false,
        };
        // As the server answers (D144): reading in stores the offer the page reviews, without a new version; approving
        // it clears it and makes the approved manifest a new version of the connector.
        const apply = !!(request.postDataJSON() as { apply?: boolean } | null)?.apply;
        const now = apply ? { ...c, updatedAt: NOW, version: c.version + 1 } : c;
        if (apply) this.connectors = this.connectors.map(x => (x.id === cid ? now : x));
        return json({ diff, connector: { ...connectorDetail(now), offered: apply ? null : { at: NOW, diff } } });
      }
      if (path === `/admin/connectors/${cid}/preview`)
        return json(connectorPreview(url.searchParams.get('role') === 'employee' ? 'employee' : 'manager'));
      if (path === `/admin/connectors/${cid}/secret`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        // A new key is a change of the connector, so a page that showed it before is refused after it (DE-M5).
        const next = { ...c, secretChangedAt: NOW, updatedAt: NOW, version: c.version + 1 };
        this.connectors = this.connectors.map(x => (x.id === cid ? next : x));
        return json(connectorDetail(next));
      }
      if (path === `/admin/connectors/${cid}`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        if (method === 'DELETE') {
          this.connectors = this.connectors.filter(x => x.id !== cid);
          return json({ closedCards: 1 });
        }
        if (method === 'PATCH') {
          const patch = request.postDataJSON() as Partial<ConnectorSummary> & {
            capabilities?: unknown;
            lens?: unknown;
            column?: unknown;
            menu?: Record<string, boolean>;
            figures?: Record<string, boolean>;
          };
          // The server takes no change without the version the page showed (`ConnectorPatchInput`), and refuses one
          // made on a version saved since (DE-M5), before it looks at what the change is.
          if (typeof patch.version !== 'number')
            return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
          if (patch.version !== c.version)
            return route.fulfill({
              status: 400,
              json: { error: 'Anslutningen har ändrats sedan du öppnade den. Se över den och gör ändringen igen.' },
            });
          let menuOn = this.menuOn,
            figuresOff = this.figuresOff;
          for (const [name, on] of Object.entries(patch.menu ?? {}))
            menuOn = on ? [...new Set([...menuOn, name])] : menuOn.filter(n => n !== name);
          for (const [area, on] of Object.entries(patch.figures ?? {}))
            figuresOff = on ? figuresOff.filter(a => a !== area) : [...new Set([...figuresOff, area])];
          const differs = (key: 'state' | 'scanEnabled' | 'toolsEnabled' | 'header' | 'url') =>
            key in patch && patch[key] !== c[key];
          // A change that changes nothing writes nothing, so the version stays, as the server answers it.
          const changed =
            (['state', 'scanEnabled', 'toolsEnabled', 'header', 'url'] as const).some(differs) ||
            ('audience' in patch && JSON.stringify(patch.audience) !== JSON.stringify(c.audience)) ||
            'capabilities' in patch ||
            'lens' in patch ||
            'column' in patch ||
            JSON.stringify([...menuOn].sort()) !== JSON.stringify([...this.menuOn].sort()) ||
            JSON.stringify([...figuresOff].sort()) !== JSON.stringify([...this.figuresOff].sort());
          if (!changed) return json(connectorDetail(c, this.menuOn, this.figuresOff));
          const next = {
            ...c,
            ...('state' in patch ? { state: patch.state! } : {}),
            ...('audience' in patch ? { audience: patch.audience! } : {}),
            ...('scanEnabled' in patch ? { scanEnabled: patch.scanEnabled! } : {}),
            ...('toolsEnabled' in patch ? { toolsEnabled: patch.toolsEnabled! } : {}),
            ...('header' in patch ? { header: patch.header! } : {}),
            ...('url' in patch ? { url: patch.url! } : {}),
            updatedAt: NOW,
            version: c.version + 1,
          };
          // The header is exclusive (D88): the new holder takes it from the previous one.
          if ('header' in patch && patch.header)
            this.connectors = this.connectors.map(x =>
              x.id === cid || !x.header ? x : { ...x, header: false, version: x.version + 1 },
            );
          this.menuOn = menuOn;
          this.figuresOff = figuresOff;
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
    if (path === '/assistant/reach' && post) {
      this.reachAsked.push(request.postDataJSON());
      return json(this.reach);
    }
    {
      const acted = post ? /^\/records\/([^/]+)\/(effect|decide|actions)$/.exec(path) : null;
      if (acted)
        return this.recordStart(route, decodeURIComponent(acted[1]!), acted[2] as 'effect' | 'decide' | 'actions');
      const listed = /^\/records\/([^/]+)\/actions$/.exec(path);
      if (listed && !post) {
        const actions = this.recordActions[decodeURIComponent(listed[1]!)];
        if (actions === null) return route.fulfill({ status: 404, json: { error: 'Posten finns inte.' } });
        return json({ actions: actions ?? [] });
      }
    }
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
    // A decision on the person's own calendar (D45), as `calendar/usecases/decisions.ts` queues it: a card of its own,
    // named by what it does, waiting on the calendar, and handled once the calendar reads the change back. Moving or
    // cancelling names the meeting as the calendar holds it.
    const calendarDecision = (
      {
        '/calendar/events': ['calendar.createEvent', 'Boka'],
        '/calendar/events/reschedule': ['calendar.rescheduleEvent', 'Flytta'],
        '/calendar/events/cancel': ['calendar.cancelEvent', 'Ställ in'],
      } as Record<string, [string, string]>
    )[path];
    if (calendarDecision && post) {
      const [operation, verb] = calendarDecision;
      const b = request.postDataJSON() as { decisionId: string; title?: string; ref?: string };
      const known = b.ref ? events(WEEK).find(e => e.ref === b.ref)?.title : undefined;
      const title = b.title?.trim() || known || 'Mötet';
      const cardId = `calendar:${user.id}:${b.decisionId}`;
      if (!this.threads.some(t => t.id === cardId))
        this.threads.push({
          ...this.threads[0]!,
          id: cardId,
          kind: 'pushed',
          topic: `calendar-decision:${b.decisionId}`,
          connector: 'calendar',
          area: 'calendar',
          title: `${verb}: ${title}`,
          summary: 'Beslutet är sparat. Väntar på kalenderns besked.',
          trigger: { reason: 'Du godkände en kalenderändring', source: 'Kalendern', at: NOW },
          state: 'open',
          handledAt: null,
          items: [],
          actions: [],
          proposals: [],
          messages: [],
          receipt: null,
          deadline: null,
          snoozedUntil: null,
          remindedAt: null,
          execution: null,
        });
      const card = this.approve(
        cardId,
        operation,
        () => ({
          state: 'handled',
          handledAt: NOW,
          receipt: {
            at: NOW,
            headline: '1 av 1 kalenderändringar är bekräftade.',
            undoUntil: null,
            undoCapability: null,
            rows: [{ ref: 'event', label: title, outcome: 'done', detail: 'Kontrollerat i kalendern.' }],
          },
        }),
        null,
        b.decisionId,
      );
      return route.fulfill({ status: path === '/calendar/events/cancel' ? 200 : 202, json: card });
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
      const from = input<{ from?: string }>().from ?? '2026-11-02';
      return json({ output: { from, events: events(from) } });
    }
    if (path === '/cap/calendar.day') {
      const date = input<{ date?: string }>().date ?? '2026-11-04';
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
    // the registry refuses a read of a connector that is switched off: `POST /api/cap` answers it 404, as a name nobody
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
      return this.handleTalks(route, path);
    // `@` as the server answers it: with nothing typed only the context the box sends (`near`), with text everything open, the context first.
    if (path === '/objects') {
      const asked = input<{ q?: string; near?: string[] }>();
      const q = (asked.q ?? '').toLowerCase(),
        near = asked.near ?? [];
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
      return json({ output: /lindqvist/i.test(JSON.stringify(input())) ? personSearch : searchOutput });
    // The phone book's declared views, answered by the connector itself.
    if (path.startsWith('/cap/phonebook.')) {
      const answer = await phonebook(path.slice('/cap/'.length), input());
      return route.fulfill({ status: answer.status, json: answer.body });
    }
    if (path === '/cap/clew.cardFromAnswer' && post) return json({ output: { threadId: 'rutin' } });
    // An employee's absence pattern is asked for one employee's ref (`hr:emp:<n>`, the HR manifest's input pattern).
    if (path === '/cap/hr.absencePattern') {
      const ref = input<{ ref?: string }>().ref;
      if (!ref || !/^hr:emp:[0-9]+$/.test(ref))
        return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan till hr.absencePattern.' } });
    }
    // A read a spec opens, as its connector answers it, with the view its manifest declares.
    const read = path.startsWith('/cap/') ? path.slice('/cap/'.length) : null;
    const view = read && read in READS ? manifestView(read) : undefined;
    if (read && view) return json({ output: READS[read], source: view.source, view });
    // A read the person may open that declares no view (D116, `views`), drawn as it is: `hr.whoIsOn`, whose answer is
    // the suite's `output`, and a read a test adds to `views` itself to stand for one. Every other read of the fixture
    // connectors answers its own shape, so it is in `READS` or fails the test as unmocked.
    const listed = path.startsWith('/cap/') ? this.views.find(v => v.capability === path.slice(5)) : undefined;
    const standIn = !!listed && (listed.capability === 'hr.whoIsOn' || !CATALOGUED.has(listed.capability));
    if (listed && standIn && !listed.kind)
      return json({ output: this.output, source: SOURCES[listed.capability.split('.')[0]!] ?? 'Personalsystemet' });
    // A capability the registry does not know (D23) is the route's 404; the suite fails on one it reads.
    if (path.startsWith('/cap/')) {
      this.unmocked.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 404, json: { error: 'Okänd förmåga.' } });
    }
    // A turn as the server streams it (D36): a read as a step, the answer in two deltas, then the finished turn. Playwright
    // answers in one piece, so the pending turn is what `answerDelay` and `holdAnswer` hold open.
    if (path === '/conversation/stream') {
      const body = request.postDataJSON() as {
        text: string;
        conversationId?: string;
        chips?: { ref: string }[];
        beside?: string;
        assistant?: string;
        suggested?: boolean;
        own?: boolean;
        confirmed?: boolean;
        side?: boolean;
        page?: { subject: string; label: string };
        thing?: { kind: string; id?: string; capability?: string; input?: Record<string, unknown> };
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
            side: !!body.side,
          })
        : conversation(
            this.threads,
            body.text,
            // Asked in place, a new conversation is one per thing, as the server makes a new one per question asked: by
            // the thing that stands open where there is one (D136: a person, a unit, one record of a read), else by
            // what stands open beside it.
            body.conversationId ??
              (body.own && (body.thing || body.beside)
                ? 'om-' +
                  (body.thing
                    ? [body.thing.kind, body.thing.id ?? body.thing.capability, JSON.stringify(body.thing.input ?? '')]
                        .join('-')
                        .replace(/[^A-Za-z0-9]+/g, '-')
                        .replace(/-+$/, '')
                    : body.beside!.replace(/[^A-Za-z0-9]/g, '-'))
                : undefined),
            body.beside,
          );
      // Asked for a comment beside a record that offers one, the assistant fills the action in and sends nothing
      // (D137 item 4): the draft is kept on the answer, and the turn's response carries it with its action.
      const offered = body.thing?.kind === 'record' ? this.recordActions[body.thing.capability ?? '']?.[0] : undefined;
      if (!handed && offered && /kommentar/i.test(body.text)) {
        const drafted = {
          capability: offered.capability,
          record: { capability: body.thing!.capability!, input: body.thing!.input ?? {} },
          values: { text: 'Behörigheten gäller Skönsmons skola.' },
        };
        const written = response.thread.messages.at(-1)!;
        written.body = 'Jag har fyllt i en kommentar. Inget är skickat.';
        written.meta = { ...written.meta, recordDraft: drafted };
        response.answer = { ...response.answer, body: written.body };
        response.recordDraft = { ...drafted, action: offered };
      }
      // The work items the answer names (`MessageMeta.cards`), when a test says which.
      if (!handed && this.answerCards) {
        const written = response.thread.messages.at(-1)!;
        written.meta = { ...written.meta, cards: this.answerCards };
      }
      // The server keeps the chips a question went with on it (`MessageMeta.chips`): how a page finds the
      // conversation about its thing again. Kept here for a question asked in place.
      const question = [...response.thread.messages].reverse().find(m => m.role === 'user');
      if (!handed && body.own && body.beside && body.chips?.length && question)
        question.meta = { ...question.meta, chips: body.chips as Chip[] };
      // A conversation keeps the assistants it has an exchange with whoever answers the turn.
      const earlier = this.threads.find(t => t.id === response.conversationId);
      const before = earlier?.handover;
      if (!handed && before) response.thread.handover = before;
      // A conversation started beside a page is kept as asked beside its subject (D141 rule 6); one that exists keeps
      // what it had.
      if (earlier?.askedBeside) response.thread.askedBeside = earlier.askedBeside;
      else if (!handed && !body.conversationId && body.page)
        response.thread.askedBeside = { subject: body.page.subject, label: body.page.label, openedAt: null };
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
    // The conversation's page marks a conversation asked beside a page as opened, once (D141 rule 6).
    const opening = post ? /^\/conversations\/([^/]+)\/opened$/.exec(path) : null;
    if (opening) {
      const at = decodeURIComponent(opening[1]!);
      const t = this.threads.find(t => t.id === at && t.kind === 'question');
      if (!t) return route.fulfill({ status: 404, json: { error: 'Samtalet finns inte.' } });
      this.opened.push(at);
      const marked =
        t.askedBeside && !t.askedBeside.openedAt ? { ...t, askedBeside: { ...t.askedBeside, openedAt: NOW } } : t;
      this.threads = this.threads.map(x => (x.id === at ? marked : x));
      return json(marked);
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
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: FAILED } });
    }
    if (path.endsWith('/snooze') && post) {
      const body = (request.postDataJSON() ?? {}) as { preset?: string; until?: string; text?: string };
      const until = body.until ?? snoozePresets.find(p => p.id === body.preset)?.at ?? '2026-11-05T05:00:00.000Z';
      return json(this.update(id, { snoozedUntil: until }));
    }
    if (path.endsWith('/dismiss') && post) return json(this.update(id, { state: 'dismissed', handledAt: NOW }));
    // The person says the next step is someone else's and taken (D139), and takes it back.
    if (path.endsWith('/hand-on') && post) {
      const to = this.threads.find(t => t.id === id)?.handOn?.waitingOn ?? '';
      return json(this.update(id, { waitingOn: to, handedOn: { to, at: NOW } }));
    }
    if (path.endsWith('/hand-back') && post) {
      this.threads = this.threads.map(t => {
        if (t.id !== id) return t;
        const { handedOn: _, ...rest } = t;
        return { ...rest, waitingOn: null, updatedAt: NOW };
      });
      return json(this.threads.find(t => t.id === id)!);
    }
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
    // Confirming proposals (D70 amended): the decision waits on the calendar; its answer reads the invitations back,
    // the card stays open and waits on the invitees, and its receipt carries the way back for ten minutes.
    // Refused as the server's `confirm` refuses (AM-4): no decision without the card's version, a decision on its way is
    // replayed, and a card that has changed since the person was shown it is decided again.
    if (path.endsWith('/confirm') && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: FAILED } });
      const body = (request.postDataJSON() ?? {}) as { proposalIds?: string[]; version?: string };
      if (typeof body.version !== 'string' || !body.version)
        return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
      const shown = this.threads.find(t => t.id === id);
      if (shown?.execution && ['pending', 'running', 'unknown'].includes(shown.execution.state)) return json(shown);
      if (shown && body.version !== shown.updatedAt)
        return route.fulfill({
          status: 400,
          json: { error: 'Ärendet har ändrats sedan du öppnade det. Se över det och besluta igen.' },
        });
      const ids = body.proposalIds ?? [];
      return json(
        this.approve(id, 'calendar.confirmProposals', t => {
          const sent = t.proposals.filter(p => ids.includes(p.id));
          return {
            waitingOn: 'svar från medarbetarna',
            proposals: t.proposals.map(p =>
              ids.includes(p.id) ? { ...p, status: 'confirmed', eventRef: `memory:${p.id}`, undoUntil: UNDO_UNTIL } : p,
            ),
            receipt: {
              at: NOW,
              headline: `${sent.length} av ${sent.length} kalenderändringar är bekräftade.`,
              undoUntil: UNDO_UNTIL,
              undoCapability: 'calendar.undoProposals',
              undoInput: {
                threadId: id,
                items: sent.map(p => ({ id: p.id, proposalId: p.id, label: p.participant.name, action: 'cancel' })),
              },
              rows: sent.map(p => ({
                ref: p.id,
                label: p.participant.name,
                outcome: 'done',
                detail: 'Kontrollerat i kalendern.',
              })),
            },
          };
        }),
      );
    }
    // The receipt's way back (D70), refused as the server refuses it. From the receipt's row (`/undo-receipt`,
    // `undoReceipt`): a window that has closed, a receipt with no decision behind it, or a decision whose answer is still
    // to come. From a proposal card's own "Ångra allt" (`/undo`, the calendar's `undo`): a window that has closed or a
    // receipt without the calendar's input or decision, and then the ledger's refusal of an original that has not
    // succeeded, wholly or in part (`undoable`). An undo already on its way is the same decision again, which the ledger replays: the item as it is.
    // Undone, the card is open again with no receipt, and invitations that were sent are cancelled, so their proposals
    // are undone (`execution-projection.ts`).
    if ((path.endsWith('/undo-receipt') || path.endsWith('/undo')) && post) {
      if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
      if (this.mutationFails) return route.fulfill({ status: 503, json: { error: FAILED } });
      const t = this.threads.find(t => t.id === id)!,
        r = t.receipt,
        refuse = (error: string) => route.fulfill({ status: 400, json: { error } });
      if (path.endsWith('/undo')) {
        if (!r?.undoInput || !r.undoCapability || !r.undoUntil || r.undoUntil < NOW || !t.execution)
          return refuse('Ångerfönstret har gått ut.');
        if (!t.execution.compensates && !['succeeded', 'partial'].includes(t.execution.state))
          return refuse('Åtgärden kan inte ångras.');
      } else {
        if (!r?.undoCapability || !r.undoUntil || r.undoUntil <= NOW) return refuse('Ångerfönstret har gått ut.');
        if (!t.execution) return refuse('Det äldre kvittot behöver kontrolleras i källsystemet innan det kan ångras.');
        if (['pending', 'running', 'unknown'].includes(t.execution.state) && !t.execution.compensates)
          return refuse('Kontrollera källans besked innan åtgärden kan ångras.');
      }
      if (t.execution.compensates) return json(t);
      return json(
        this.approve(
          id,
          r.undoCapability,
          t => ({
            state: 'open',
            handledAt: null,
            waitingOn: null,
            receipt: null,
            // An undone invitation is a proposed time again (DE-L17), as the projection writes it.
            proposals: t.proposals.map(p =>
              p.status === 'confirmed' ? { ...p, status: 'proposed', eventRef: null, undoUntil: null } : p,
            ),
          }),
          t.execution.compensates ?? t.execution.id,
        ),
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
      // The effect is the HR connector's read, so a silent system is the registry's 400, never retried (D33).
      if (this.effectFails)
        return route.fulfill({ status: 400, json: { error: 'Personalsystemet svarar inte just nu.' } });
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
      // An execute is recorded as the person's decision and answered with the item waiting on its source (D45); the
      // receipt, read back with the refs the person approved, comes with the source's answer (`approve`).
      const body = (request.postDataJSON() ?? {}) as {
        actionId?: string;
        version?: string;
        refs?: string[];
        values?: Record<string, string>;
      };
      // The endpoint takes no decision without the version of the item it was made on (`ActInput`, AM-4).
      if (typeof body.version !== 'string' || !body.version)
        return route.fulfill({ status: 400, json: { error: 'Ogiltig förfrågan.' } });
      const t = this.threads.find(t => t.id === id);
      const action = t?.actions.find(a => a.id === body.actionId);
      if (t && action?.kind === 'execute') {
        this.acted.push({ threadId: id, body });
        if (this.mutationDelay) await new Promise(resolve => setTimeout(resolve, this.mutationDelay));
        if (this.mutationFails) return route.fulfill({ status: 503, json: { error: FAILED } });
        // Refused as the server's `act` refuses, in its order: the answers against the asks (`answersOf`), then rows the
        // source already got done, then an item that is no longer open, then one that has changed since the person was
        // shown it (AM-4), then an earlier decision
        // of another action. The same action decided again is the same decision, which the ledger replays whatever version
        // it names: the item as it is, nothing new (`threads/usecases/decisions.ts`). One that ended without its effect or
        // with part of it, refused, let go by the person or not sent because its user name moved (D122), is decided anew
        // (DE-M1), on the rows the source did not get done.
        const values = body.values ?? {};
        const missing = (action.path?.asks ?? []).find(a => a.required && !values[a.property]);
        const ended = !!t.execution && ['failed', 'partial'].includes(t.execution.state);
        const previous = t.execution && !t.execution.compensates && !ended ? t.execution : undefined;
        // The server reads the done rows from the ledger, across every decision on the item; the mock has the latest
        // receipt's, and `carried` stands for those of earlier decisions.
        const done = new Set([
          ...(this.carried[id] ?? []),
          ...(t.execution?.state === 'partial'
            ? (t.receipt?.rows.filter(r => r.outcome === 'done').map(r => r.ref) ?? [])
            : []),
        ]);
        const refusal =
          this.actRefusal ??
          (missing ? `${missing.label} behöver fyllas i.` : undefined) ??
          (Object.keys(values).some(k => !(action.path?.asks ?? []).some(a => a.property === k))
            ? 'Åtgärden frågar inte efter det värdet.'
            : undefined) ??
          (!previous &&
          action.usesItems &&
          (body.refs ?? t.items.filter(i => i.selected).map(i => i.ref)).some(ref => done.has(ref))
            ? 'En del av raderna är redan genomförda. Välj bara de som återstår.'
            : undefined) ??
          (!previous && t.state !== 'open' ? 'Ärendet är redan hanterat.' : undefined) ??
          (!previous && body.version !== t.updatedAt
            ? 'Ärendet har ändrats sedan du öppnade det. Se över det och besluta igen.'
            : undefined) ??
          (previous && previous.operation !== action.capability
            ? 'Ett tidigare beslut väntar redan på besked.'
            : undefined);
        this.actRefusal = null;
        if (refusal) return route.fulfill({ status: 400, json: { error: refusal } });
        if (previous) return json({ kind: 'execute', thread: t });
        const refs = body.refs ?? t.items.filter(i => i.selected).map(i => i.ref);
        if (action.capability === 'reference.complete') {
          const receipt = {
            at: NOW,
            headline: 'Bekräftat i testkällan.',
            undoCapability: 'reference.undo',
            undoUntil: UNDO_UNTIL,
            rows: [{ ref: 'reference:item:1', label: 'Testpost', outcome: 'done' as const, detail: 'Version 2' }],
          };
          const decided = this.approve(id, action.capability, () => ({ state: 'handled', handledAt: NOW, receipt }));
          return json({ kind: 'execute', thread: decided });
        }
        const receipt: Thread['receipt'] =
          action.capability === 'servicedesk.order'
            ? orderReceipt(values.item)
            : action.capability === 'hr.bookTalk'
              ? {
                  at: NOW,
                  headline: 'Samtalet är registrerat i personalsystemet.',
                  undoUntil: UNDO_UNTIL,
                  undoCapability: 'hr.unbookTalk',
                  rows: [
                    {
                      ref: refs[0] ?? 'hr:emp:1',
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
                    undoUntil: UNDO_UNTIL,
                    undoCapability: 'hr.undecideLeave',
                    rows: [
                      {
                        ref: refs[0] ?? 'hr:leave:1',
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
                      undoUntil: UNDO_UNTIL,
                      undoCapability: 'finance.unapprove',
                      rows: refs.map(ref => ({
                        ref,
                        label: t.items.find(i => i.ref === ref)?.label ?? ref,
                        outcome: 'done',
                        detail: 'Läst tillbaka från ekonomisystemet',
                      })),
                    };
        // A decision is a new version of the item, so its Händelser are read again (D112 item 4).
        const decided = this.approve(id, action.capability, () => ({ state: 'handled', handledAt: NOW, receipt }));
        return json({ kind: 'execute', thread: decided });
      }
      if (this.cardReadDelay) await new Promise(resolve => setTimeout(resolve, this.cardReadDelay));
      if (this.cardReadFails) {
        const source = this.threads.find(t => t.id === id)?.trigger.source ?? 'Källan';
        return route.fulfill({ status: 400, json: { error: `${source} svarar inte just nu.` } });
      }
      const read = body.actionId ? this.cardReads[body.actionId] : undefined;
      return json(read ? { kind: 'read', ...read } : { kind: 'read', output: this.output });
    }
    // A work item's Händelser (D112 item 4), as the audit rows of what the thread shows would read back.
    if (/^\/threads\/[^/]+\/events$/.test(path) && !post) {
      const t = this.threads.find(t => t.id === id);
      if (!t) return route.fulfill({ status: 404, json: { error: 'Ärendet finns inte.' } });
      // The history is Clew's own audit rows, so a failure is the routes' own sentence, never a source's.
      if (this.itemEventsFail) return route.fulfill({ status: 503, json: { error: FAILED } });
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
  /**
   * An action about an entity (D97) from its dialog (D126 item 7), answered as the entities module does: `effect` reads
   * what an execute would write and writes nothing; `actions` starts a propose's work item with the answers; `decide`
   * makes an execute's work item with the human decision in it, here read back at once as the source would answer it.
   * An action the entity does not offer, or the wrong route for its kind, is the server's 404.
   */
  /**
   * An action about a record (D137) from its dialog, answered as the records module does: `effect` reads what an
   * execute would write and writes nothing; `decide` makes the work item with the human decision in it, read back at
   * once as the source would answer it; `actions` starts a propose's work item. A decision or a start that names the
   * assistant's draft it was sent from marks that draft as sent with the work item it became, once. An action the
   * record does not offer, or the wrong route for its kind, is the server's 404.
   */
  private recordStart(route: Route, read: string, sub: 'effect' | 'decide' | 'actions') {
    const posted = route.request().postDataJSON() as Omit<RecordActed, 'read'>;
    const action = (this.recordActions[read] ?? []).find(a => a.capability === posted.capability);
    if (!action || (sub !== 'actions' && action.kind !== 'execute'))
      return route.fulfill({ status: 404, json: { error: 'Okänd adress.' } });
    const asked: RecordActed = { read, ...posted };
    if (sub === 'effect') {
      this.recordEffects.push(asked);
      return route.fulfill({
        json: {
          rows: [{ label: 'Kommentaren läggs till på beställningen', detail: posted.values?.text ?? '' }],
          source: action.source,
        } satisfies EffectPreview,
      });
    }
    (sub === 'decide' ? this.recordDecides : this.recordStarts).push(asked);
    const id = `record-${action.capability.replace(/\W/g, '-')}-${this.recordDecides.length + this.recordStarts.length}`;
    const made: Thread = {
      ...this.threads[0]!,
      id,
      topic: id,
      connector: action.connector,
      title: action.title,
      trigger: { ...this.threads[0]!.trigger, reason: `Du valde ${action.title}`, source: action.source },
      summary: `${action.title}.`,
      items: [],
      actions: [],
      proposals: [],
      deadline: null,
      ...(sub === 'decide'
        ? {
            state: 'handled' as const,
            handledAt: NOW,
            receipt: {
              at: NOW,
              headline: `Kommentaren är tillagd i ${action.source}.`,
              undoUntil: null,
              undoCapability: null,
              rows: [
                { ref: `${action.connector}:kommentar`, label: action.title, outcome: 'done' as const, detail: '' },
              ],
            },
          }
        : { state: 'open' as const }),
    };
    // The draft the send names is marked with the work item it became, the first time only.
    const { draft } = posted;
    if (draft)
      this.threads = this.threads.map(t =>
        t.id !== draft.conversationId
          ? t
          : {
              ...t,
              messages: t.messages.map(m =>
                m.id === draft.messageId && m.meta?.recordDraft && !m.meta.recordDraft.sent
                  ? { ...m, meta: { ...m.meta, recordDraft: { ...m.meta.recordDraft, sent: { threadId: id } } } }
                  : m,
              ),
            },
      );
    this.threads = [...this.threads.filter(t => t.id !== id), made];
    return route.fulfill({ json: { threadId: id } });
  }

  private entityStart(route: Route, path: string) {
    const [, , kind, key = '', sub = ''] = path.split('/');
    const posted = route.request().postDataJSON() as { capability?: string; values?: Record<string, string> } | null;
    const capability = posted?.capability ?? '';
    const opened = decodeURIComponent(key);
    const detail = !['actions', 'effect', 'decide'].includes(sub)
      ? undefined
      : kind === 'person'
        ? (this.entityDetailOf?.(opened) ?? entityDetail(this.entityList, opened))
        : kind === 'unit'
          ? this.unitDetailOf?.(opened)
          : undefined;
    const action = detail?.actions.find(a => a.capability === capability);
    if (!detail || !action || (sub !== 'actions' && action.kind !== 'execute'))
      return route.fulfill({ status: 404, json: { error: 'Okänd adress.' } });
    const asked = {
      key: detail.entity.key,
      capability,
      ...(posted?.values ? { values: posted.values } : {}),
    };
    const values = posted?.values ?? {};
    if (sub === 'effect') {
      this.entityEffects.push(asked);
      const details = [values.when ? talkTime(values.when) : 'nästa lediga tid', values.place].filter(Boolean);
      return route.fulfill({
        json: {
          rows: [{ label: 'Omtankesamtalet registreras', detail: `På ${detail.entity.name}, ${details.join(', ')}` }],
          undoMinutes: 10,
          source: action.source,
        } satisfies EffectPreview,
      });
    }
    (sub === 'decide' ? this.entityDecides : this.entityStarts).push(asked);
    const refusal = this.entityRefusals[capability];
    if (refusal) return route.fulfill({ status: 400, json: { error: refusal } });
    const id = `entity-${capability.replace(/\W/g, '-')}-${detail.entity.key}`;
    if (sub === 'decide') {
      // The work item is made with one row naming who it acts on (`entities/actions.ts`, D97 item 6) and decided at
      // once: it waits on its source, and the source's answer is read back onto it (D45, D70).
      const receipt: Thread['receipt'] =
        capability === 'servicedesk.order'
          ? orderReceipt(values.item)
          : {
              at: NOW,
              headline: `${action.title} är gjort i ${action.source.toLocaleLowerCase('sv-SE')}.`,
              undoUntil: null,
              undoCapability: null,
              rows: [
                {
                  ref: `person:${detail.entity.id ?? detail.entity.key}`,
                  label: action.title,
                  outcome: 'done',
                  detail: [`registrerat för ${detail.entity.name}`, values.when && talkTime(values.when), values.place]
                    .filter(Boolean)
                    .join(', '),
                },
              ],
            };
      this.threads = [
        ...this.threads.filter(t => t.id !== id),
        {
          ...this.threads[0]!,
          id,
          topic: id,
          connector: action.connector,
          area: 'personal',
          title: `${action.title}: ${detail.entity.name}`,
          trigger: { reason: `Du valde ${action.title} för ${detail.entity.name}`, source: action.source, at: NOW },
          summary: `${action.title} för ${detail.entity.name}.`,
          state: 'open',
          handledAt: null,
          items: [
            {
              ref: `${kind}:${detail.entity.id ?? detail.entity.key}`,
              label: detail.entity.name,
              detail: detail.entity.detail ?? '',
              selectable: false,
              selected: true,
              subject: { entity: kind as 'person', key: detail.entity.key },
            },
          ],
          actions: [
            {
              id: 'decide',
              label: action.title,
              capability: action.capability,
              kind: 'execute',
              role: 'primary',
              input: { [action.param]: detail.entity.key },
              ...(action.path ? { path: action.path } : {}),
            },
          ],
          proposals: [],
          receipt: null,
          execution: null,
          waitingOn: null,
          deadline: null,
        },
      ];
      this.approve(id, action.capability, () => ({ state: 'handled', handledAt: NOW, receipt }));
      return route.fulfill({ json: { threadId: id } });
    }
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
   * without a talks system, read-only when another system answers), and the seven writes over the mock's own state, so a
   * spec sees the lists change on the next read.
   */
  private handleTalks(route: Route, path: string) {
    const request = route.request(),
      method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const fail = (status: number, error: string) => route.fulfill({ status, json: { error } });
    // A write the talks routes refuse (`routes/talks.ts`): a 403 with the route's sentence and `code: 'denied'`.
    const denied = (error: string) => route.fulfill({ status: 403, json: { error, code: 'denied' } });
    const NOT_WRITABLE = 'Utvecklingssamtalen hålls i ett annat system, så de kan inte ändras här.';
    const empty = () => route.fulfill({ status: 204, body: '' });
    // The registry's own refusal for a capability outside the person's scope: a 400 with its sentence and no code. A
    // write while no system answers the talks profile in Clew is the routes' own refusal.
    if (!this.talksOffered)
      return path.startsWith('/cap/') ? fail(400, 'Du saknar behörighet för åtgärden.') : denied(NOT_WRITABLE);
    if (path === '/cap/clew.talks') {
      const result = talksResult({
        round: this.talksRound,
        rows: this.employee ? [] : this.talkRows,
        commitments: this.commitments,
      });
      return json({ output: this.talksWritable ? result : readOnlyTalks(result), source: result.source });
    }
    if (path === '/cap/clew.commitments') {
      const input = (request.postDataJSON() ?? {}) as CommitmentsInput;
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
    const body = method === 'POST' || method === 'PUT' ? (request.postDataJSON() ?? {}) : null;
    this.talkWrites.push({ method, path, body });
    if (!this.talksWritable) return denied(NOT_WRITABLE);
    const done = /^\/talks\/commitments\/([^/]+)\/done$/.exec(path);
    // The owner of an action point marks it done and opens it again whatever their role (D96 item 4); someone who
    // manages nobody may do nothing else here, and the talks module says so (`talks/usecases.ts`).
    if (this.employee && !done) return denied('Utvecklingssamtalen är för den som är chef för en enhet.');
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
    if (what === 'booking' && path.endsWith('/booking/calendar')) {
      // What the calendar holds against the reader's booking, settled as the calendar module settles it (D133).
      const { decision } = body as TalkCalendarBody;
      // The meeting's time passed without a talk (D134): the invitation is over and the talk lacks a time.
      if (decision === 'missed') {
        if (row?.own !== true || row.invited !== true)
          return fail(400, 'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.');
        if (!row.until || Date.parse(row.until) > Date.parse(NOW))
          return fail(400, 'Tiden för samtalet har inte passerat än.');
        const { at: _a, until: _u, invited: _i, own: _o, calendar: _c, ...gone } = row;
        this.talkRows = this.talkRows.map(r => (r.personId === personId ? { ...gone, state: 'missing' } : r));
        return empty();
      }
      if (!row?.calendar || row.own !== true)
        return fail(400, 'Samtalet har ingen inbjudan från dig att ändra. Läs om sidan.');
      const { calendar, ...settled } = row;
      const gone = 'gone' in calendar;
      if ((decision === 'adopt') === gone)
        return fail(
          400,
          gone ? 'Mötet finns inte längre i kalendern. Läs om sidan.' : 'Mötet finns kvar i kalendern. Läs om sidan.',
        );
      const { at: _at, until: _until, invited: _invited, own: _own, ...bare } = settled;
      const next: typeof row =
        'gone' in calendar
          ? decision === 'keep'
            ? { ...settled, invited: false }
            : { ...bare, state: 'missing' }
          : { ...settled, at: calendar.start, until: calendar.end };
      this.talkRows = this.talkRows.map(r => (r.personId === personId ? next : r));
      return empty();
    }
    if (what === 'booking') {
      if (!row) return fail(400, 'Personen finns inte i samtalsomgången.');
      // As the talks module refuses it (D132 item 4): never a talk marked held, nor a booking an invitation carries.
      if (row.state === 'held') return fail(400, 'Samtalet är redan markerat som hållet.');
      if (row.state === 'booked' && row.invited !== false)
        return fail(400, 'Samtalet är bokat genom en inbjudan från Clew, så tiden kan inte ändras här.');
      const { at: _at, until: _until, invited: _invited, own: _own, ...bare } = row;
      if (method === 'PUT') {
        const { start, end } = body as TalkBookingBody;
        if (!(Date.parse(end) > Date.parse(start)))
          return fail(400, 'Ange en giltig start- och sluttid, med högst ett dygn emellan.');
        this.talkRows = this.talkRows.map(r =>
          r.personId === personId ? { ...bare, state: 'booked', at: start, until: end, invited: false, own: true } : r,
        );
        return json({ id: `talk-${personId}`, start, end });
      }
      this.talkRows = this.talkRows.map(r => (r.personId === personId ? { ...bare, state: 'missing' } : r));
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
      const wrong = providerAddressProblem(input.baseUrl);
      if (wrong) return route.fulfill({ status: 400, json: { error: wrong } });
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
    // As the server does (D24): an address it cannot read, or with a user name or password in it, is refused, and so
    // is a key given for a host the provider has left since the page was read.
    const origin = (url: string) => {
      try {
        return new URL(url).origin;
      } catch {
        return undefined;
      }
    };
    if (action === 'key') {
      const input = body() as { apiKey: string; baseUrl?: string };
      if (!input.baseUrl || !origin(input.baseUrl) || origin(input.baseUrl) !== origin(p.baseUrl))
        return route.fulfill({
          status: 400,
          json: {
            error:
              'Leverantörens adress har ändrats sedan sidan lästes in. Läs in sidan igen och lägg in nyckeln för den nya adressen.',
          },
        });
      const next = { ...p, hasKey: !!input.apiKey, keyChangedAt: NOW };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    if (method === 'DELETE') {
      this.providers = this.providers.filter(x => x.id !== id);
      return json({ removed: true });
    }
    if (method === 'PATCH') {
      const patch = body() as Partial<ProviderSummary>;
      const wrong = patch.baseUrl === undefined ? undefined : providerAddressProblem(patch.baseUrl);
      if (wrong) return route.fulfill({ status: 400, json: { error: wrong } });
      // As the server does (D24): an address on another host takes the key with it.
      const moved = !!patch.baseUrl && p.hasKey && origin(patch.baseUrl) !== origin(p.baseUrl);
      const next = {
        ...p,
        ...patch,
        ...(moved ? { hasKey: false, keyChangedAt: NOW } : {}),
        updatedAt: new Date().toISOString(),
      };
      this.providers = this.providers.map(x => (x.id === id ? next : x));
      return json(providerDetail(next));
    }
    return json(providerDetail(p));
  }
}

/**
 * Keeps the page's change streams (D46) where the mock can reach them, so a notice is a message on the stream the page
 * opened, as the server sends it. A spec that puts its own EventSource in place replaces this one and sends its own.
 */
function recordChangeStreams() {
  const Native = window.EventSource;
  const open = new Set<EventSource>();
  Object.assign(window, { changeStreams: open });
  window.EventSource = class extends Native {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      open.add(this);
    }
    close() {
      open.delete(this);
      super.close();
    }
  };
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

/**
 * Keeps each violation of the document's content security policy (D145) in the window's own list, read when the test
 * ends, and tells the test at once as well. Runs in every page and frame of the test's context; the build is served
 * under the web image's headers (`security-headers.ts`), so whatever the policy refuses fails the spec. It listens on
 * the window, not the document: a popup opened with an address starts as about:blank and keeps that window for the page
 * it then loads, while the first document and anything listening on it are gone.
 */
function recordPolicyViolations() {
  const kept: string[] = [];
  Object.assign(window, { policyViolations: kept });
  window.addEventListener('securitypolicyviolation', event => {
    const text = `${event.effectiveDirective} refused ${event.blockedURI || 'inline'} in ${event.sourceFile || event.documentURI}`;
    kept.push(text);
    (window as unknown as { reportPolicyViolation: (text: string) => void }).reportPolicyViolation(text);
  });
}

/** What the policy refused while the test ran, from every page, frame and worker of its context (D145). */
export type PolicyGuard = {
  /** Everything refused so far, as the documents kept it and as the browser said it. */
  violations(): Promise<string[]>;
  /** Forgets what was refused so far: for the spec that refuses on purpose to show the guard works. */
  clear(): Promise<void>;
};

/** Every document's own list, from every frame of every page still open; a frame gone since is skipped. */
async function eachKept<T>(context: BrowserContext, read: () => T): Promise<T[]> {
  const frames = context.pages().flatMap(page => page.frames());
  const lists = await Promise.all(frames.map(frame => frame.evaluate(read).catch(() => undefined)));
  return lists.filter((list): list is Awaited<T> => list !== undefined) as T[];
}

export const test = base.extend<{ api: MockApi; policy: PolicyGuard }>({
  // Automatic, so a spec that never asks for the mocked API is held to the policy as well; on the context, so a popup,
  // a new tab and every frame of each are watched from their first script on.
  policy: [
    async ({ context }, use) => {
      const reported = new Set<string>();
      await context.exposeBinding('reportPolicyViolation', (_source, text: string) => void reported.add(text));
      await context.addInitScript(recordPolicyViolations);
      // The browser's own word for a refusal on a page's console is read as well.
      const fromConsole = (message: ConsoleMessage) => {
        if (/Content Security Policy/i.test(message.text())) reported.add(message.text());
      };
      // A worker runs no init script, and what the browser says there never reaches the test: the guard listens in each
      // worker as it starts and says each refusal on the worker's console, which the test does read. A refusal in the
      // worker's first run, before the listener is in, goes unheard.
      const watchWorker = (worker: Worker) => {
        worker.on('console', fromConsole);
        void worker
          .evaluate(() =>
            self.addEventListener('securitypolicyviolation', event =>
              console.error(
                `Content Security Policy: ${event.effectiveDirective} refused ${event.blockedURI || 'inline'} in ${event.sourceFile || self.location.href}`,
              ),
            ),
          )
          .catch(() => undefined);
      };
      const watchPage = (page: Page) => page.on('worker', watchWorker);
      context.on('console', fromConsole);
      context.on('page', watchPage);
      context.pages().forEach(watchPage);
      const violations = async () => {
        for (const list of await eachKept(
          context,
          () => (window as { policyViolations?: string[] }).policyViolations ?? [],
        ))
          for (const text of list) reported.add(text);
        return [...reported];
      };
      await use({
        violations,
        clear: async () => {
          await eachKept(context, () => (window as { policyViolations?: string[] }).policyViolations?.splice(0));
          reported.clear();
        },
      });
      expect(await violations()).toEqual([]);
      context.off('console', fromConsole);
      context.off('page', watchPage);
    },
    { auto: true },
  ],
  api: async ({ page }, use) => {
    const api = new MockApi();
    api.page = page;
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript(recordAnnouncements);
    await page.addInitScript(recordChangeStreams);
    await page.route('**/api/**', route => api.handle(route));
    await use(api);
    expect(api.unmocked).toEqual([]);
  },
});
export { expect };

export const answer = (page: Page) =>
  page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' });
/**
 * Hem's line (D126 items 4 and 9, board HemFraga): a plain field named "Fråga assistenten", whose question is asked on the
 * conversation page. It takes no `@`, so it is no combobox.
 */
export const hemLine = (page: Page) => page.getByRole('textbox', { name: 'Fråga assistenten', exact: true });
/**
 * Where a question is written: Hem's line, the box on Ny fråga ("Vad vill du göra"), and "Svara i samtalet" once a
 * conversation is open (the scope line, H3.3). One of them is on a page at a time. Hem's line is a plain input, so what
 * it holds is its value; the boxes hold their text.
 */
export const composer = (page: Page) =>
  page.getByRole('combobox', { name: /^(Vad vill du göra|Svara i samtalet)$/ }).or(hemLine(page));
/** "Inte nu" on the first work item, the way a person does it (D29): open the picker, choose "I morgon". */
export async function snoozeFirst(page: Page) {
  // A card keeps Inte nu in view; a row has one link to its work item (D112), so the first row's item is opened first:
  // from Att göra in the reading pane, an article named by the item, from Hem as its own page (D126 rule 1). Inte nu
  // stands among its buttons there.
  const button = page.getByRole('main').getByRole('button', { name: 'Inte nu', exact: true }).first();
  if (await button.isVisible()) await button.click();
  else {
    // A work item's row (`#work-<id>`) has one link: on Hem "Öppna", named with the row's title (D130), in Att göra's
    // table and its list on a phone the title itself (D126).
    const row = page.getByRole('main').locator('[id^="work-"]').getByRole('link').first();
    const title = ((await row.getAttribute('aria-label')) ?? (await row.textContent()) ?? '')
      .trim()
      .replace(/^Öppna /, '');
    await row.click();
    const article = page.getByRole('article', { name: `Ärende: ${title}`, exact: true });
    const alone = page.getByRole('main').getByRole('heading', { level: 1, name: title, exact: true });
    await expect(article.or(alone).first()).toBeVisible();
    const item = (await article.isVisible()) ? article : page.getByRole('main');
    // A calendar proposal keeps Inte nu among its buttons; a work item has it under Fler åtgärder (D126 rule 2).
    const own = item.getByRole('button', { name: 'Inte nu', exact: true }).first();
    const more = item.getByRole('button', { name: 'Fler åtgärder' }).first();
    await expect(own.or(more).first()).toBeVisible();
    if (await own.isVisible()) await own.click();
    else {
      await more.click();
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
/** Finds headings by their accessible level, including Astryx headings with a separate visual level. */
export const heading = (scope: Page | Locator, level: number, name = '') =>
  scope.locator(`h${level}:not([aria-level]), [aria-level="${level}"]`).filter({ hasText: name });
export const announcements = (page: Page) =>
  page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);
/**
 * Clew's own pages (D130): the row under the shared header's band, a navigation landmark named "Mina sidor". There is
 * no rail. Without a header connector Start stands first in it; with one, Start is a place of the band ("Huvudmeny").
 */
export const pagesNav = (page: Page) => page.getByRole('navigation', { name: 'Mina sidor', exact: true });
/**
 * Where a person reaches Clew's pages: the row under the band, and below the header's breakpoint the drawer its "Meny"
 * opens, which lists every page, the tools among them, and then the places.
 */
export async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Meny', exact: true });
  if (!(await toggle.isVisible())) return pagesNav(page);
  await toggle.click();
  // Named by the site, which a header connector may name: found by its own way out.
  const drawer = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Stäng navigering' }) });
  await expect(drawer).toBeVisible();
  return drawer;
}
/**
 * The tools on a wide window (D130): a menu at the end of the pages' row. Its button is named "Verktyg", or by the
 * tool whose page is open, so it is found by what it opens.
 */
export const toolsButton = (page: Page) => pagesNav(page).locator('button[aria-haspopup="menu"]');
/** Opens the tools' menu where it is closed and answers it; on a phone the tools are rows of the drawer (`openNav`). */
export async function openTools(page: Page) {
  const menu = page.getByRole('menu');
  if (!(await menu.isVisible())) await toolsButton(page).click();
  await expect(menu).toBeVisible();
  return menu;
}
/** A tool's row in the tools' menu, the menu opened first. */
export const toolRow = async (page: Page, label: string) =>
  (await openTools(page)).getByRole('menuitem', { name: label, exact: true });
/**
 * The signed-in person on the band (D87, D130): one button for the avatar, the name and on a wide window the unit, named
 * by what it shows and by what it opens, the settings under it, where "Min sida" leads to the person's own page.
 */
export const personButton = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: /^Testa Testsson, (.+, )?inställningar$/ });
/**
 * The person's settings (D39), opened from the person on the band, the one way to them: under the person with a
 * pointer, a low sheet on a touch phone, a dialog named by the person either way.
 */
export async function openSettings(page: Page) {
  await personButton(page).click();
  const settings = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
  await expect(settings).toBeVisible();
  return settings;
}
/** The reminders' bell on the band (D88): named by how many are due, or by that they could not be read. */
export const bell = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Påminnelser/ });
/** The search (D126's "Sök"): its button on the band, which opens the command palette over the page. */
export const searchButton = (page: Page) => page.getByRole('button', { name: 'Sök', exact: true });
/**
 * The surface that docks the composer: ChatLayout's sticky wrapper (D31), or null when the row is in the page flow.
 * It starts from the page's own question field (`composer`: Hem's line is a plain input since D130), never from the
 * first combobox in the document, which is the search palette's field in its closed dialog.
 */
const dockOf = (page: Page) =>
  composer(page)
    .first()
    .evaluate(field => {
      let el = field.parentElement;
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
      // Hem's field uses the pill's focus outline. Its inset shadow is present even at rest.
      const askPill = active.matches('input') ? active.closest('[data-variant="ask"]') : null;
      const marked = askPill ? drawn(askPill) : ring(active, 0) || drawn(ownRow);
      if (!marked) unmarked.push(name);
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

/**
 * The page's own scrolling under the shell's header (D130 item 8 as amended 2026-11-21): scrolls the shell's column,
 * the outermost scrolling ancestor of the page's level-1 heading (the document on a short screen), by `by` px, and answers how far it has gone, how far
 * it can go, and where its top edge is in the window. A page that keeps its header has no room to scroll there.
 */
export const scrollPage = (page: Page, by: number) =>
  page.evaluate(by => {
    // On a short screen the shell lets the window scroll (1.4.10): then no ancestor scrolls, and the document does.
    let shell = document.scrollingElement as HTMLElement;
    for (let el = document.querySelector('h1')?.parentElement ?? null; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') shell = el;
    }
    shell.scrollTop += by;
    return {
      scrolled: Math.round(shell.scrollTop),
      room: Math.round(shell.scrollHeight - shell.clientHeight),
      top: Math.max(0, Math.round(shell.getBoundingClientRect().top)),
    };
  }, by);

/**
 * Walks backwards with Shift+Tab from the last control in the page's main region, the direction in which the browser
 * brings a control in at the top edge, and names every stop any part of which is under `row` (a row that sticks at
 * the top of the page): stricter than 2.4.11, which only forbids a stop that is entirely hidden. The walk ends when the
 * focus reaches the row itself or leaves the main region.
 */
export async function stopsUnderStuckRow(page: Page, row: Locator, limit = 80) {
  await page.evaluate(() => {
    const main = document.querySelector('main, [role="main"]')!;
    const stops = [...main.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')].filter(
      el => el.getClientRects().length > 0,
    );
    stops.at(-1)?.focus();
  });
  const handle = await row.elementHandle();
  const under: string[] = [];
  let stops = 0;
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Shift+Tab');
    const stop = await page.evaluate(row => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.closest('main, [role="main"]')) return 'out' as const;
      if (row!.contains(active)) return 'row' as const;
      const a = active.getBoundingClientRect();
      const r = row!.getBoundingClientRect();
      const covered = a.top < r.bottom - 1 && a.bottom > r.top + 1 && a.left < r.right && a.right > r.left;
      const name = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 40)}" at ${Math.round(a.top)} under the row ending at ${Math.round(r.bottom)}`;
      return { name, covered };
    }, handle);
    if (stop === 'out' || stop === 'row') break;
    stops++;
    if (stop.covered) under.push(stop.name);
  }
  return { under, stops };
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
