import type {
  AuthenticatedContext,
  Capability,
  CompetenceAttentionOutput,
  CompetenceHoldingBody,
  CompetenceHoldingsInput,
  CompetenceHoldingsOutput,
  CompetenceMappingBody,
  CompetenceReadCounts,
  CompetenceReadOutcome,
  CompetenceSource,
  CompetenceSourcesOutput,
  CompetenceType,
  CompetenceTypeBody,
  CompetenceTypePatch,
  CompetenceValidityImpact,
  StaffPerson,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  counts,
  dailyCopyStart,
  deciding,
  endOf,
  holdingRow,
  isCalendarDay,
  leaseUntil,
  needsAttention,
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
} from './domain';
import {
  TypeNameTaken,
  type CompetenceDeps,
  type CompetenceExport,
  type CompetenceTx,
  type HoldingRecord,
  type HoldingsSourceRef,
  type PersonRef,
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
 * mappings of sources.
 */
export const COMPETENCE_EXPORT_FORMAT = 'clew.competence/2';
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
 * sources hold and the mapping of their types (item 9), and the reads that work out where every holding stands today.
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
  /** The people who report to the persona now, each once, themselves and deactivated people left out. */
  async function reports(persona: AuthenticatedContext) {
    const staff = await deps.staff(persona);
    const people = new Map<string, StaffPerson>();
    for (const unit of staff.units)
      for (const p of unit.people)
        if (p.id !== persona.id && p.enabled !== false && !people.has(p.id)) people.set(p.id, p);
    return { manages: staff.units.length > 0, people };
  }
  async function reportOf(persona: AuthenticatedContext, personId: string) {
    const { manages, people } = await reports(persona);
    if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
    const person = people.get(personId);
    if (!person) throw new ForbiddenError(NOT_YOURS);
    return person;
  }
  /**
   * Where every counted holding of these people stands today: one standing per person and type, mapped copied rows
   * counted exactly like registered ones (D108 items 4 and 9). `waiting` are the copied rows whose type is not mapped.
   */
  async function standingsWith(
    tx: CompetenceTx,
    personIds: readonly string[],
    today: string,
  ): Promise<{ standings: Standing[]; waiting: HoldingRecord[] }> {
    const holdings = await tx.holdingsOf(personIds);
    const typeIds = [...new Set(holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])))];
    const types = new Map((await tx.typesById(typeIds)).map(t => [t.id, t]));
    return { standings: deciding(holdings, types, today), waiting: holdings.filter(uncounted) };
  }
  const standings = async (tx: CompetenceTx, personIds: readonly string[], today: string) =>
    (await standingsWith(tx, personIds, today)).standings;
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
   * A person is one row of a read. Clew compares a key without regard to case, and a source may hold two accounts
   * whose keys differ only in case, on one page or on two; a source cannot always tell, and Clew can. A key that a
   * second row of the same sweep answers for, in any spelling, is nobody's: nothing of either row is kept, their
   * holdings count as unusable, and what the person already has from the source is left as it is.
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
      // Opened, not read: a source no run has claimed before gets its row here, so two first runs wait for each other.
      const base = await tx.openSource(blankSource(connectorId, ref.source));
      if (leased(base, iso) && base.run !== run) return false;
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
      /** The keys, lower case, a row has answered for, and those a second row answered for: one person, two accounts. */
      answered: new Set<string>(),
      twice: new Set<string>(),
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
        if (key) (got.answered.has(key) ? got.twice : got.answered).add(key);
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
          ...(got.twice.size ? { ambiguous: got.twice.size } : {}),
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
    // One person, two rows: neither is kept (see above). Their usable holdings become unusable ones in the counts.
    const twice = new Set([...got.twice].flatMap(key => got.keys.get(key)?.id ?? []));
    if (twice.size) {
      for (const m of got.matched.filter(m => twice.has(m.personId))) {
        got.invalid++;
        tally(m.organisationId).invalid++;
      }
      got.matched = got.matched.filter(m => !twice.has(m.personId));
      deps.log?.('competence: a source answered more than one row for the same person; nothing of those rows is kept', {
        connector: connectorId,
        people: twice.size,
      });
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
        // Checked again under the source's lock, which an erasure takes for every source before it removes anything: a
        // person deactivated (and perhaps erased) since the page was read gets nothing, and one erased from here on
        // waits for this write and takes its rows with it.
        const active = await tx.activeIds([...new Set([...matched.map(m => m.personId), ...holders])]);
        const removed = existing.filter(h => !active.has(h.personId) || !keep(h.personId));
        const gone = new Set(removed.map(h => h.id));
        const plan = planCopy({
          connectorId,
          // What a person answered by two rows already has is left out of the plan: neither revoked for absence nor
          // marked as read again, since nothing this read says of them is known to be theirs.
          existing: existing.filter(h => !gone.has(h.id) && !twice.has(h.personId)),
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
     * a copied one with its source and when it was read; after them the copied rows whose type is not mapped, under the
     * source's own label and marked as counting towards nothing (D108 item 9).
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
        const { standings: held, waiting } = await standingsWith(tx, [personId], today);
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
     * without regard to case, how many of their holdings have run out, how many soon will and how many count. A
     * person with no holding has a row too, since it is where a first certificate is registered from. A key that is
     * nobody the reader manages has no row, and is never a refusal.
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
          asked.map(a => a.id),
          today,
        ),
      );
      return {
        rows: asked.map(a => ({ key: a.key, ...summarise(all.filter(s => s.holding.personId === a.id)) })),
      };
    },

    /**
     * `competence.attention` (D108 item 11): what has expired or expires within 90 days among the manager's reports,
     * the expired first.
     */
    async attention(persona: AuthenticatedContext): Promise<CompetenceAttentionOutput> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const due = (await standings(tx, [...people.keys()], today)).filter(needsAttention);
        const persons = new Map((await tx.persons([...new Set(due.map(s => s.holding.personId))])).map(p => [p.id, p]));
        const names = await sourceNames(tx);
        const rows = due.flatMap(s => {
          const person = persons.get(s.holding.personId);
          return person ? [holdingRow(s, person, names)] : [];
        });
        return { rows: orderHoldingRows(rows) };
      });
    },

    /**
     * The area's figure and the manager's card: how many holdings among the reports have expired and how many expire
     * within 90 days, and how many people that is. Null for someone who manages nobody.
     */
    async summary(
      persona: AuthenticatedContext,
    ): Promise<{ expired: number; expiring: number; people: number; reports: number } | null> {
      const { manages, people } = await reports(persona);
      if (!manages) return null;
      const today = swedishDay(now());
      const due = (await deps.store.transaction(tx => standings(tx, [...people.keys()], today))).filter(needsAttention);
      return {
        expired: due.filter(s => s.status === 'expired').length,
        expiring: due.filter(s => s.status === 'expiring').length,
        people: new Set(due.map(s => s.holding.personId)).size,
        reports: people.size,
      };
    },

    /** The reader's own holdings that have expired or expire within 90 days, the soonest first: what their card says. */
    async ownAttention(persona: AuthenticatedContext): Promise<Standing[]> {
      const today = swedishDay(now());
      const due = (await deps.store.transaction(tx => standings(tx, [persona.id], today))).filter(needsAttention);
      return due.sort((a, b) => (a.end ?? '').localeCompare(b.end ?? '') || a.holding.id.localeCompare(b.holding.id));
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
     * Erase one person from the domain (D108 item 14): their holdings, copied ones included, and their id on the holdings
     * they registered or revoked for others. Only for a person the directory has deactivated: an active person is refused
     * with `PersonStillActive`. `actor` is the operator's.
     */
    async erasePerson(actor: string, personId: string): Promise<{ holdings: number; cleared: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        // Erasure is for a person the directory has deactivated (item 14): an active person's copied rows would come
        // back at the next read of their source, and their manager's attestations are still in use.
        if ((await tx.activeIds([personId])).has(personId)) throw new PersonStillActive();
        const erased = await tx.erasePerson(personId);
        const counted = { holdings: erased.holdings, cleared: erased.cleared };
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
          details: { types: data.types.length, holdings: data.holdings.length, mappings: data.mappings.length },
        });
        return { format: COMPETENCE_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type CompetenceUsecases = ReturnType<typeof competenceUsecases>;
