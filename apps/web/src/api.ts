import type {
  CommitmentAddBody,
  DialogueActivityAddBody,
  DialogueActivityDoneBody,
  DialogueActivityEditBody,
  DialogueAssessBody,
  DialogueNoteAddBody,
  DialogueNoteEditBody,
  DialogueUnit,
  CommitmentsInput,
  CommitmentsResult,
  NewsResult,
  TalkHeldBody,
  TalksResult,
  GroupCapabilityInputType,
  GroupRelationInputType,
  GroupSearchResult,
  ProvisionerIssueInputType,
  ProvisionerKeyIssued,
  ProvisionerRotateInputType,
  UsersAdminOverview,
  UsersAdminPage,
  UsersAdminQueryType,
  StaffOverview,
  ManifestReference,
  DocumentRequest,
  ReviewEvidence,
  ReviewPreview,
  SiteHeaderView,
  AskValues,
  EffectPreview,
  MeetingTimes,
} from '@clew/contracts';
import type {
  AddModelInput,
  AddProviderInput,
  ModelDetail,
  ModelPatchInput,
  ModelSummary,
  ProviderDetail,
  ProviderPatchInput,
  ProviderSummary,
  ProviderTestReport,
} from '@clew/contracts';
import type {
  MenuEntry,
  SystemMark,
  ViewEntry,
  PanelViewSpec,
  SnoozeInput,
  SnoozePreset,
  AddConnectorInput,
  Area,
  AssistantStatus,
  HandoverAssistant,
  Attention,
  AvailabilityInput,
  AvailabilityResult,
  CalendarEvent,
  CalendarMember,
  CalendarRoom,
  CancelEventInput,
  CreateEventInput,
  DayView,
  MoveProposalInput,
  RescheduleEventInput,
  CheckReport,
  ClewObject,
  ConnectorDetail,
  ConnectorHealth,
  ConnectorPatchInput,
  ConnectorPreview,
  ConnectorSummary,
  ConversationEvent,
  ConversationInput,
  ConversationResponse,
  ItemEvents,
  TurnEvent,
  ManifestDiff,
  Proposal,
  Role,
  Thread,
  TodayView,
  Verb,
} from '@clew/contracts';
import { sessionFetch } from '@clew/ui';
import type {
  AppearanceAdminView,
  AppearanceLogoInputType,
  OrganisationOverview,
  OrganisationUnitPeople,
} from '@clew/contracts';
import type {
  CompetenceHoldingBody,
  CompetenceImportBody,
  CompetenceImportOutcome,
  CompetenceMappingBody,
  CompetenceMergePreview,
  CompetenceMatrixInput,
  CompetenceMatrixOutput,
  CompetenceRequirementBody,
  CompetenceRequirementsOutput,
  CompetenceSearchBody,
  CompetenceSearchFileBody,
  CompetenceSearchOptions,
  CompetenceSearchPage,
  CompetenceTypeSearchBody,
  CompetenceTypeSearchOutput,
  CompetenceShareTargetBody,
  CompetenceShareTargetsOutput,
  CompetenceSourcesOutput,
  CompetenceTypeBody,
  CompetenceTypePatch,
  CompetenceTypesOutput,
  CompetenceValidityImpact,
  CompetenceApproval,
  CompetenceDecision,
  CompetenceOwnOutput,
  CompetenceSkillBody,
  CompetenceSkillChangeBody,
  CompetenceSkillRatingBody,
  CompetenceSkillValidation,
  CompetenceValidationBody,
  EntityActionStarted,
  EntityDetail,
  EntityKind,
  EntityList,
  EntityRows,
  EntitySection,
} from '@clew/contracts';
import type {
  BoardingImportBody,
  BoardingImportOutcome,
  BoardingItemAddBody,
  BoardingLayersOutput,
  BoardingPersonOutput,
  BoardingPlanOutput,
  BoardingPlansOutput,
  BoardingPreview,
  BoardingStartBody,
  BoardingSuggestionsOutput,
} from '@clew/contracts';

import { ApiError } from './api-error';
import { matrixQuery } from './competence-address';
export { ApiError };
export interface CorrectionExecution {
  id: string;
  state: 'pending' | 'running' | 'unknown' | 'failed' | 'partial' | 'succeeded';
  result: { headline: string; rows: Array<{ ref: string; outcome: string; detail: string }> } | null;
}

/** Every call goes through the same-origin proxy with the session CSRF token. Errors carry the server's Swedish message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, 'Tjänsten svarade oväntat.');
  }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? 'Något gick fel.');
  return data as T;
}
/**
 * A conversation turn as it runs (D36): `POST /api/conversation/stream` answers with server-sent events, read here from
 * the response body. Each step and text delta goes to `onEvent`; the finished turn resolves, the server's Swedish error
 * rejects as an ApiError, and `signal` is Stoppa (the fetch aborts, the server stops the turn and writes nothing).
 */
async function converseStream(
  input: ConversationInput,
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<ConversationResponse | { offer: HandoverAssistant; held?: 'person' | 'card' }> {
  const response = await sessionFetch('/api/conversation/stream', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) {
    let message = 'Något gick fel.';
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, message);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n');
      buffer = buffer.slice(end + 2);
      if (!data) continue;
      let event: ConversationEvent;
      try {
        event = JSON.parse(data) as ConversationEvent;
      } catch {
        throw new ApiError(502, 'Tjänsten svarade oväntat.');
      }
      if (event.type === 'done') {
        void reader.cancel();
        return event.response;
      }
      // Clew's assistant suggests another system's assistant: nothing was sent or saved, and the person is asked.
      if (event.type === 'offer') {
        void reader.cancel();
        return { offer: event.assistant };
      }
      // Clew held a question on its way to another system's assistant: it names the person's staff or one of their cards.
      if (event.type === 'hold') {
        void reader.cancel();
        return { offer: event.assistant, held: event.about };
      }
      if (event.type === 'error') {
        void reader.cancel();
        throw new ApiError(400, event.message);
      }
      onEvent(event);
    }
  }
  throw new ApiError(502, 'Svaret bröts innan det var klart. Försök igen.');
}
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
/**
 * A file the server makes from what a body asks (a search's result, D121): its bytes and the name the server gave it.
 * Errors carry the server's Swedish message, as `call`'s do.
 */
async function file(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const response = await sessionFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    let message = 'Något gick fel.';
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, message);
  }
  const named = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
  return { blob: await response.blob(), filename: named ?? 'fil.csv' };
}
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => call<T>(path, { method: 'DELETE' });
/** A read capability's output alone, through the same route the panel's views use (`/api/cap/<name>?input=`). */
const read = <T>(name: string, input: unknown) =>
  call<{ output: T }>(`/api/cap/${name}?input=${encodeURIComponent(JSON.stringify(input))}`).then(r => r.output);
const talkPath = (personId: string) => `/api/talks/${encodeURIComponent(personId)}`;
const commitmentPath = (id: string) => `/api/talks/commitments/${encodeURIComponent(id)}`;
const dialogueUnitPath = (unitId: string) => `/api/dialogue/units/${encodeURIComponent(unitId)}`;
const dialogueActivityPath = (id: string) => `/api/dialogue/activities/${encodeURIComponent(id)}`;
const dialogueNotePath = (id: string) => `/api/dialogue/notes/${encodeURIComponent(id)}`;
export const api = {
  /** Personal (D94): the people on the units the signed-in manager manages; 403 for anyone else. */
  staff: () => call<StaffOverview>('/api/staff'),
  /**
   * Entities (D97): what sources say about a person or a unit, placed by Clew. `list` is the page's people or units with
   * the administrator's columns, lenses and the actions; `rows` is one source over all of them (a lens, a column, the
   * marks); `detail` is one opened entity; `section` is one source's answer for it. A key the reader may not ask about
   * answers 404.
   */
  entities: {
    list: (kind: EntityKind) => call<EntityList>(`/api/entities/${kind}`),
    rows: (kind: EntityKind, capability: string) =>
      call<EntityRows>(`/api/entities/${kind}/rows?capability=${encodeURIComponent(capability)}`),
    detail: (kind: EntityKind, key: string) => call<EntityDetail>(`/api/entities/${kind}/${encodeURIComponent(key)}`),
    section: (kind: EntityKind, key: string, capability: string) =>
      call<EntitySection>(
        `/api/entities/${kind}/${encodeURIComponent(key)}/section?capability=${encodeURIComponent(capability)}`,
      ),
    /**
     * Start one of the entity's actions from its menu, without the model (D97, D8): the answer is the card the person
     * decides on. A refusal is the source's Swedish sentence (400); an action the entity does not offer is a 404.
     */
    start: (kind: EntityKind, key: string, capability: string, values?: AskValues) =>
      post<EntityActionStarted>(`/api/entities/${kind}/${encodeURIComponent(key)}/actions`, {
        capability,
        ...(values ? { values } : {}),
      }),
  },
  /**
   * Utvecklingssamtal (D96 items 7 to 9): the two composites of Clew's core connector and the built-in module's writes.
   * A person without a talks system has the reads refused; `queries.ts` turns that refusal into `null`. The writes are
   * only offered when a read said `writable`.
   */
  talks: {
    /** `clew.talks`: the open round and one row per person on the reader's units. */
    round: () => read<TalksResult>('clew.talks', {}),
    /** `clew.commitments`: without `person` the reader's own and those about the reader; with it one employee's (their user name, else their id). */
    commitments: (person?: string) =>
      read<CommitmentsResult>('clew.commitments', (person ? { person } : {}) satisfies CommitmentsInput),
    /** Marks the person's talk held, today in Swedish time unless `heldOn` says another day. */
    markHeld: (personId: string, body: TalkHeldBody = {}) =>
      post<{ id: string; heldOn: string }>(`${talkPath(personId)}/held`, body),
    /** Undoes a held mark. */
    unmarkHeld: (personId: string) => del<void>(`${talkPath(personId)}/held`),
    /** Adds an action point in the person's talk, for the employee or the manager. */
    addCommitment: (personId: string, body: CommitmentAddBody) =>
      post<{ id: string }>(`${talkPath(personId)}/commitments`, body),
    /** Marks an action point done (its owner only). */
    complete: (id: string) => post<void>(`${commitmentPath(id)}/done`),
    /** Opens a done action point again. */
    reopen: (id: string) => del<void>(`${commitmentPath(id)}/done`),
  },
  /**
   * The follow-up dialogue (D118): one unit's dialogue and its writes, Clew's own routes. Refused while the module is
   * switched off for the person, and for a unit they do not follow up.
   */
  dialogue: {
    unit: (unitId: string) => call<DialogueUnit>(dialogueUnitPath(unitId)),
    assess: (unitId: string, body: DialogueAssessBody) =>
      post<{ id: string }>(`${dialogueUnitPath(unitId)}/assessments`, body),
    addActivity: (unitId: string, body: DialogueActivityAddBody) =>
      post<{ id: string }>(`${dialogueUnitPath(unitId)}/activities`, body),
    editActivity: (id: string, body: DialogueActivityEditBody) => patch<void>(dialogueActivityPath(id), body),
    complete: (id: string, body: DialogueActivityDoneBody = {}) => post<void>(`${dialogueActivityPath(id)}/done`, body),
    reopen: (id: string) => del<void>(`${dialogueActivityPath(id)}/done`),
    remove: (id: string) => del<void>(dialogueActivityPath(id)),
    /** The reader's own notes on an area (D120): written, changed and removed by their author only. */
    addNote: (unitId: string, body: DialogueNoteAddBody) =>
      post<{ id: string }>(`${dialogueUnitPath(unitId)}/notes`, body),
    editNote: (id: string, body: DialogueNoteEditBody) => patch<void>(dialogueNotePath(id), body),
    removeNote: (id: string) => del<void>(dialogueNotePath(id)),
  },
  /**
   * Kompetens (D108): the built-in module's own routes. They are refused while the module is switched off for the
   * person, and the catalogue is refused to someone who neither manages anyone nor administers it (a person reads the
   * types of their own registration from `ownTypes`); `queries.ts` turns that refusal into `null`.
   */
  competence: {
    /** The competence types a certificate can be registered for. */
    types: () => call<CompetenceTypesOutput>('/api/competence/types'),
    /** An administrator of the catalogue adds a type. */
    addType: (body: CompetenceTypeBody) => post<{ id: string }>('/api/competence/types', body),
    /** Changes a type: what the body does not name is kept; `validityMonths: null` removes the employer's rule. */
    updateType: (id: string, body: CompetenceTypePatch) =>
      patch<void>(`/api/competence/types/${encodeURIComponent(id)}`, body),
    /** Archives a type: it takes no new holdings and keeps the ones it has. */
    archiveType: (id: string) => post<void>(`/api/competence/types/${encodeURIComponent(id)}/archive`),
    /** Brings an archived type back; a merged one is refused, since a merge is not undone. */
    restoreType: (id: string) => post<void>(`/api/competence/types/${encodeURIComponent(id)}/restore`),
    /** What merging the type into another would move, in counts; nothing is written. */
    mergePreview: (id: string, into: string) =>
      call<CompetenceMergePreview>(
        `/api/competence/types/${encodeURIComponent(id)}/merge?into=${encodeURIComponent(into)}`,
      ),
    /** Merges the type into another: its holdings, requirements and mappings move, and it is archived as merged. */
    mergeTypes: (id: string, into: string) =>
      post<CompetenceMergePreview>(`/api/competence/types/${encodeURIComponent(id)}/merge`, { into }),
    /** Imports chosen rows of a file (D120 item 7), a part at a time: what the catalogue holds already is skipped. */
    importTypes: (body: CompetenceImportBody) => post<CompetenceImportOutcome>('/api/competence/types/import', body),
    /** What a new validity would do to the holdings counted from the type's rule, before it is saved. */
    validityImpact: (id: string, months: number | null) =>
      call<CompetenceValidityImpact>(
        `/api/competence/types/${encodeURIComponent(id)}/validity?months=${months === null ? 'none' : months}`,
      ),
    /** A manager registers a certificate for a person who reports to them. */
    register: (personId: string, body: CompetenceHoldingBody) =>
      post<{ id: string }>(`/api/competence/people/${encodeURIComponent(personId)}/holdings`, body),
    /** The manager a person reports to takes back a holding registered in Clew; a copied one is refused. */
    revokeHolding: (id: string) => del<void>(`/api/competence/holdings/${encodeURIComponent(id)}`),
    /** The reader's own registration (D108 item 7): whether anyone would decide it, and the ones that wait. */
    own: () => call<CompetenceOwnOutput>('/api/competence/own'),
    /** The types a person may register one of their own for: the catalogue's, archived ones left out. */
    ownTypes: () => call<CompetenceTypesOutput>('/api/competence/own/types'),
    /** The reader registers a holding of their own, for the manager they report to to approve. */
    registerOwn: (body: CompetenceHoldingBody) => post<{ id: string }>('/api/competence/own/holdings', body),
    /** The reader takes back their own registration while it waits. */
    withdrawOwn: (id: string) => del<void>(`/api/competence/own/holdings/${encodeURIComponent(id)}`),
    /** The reader removes their own registration that their manager rejected. */
    removeRejected: (id: string) => del<void>(`/api/competence/own/rejected/${encodeURIComponent(id)}`),
    /** The reader adds a skill of their own (D120): stored at once as their own rating; one they hold is refused. */
    rateOwnSkill: (body: CompetenceSkillRatingBody) => post<{ id: string }>('/api/competence/own/skills', body),
    /** The reader changes a skill of their own: its level and the interest mark. */
    changeOwnSkill: (id: string, body: CompetenceSkillChangeBody) =>
      put<void>(`/api/competence/own/skills/${encodeURIComponent(id)}`, body),
    /** The reader removes a skill of their own. */
    removeOwnSkill: (id: string) => del<void>(`/api/competence/own/skills/${encodeURIComponent(id)}`),
    /** A manager registers a skill for a person who reports to them, confirmed at once. */
    registerSkill: (personId: string, body: CompetenceSkillBody) =>
      post<{ id: string }>(`/api/competence/people/${encodeURIComponent(personId)}/skills`, body),
    /** A report's skill as the manager confirms it. */
    skill: (id: string) => call<CompetenceSkillValidation>(`/api/competence/skills/${encodeURIComponent(id)}`),
    /** The manager confirms the skill's level, or sets another. */
    validateSkill: (id: string, body: CompetenceValidationBody) =>
      post<void>(`/api/competence/skills/${encodeURIComponent(id)}/validation`, body),
    /** A registration of a report's own that waits for the reader's decision. */
    approval: (id: string) => call<CompetenceApproval>(`/api/competence/approvals/${encodeURIComponent(id)}`),
    /** The reader approves or rejects it. */
    decide: (id: string, decision: CompetenceDecision) =>
      post<void>(`/api/competence/approvals/${encodeURIComponent(id)}`, { decision }),
    /** The manager's matrix (D108 item 11): their reports against what is required of them, the set of columns `by`. */
    matrix: (input: CompetenceMatrixInput) =>
      call<CompetenceMatrixOutput>(`/api/competence/matrix${matrixQuery(input)}`),
    /**
     * Kompetenssökning (D121): what the page narrows by, refused to anyone without the relation; the types whose name or
     * area holds the words typed; one page of the people who hold a type; and the whole result as a file. What is
     * searched for travels in the body, never in an address, and every read is logged on the server.
     */
    searchOptions: () => call<CompetenceSearchOptions>('/api/competence/search'),
    findTypes: (body: CompetenceTypeSearchBody) =>
      post<CompetenceTypeSearchOutput>('/api/competence/search/types', body),
    search: (body: CompetenceSearchBody) => post<CompetenceSearchPage>('/api/competence/search', body),
    searchFile: (body: CompetenceSearchFileBody) => file('/api/competence/search.csv', body),
    /** The systems whose holdings are copied in (D108 item 9): each one's last read and its types with their mappings. */
    sources: () => call<CompetenceSourcesOutput>('/api/competence/sources'),
    /** Maps a type of a source to a catalogue type, or removes the mapping with `typeId: null`. */
    mapSourceType: (connectorId: string, body: CompetenceMappingBody) =>
      put<{ holdings: number }>(`/api/competence/sources/${encodeURIComponent(connectorId)}/mapping`, body),
    /** "Läs in nu": a read of one source, started at once. */
    readSource: (connectorId: string) => post<void>(`/api/competence/sources/${encodeURIComponent(connectorId)}/read`),
    /** The requirements on positions and units (D108 item 6), and the positions and units they can be set on. */
    requirements: () => call<CompetenceRequirementsOutput>('/api/competence/requirements'),
    /** Adds a requirement on one position, one unit or, for a manager, one of their reports. */
    addRequirement: (body: CompetenceRequirementBody) => post<{ id: string }>('/api/competence/requirements', body),
    /** Removes a requirement. */
    removeRequirement: (id: string) => del<void>(`/api/competence/requirements/${encodeURIComponent(id)}`),
    /** The share targets: a least share of a position's holders, on a unit's branch or the whole organisation. */
    shareTargets: () => call<CompetenceShareTargetsOutput>('/api/competence/share-targets'),
    /** Adds a share target. */
    addShareTarget: (body: CompetenceShareTargetBody) => post<{ id: string }>('/api/competence/share-targets', body),
    /** Removes a share target. */
    removeShareTarget: (id: string) => del<void>(`/api/competence/share-targets/${encodeURIComponent(id)}`),
  },
  /**
   * Introduktion och avslut (D124): the built-in module's own routes. Every one is refused (403) while the module is
   * switched off for the person; a refusal of what is asked is a 400 with a Swedish sentence to show as it is. The use
   * cases decide who may do what: a manager starts, adds and closes; an item's owner or the manager ticks it.
   */
  boarding: {
    /**
     * The open plans of the reader's reports and those the reader holds for someone since deactivated, the reader's own
     * open plans apart from them, and whether the reader manages a unit (D124 item 12).
     */
    plans: () => call<BoardingPlansOutput>('/api/boarding/plans'),
    /** The reports whose employment starts soon with no introduction. */
    suggestions: () => call<BoardingSuggestionsOutput>('/api/boarding/suggestions'),
    /** One person's plans, whether the reader may start one, the buddies to choose from and a suggested first day. */
    person: (personId: string) => call<BoardingPersonOutput>(`/api/boarding/people/${encodeURIComponent(personId)}`),
    /** One plan with its items, by phase; an owner who is neither manager nor person is given their own items. */
    plan: (id: string) => call<BoardingPlanOutput>(`/api/boarding/plans/${encodeURIComponent(id)}`),
    /** What starting the plan would make; writes nothing. */
    preview: (body: BoardingStartBody) => post<BoardingPreview>('/api/boarding/preview', body),
    /** The manager starts the plan; its items become work items in their owners' Att göra. */
    start: (body: BoardingStartBody) => post<{ id: string }>('/api/boarding/plans', body),
    /** The manager adds an item to one plan. */
    addItem: (planId: string, body: BoardingItemAddBody) =>
      post<{ id: string }>(`/api/boarding/plans/${encodeURIComponent(planId)}/items`, body),
    /** The manager closes the plan: every open item's card closes with it. */
    close: (planId: string) => post<void>(`/api/boarding/plans/${encodeURIComponent(planId)}/close`),
    /** An item ticked off by its owner or the manager; its card closes. */
    done: (itemId: string) => post<void>(`/api/boarding/items/${encodeURIComponent(itemId)}/done`),
    /** An item opened again; its card opens again. */
    notDone: (itemId: string) => del<void>(`/api/boarding/items/${encodeURIComponent(itemId)}/done`),
    /** An administrator with `admin.boarding` reads the organisation's layers. */
    layers: () => call<BoardingLayersOutput>('/api/boarding/layers'),
    /** An administrator imports a whole file of layers, as the page read it. */
    importLayers: (body: BoardingImportBody) => post<BoardingImportOutcome>('/api/boarding/layers/import', body),
  },
  /** The manifest field by field (D60): a public document, read with the plain fetch since no session or token belongs on it. */
  manifestReference: async () => {
    const response = await fetch('/api/protocol/manifest-reference.json');
    if (!response.ok) throw new ApiError(response.status, 'The reference could not be read.');
    return response.json() as Promise<ManifestReference>;
  },
  threads: () =>
    call<{
      threads: Thread[];
      sources?: Array<{ connector: string; state: string; lastSuccess: string | null; error: string | null }>;
      deliveries?: Array<{ id: string; threadId: string; kind: 'automatic' | 'reminder' }>;
    }>('/api/threads'),
  claimDelivery: (id: string) => post<{ claimed: boolean }>(`/api/deliveries/${encodeURIComponent(id)}/claim`, {}),
  ask: (question: string) => post<Thread>('/api/ask', { question }),
  reply: (id: string, body: string) => post<Thread>(`/api/threads/${id}/reply`, { body }),
  confirm: (id: string, proposalIds: string[]) => post<Thread>(`/api/threads/${id}/confirm`, { proposalIds }),
  undo: (id: string) => post<Thread>(`/api/threads/${id}/undo`),
  replan: (id: string, week: string) => post<Thread>(`/api/threads/${id}/replan`, { week }),
  dismiss: (id: string) => post<Thread>(`/api/threads/${id}/dismiss`),
  thread: (id: string) => call<Thread>(`/api/threads/${id}`),
  /** A work item's Händelser (D112 item 4), from its audit rows. */
  itemEvents: (id: string) => call<ItemEvents>(`/api/threads/${id}/events`),
  converse: (input: ConversationInput) => post<ConversationResponse>('/api/conversation', input),
  converseStream,
  objects: (q: string, near: string[] = []) =>
    call<{ objects: ClewObject[] }>(
      '/api/objects?q=' + encodeURIComponent(q) + (near.length ? '&near=' + encodeURIComponent(near.join(',')) : ''),
    ),
  verbs: (id: string) => call<{ verbs: Verb[] }>(`/api/threads/${id}/verbs`),
  reopen: (id: string) => post<Thread>(`/api/threads/${id}/reopen`),
  assistantStatus: () => call<AssistantStatus>('/api/assistant/status'),
  /** The assistants of other systems the person may hand a conversation to; empty when no source has any for them. */
  handoverAssistants: () => call<{ assistants: HandoverAssistant[] }>('/api/assistant/handover'),
  /** The person's own model in the composer (D24); null goes back to the default. */
  chooseModel: (modelId: string | null) => patch<AssistantStatus>('/api/assistant/model', { modelId }),
  today: () => call<TodayView>('/api/today'),
  attention: () => call<Attention>('/api/attention'),
  areas: () => call<{ areas: Area[]; menu?: MenuEntry[]; systems?: SystemMark[]; views?: ViewEntry[] }>('/api/areas'),
  connectors: () => call<{ connectors: unknown[]; tools: string[] }>('/api/connectors'),
  /** The human decision on a work item's action (D45/D47), with the person's answers to its asks (D112) in `values`. */
  act: (id: string, actionId: string, refs?: string[], reviews?: ReviewEvidence[], values?: AskValues) =>
    post<{ kind: 'execute'; thread: Thread } | { kind: 'read' | 'propose'; output: unknown; view?: PanelViewSpec }>(
      `/api/threads/${id}/act`,
      { actionId, refs, reviews, ...(values ? { values } : {}) },
    ),
  /** "Det här händer" (D112): what the action would write with these rows and answers, from its effect read. Writes nothing. */
  effect: (id: string, actionId: string, refs?: string[], values?: AskValues) =>
    post<EffectPreview>(`/api/threads/${id}/effect`, { actionId, refs, ...(values ? { values } : {}) }),
  /**
   * Free times for an action's meeting ask (D112) from the person's own calendar, before `before` (a work item's
   * deadline), and the person's own `date` when the dialog draws a day. Empty slots and no day without a calendar.
   */
  meetingTimes: (capability: string, property: string, options: { date?: string; before?: string } = {}) =>
    call<MeetingTimes>(
      `/api/asks/times?${new URLSearchParams({
        capability,
        property,
        ...(options.date ? { date: options.date } : {}),
        ...(options.before ? { before: options.before } : {}),
      })}`,
    ),
  undoReceipt: (id: string) => post<Thread>(`/api/threads/${id}/undo-receipt`),
  retryRejected: (id: string) => post<Thread>(`/api/threads/${id}/retry`),
  /** One item's document for the review flow (D70). */
  preview: (id: string, ref: string) =>
    call<ReviewPreview>(`/api/threads/${id}/preview?ref=${encodeURIComponent(ref)}`),
  documentHref: (request: DocumentRequest) =>
    '/api/documents/content?request=' + encodeURIComponent(JSON.stringify(request)),
  document: async (request: DocumentRequest, signal: AbortSignal) => {
    const response = await sessionFetch(
      '/api/documents/content?request=' + encodeURIComponent(JSON.stringify(request)),
      { signal },
    );
    if (!response.ok) {
      let message = 'Dokumentet kunde inte hämtas.';
      try {
        message = (await response.json()).error ?? message;
      } catch {
        /* no JSON */
      }
      throw new ApiError(response.status, message);
    }
    return response.arrayBuffer();
  },
  checkExecution: (id: string) => post<Thread>(`/api/threads/${id}/execution/check`),
  approveCorrection: (input: { decisionId: string; operation: string; payload: unknown }) =>
    post<CorrectionExecution>('/api/executions', input),
  correctionExecution: (id: string) => call<CorrectionExecution>(`/api/executions/${encodeURIComponent(id)}`),
  checkCorrection: (id: string) => post<CorrectionExecution>(`/api/executions/${encodeURIComponent(id)}/reconcile`),
  snooze: (id: string, input: SnoozeInput = {}) => post<Thread>(`/api/threads/${id}/snooze`, input),
  snoozePresets: () => call<{ presets: SnoozePreset[] }>('/api/snooze/presets'),
  remindInvitees: (id: string) => post<Thread>(`/api/threads/${id}/remind-invitees`),
  remind: (id: string, seconds: number) =>
    post<{ id: string; fireAt: string; thread: Thread }>(`/api/threads/${id}/remind`, { seconds }),
  cancelReminder: (id: string, workflowId: string) => post<Thread>(`/api/threads/${id}/remind/cancel`, { workflowId }),
  capability: (name: string, input?: unknown) =>
    call<{ output: unknown; source?: string; view?: PanelViewSpec }>(
      `/api/cap/${name}` + (input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''),
    ),
  runCapability: (name: string, input?: unknown) => post<{ output: unknown }>(`/api/cap/${name}`, input ?? {}),
  // Administration (D23). Every call is checked again on the server; no secret ever comes back.
  /** The shared header (D88): what the person's header connector lists for them, else Clew's default. */
  header: () => call<SiteHeaderView>('/api/header'),
  /**
   * `clew.news` (D112, amended 2026-11-11): the news from every source the person may read, newest first. Refused for a
   * person with no news source; `queries.ts` turns that refusal into `null`.
   */
  news: () => read<NewsResult>('clew.news', {}),
  admin: {
    connectors: () => call<{ connectors: ConnectorSummary[] }>('/api/admin/connectors'),
    units: () => call<{ units: Array<{ id: string; label: string }> }>('/api/admin/units'),
    groups: () => call<{ groups: Array<{ id: string; label: string }> }>('/api/admin/groups'),
    // Användare (D62, D85): the provisioned people and the group-capability rows.
    users: () => call<UsersAdminOverview>('/api/admin/users'),
    // One page of the people (D100). A read sent as a body, so a searched name is in no address.
    usersPage: (query: UsersAdminQueryType) => post<UsersAdminPage>('/api/admin/users/search', query),
    // The group picker searches every group of the organisation (D85), in a body as the people list asks; a search a
    // newer one replaced is stopped with `signal`.
    searchGroups: (text: string, signal?: AbortSignal) =>
      call<GroupSearchResult>('/api/admin/users/groups/search', {
        method: 'POST',
        body: JSON.stringify({ text }),
        ...(signal ? { signal } : {}),
      }),
    addGroupCapability: (input: GroupCapabilityInputType) =>
      post<UsersAdminOverview>('/api/admin/users/group-capabilities', input),
    removeGroupCapability: (input: GroupCapabilityInputType) =>
      post<UsersAdminOverview>('/api/admin/users/group-capabilities/remove', input),
    // D121: a group gives a relation to people by grant, mapped beside the capabilities.
    addGroupRelation: (input: GroupRelationInputType) =>
      post<UsersAdminOverview>('/api/admin/users/group-relations', input),
    removeGroupRelation: (input: GroupRelationInputType) =>
      post<UsersAdminOverview>('/api/admin/users/group-relations/remove', input),
    // The catalogues' keys (D107). The answer to issuing or rotating one carries the key, once.
    issueProvisioner: (input: ProvisionerIssueInputType) =>
      post<ProvisionerKeyIssued>('/api/admin/users/provisioners', input),
    rotateProvisioner: (id: string, input: ProvisionerRotateInputType) =>
      post<ProvisionerKeyIssued>(`/api/admin/users/provisioners/${encodeURIComponent(id)}/rotate`, input),
    revokeProvisioner: (id: string) =>
      post<UsersAdminOverview>(`/api/admin/users/provisioners/${encodeURIComponent(id)}/revoke`),
    // Organisation (D99): the organisation tree as the catalogue pushed it, and the people of one unit.
    organisation: () => call<OrganisationOverview>('/api/admin/organisation'),
    organisationUnit: (unitId: string) =>
      call<OrganisationUnitPeople>(`/api/admin/organisation/units/${encodeURIComponent(unitId)}`),
    // Utseende (D98): the installation's theme file and logo.
    appearance: () => call<AppearanceAdminView>('/api/admin/appearance'),
    setTheme: (file: unknown) =>
      call<AppearanceAdminView>('/api/admin/appearance/theme', { method: 'PUT', body: JSON.stringify({ file }) }),
    clearTheme: () => del<AppearanceAdminView>('/api/admin/appearance/theme'),
    setLogo: (input: AppearanceLogoInputType) =>
      call<AppearanceAdminView>('/api/admin/appearance/logo', { method: 'PUT', body: JSON.stringify(input) }),
    clearLogo: () => del<AppearanceAdminView>('/api/admin/appearance/logo'),
    connector: (id: string) => call<ConnectorDetail>(`/api/admin/connectors/${id}`),
    add: (input: AddConnectorInput) =>
      post<{ connector: ConnectorDetail; report: CheckReport }>('/api/admin/connectors', input),
    update: (id: string, input: ConnectorPatchInput) => patch<ConnectorDetail>(`/api/admin/connectors/${id}`, input),
    remove: (id: string) => del<{ closedCards: number }>(`/api/admin/connectors/${id}`),
    rotateSecret: (id: string, secret: string) =>
      post<ConnectorDetail>(`/api/admin/connectors/${id}/secret`, { secret }),
    test: (id: string) => post<CheckReport & { health: ConnectorHealth }>(`/api/admin/connectors/${id}/test`),
    refresh: (id: string, apply: boolean) =>
      post<{ diff: ManifestDiff; connector: ConnectorDetail }>(`/api/admin/connectors/${id}/refresh`, { apply }),
    preview: (id: string, role: Role, unitId?: string) =>
      call<ConnectorPreview>(
        `/api/admin/connectors/${id}/preview?role=${role}` + (unitId ? `&unitId=${encodeURIComponent(unitId)}` : ''),
      ),
    // Modeller (D24): providers and the models under them. A key goes in, never comes out.
    models: () => call<{ providers: ProviderSummary[]; models: ModelSummary[] }>('/api/admin/models'),
    model: (id: string) => call<ModelDetail>(`/api/admin/models/${id}`),
    addModel: (input: AddModelInput) =>
      post<{ model: ModelDetail; report: ProviderTestReport }>('/api/admin/models', input),
    updateModel: (id: string, input: ModelPatchInput) => patch<ModelDetail>(`/api/admin/models/${id}`, input),
    removeModel: (id: string) => del<{ removed: true }>(`/api/admin/models/${id}`),
    testModel: (id: string) => post<ProviderTestReport>(`/api/admin/models/${id}/test`),
    provider: (id: string) => call<ProviderDetail>(`/api/admin/providers/${id}`),
    addProvider: (input: AddProviderInput) =>
      post<{ provider: ProviderDetail; report: ProviderTestReport }>('/api/admin/providers', input),
    updateProvider: (id: string, input: ProviderPatchInput) =>
      patch<ProviderDetail>(`/api/admin/providers/${id}`, input),
    removeProvider: (id: string) => del<{ removed: true }>(`/api/admin/providers/${id}`),
    providerKey: (id: string, apiKey: string) => post<ProviderDetail>(`/api/admin/providers/${id}/key`, { apiKey }),
    testProvider: (id: string) => post<ProviderTestReport>(`/api/admin/providers/${id}/test`),
  },
  calendar: (from?: string) =>
    call<{ from: string; events: CalendarEvent[]; proposals: Proposal[] }>(
      '/api/calendar' + (from ? `?from=${from}` : ''),
    ),
  // A person's own bookings and proposal moves (D28). The day view is a read capability, so the side panel reaches it the same way as any view.
  calendarDay: (date: string) =>
    call<{ output: DayView }>(`/api/cap/calendar.day?input=${encodeURIComponent(JSON.stringify({ date }))}`).then(
      r => r.output,
    ),
  members: () => call<{ members: CalendarMember[] }>('/api/calendar/members'),
  rooms: () => call<{ rooms: CalendarRoom[] }>('/api/calendar/rooms'),
  availability: (input: AvailabilityInput) => post<AvailabilityResult>('/api/calendar/availability', input),
  createEvent: (input: CreateEventInput) => post<Thread>('/api/calendar/events', input),
  rescheduleEvent: (input: RescheduleEventInput) => post<Thread>('/api/calendar/events/reschedule', input),
  cancelEvent: (input: CancelEventInput) => post<Thread>('/api/calendar/events/cancel', input),
  moveProposal: (threadId: string, proposalId: string, input: MoveProposalInput) =>
    post<Thread>(`/api/threads/${threadId}/proposals/${proposalId}/move`, input),
};
