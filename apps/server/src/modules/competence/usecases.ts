import {
  COMPETENCE_STATUSES,
  type AuthenticatedContext,
  type Capability,
  type CompetenceAttentionOutput,
  type CompetenceHoldingBody,
  type CompetenceHoldingsInput,
  type CompetenceHoldingsOutput,
  type CompetenceMappingBody,
  type CompetenceMatrixInput,
  type CompetenceMatrixOutput,
  type CompetenceReadCounts,
  type CompetenceReadOutcome,
  type CompetenceRequirement,
  type CompetenceRequirementBody,
  type CompetenceRequirementsOutput,
  type CompetenceShareTarget,
  type CompetenceShareTargetBody,
  type CompetenceShareTargetsOutput,
  type CompetenceSource,
  type CompetenceSourcesOutput,
  type CompetenceType,
  type CompetenceTypeBody,
  type CompetenceTypePatch,
  type CompetenceValidityImpact,
  type StaffPerson,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  branchOf,
  counts,
  coverageOf,
  dailyCopyStart,
  deciding,
  endOf,
  holdingRow,
  isCalendarDay,
  leaseUntil,
  matrixCsv,
  matrixOf,
  meets,
  needsAttention,
  organisationOutcome,
  nextDailyCopy,
  normaliseArea,
  normaliseName,
  orderHoldingRows,
  orderTypes,
  COPY_HOLDINGS_MAX,
  PAGES_MAX,
  personKey,
  planCopy,
  readNowStart,
  requiredOf,
  SOURCE_ID_MAX,
  SOURCE_KEY_MAX,
  safeText,
  sourceReadError,
  statusOn,
  summarise,
  swedishDay,
  typeRow,
  UNAVAILABLE_PAUSES_MS,
  uncounted,
  uncountedRow,
  usableHolding,
  type PersonSummary,
  type ReadHolding,
  type Standing,
  type UnitCoverage,
} from './domain';
import {
  RequirementTaken,
  ShareTargetTaken,
  TypeNameTaken,
  type CompetenceDeps,
  type CompetenceExport,
  type CompetenceTx,
  type HoldingRecord,
  type HoldingsSourceRef,
  type PersonRef,
  type RequirementRecord,
  type ShareTargetRecord,
  type SourceHoldingsPage,
  type SourceHoldingsRow,
  type SourceReadCounts,
  type SourceRecord,
  type TypeRecord,
} from './model';

/** A request the competence module turns down for what it asks, not who asks (D108); a 400 with this message. */
export class CompetenceError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'CompetenceError';
  }
}
/** Erasure was asked for a person who is still active (D108 item 14); an operator's error, so in English. */
export class PersonStillActive extends Error {
  constructor() {
    super(
      'The person is still active. Erasure is for a person the directory has deactivated (D108 item 14): an active person would get their copied holdings back at the next read of the source.',
    );
    this.name = 'PersonStillActive';
  }
}
/** The grant capability behind the catalogue (D108 item 8). */
export const COMPETENCE_ADMIN: Capability = 'admin.competence';
/**
 * The version of the export document (D108 item 14); a breaking change is a new version. Version 2 (item 9): a holding
 * may have no type (a copied row whose source type is not mapped) and carries `copy`, and the document lists the
 * mappings of sources. Version 3 (item 6): the document lists the requirements and the share targets. Version 4: a
 * requirement and a share target name a position by its code (`positionCode`) and a unit by the id of its `unit:` key,
 * never by an internal row, and `createdBy` may be null (its author was erased).
 */
export const COMPETENCE_EXPORT_FORMAT = 'clew.competence/4';
/** The actor of the scheduled copy (D108 item 9) in its audit rows. */
export const COPY_ACTOR = 'system:competence-copy';
const NOT_A_MANAGER = 'Intyg registreras av den som är chef för en enhet.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_TYPE = 'Kompetensen finns inte i katalogen.';
const ARCHIVED = 'Kompetensen är arkiverad och kan inte registreras.';
const BAD_DAY = 'Ange ett giltigt datum.';
const NAME_TAKEN = 'Det finns redan en kompetens med det namnet.';
const BAD_NAME = 'Ange ett namn på högst 120 tecken.';
const BAD_AREA = 'Ange ett område på högst 80 tecken.';
const NOT_ALLOWED = 'Du kan inte ändra det här intyget.';
const NO_SOURCE = 'Källan finns inte bland de system som svarar om intyg.';
const NOT_ANSWERING = 'Källan svarar inte om intyg just nu.';
const READING = 'Källan läses in just nu.';
const ARCHIVED_MAPPING = 'Kompetensen är arkiverad och kan inte kopplas.';
const BAD_SOURCE_TYPE = 'Ogiltig typ i källan.';
const ONE_TARGET = 'Ett krav gäller en befattning, en enhet eller en person.';
const NOT_THEIR_MANAGER = 'Krav på en enskild person sätts av den som är personens chef.';
const ARCHIVED_REQUIREMENT = 'Kompetensen är arkiverad och kan inte krävas.';
const NO_POSITION = 'Befattningen finns inte.';
const NO_UNIT = 'Enheten finns inte.';
const REQUIREMENT_TAKEN = 'Det kravet finns redan.';
const NOT_YOUR_REQUIREMENT = 'Du kan inte ta bort det här kravet.';
const BAD_SHARE = 'Ange en andel mellan 1 och 100 procent.';
const TARGET_TAKEN = 'Det finns redan ett andelsmål för den kompetensen och befattningen där.';
const NO_TARGET = 'Andelsmålet finns inte.';
const NOT_YOUR_UNIT = 'Enheten finns inte bland dem du är chef för.';
const NOT_A_MANAGER_MATRIX = 'Medarbetarnas kompetens visas för den som är chef för en enhet.';
/**
 * A unit's coverage (D108 items 6 and 8) as the read about a unit and its table answer it: counts only, each share
 * target set on the unit with its position's label.
 */
export interface UnitCoverageResult extends Omit<UnitCoverage, 'targets'> {
  unitId: string;
  unitLabel: string;
  targets: Array<UnitCoverage['targets'][number] & { positionLabel: string }>;
}
/** The keys a requirement's audit row carries: ids and a position's code, never a name. */
const requirementDetails = (r: RequirementRecord) => ({
  organisationId: r.organisationId,
  typeId: r.typeId,
  positionCode: r.positionCode,
  unitId: r.unitId,
  personId: r.personId,
});
const targetDetails = (t: ShareTargetRecord) => ({
  organisationId: t.organisationId,
  typeId: t.typeId,
  positionCode: t.positionCode,
  unitId: t.unitId,
  minShare: t.minShare,
});
/** Standings in the order a person's cards are listed: by status (expired, missing, expiring), the soonest end first. */
const byUrgency = (a: Standing, b: Standing) =>
  COMPETENCE_STATUSES.indexOf(a.status) - COMPETENCE_STATUSES.indexOf(b.status) ||
  (a.end ?? '').localeCompare(b.end ?? '') ||
  a.type.name.localeCompare(b.type.name, 'sv') ||
  a.type.id.localeCompare(b.type.id) ||
  (a.holding?.id ?? '').localeCompare(b.holding?.id ?? '');
/**
 * What one read of a source came to: `busy` when another run held the source (or it was removed) and nothing was read
 * or written, `off` when the module was switched off before it began. The counts are the whole read's.
 */
export interface CopyResult {
  connectorId: string;
  outcome: CompetenceReadOutcome | 'busy' | 'off';
  counts?: CompetenceReadCounts;
  unmatched?: number;
}

/**
 * The competence module's use cases (D108): the catalogue, a manager's registration of a certificate, the copy of what
 * sources hold and the mapping of their types (item 9), requirements and share targets (item 6), and the reads that work
 * out where every holding stands today, what a person lacks and how a unit's branch is covered.
 * A manager's reach is their reports, computed when asked (`deps.staff`, D99 item 4) and never stored, so a former
 * manager reads and writes nothing the day the line changes. Every change is one `deps.store` transaction with its
 * audit row. Audit rows carry ids, dates, counts and kinds: never a person's name, a type's name, a source's key or
 * its label.
 */
export function competenceUsecases(deps: CompetenceDeps) {
  const now = () => deps.clock();
  const admin = async (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(COMPETENCE_ADMIN)) throw new ForbiddenError();
    await persona.authorize();
  };
  /**
   * The people who report to the persona now (`deps.staff`: D99's direct reports, D117's `managed`, never a co-manager
   * or the reader's own manager whom Personal also lists), each once, themselves and deactivated people left out.
   */
  async function reports(persona: AuthenticatedContext) {
    const staff = await deps.staff(persona);
    const people = new Map<string, StaffPerson>();
    for (const unit of staff.units)
      for (const p of unit.people)
        if (p.id !== persona.id && p.enabled !== false && !people.has(p.id)) people.set(p.id, p);
    return { manages: staff.units.length > 0, people, units: staff.units };
  }
  async function reportOf(persona: AuthenticatedContext, personId: string, notAManager = NOT_A_MANAGER) {
    const { manages, people } = await reports(persona);
    if (!manages) throw new ForbiddenError(notAManager);
    const person = people.get(personId);
    if (!person) throw new ForbiddenError(NOT_YOURS);
    return person;
  }
  /**
   * The types required of each of these people (D108 item 6): by the positions they hold, the units they are assigned
   * to and the requirements set on them alone, in their organisation.
   */
  async function requiredFor(
    tx: CompetenceTx,
    organisationId: string,
    personIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (!personIds.length) return new Map();
    const requirements = await tx.requirements(organisationId);
    if (!requirements.length) return new Map();
    const placed = new Map((await tx.placesOf(organisationId, personIds)).map(p => [p.personId, p]));
    return new Map(
      personIds.map(id => [
        id,
        requiredOf(placed.get(id) ?? { personId: id, unitIds: [], positionCodes: [] }, requirements),
      ]),
    );
  }
  /**
   * Where these people stand today: one standing per person and type held, mapped copied rows counted exactly like
   * registered ones (D108 items 4 and 9), and one `missing` standing per type required of them that they hold nothing of
   * that counts (item 6). `waiting` are the copied rows whose type is not mapped.
   */
  async function standingsWith(
    tx: CompetenceTx,
    organisationId: string,
    personIds: readonly string[],
    today: string,
  ): Promise<{ standings: Standing[]; waiting: HoldingRecord[] }> {
    const holdings = await tx.holdingsOf(personIds);
    const required = await requiredFor(tx, organisationId, personIds);
    const typeIds = [
      ...new Set([...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])), ...[...required.values()].flat()]),
    ];
    const types = new Map((await tx.typesById(typeIds)).map(t => [t.id, t]));
    return { standings: deciding(holdings, types, today, required), waiting: holdings.filter(uncounted) };
  }
  const standings = async (tx: CompetenceTx, organisationId: string, personIds: readonly string[], today: string) =>
    (await standingsWith(tx, organisationId, personIds, today)).standings;
  /**
   * How a unit's branch is covered today (D108 items 6 and 8, D99 item 5), for its manager: the active people assigned
   * to the unit or a unit below it, against the requirements that apply to each of them, and the share targets set on
   * this unit, each measured over this branch once. `reports` are the reader's own reports, whom they know; the rest of
   * the branch is counted only where it is large enough (`coverageOf`). Counts only.
   */
  async function coverageIn(
    tx: CompetenceTx,
    persona: AuthenticatedContext,
    reports: ReadonlySet<string>,
    unitId: string,
    today: string,
  ): Promise<Omit<UnitCoverageResult, 'unitId' | 'unitLabel'>> {
    const organisationId = persona.organisationId;
    const personIds = await tx.placedOn(organisationId, branchOf(await tx.units(organisationId), unitId));
    const people = await tx.placesOf(organisationId, personIds);
    const requirements = await tx.requirements(organisationId);
    const targets = (await tx.shareTargets(organisationId)).filter(t => t.unitId === unitId);
    const holdings = await tx.holdingsOf(personIds);
    const typeIds = new Set([
      ...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])),
      ...requirements.map(r => r.typeId),
      ...targets.map(t => t.typeId),
    ]);
    const types = new Map((await tx.typesById([...typeIds])).map(t => [t.id, t]));
    const covered = coverageOf({
      people,
      reader: persona.id,
      reports,
      requirements,
      targets,
      types,
      standings: deciding(holdings, types, today),
    });
    if (!covered.targets.length) return { ...covered, targets: [] };
    const positionLabel = new Map((await tx.positions(organisationId)).map(p => [p.code, p.label]));
    return {
      ...covered,
      targets: covered.targets.map(t => ({
        ...t,
        positionLabel: positionLabel.get(t.target.positionCode) ?? t.target.positionCode,
      })),
    };
  }
  /**
   * The manager's matrix today (D108 item 11): these people, the manager's reports, against what is required of them in
   * their organisation, with the set of columns `input` names. Read in the transaction it is given.
   */
  async function matrixIn(
    tx: CompetenceTx,
    organisationId: string,
    people: readonly StaffPerson[],
    today: string,
    input: CompetenceMatrixInput,
  ): Promise<CompetenceMatrixOutput> {
    const personIds = people.map(p => p.id);
    const placed = await tx.placesOf(organisationId, personIds);
    const requirements = await tx.requirements(organisationId);
    const holdings = await tx.holdingsOf(personIds);
    const typeIds = new Set([
      ...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])),
      ...requirements.map(r => r.typeId),
    ]);
    const types = new Map((await tx.typesById([...typeIds])).map(t => [t.id, t]));
    return matrixOf({
      people: people.map(p => ({ id: p.id, name: p.name, userName: p.userName })),
      placed,
      requirements,
      types,
      holdings,
      positions: await tx.positions(organisationId),
      units: await tx.units(organisationId),
      today,
      by: input.by,
      part: input.part,
    });
  }
  /**
   * Whether a position (by code) or a unit (by id) is one the organisation has now: a position the provisioner pushed, a
   * node of the tree as pushed, a unit nobody is placed on included.
   */
  const positionExists = async (tx: CompetenceTx, organisationId: string, code: string) =>
    (await tx.positions(organisationId)).some(p => p.code === code);
  const unitExists = async (tx: CompetenceTx, organisationId: string, unitId: string) =>
    (await tx.units(organisationId)).some(u => u.id === unitId);
  /**
   * Add a requirement as `actor` (D108 item 6). The type must be the organisation's and not archived, the position's code
   * one the organisation has and the unit one of its tree; who may set it on what is the caller's to check.
   */
  async function insertRequirement(
    actor: string,
    organisationId: string,
    body: CompetenceRequirementBody,
  ): Promise<string> {
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_REQUIREMENT);
        if (body.positionCode !== undefined && !(await positionExists(tx, organisationId, body.positionCode)))
          throw new CompetenceError(NO_POSITION);
        if (body.unitId !== undefined && !(await unitExists(tx, organisationId, body.unitId)))
          throw new CompetenceError(NO_UNIT);
        const record: RequirementRecord = {
          id,
          organisationId,
          typeId: type.id,
          positionCode: body.positionCode ?? null,
          unitId: body.unitId ?? null,
          personId: body.personId ?? null,
          minLevel: null,
          createdBy: actor,
          createdAt: at,
        };
        await tx.insertRequirement(record);
        await tx.audit({
          actor,
          action: 'competence.requirement_added',
          subject: 'competence-requirement:' + id,
          at,
          details: requirementDetails(record),
        });
        return id;
      });
    } catch (error) {
      if (error instanceof RequirementTaken) throw new CompetenceError(REQUIREMENT_TAKEN);
      throw error;
    }
  }
  /** Add a share target as `actor` (D108 item 6): the type, the position (by code) and the unit, if any, the organisation's. */
  async function insertShareTarget(
    actor: string,
    organisationId: string,
    body: CompetenceShareTargetBody,
  ): Promise<string> {
    if (!Number.isInteger(body.minShare) || body.minShare < 1 || body.minShare > 100)
      throw new CompetenceError(BAD_SHARE);
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_REQUIREMENT);
        if (!(await positionExists(tx, organisationId, body.positionCode))) throw new CompetenceError(NO_POSITION);
        if (body.unitId !== undefined && !(await unitExists(tx, organisationId, body.unitId)))
          throw new CompetenceError(NO_UNIT);
        const record: ShareTargetRecord = {
          id,
          organisationId,
          typeId: type.id,
          positionCode: body.positionCode,
          unitId: body.unitId ?? null,
          minShare: body.minShare,
          createdBy: actor,
          createdAt: at,
        };
        await tx.insertShareTarget(record);
        await tx.audit({
          actor,
          action: 'competence.share_target_added',
          subject: 'competence-share-target:' + id,
          at,
          details: targetDetails(record),
        });
        return id;
      });
    } catch (error) {
      if (error instanceof ShareTargetTaken) throw new CompetenceError(TARGET_TAKEN);
      throw error;
    }
  }
  /** The name of each source a copied row came from, as it was when last read. */
  const sourceNames = async (tx: CompetenceTx) => new Map((await tx.sources()).map(s => [s.connectorId, s.source]));
  /** The sources that answer the holdings profile now; none while the module is switched off for the installation. */
  async function answering(only?: string | null): Promise<HoldingsSourceRef[]> {
    const port = deps.holdings;
    if (!port || !(await port.switchedOn())) return [];
    const all = await port.holdingsSources();
    return only ? all.filter(s => s.connectorId === only) : all;
  }
  /** Whether an organisation has anyone a source's rows may be kept for (D23); with no port, no source reaches anyone. */
  const reaches = async (connectorId: string, organisationId: string) =>
    !!deps.holdings && (await deps.holdings.reaches(connectorId, organisationId));
  /** A source's record before its first read. */
  const blankSource = (connectorId: string, source: string): SourceRecord => ({
    connectorId,
    source,
    run: null,
    claimedAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    counts: null,
  });
  const leased = (s: SourceRecord | undefined, at: string) => !!s?.run && !!s.leaseUntil && s.leaseUntil > at;
  function typeFields(body: CompetenceTypePatch) {
    const patch: { name?: string; area?: string } = {};
    if (body.name !== undefined) {
      const name = normaliseName(body.name);
      if (!name) throw new CompetenceError(BAD_NAME);
      patch.name = name;
    }
    if (body.area !== undefined) {
      const area = normaliseArea(body.area);
      if (!area) throw new CompetenceError(BAD_AREA);
      patch.area = area;
    }
    return patch;
  }
  /** Add a type as `actor`; the administrator's and the operator's path share it. */
  async function insertType(actor: string, organisationId: string, body: CompetenceTypeBody): Promise<string> {
    const { name, area } = typeFields(body);
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        await tx.insertType({
          id,
          organisationId,
          name: name!,
          area: area!,
          kind: body.kind,
          validityMonths: body.validityMonths ?? null,
          archivedAt: null,
          createdBy: actor,
          createdAt: at,
        });
        await tx.audit({
          actor,
          action: 'competence.type_added',
          subject: 'competence-type:' + id,
          at,
          details: { organisationId, kind: body.kind, validityMonths: body.validityMonths ?? null },
        });
        return id;
      });
    } catch (error) {
      if (error instanceof TypeNameTaken) throw new CompetenceError(NAME_TAKEN);
      throw error;
    }
  }
  /** Register a holding for `personId` as `actor`; the manager's and the operator's path share the checks on the type and the dates. */
  async function insertHolding(
    actor: string,
    registeredBy: string | null,
    organisationId: string,
    personId: string,
    body: CompetenceHoldingBody,
  ): Promise<string> {
    const at = now(),
      iso = at.toISOString(),
      today = swedishDay(at);
    if (!isCalendarDay(body.issuedOn)) throw new CompetenceError(BAD_DAY);
    if (body.issuedOn > today)
      throw new CompetenceError('Ett intyg kan inte vara utfärdat en dag som inte har kommit.');
    if (body.expiresOn !== undefined) {
      if (!isCalendarDay(body.expiresOn)) throw new CompetenceError(BAD_DAY);
      if (body.expiresOn < body.issuedOn) throw new CompetenceError('Slutdatumet kan inte vara före utfärdandet.');
    }
    const id = deps.ids();
    return deps.store.transaction(async tx => {
      const type = await tx.type(body.typeId);
      if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
      if (type.archivedAt) throw new CompetenceError(ARCHIVED);
      await tx.insertHolding({
        id,
        personId,
        typeId: type.id,
        issuedOn: body.issuedOn,
        expiresOn: body.expiresOn ?? null,
        evidence: 'manager',
        state: 'valid',
        registeredBy,
        createdAt: iso,
        revokedAt: null,
        revokedBy: null,
        copy: null,
      });
      await tx.audit({
        actor,
        action: 'competence.holding_registered',
        subject: 'holding:' + id,
        at: iso,
        details: { personId, typeId: type.id, issuedOn: body.issuedOn, expiresOn: body.expiresOn ?? null },
      });
      return id;
    });
  }

  /**
   * Read one source to the end and copy what it holds (D108 item 9), under a lease on the source so two runs never read
   * it at once; the same run may take its own lease again, which is how a run the engine recovers after a restart goes
   * on. Nothing is read while the module is switched off, which is asked again for each source.
   *
   * Each page is taken in as it comes. Its keys are matched to active people by user name; a key that matches nobody is
   * counted and what it holds dropped there, and so is what the source holds for a person outside the source
   * connector's audience or the competence module's own (D23, `HoldingsPort.admitted`). The read holds only the usable
   * holdings of the people it may keep rows for and the source's row ids, at most `COPY_HOLDINGS_MAX` holdings.
   *
   * A page that does not answer is handled by its error kind (`SourceReadError`): the same page is asked again twice
   * after a pause when the source is unavailable, the sweep starts again from the first page once when the source no
   * longer knows the cursor, and anything else stops the read. A read that stops keeps what it read, revokes nothing and
   * is recorded as failed; the next run reads the source again. Everything the read changes is written in one
   * transaction with the run's one audit row of counts; a write that fails changes nothing, is recorded as failed with
   * its kind (`storage`) and lets go of the source. Logs and audit rows carry kinds and counts, never a source's words.
   */
  async function copySource(
    actor: string,
    run: string,
    ref: HoldingsSourceRef,
    options: { signal?: AbortSignal } = {},
  ): Promise<CopyResult> {
    const port = deps.holdings;
    const connectorId = ref.connectorId;
    const signal = options.signal;
    if (!port) return { connectorId, outcome: 'busy' };
    // Switched off meanwhile: the sources a run listed before are not read.
    if (!(await port.switchedOn())) return { connectorId, outcome: 'off' };
    const claimed = await deps.store.transaction(async tx => {
      const at = now(),
        iso = at.toISOString();
      const current = await tx.source(connectorId);
      if (leased(current, iso) && current!.run !== run) return false;
      const base = current ?? blankSource(connectorId, ref.source);
      await tx.putSource({
        ...base,
        source: ref.source,
        run,
        claimedAt: base.run === run && base.claimedAt ? base.claimedAt : iso,
        leaseUntil: leaseUntil(at),
      });
      return true;
    });
    if (!claimed) return { connectorId, outcome: 'busy' };
    /** Renew the lease between pages; false when another run has taken the source since. */
    const renew = () =>
      deps.store.transaction(async tx => {
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return false;
        await tx.putSource({ ...current, leaseUntil: leaseUntil(now()) });
        return true;
      });
    /** Who of these people the source's rows may be kept for, asked a thousand at a time. */
    const admitted = async (personIds: readonly string[]) => {
      const inside = new Set<string>();
      for (let i = 0; i < personIds.length; i += 1000)
        for (const id of await port.admitted(connectorId, personIds.slice(i, i + 1000))) inside.add(id);
      return inside;
    };

    const today = swedishDay(now());
    /** What one sweep from the first page has gathered; a sweep started again gives all of it back. */
    const sweep = () => ({
      /** Every row id the source answered, for people Clew matched or not: what is not here may be withdrawn. */
      seen: new Set<string>(),
      /** The usable holdings of the people the source's rows may be kept for. */
      matched: [] as ReadHolding[],
      /** Each key seen, lower case, and the active person it matched, null for nobody. */
      keys: new Map<string, PersonRef | null>(),
      /** The people matched, and whether the source's rows may be kept for them. */
      admitted: new Map<string, boolean>(),
      /** Per organisation: holdings read and unusable for the people admitted, and the people outside. */
      byOrganisation: new Map<string, { read: number; invalid: number; outside: number }>(),
      cursors: new Set<string>(),
      read: 0,
      invalid: 0,
      pages: 0,
      partial: false,
      withdrawals: true,
    });
    let got = sweep();
    const tally = (organisationId: string) => {
      let t = got.byOrganisation.get(organisationId);
      if (!t) got.byOrganisation.set(organisationId, (t = { read: 0, invalid: 0, outside: 0 }));
      return t;
    };
    /** Take one page in: match its new keys and their audiences, keep the usable holdings of those admitted. */
    const take = async (rows: readonly SourceHoldingsRow[]) => {
      // A key Postgres cannot hold or compare (a control character, a lone surrogate) is no key: its holdings are unusable.
      const keyOf = (row: SourceHoldingsRow) =>
        typeof row?.key === 'string' && row.key.length >= 1 && row.key.length <= SOURCE_KEY_MAX && safeText(row.key)
          ? row.key.toLowerCase()
          : '';
      const fresh = [...new Set(rows.map(keyOf).filter(k => k && !got.keys.has(k)))];
      if (fresh.length) {
        const people = await deps.store.transaction(tx => tx.activeByUserName(fresh));
        const byName = new Map(people.flatMap(p => (p.userName ? [[p.userName.toLowerCase(), p] as const] : [])));
        for (const k of fresh) got.keys.set(k, byName.get(k) ?? null);
        const newcomers = people.filter(p => !got.admitted.has(p.id));
        const inside = await admitted(newcomers.map(p => p.id));
        for (const p of newcomers) {
          got.admitted.set(p.id, inside.has(p.id));
          if (!inside.has(p.id)) tally(p.organisationId).outside++;
        }
      }
      for (const row of rows) {
        if (row?.partial) got.partial = true;
        const key = keyOf(row);
        const person = key ? got.keys.get(key) : undefined;
        for (const holding of Array.isArray(row?.holdings) ? row.holdings : []) {
          got.read++;
          if (typeof holding?.id === 'string' && holding.id) got.seen.add(holding.id);
          // A key that matches nobody, or a person outside an audience: counted, neither kept nor looked at.
          if (person === null || (person && !got.admitted.get(person.id))) continue;
          const usable = person ? usableHolding(holding, today) : undefined;
          if (person) tally(person.organisationId).read++;
          if (!person || !usable) {
            got.invalid++;
            if (person) tally(person.organisationId).invalid++;
          } else got.matched.push({ personId: person.id, organisationId: person.organisationId, holding: usable });
        }
      }
    };
    const stop = (failure: string) => {
      deps.log?.(
        `competence: the read of a source stopped (${failure}); what was read is kept and it is read again at the next run`,
        { connector: connectorId, pages: got.pages },
      );
      return failure;
    };
    let failure: string | null = null;
    let outcome: CompetenceReadOutcome = 'complete';
    const blank = (): CompetenceReadCounts => ({
      read: 0,
      stored: 0,
      unchanged: 0,
      invalid: 0,
      unmapped: 0,
      revoked: 0,
      outside: 0,
      removed: 0,
    });
    /** The counts of the read, the whole and per organisation; what was written is added where the write says it. */
    const counting = () => {
      const organisations: Record<string, CompetenceReadCounts> = {};
      const of = (organisationId: string | undefined) =>
        organisationId === undefined ? undefined : (organisations[organisationId] ??= blank());
      for (const [organisationId, t] of got.byOrganisation)
        Object.assign(of(organisationId)!, { read: t.read, invalid: t.invalid, outside: t.outside });
      const total: CompetenceReadCounts = {
        ...blank(),
        read: got.read,
        invalid: got.invalid,
        outside: [...got.admitted.values()].filter(a => !a).length,
      };
      const unmatched = [...got.keys.values()].filter(p => p === null).length;
      return { total, organisations, of, unmatched };
    };
    const finish = async (tx: CompetenceTx, current: SourceRecord, at: string, counts: SourceReadCounts) => {
      await tx.putSource({
        ...current,
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: current.claimedAt ?? at,
        finishedAt: at,
        outcome,
        counts,
      });
      await tx.audit({
        actor,
        action: 'competence.source_read',
        subject: 'connector:' + connectorId,
        at,
        details: {
          run,
          outcome,
          ...(failure ? { failure } : {}),
          pages: got.pages,
          unmatched: counts.unmatched,
          ...counts.total,
        },
      });
    };
    /**
     * Something of Clew's own failed while the source was read or what it answered was written (the database, the
     * directory behind the audiences): the copy is as it was, the read is recorded as failed with the kind `storage` and
     * the source let go of, so the next run reads it again rather than wait for the lease to lapse.
     */
    const failedHere = async (error: unknown, during: 'read' | 'write') => {
      const code = (error as { code?: unknown } | null)?.code;
      deps.log?.(
        during === 'write'
          ? 'competence: what a source answered could not be written; the copy is unchanged'
          : "competence: a source's read failed on Clew's side; the copy is unchanged",
        {
          connector: connectorId,
          failure: 'storage',
          ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { code } : {}),
        },
      );
      failure = 'storage';
      outcome = 'failed';
      return deps.store.transaction(async (tx): Promise<CopyResult> => {
        const at = now().toISOString();
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return { connectorId, outcome: 'busy' };
        const { total, organisations, unmatched } = counting();
        await finish(tx, current, at, { unmatched, total, organisations });
        return { connectorId, outcome, counts: total, unmatched };
      });
    };

    let keep: (personId: string) => boolean;
    let holders: string[];
    try {
      let cursor: string | undefined;
      let restarted = false,
        retries = 0;
      for (;;) {
        if (signal?.aborted) {
          failure = stop('cancelled');
          break;
        }
        let page: SourceHoldingsPage;
        try {
          page = await port.readHoldings(connectorId, cursor, signal ? { signal } : {});
        } catch (error) {
          const code = sourceReadError(error);
          if (signal?.aborted) {
            failure = stop('cancelled');
            break;
          }
          if (code === 'invalid' && cursor !== undefined && !restarted) {
            // The source no longer knows the cursor: one sweep from the first page, then a second refusal stops the read.
            restarted = true;
            got = sweep();
            cursor = undefined;
            deps.log?.('competence: a source refused its cursor; the read starts again from the first page', {
              connector: connectorId,
            });
            continue;
          }
          if (code === 'unavailable' && retries < UNAVAILABLE_PAUSES_MS.length) {
            await deps.pause?.(UNAVAILABLE_PAUSES_MS[retries++]!);
            if (!(await renew())) return { connectorId, outcome: 'busy' };
            continue;
          }
          failure = stop(code ?? 'unknown');
          break;
        }
        retries = 0;
        got.pages++;
        got.withdrawals &&= page.withdrawalsReported === true;
        await take(page.rows ?? []);
        if (got.read > COPY_HOLDINGS_MAX) {
          failure = stop('too-large');
          break;
        }
        if (!page.next) break;
        if (got.cursors.has(page.next) || got.pages >= PAGES_MAX) {
          failure = stop('endless');
          break;
        }
        got.cursors.add(page.next);
        cursor = page.next;
        if (!(await renew())) return { connectorId, outcome: 'busy' };
      }
      // The people who already have rows of the source and may no longer have them: outside an audience or deactivated.
      holders = await deps.store.transaction(tx => tx.copiedPeople(connectorId));
      const known = new Set(got.admitted.keys());
      const asked = await admitted(holders.filter(id => !known.has(id)));
      keep = (personId: string) => got.admitted.get(personId) ?? asked.has(personId);
    } catch (error) {
      return failedHere(error, 'read');
    }
    const { seen, matched, partial, withdrawals } = got;
    outcome = failure ? 'failed' : partial ? 'partial' : 'complete';
    try {
      return await deps.store.transaction(async (tx): Promise<CopyResult> => {
        const at = now().toISOString();
        // The source's row first, as a mapping, an erasure and forgetting the source take it, and as removing the
        // connector does through its cascade. Gone or taken by another run: nothing is written.
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return { connectorId, outcome: 'busy' };
        const mapped = new Map(
          (await tx.mappingsOf(connectorId)).map(m => [m.organisationId + '\n' + m.sourceType, m]),
        );
        const existing = await tx.copiedFrom(connectorId);
        // Checked again under the lock: a person deactivated (and perhaps erased) since the page was read gets nothing.
        const active = await tx.activeIds([...new Set([...matched.map(m => m.personId), ...holders])]);
        const removed = existing.filter(h => !active.has(h.personId) || !keep(h.personId));
        const gone = new Set(removed.map(h => h.id));
        const plan = planCopy({
          connectorId,
          existing: existing.filter(h => !gone.has(h.id)),
          read: matched.filter(m => active.has(m.personId)),
          seen,
          mapping: (organisationId, sourceType) => mapped.get(organisationId + '\n' + sourceType)?.typeId ?? null,
          // Only a complete read of a source that reports withdrawals says a missing row is gone (item 9).
          revokeAbsent: outcome === 'complete' && withdrawals,
          at,
          newId: deps.ids,
        });
        await tx.removeCopied(
          connectorId,
          removed.map(h => h.id),
        );
        await tx.putCopied(plan.write);
        await tx.touchCopied(connectorId, plan.touch, at);
        // Each row's organisation: from the read, else from its person.
        const organisationOf = new Map(matched.map(m => [m.personId, m.organisationId]));
        const unknown = [...new Set([...removed, ...plan.revoked].map(h => h.personId))].filter(
          id => !organisationOf.has(id),
        );
        for (let i = 0; i < unknown.length; i += 1000)
          for (const p of await tx.persons(unknown.slice(i, i + 1000))) organisationOf.set(p.id, p.organisationId);
        const { total, organisations, of, unmatched } = counting();
        const add = (key: keyof CompetenceReadCounts, organisationId: string | undefined, n = 1) => {
          total[key] += n;
          const o = of(organisationId);
          if (o) o[key] += n;
        };
        for (const r of plan.stored) add('stored', r.organisationId);
        for (const r of plan.unchanged) add('unchanged', r.organisationId);
        for (const h of plan.revoked) add('revoked', organisationOf.get(h.personId));
        for (const h of removed) add('removed', organisationOf.get(h.personId));
        for (const [organisationId, types] of plan.unmapped) add('unmapped', organisationId, types.size);
        await finish(tx, current, at, { unmatched, total, organisations });
        return { connectorId, outcome, counts: total, unmatched };
      });
    } catch (error) {
      // What the source answered could not be written (a value the database refuses, the database itself).
      return failedHere(error, 'write');
    }
  }

  /**
   * Map a source's type to a catalogue type for an organisation, or remove the mapping (D108 item 9), and re-type the
   * rows already copied with it in the same transaction. The administrator's and the operator's path share it.
   */
  async function setMapping(
    actor: string,
    organisationId: string,
    connectorId: string,
    body: CompetenceMappingBody,
    knownSourceOnly: boolean,
  ): Promise<{ holdings: number }> {
    const sourceType = body.sourceType;
    if (!sourceType || sourceType.length > SOURCE_ID_MAX) throw new CompetenceError(BAD_SOURCE_TYPE);
    // An administrator maps only a source their organisation has someone in the audience of (D23); else it is unknown.
    if (knownSourceOnly && !(await reaches(connectorId, organisationId))) throw new CompetenceError(NO_SOURCE);
    const answers = knownSourceOnly ? (await answering(connectorId)).length > 0 : true;
    const at = now().toISOString();
    return deps.store.transaction(async tx => {
      // The source's row is locked first, as the copy's write locks it, so a mapping and a read's write never interleave.
      const record = await tx.source(connectorId);
      if (!answers && !record) throw new CompetenceError(NO_SOURCE);
      if (body.typeId !== null) {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_MAPPING);
      }
      const before = (await tx.mappings(organisationId, connectorId)).find(m => m.sourceType === sourceType);
      if ((before?.typeId ?? null) === body.typeId) return { holdings: 0 };
      if (body.typeId === null) await tx.removeMapping(connectorId, organisationId, sourceType);
      else
        await tx.putMapping({
          connectorId,
          organisationId,
          sourceType,
          typeId: body.typeId,
          mappedBy: actor,
          mappedAt: at,
        });
      const holdings = await tx.retypeCopied(connectorId, organisationId, sourceType, body.typeId);
      await tx.audit({
        actor,
        action: body.typeId === null ? 'competence.source_unmapped' : 'competence.source_mapped',
        subject: 'connector:' + connectorId,
        at,
        details: { organisationId, sourceType, typeBefore: before?.typeId ?? null, typeAfter: body.typeId, holdings },
      });
      return { holdings };
    });
  }

  return {
    /**
     * The catalogue (D108 item 2). An administrator of it reads every type, archived ones included; a manager reads the
     * ones a certificate can be registered for; anyone else is refused.
     */
    async types(persona: AuthenticatedContext): Promise<{ rows: CompetenceType[] }> {
      const isAdmin = persona.capabilities.includes(COMPETENCE_ADMIN);
      if (!isAdmin && !(await reports(persona)).manages) throw new ForbiddenError();
      const rows = await deps.store.transaction(tx => tx.types(persona.organisationId, { archived: isAdmin }));
      return { rows: orderTypes(rows).map(typeRow) };
    },

    /** An administrator adds a type to the catalogue. Returns its id. */
    async addType(persona: AuthenticatedContext, body: CompetenceTypeBody): Promise<string> {
      await admin(persona);
      return insertType(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a type for an organisation, as the development seed does. `actor` is the operator's. */
    seedType: (actor: string, organisationId: string, body: CompetenceTypeBody) =>
      insertType(actor, organisationId, body),

    /**
     * What a new validity would do to the holdings counted from this type's rule (D108 item 3): how many there are and
     * how many are expired today under the current rule and under the new one. Nothing is written.
     */
    async validityImpact(
      persona: AuthenticatedContext,
      typeId: string,
      validityMonths: number | null,
    ): Promise<CompetenceValidityImpact> {
      await admin(persona);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const type = await tx.type(typeId);
        if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
        const ruled = (await tx.holdingsOfType(typeId)).filter(h => counts(h) && h.expiresOn === null);
        const expired = (months: number | null) =>
          ruled.filter(h => statusOn(endOf(h, { validityMonths: months }), today) === 'expired').length;
        return {
          holdings: ruled.length,
          expiredBefore: expired(type.validityMonths),
          expiredAfter: expired(validityMonths),
        };
      });
    },

    /**
     * An administrator changes a type: its name, area, kind or the employer's validity. A new validity applies at once
     * to every holding counted from the rule (D108 item 3); `validityImpact` says what that does before this is called.
     */
    async updateType(persona: AuthenticatedContext, typeId: string, body: CompetenceTypePatch): Promise<void> {
      await admin(persona);
      const patch: Partial<TypeRecord> = { ...typeFields(body) };
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.validityMonths !== undefined) patch.validityMonths = body.validityMonths;
      const at = now().toISOString();
      try {
        await deps.store.transaction(async tx => {
          const type = await tx.type(typeId);
          if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
          const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter(key => patch[key] !== type[key]);
          if (!changed.length) return;
          await tx.updateType(typeId, patch);
          await tx.audit({
            actor: persona.principal.id,
            action: 'competence.type_changed',
            subject: 'competence-type:' + typeId,
            at,
            details: {
              changed: changed.sort(),
              ...(changed.includes('validityMonths')
                ? { validityBefore: type.validityMonths, validityAfter: patch.validityMonths ?? null }
                : {}),
            },
          });
        });
      } catch (error) {
        if (error instanceof TypeNameTaken) throw new CompetenceError(NAME_TAKEN);
        throw error;
      }
    },

    /** An administrator archives a type: it takes no new holdings and keeps the ones it has. Archiving twice is one. */
    async archiveType(persona: AuthenticatedContext, typeId: string): Promise<void> {
      await admin(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const type = await tx.type(typeId);
        if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) return;
        await tx.updateType(typeId, { archivedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.type_archived',
          subject: 'competence-type:' + typeId,
          at,
        });
      });
    },

    /**
     * The manager a person reports to registers a certificate for them (D108 item 7): the type, the day it was issued
     * and, where the issuer set one, its end date. Returns the holding's id.
     */
    async registerHolding(
      persona: AuthenticatedContext,
      personId: string,
      body: CompetenceHoldingBody,
    ): Promise<string> {
      await reportOf(persona, personId);
      return insertHolding(persona.principal.id, persona.id, persona.organisationId, personId, body);
    },
    /** An operator registers a holding for a person of an organisation, as the development seed does. */
    seedHolding: (actor: string, organisationId: string, personId: string, body: CompetenceHoldingBody) =>
      insertHolding(actor, null, organisationId, personId, body),

    /**
     * The manager a person reports to now takes back a holding registered in Clew: it stays as a row, marked revoked,
     * and counts towards nothing. Revoking twice is one.
     */
    async revokeHolding(persona: AuthenticatedContext, holdingId: string): Promise<void> {
      const { people } = await reports(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || !people.has(holding.personId) || holding.evidence === 'system')
          throw new ForbiddenError(NOT_ALLOWED);
        if (holding.state === 'revoked') return;
        await tx.updateHolding(holdingId, { state: 'revoked', revokedAt: at, revokedBy: persona.id });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.holding_revoked',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: holding.personId, typeId: holding.typeId },
        });
      });
    },

    /**
     * `competence.holdings`. With `person` (a user name, or the id of a person provisioned without one): what that
     * report holds, for the manager they report to. Without: the reader's own. For each type the holding that decides,
     * a copied one with its source and when it was read; a type required of the person that they hold nothing of as a
     * `missing` row (D108 item 6); after them the copied rows whose type is not mapped, under the source's own label and
     * marked as counting towards nothing (item 9).
     */
    async holdings(
      persona: AuthenticatedContext,
      input: CompetenceHoldingsInput = {},
    ): Promise<CompetenceHoldingsOutput> {
      let personId = persona.id;
      const self = await deps.store.transaction(tx => tx.persons([persona.id]));
      // The reader's own key is the reader: a row about them opens their own list.
      if (input.person !== undefined && !(self[0] && personKey(self[0]) === input.person)) {
        const { manages, people } = await reports(persona);
        if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
        const found = [...people.values()].find(p => personKey(p) === input.person);
        if (!found) throw new ForbiddenError(NOT_YOURS);
        personId = found.id;
      }
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const [person] = await tx.persons([personId]);
        if (!person) return { rows: [] };
        const { standings: held, waiting } = await standingsWith(tx, persona.organisationId, [personId], today);
        const names = await sourceNames(tx);
        return {
          rows: orderHoldingRows([
            ...held.map(s => holdingRow(s, person, names)),
            ...waiting.map(h => uncountedRow(h, person, names)),
          ]).slice(0, 500),
        };
      });
    },

    /**
     * What `competence.person` answers (D97): for each asked person who reports to the reader, by their user name
     * without regard to case, how many of their holdings have run out, how many required types they lack, how many soon
     * run out and how many count. A person with no holding has a row too, since it is where a first certificate is
     * registered from. A key that is nobody the reader manages has no row, and is never a refusal.
     */
    async aboutPeople(
      persona: AuthenticatedContext,
      keys: readonly string[],
    ): Promise<{ rows: Array<{ key: string } & PersonSummary> }> {
      const { people } = await reports(persona);
      const byUserName = new Map(
        [...people.values()].flatMap(p => (p.userName ? [[p.userName.toLowerCase(), p.id] as const] : [])),
      );
      const asked = [...new Set(keys)].flatMap(key => {
        const id = byUserName.get(key.toLowerCase());
        return id ? [{ key, id }] : [];
      });
      if (!asked.length) return { rows: [] };
      const today = swedishDay(now());
      const all = await deps.store.transaction(tx =>
        standings(
          tx,
          persona.organisationId,
          asked.map(a => a.id),
          today,
        ),
      );
      return {
        rows: asked.map(a => ({ key: a.key, ...summarise(all.filter(s => s.personId === a.id)) })),
      };
    },

    /**
     * `competence.attention` (D108 items 6 and 11): what has expired, is missing or expires within 90 days among the
     * manager's reports, the expired first.
     */
    async attention(persona: AuthenticatedContext): Promise<CompetenceAttentionOutput> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const due = (await standings(tx, persona.organisationId, [...people.keys()], today)).filter(needsAttention);
        const persons = new Map((await tx.persons([...new Set(due.map(s => s.personId))])).map(p => [p.id, p]));
        const names = await sourceNames(tx);
        const rows = due.flatMap(s => {
          const person = persons.get(s.personId);
          return person ? [holdingRow(s, person, names)] : [];
        });
        return { rows: orderHoldingRows(rows).slice(0, 500) };
      });
    },

    /**
     * The area's figure and the manager's card: how many holdings among the reports have expired, how many required
     * types they lack and how many holdings expire within 90 days, and how many people that is. Null for someone who
     * manages nobody.
     */
    async summary(
      persona: AuthenticatedContext,
    ): Promise<{ expired: number; missing: number; expiring: number; people: number; reports: number } | null> {
      const { manages, people } = await reports(persona);
      if (!manages) return null;
      const today = swedishDay(now());
      const due = (
        await deps.store.transaction(tx => standings(tx, persona.organisationId, [...people.keys()], today))
      ).filter(needsAttention);
      return {
        expired: due.filter(s => s.status === 'expired').length,
        missing: due.filter(s => s.status === 'missing').length,
        expiring: due.filter(s => s.status === 'expiring').length,
        people: new Set(due.map(s => s.personId)).size,
        reports: people.size,
      };
    },

    /**
     * What the reader's own card says: their holdings that have expired or expire within 90 days and the required types
     * they lack, the expired first, then the missing, then the expiring, each the soonest first.
     */
    async ownAttention(persona: AuthenticatedContext): Promise<Standing[]> {
      const today = swedishDay(now());
      const due = (
        await deps.store.transaction(tx => standings(tx, persona.organisationId, [persona.id], today))
      ).filter(needsAttention);
      return due.sort(byUrgency);
    },

    /**
     * What the scan reads (D108 item 12, D47): when it read, the reader's own standings to act on (`ownAttention`), and,
     * for a manager, what is due among their reports, one entry per person and type with its status and end, from which
     * the manager's one card is counted and its occurrences named. Never stored: the scan derives it each time.
     */
    async scanOf(persona: AuthenticatedContext, manager: boolean) {
      const at = now(),
        today = swedishDay(at);
      const own = (
        await deps.store.transaction(tx => standings(tx, persona.organisationId, [persona.id], today))
      ).filter(needsAttention);
      let team: {
        expired: number;
        missing: number;
        expiring: number;
        people: number;
        due: Array<{ personId: string; typeId: string; status: Standing['status']; end: string | null }>;
      } | null = null;
      if (manager) {
        const { manages, people } = await reports(persona);
        if (manages) {
          const due = (
            await deps.store.transaction(tx => standings(tx, persona.organisationId, [...people.keys()], today))
          ).filter(needsAttention);
          const count = (status: Standing['status']) => due.filter(d => d.status === status).length;
          team = {
            expired: count('expired'),
            missing: count('missing'),
            expiring: count('expiring'),
            people: new Set(due.map(d => d.personId)).size,
            due: due.map(d => ({ personId: d.personId, typeId: d.type.id, status: d.status, end: d.end })),
          };
        }
      }
      return { observedAt: at.toISOString(), own: own.sort(byUrgency), team };
    },

    /**
     * Administration › Kompetens › Krav (D108 item 6): the requirements set on positions and units, and the positions and
     * units of the organisation they can be set on. A requirement set on one person is their manager's, not the
     * administrator's (D118), and is not listed here. Behind the capability and the step-up.
     */
    async requirements(persona: AuthenticatedContext): Promise<CompetenceRequirementsOutput> {
      await admin(persona);
      return deps.store.transaction(async tx => {
        const org = persona.organisationId;
        const [rows, positions, units] = [await tx.requirements(org), await tx.positions(org), await tx.units(org)];
        const positionLabel = new Map(positions.map(p => [p.code, p.label])),
          unitLabel = new Map(units.map(u => [u.id, u.label]));
        // A position or a unit that is gone keeps its requirement, which counts towards nothing until it comes back, and
        // is listed by its key and marked, so an administrator can remove it.
        const on = (
          r: RequirementRecord,
          kind: 'position' | 'unit',
          key: string,
          label: string | undefined,
        ): CompetenceRequirement => ({
          id: r.id,
          typeId: r.typeId,
          on: kind,
          targetId: key,
          targetLabel: label ?? key,
          ...(label === undefined ? { gone: true as const } : {}),
        });
        const listed = rows.flatMap((r): CompetenceRequirement[] =>
          r.positionCode !== null
            ? [on(r, 'position', r.positionCode, positionLabel.get(r.positionCode))]
            : r.unitId !== null
              ? [on(r, 'unit', r.unitId, unitLabel.get(r.unitId))]
              : [],
        );
        return {
          rows: listed.sort(
            (a, b) =>
              a.on.localeCompare(b.on) ||
              a.targetLabel.localeCompare(b.targetLabel, 'sv') ||
              a.targetId.localeCompare(b.targetId) ||
              a.id.localeCompare(b.id),
          ),
          positions: positions.map(p => ({ code: p.code, label: p.label })),
          units: units.map(u => ({ id: u.id, label: u.label })),
        };
      });
    },

    /**
     * Add a requirement (D108 item 6) for exactly one of a position or a unit, as an administrator with the capability
     * and the step-up, or one person, as the manager that person reports to (never as an administrator, D118). One
     * requirement per type and target; the same again is refused. Returns its id.
     */
    async addRequirement(persona: AuthenticatedContext, body: CompetenceRequirementBody): Promise<string> {
      const named = [body.positionCode, body.unitId, body.personId].filter(v => v !== undefined);
      if (named.length !== 1) throw new CompetenceError(ONE_TARGET);
      if (body.personId !== undefined) await reportOf(persona, body.personId, NOT_THEIR_MANAGER);
      else await admin(persona);
      return insertRequirement(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a requirement for an organisation, as the development seed does. `actor` is the operator's. */
    seedRequirement: (actor: string, organisationId: string, body: CompetenceRequirementBody) =>
      insertRequirement(actor, organisationId, body),

    /**
     * Remove a requirement (D108 item 6): one on a position or a unit as an administrator, one on a person as the manager
     * that person reports to now, whoever set it. An id that is unknown, of another organisation or not the reader's to
     * remove is refused in the same words, so a refusal never tells whether a requirement exists. Audited with the keys
     * it carried.
     */
    async removeRequirement(persona: AuthenticatedContext, requirementId: string): Promise<void> {
      const found = await deps.store.transaction(tx => tx.requirement(requirementId));
      const refused = () => new ForbiddenError(NOT_YOUR_REQUIREMENT);
      if (!found || found.organisationId !== persona.organisationId) throw refused();
      if (found.personId !== null) {
        if (!(await reports(persona)).people.has(found.personId)) throw refused();
      } else {
        if (!persona.capabilities.includes(COMPETENCE_ADMIN)) throw refused();
        await persona.authorize();
      }
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const current = await tx.requirement(requirementId);
        if (!current) return;
        await tx.removeRequirement(requirementId);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.requirement_removed',
          subject: 'competence-requirement:' + requirementId,
          at,
          details: requirementDetails(current),
        });
      });
    },

    /**
     * Administration › Kompetens › Krav: the organisation's share targets (D108 item 6), behind the capability and the
     * step-up. A target across the whole organisation is measured over it here, once, as a figure that names nobody
     * (D118), shown only over at least `COVERAGE_MIN_GROUP` people (`organisationOutcome`); a unit's target is measured
     * on that unit's read, for the manager who leads it. A target whose position or unit is gone is marked and counts
     * towards nothing.
     */
    async shareTargets(persona: AuthenticatedContext): Promise<CompetenceShareTargetsOutput> {
      await admin(persona);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const org = persona.organisationId;
        const [rows, positions, units] = [await tx.shareTargets(org), await tx.positions(org), await tx.units(org)];
        const positionLabel = new Map(positions.map(p => [p.code, p.label])),
          unitLabel = new Map(units.map(u => [u.id, u.label]));
        const gone = (t: ShareTargetRecord) =>
          !positionLabel.has(t.positionCode) || (t.unitId !== null && !unitLabel.has(t.unitId));
        const measured = rows.filter(t => t.unitId === null && !gone(t));
        const holders = measured.length
          ? await tx.positionHolders(org, [...new Set(measured.map(t => t.positionCode))])
          : [];
        const holdings = await tx.holdingsOf([...new Set(holders.map(h => h.personId))]);
        const types = new Map(
          (
            await tx.typesById([
              ...new Set([...holdings.flatMap(h => (h.typeId ? [h.typeId] : [])), ...rows.map(t => t.typeId)]),
            ])
          ).map(t => [t.id, t]),
        );
        const met = new Set(
          deciding(holdings, types, today)
            .filter(meets)
            .map(s => s.personId + '\n' + s.type.id),
        );
        return {
          rows: rows.map((t): CompetenceShareTarget => {
            const type = types.get(t.typeId);
            const outcome =
              t.unitId === null && !gone(t) && type && type.archivedAt === null
                ? organisationOutcome(
                    t,
                    holders.filter(h => h.code === t.positionCode).map(h => h.personId),
                    personId => met.has(personId + '\n' + t.typeId),
                  )
                : undefined;
            return {
              id: t.id,
              typeId: t.typeId,
              positionCode: t.positionCode,
              positionLabel: positionLabel.get(t.positionCode) ?? t.positionCode,
              ...(t.unitId !== null ? { unitId: t.unitId, unitLabel: unitLabel.get(t.unitId) ?? t.unitId } : {}),
              minShare: t.minShare,
              ...(gone(t) ? { gone: true as const } : {}),
              ...(outcome ? { outcome } : {}),
            };
          }),
        };
      });
    },

    /**
     * An administrator adds a share target (D108 item 6): of the people who hold a position, at least a share in whole
     * percent hold a type, on a unit's branch or across the organisation. One per type, position and unit. Returns its id.
     */
    async addShareTarget(persona: AuthenticatedContext, body: CompetenceShareTargetBody): Promise<string> {
      await admin(persona);
      return insertShareTarget(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a share target for an organisation, as the development seed does. */
    seedShareTarget: (actor: string, organisationId: string, body: CompetenceShareTargetBody) =>
      insertShareTarget(actor, organisationId, body),

    /** An administrator removes a share target. Audited with the ids and the share it carried. */
    async removeShareTarget(persona: AuthenticatedContext, targetId: string): Promise<void> {
      await admin(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const current = await tx.shareTarget(targetId);
        if (!current || current.organisationId !== persona.organisationId) throw new CompetenceError(NO_TARGET);
        await tx.removeShareTarget(targetId);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.share_target_removed',
          subject: 'competence-share-target:' + targetId,
          at,
          details: targetDetails(current),
        });
      });
    },

    /**
     * The table behind a unit's row (D108 items 6 and 8): for a unit the reader manages, how its branch is covered, per
     * required type and per share target that applies. Counts over the branch (D99 item 5); names nobody. Anyone else is
     * refused.
     */
    async coverage(persona: AuthenticatedContext, unitId: string): Promise<UnitCoverageResult> {
      const { units, people } = await reports(persona);
      const unit = units.find(u => u.unitId === unitId);
      if (!unit) throw new ForbiddenError(NOT_YOUR_UNIT);
      const today = swedishDay(now());
      const covered = await deps.store.transaction(tx =>
        coverageIn(tx, persona, new Set(people.keys()), unitId, today),
      );
      return { unitId, unitLabel: unit.unitLabel, ...covered };
    },

    /**
     * What the read about a unit answers (D97, D108 item 8): for each asked unit the reader manages, its branch's
     * coverage. A unit where nothing is required of anyone and no share target applies has no row; a unit the reader
     * does not manage has none either, and is never a refusal.
     */
    async aboutUnits(persona: AuthenticatedContext, keys: readonly string[]): Promise<UnitCoverageResult[]> {
      const asked = new Set(keys);
      const managed = await reports(persona);
      const units = [
        ...new Map(managed.units.filter(u => asked.has(u.unitId)).map(u => [u.unitId, u] as const)).values(),
      ];
      if (!units.length) return [];
      const today = swedishDay(now());
      const own = new Set(managed.people.keys());
      return deps.store.transaction(async tx => {
        const rows: UnitCoverageResult[] = [];
        for (const unit of units) {
          const covered = await coverageIn(tx, persona, own, unit.unitId, today);
          if (covered.under || covered.targets.length)
            rows.push({ unitId: unit.unitId, unitLabel: unit.unitLabel, ...covered });
        }
        return rows;
      });
    },

    /**
     * The manager's matrix (D108 item 11): the people who report to the reader now against the types required of at
     * least one of them, at most ten columns at a time, with the sets of columns to choose from where more are required
     * (`matrixOf`). A manager's reports only (D99 item 4); anyone who manages nobody is refused. A read, so no audit row.
     */
    async matrix(persona: AuthenticatedContext, input: CompetenceMatrixInput = {}): Promise<CompetenceMatrixOutput> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER_MATRIX);
      const today = swedishDay(now());
      return deps.store.transaction(tx => matrixIn(tx, persona.organisationId, [...people.values()], today, input));
    },

    /**
     * The matrix as shown, as a file to download (D108 item 11): the same read as `matrix` with the same set of columns,
     * written as CSV. It names the manager's own reports, which is what it is for; its audit row, in the same
     * transaction, counts the people and the columns and names nobody.
     */
    async exportMatrix(
      persona: AuthenticatedContext,
      input: CompetenceMatrixInput = {},
    ): Promise<{ filename: string; text: string }> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER_MATRIX);
      const at = now(),
        today = swedishDay(at);
      return deps.store.transaction(async tx => {
        const matrix = await matrixIn(tx, persona.organisationId, [...people.values()], today, input);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.matrix_exported',
          subject: 'organisation:' + persona.organisationId,
          at: at.toISOString(),
          details: { people: matrix.rows.length, types: matrix.columns.length },
        });
        return { filename: `kompetens-${today}.csv`, text: matrixCsv(matrix) };
      });
    },

    /**
     * Administration › Kompetens › Källor (D108 item 9): every system that answers the holdings profile now or has
     * been read, with its last read and its types among the organisation's copied rows, each with its mapping. Behind
     * the capability and the step-up, as the catalogue is.
     */
    async sources(persona: AuthenticatedContext): Promise<CompetenceSourcesOutput> {
      await admin(persona);
      const live = await answering();
      const at = now().toISOString();
      const read = await deps.store.transaction(async tx => ({
        records: new Map((await tx.sources()).map(s => [s.connectorId, s])),
        counted: await tx.sourceTypes(persona.organisationId),
        maps: await tx.mappings(persona.organisationId),
      }));
      const { records, counted, maps } = read;
      const names = new Map(live.map(s => [s.connectorId, s.source]));
      const candidates = new Set([
        ...live.map(s => s.connectorId),
        ...records.keys(),
        ...counted.map(c => c.connectorId),
        ...maps.map(m => m.connectorId),
      ]);
      // A source is shown only to an organisation that has someone in its audience and the module's (D23): to anyone
      // else the connector does not exist, here as everywhere.
      const ids: string[] = [];
      for (const connectorId of candidates)
        if (await reaches(connectorId, persona.organisationId)) ids.push(connectorId);
      {
        const rows = ids.map((connectorId): CompetenceSource => {
          const record = records.get(connectorId);
          const types = new Map<string, CompetenceSource['types'][number]>();
          for (const c of counted.filter(c => c.connectorId === connectorId))
            types.set(c.sourceType, { sourceType: c.sourceType, label: c.label, holdings: c.holdings });
          for (const m of maps.filter(m => m.connectorId === connectorId))
            types.set(m.sourceType, {
              ...(types.get(m.sourceType) ?? { sourceType: m.sourceType, label: m.sourceType, holdings: 0 }),
              typeId: m.typeId,
            });
          return {
            connectorId,
            source: names.get(connectorId) ?? record?.source ?? connectorId,
            answering: names.has(connectorId),
            reading: leased(record, at),
            // The outcome and the time are the source's; the counts are this organisation's own.
            ...(record?.outcome && record.startedAt && record.finishedAt && record.counts
              ? {
                  lastRead: {
                    startedAt: record.startedAt,
                    finishedAt: record.finishedAt,
                    outcome: record.outcome,
                    unmatched: record.counts.unmatched ?? 0,
                    counts: {
                      read: 0,
                      stored: 0,
                      unchanged: 0,
                      invalid: 0,
                      unmapped: 0,
                      revoked: 0,
                      outside: 0,
                      removed: 0,
                      ...record.counts.organisations?.[persona.organisationId],
                    },
                  },
                }
              : {}),
            types: [...types.values()].sort(
              (a, b) => a.label.localeCompare(b.label, 'sv') || a.sourceType.localeCompare(b.sourceType),
            ),
          };
        });
        return {
          rows: rows.sort(
            (a, b) => a.source.localeCompare(b.source, 'sv') || a.connectorId.localeCompare(b.connectorId),
          ),
        };
      }
    },

    /**
     * An administrator maps one type of a source to a catalogue type of their organisation, or removes the mapping
     * with `typeId: null` (D108 item 9). The rows already copied with it are re-typed in the same transaction, so they
     * count, or stop counting, at once. The same mapping again changes nothing and writes nothing.
     */
    async mapSourceType(
      persona: AuthenticatedContext,
      connectorId: string,
      body: CompetenceMappingBody,
    ): Promise<{ holdings: number }> {
      await admin(persona);
      return setMapping(persona.principal.id, persona.organisationId, connectorId, body, true);
    },
    /**
     * An operator maps a source's type for an organisation, as the development convenience script does. The source
     * need not have been read yet, so the first read is typed; the connector's row must exist.
     */
    seedMapping: (actor: string, organisationId: string, connectorId: string, body: CompetenceMappingBody) =>
      setMapping(actor, organisationId, connectorId, body, false),

    /**
     * An administrator's "Läs in nu" (D108 item 9): one run of the copy for one source, started with the transaction
     * that records the request. Refused while the source does not answer and while a read of it is under way.
     */
    async readNow(persona: AuthenticatedContext, connectorId: string): Promise<void> {
      await admin(persona);
      if (!(await answering(connectorId)).length || !(await reaches(connectorId, persona.organisationId)))
        throw new CompetenceError(NOT_ANSWERING);
      const at = now().toISOString(),
        run = deps.ids();
      await deps.store.transaction(async tx => {
        if (leased(await tx.source(connectorId), at)) throw new CompetenceError(READING);
        await tx.enqueue(readNowStart(run, connectorId, at));
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.read_requested',
          subject: 'connector:' + connectorId,
          at,
          details: { run },
        });
      });
    },

    /**
     * An operator asks for a run now (D108 item 9), of every source that answers or of the one named: started with the
     * transaction that records the request, and read by whichever instance of the server dequeues it. Returns the
     * workflow's id, which the operator's script waits on.
     */
    async requestRun(actor: string, connectorId?: string): Promise<{ run: string; workflowId: string; at: string }> {
      const at = now().toISOString(),
        run = deps.ids();
      const start = readNowStart(run, connectorId, at);
      await deps.store.transaction(async tx => {
        await tx.enqueue(start);
        await tx.audit({
          actor,
          action: 'competence.read_requested',
          subject: connectorId ? 'connector:' + connectorId : 'competence:sources',
          at,
          details: { run },
        });
      });
      return { run, workflowId: start.id, at };
    },
    /** The sources a run reads now (D108 item 9): every one that answers, or the one named; none while the module is off. */
    copySources: (only?: string | null) => answering(only),
    /** One run's read of one source; the workflow calls it once per source, the script for each. */
    copySource,
    /** Every source that answers, or the one named, one after another: what an operator's script runs. */
    async copyAll(actor: string, run: string, only?: string): Promise<CopyResult[]> {
      const results: CopyResult[] = [];
      for (const source of await answering(only)) results.push(await copySource(actor, run, source));
      return results;
    },
    /**
     * Ask for the next daily run (D108 item 9): one workflow per day at 04:00 in Sweden, by its id, so every instance
     * and every boot may ask and the engine keeps one. The engine's own row is the record: no audit row is written.
     */
    async scheduleCopy(): Promise<{ day: string; at: string }> {
      const next = nextDailyCopy(now());
      await deps.store.transaction(tx => tx.enqueue(dailyCopyStart(next.day, next.at)));
      return next;
    },
    /**
     * Remove everything one connector put in the register (D108 item 9): its copied rows, its mappings and its record.
     * The database does the same when an administrator removes the connector; this is the operator's way to do it for a
     * connector that stays. Audited with counts.
     */
    async forgetSource(actor: string, connectorId: string): Promise<{ holdings: number; mappings: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const forgotten = await tx.forgetSource(connectorId);
        await tx.audit({
          actor,
          action: 'competence.source_forgotten',
          subject: 'connector:' + connectorId,
          at,
          details: { ...forgotten },
        });
        return forgotten;
      });
    },

    /**
     * Erase one person from the domain (D108 item 14): their holdings, copied ones included, the requirements set on them
     * alone (item 6), and their id on the holdings they registered or revoked for others. Only for a person the directory
     * has deactivated: an active person is refused with `PersonStillActive`. `actor` is the operator's.
     */
    async erasePerson(
      actor: string,
      personId: string,
    ): Promise<{ holdings: number; cleared: number; requirements: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        // Erasure is for a person the directory has deactivated (item 14): an active person's copied rows would come
        // back at the next read of their source, and their manager's attestations are still in use.
        if ((await tx.activeIds([personId])).has(personId)) throw new PersonStillActive();
        const erased = await tx.erasePerson(personId);
        const counted = { holdings: erased.holdings, cleared: erased.cleared, requirements: erased.requirements };
        await tx.audit({
          actor,
          action: 'competence.person_erased',
          subject: 'person:' + personId,
          at,
          details: counted,
        });
        return counted;
      });
    },

    /** The whole domain of one organisation as one versioned document (D108 item 14). */
    async exportDomain(
      actor: string,
      organisationId: string,
    ): Promise<
      { format: typeof COMPETENCE_EXPORT_FORMAT; exportedAt: string; organisationId: string } & CompetenceExport
    > {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const data = await tx.exportOrganisation(organisationId);
        await tx.audit({
          actor,
          action: 'competence.exported',
          subject: 'organisation:' + organisationId,
          at,
          details: {
            types: data.types.length,
            holdings: data.holdings.length,
            mappings: data.mappings.length,
            requirements: data.requirements.length,
            shareTargets: data.shareTargets.length,
          },
        });
        return { format: COMPETENCE_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type CompetenceUsecases = ReturnType<typeof competenceUsecases>;
