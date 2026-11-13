import type {
  AuthenticatedContext,
  Capability,
  CompetenceAttentionOutput,
  CompetenceHoldingBody,
  CompetenceHoldingsInput,
  CompetenceHoldingsOutput,
  CompetenceType,
  CompetenceTypeBody,
  CompetenceTypePatch,
  CompetenceValidityImpact,
  StaffPerson,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  counts,
  deciding,
  endOf,
  holdingRow,
  isCalendarDay,
  needsAttention,
  normaliseArea,
  normaliseName,
  orderHoldingRows,
  orderTypes,
  personKey,
  statusOn,
  summarise,
  swedishDay,
  typeRow,
  type PersonSummary,
  type Standing,
} from './domain';
import { TypeNameTaken, type CompetenceDeps, type CompetenceExport, type CompetenceTx, type TypeRecord } from './model';

/** A request the competence module turns down for what it asks, not who asks (D108); a 400 with this message. */
export class CompetenceError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'CompetenceError';
  }
}
/** The grant capability behind the catalogue (D108 item 8). */
export const COMPETENCE_ADMIN: Capability = 'admin.competence';
/** The version of the export document (D108 item 14); a breaking change is a new version. */
export const COMPETENCE_EXPORT_FORMAT = 'clew.competence/1';
/**
 * What erasing one person from the domain did, counts only (D108 item 14), or why it erased nothing: an id the people
 * table does not hold, or a person the source has not deactivated (D122 item 7, D120 item 3).
 */
export type CompetenceErasure =
  { refused: 'unknown' | 'active' } | { holdings: number; cleared: number; cards: number };
const NOT_A_MANAGER = 'Intyg registreras av den som är chef för en enhet.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_TYPE = 'Kompetensen finns inte i katalogen.';
const ARCHIVED = 'Kompetensen är arkiverad och kan inte registreras.';
const BAD_DAY = 'Ange ett giltigt datum.';
const NAME_TAKEN = 'Det finns redan en kompetens med det namnet.';
const BAD_NAME = 'Ange ett namn på högst 120 tecken.';
const BAD_AREA = 'Ange ett område på högst 80 tecken.';
const NOT_ALLOWED = 'Du kan inte ändra det här intyget.';

/**
 * The competence module's use cases (D108): the catalogue, a manager's registration of a certificate, and the reads
 * that work out where every holding stands today. A manager's reach is their reports, computed when asked
 * (`deps.staff`, D99 item 4) and never stored, so a former manager reads and writes nothing the day the line changes.
 * Every change is one `deps.store` transaction with its audit row. Audit rows carry ids, dates, counts and kinds:
 * never a person's name or a type's name.
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
  /** Where every counted holding of these people stands today: one standing per person and type. */
  async function standings(tx: CompetenceTx, personIds: readonly string[], today: string): Promise<Standing[]> {
    const holdings = await tx.holdingsOf(personIds);
    const types = new Map((await tx.typesById([...new Set(holdings.map(h => h.typeId))])).map(t => [t.id, t]));
    return deciding(holdings, types, today);
  }
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
     * report holds, for the manager they report to. Without: the reader's own. For each type the holding that decides.
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
        return { rows: orderHoldingRows((await standings(tx, [personId], today)).map(s => holdingRow(s, person))) };
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
        const rows = due.flatMap(s => {
          const person = persons.get(s.holding.personId);
          return person ? [holdingRow(s, person)] : [];
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
     * Erase one person from the domain (D108 item 14): their holdings, their id on the holdings they registered or
     * revoked for others, and the cards the competence scan put in their own stream. `actor` is the operator's. An id
     * the people table does not hold (a user name, a typo) and a person who is still active erase nothing and write no
     * audit row: only a person the source has deactivated is erased (D120 item 3).
     */
    async erasePerson(actor: string, personId: string): Promise<CompetenceErasure> {
      const at = now().toISOString();
      return deps.store.transaction(async (tx): Promise<CompetenceErasure> => {
        const [person] = await tx.persons([personId]);
        if (!person) return { refused: 'unknown' };
        if (person.enabled) return { refused: 'active' };
        const erased = await tx.erasePerson(personId);
        const cards = await tx.cards.removeOwn(personId, actor, at);
        const counted = { holdings: erased.holdings, cleared: erased.cleared, cards };
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
          details: { types: data.types.length, holdings: data.holdings.length },
        });
        return { format: COMPETENCE_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type CompetenceUsecases = ReturnType<typeof competenceUsecases>;
