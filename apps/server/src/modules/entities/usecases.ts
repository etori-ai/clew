import { audiencedActorOf, type AboutRead } from '@clew/connectors';
import type {
  AuthenticatedContext,
  EntityDetail,
  EntityKind,
  EntityList,
  EntityRows,
  EntitySection,
} from '@clew/contracts';
import {
  actionOf,
  attentionOf,
  checkRows,
  chunk,
  columnsOf,
  combine,
  groupsOf,
  isKey,
  lensesOf,
  listedKeys,
  belowUnit,
  memberUnit,
  unitsBelow,
  personKey,
  personRef,
  managedPerson,
  personRelation,
  placed,
  unitRelation,
  sectionsOf,
  unitRef,
  type Checked,
} from './domain';
import { DEFAULT_BUDGET, type EntityDeps } from './model';

type Answer = ({ status: 'ok' } & Checked) | { status: 'unavailable' | 'timeout' };
type Found = Pick<EntityDetail, 'entity' | 'relation' | 'profile' | 'below' | 'above'>;

/**
 * Entities (D97): a person or a unit, and what the sources that declare `about` say of it, placed by Clew. Who may be
 * asked about is the core rule here (`personRelation`), checked before any source is called, and the registry checks it
 * again on every call against what the source admits (D117, `relations.ts`); a source is then sent only those keys, at
 * most what one of its calls takes, and may narrow further as the person. A read runs as the figure batch does (D75): one
 * budget per source, a cap on calls at once, what still runs cancelled when the budget ends, the person's authority
 * checked again afterwards, nothing stored. A source that fails or does not answer in time gives its status and no
 * rows; it never fails the request. Every read answers undefined for what the reader may not reach (a key outside the
 * rule, a source not theirs or, for the list, not placed), which the route answers 404 without telling which.
 */
export function entityUsecases(deps: EntityDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };

  /**
   * One source over these keys: in calls of at most `read.batch` keys, `concurrency` at a time, all within `totalMs`.
   * The first call that fails stops the rest; when the budget ends what still runs is cancelled. Rows are kept only
   * when every call answered, so an absent row always means "nothing about this one", never "not asked".
   */
  async function ask(
    persona: AuthenticatedContext,
    kind: EntityKind,
    read: AboutRead,
    keys: string[],
  ): Promise<Answer> {
    const calls = chunk(keys, read.batch);
    if (!calls.length) return { status: 'ok', rows: [] };
    const controller = new AbortController();
    const answers: Array<Checked | undefined> = calls.map(() => undefined);
    let failed = false,
      timedOut = false,
      next = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve(TIMEOUT);
      }, budget.totalMs);
    });
    const worker = async () => {
      while (!controller.signal.aborted && next < calls.length) {
        const i = next++;
        const asked = calls[i]!;
        const answer = await Promise.race([
          deps
            .read(persona, read.name, { keys: asked }, controller.signal)
            .then<Checked | typeof FAILED, typeof FAILED>(
              output => checkRows(kind, asked, read.view, output) ?? FAILED,
              () => FAILED,
            ),
          expired,
        ]);
        if (timedOut) return;
        if (answer === FAILED) {
          failed = true;
          controller.abort();
          return;
        }
        if (answer !== TIMEOUT) answers[i] = answer;
      }
    };
    try {
      const concurrency = Math.max(1, Math.floor(budget.concurrency));
      await Promise.all(Array.from({ length: Math.min(concurrency, calls.length) }, worker));
    } finally {
      clearTimeout(timer);
    }
    if (failed || timedOut) {
      const status = failed ? 'unavailable' : 'timeout';
      deps.log?.('a source about an entity gave no rows', { capability: read.name, status });
      return { status };
    }
    return { status: 'ok', ...combine(answers as Checked[]) };
  }

  /** The person's authority again after a batch (D75): a changed grant throws, and a source no longer theirs is gone. */
  async function stillAllowed(
    persona: AuthenticatedContext,
    kind: EntityKind,
    accept: (reads: AboutRead[]) => AboutRead | undefined,
  ): Promise<boolean> {
    await persona.authorize();
    return !!accept(await deps.sources.reads(audiencedActorOf(persona), kind));
  }

  /**
   * The entity behind Clew's key (D122: a person's id, a unit's id), and how the reader stands to it; undefined outside
   * the rule. A person: the reader (`self`), someone who reports to the reader on a unit they manage (`managed`, also
   * from below, D99, `reportsTo`), or another active person of the directory (`colleague`). A unit: one the reader
   * manages (`manages`), is placed on otherwise (`member`), or one whose manager reports to the reader (`below`, D117);
   * with the units under it that the reader follows up, and for a unit below the way up. A key that cannot name an
   * entity of the kind (a NUL in it, or too long) names nobody, before anything is read.
   */
  async function resolve(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    includeProfile = false,
  ): Promise<Found | undefined> {
    if (!isKey(kind, key)) return undefined;
    if (kind === 'unit') {
      const reach = await deps.directory.reach(persona);
      const member = memberUnit(reach, key),
        below = member ? undefined : belowUnit(reach, key),
        unit = member ?? below,
        relation = unitRelation(reach, key);
      if (!unit || !relation) return undefined;
      const under = unitsBelow(reach)
        .filter(u => u.under === unit.unitId)
        .map(u => ({ key: u.unitId, name: u.unitLabel }));
      // The way up from a unit below: the reader's own unit its manager reports to.
      const up = below && memberUnit(reach, below.under);
      return {
        entity: { ...unitRef(unit) },
        relation,
        ...(under.length ? { below: under } : {}),
        ...(up ? { above: { key: up.unitId, name: up.unitLabel } } : {}),
      };
    }
    const person = await deps.directory.person(persona, key, includeProfile);
    if (!person || person.id !== key || !personKey(person) || !person.userName) return undefined;
    const self = person.id === persona.id;
    const reach = self ? undefined : await deps.directory.reach(persona);
    // The rule the registry applies to every call (D117): this page and a source's answer never disagree on it.
    const relation = personRelation(persona, reach ?? NOBODY, person);
    const managed = reach && managedPerson(reach, person.id);
    // Where the person is: the reader's own unit for the reader, the unit the reader manages that they are placed on,
    // else their own unit, also for someone who reports to the reader from below (D99), whom that card does not place.
    const unit =
      self && persona.unitId
        ? { unitId: persona.unitId, unitLabel: persona.unitLabel }
        : managed?.placed
          ? managed.unit
          : person.unit;
    // Its page opens, as `/units/<id>` answers, only for a unit the reader manages, belongs to or follows up from above
    // (D117): the reader's own always.
    const opens = !!unit && (!reach || !!memberUnit(reach, unit.unitId) || !!belowUnit(reach, unit.unitId));
    return {
      entity: {
        ...personRef({ ...person, userName: person.userName }, unit),
        ...(unit
          ? { unit: { id: unit.unitId, label: unit.unitLabel, ...(opens ? { opens: true as const } : {}) } }
          : {}),
      },
      relation,
      ...(person.profile ? { profile: person.profile } : {}),
    };
  }

  /**
   * The reader's people or units in groups, with the administrator's columns and lenses, the actions, and "Just nu": the
   * reader's cards about each entity of the list, from one read of the index for the whole list (D97 item 5).
   */
  async function list(persona: AuthenticatedContext, kind: EntityKind): Promise<EntityList> {
    const actor = audiencedActorOf(persona);
    const [reach, reads, actions] = await Promise.all([
      deps.directory.reach(persona),
      deps.sources.reads(actor, kind),
      deps.sources.actions(actor, kind),
    ]);
    // "Just nu" is by Clew's key (D122): a card's rows name a person by id.
    const keys = listedKeys(kind, reach).map(e => e.key);
    const cards =
      deps.cardsNaming && keys.length
        ? await deps.cardsNaming(
            persona,
            keys.map(key => ({ entity: kind, key })),
          )
        : [];
    return {
      kind,
      groups: groupsOf(kind, reach),
      columns: columnsOf(reads),
      lenses: lensesOf(reads),
      // A row's menu is on the reader's people or units (D117): a person's action that admits no report is not offered
      // there; each row's own page says exactly which actions it offers.
      actions: actions.filter(a => kind === 'unit' || a.admits.includes('managed')).map(actionOf),
      attention: attentionOf(keys, cards),
    };
  }

  /** One source over every entity of the list (a lens, a column, the marks); only a source an administrator placed. */
  async function rows(
    persona: AuthenticatedContext,
    kind: EntityKind,
    capability: string,
  ): Promise<EntityRows | undefined> {
    const read = placed(await deps.sources.reads(audiencedActorOf(persona), kind), capability);
    if (!read) return undefined;
    // The people on the list are the reader's, so a source that admits no report is not asked; the registry leaves out
    // anyone on it who is not a report (a co-manager) and any unit the source does not admit (D117).
    if (kind === 'person' && !read.admits.includes('managed')) return { capability, status: 'ok', rows: [] };
    // A source is asked with its own key (a person's user name, D96 talks item 8), and its rows answer with it.
    const answer = await ask(
      persona,
      kind,
      read,
      listedKeys(kind, await deps.directory.reach(persona)).map(e => e.sourceKey),
    );
    if (!(await stillAllowed(persona, kind, reads => placed(reads, capability)))) return undefined;
    return answer.status === 'ok'
      ? {
          capability,
          status: 'ok',
          rows: answer.rows,
          ...(answer.heading !== undefined ? { heading: answer.heading } : {}),
          ...(answer.note !== undefined ? { note: answer.note } : {}),
        }
      : { capability, status: answer.status, rows: [] };
  }

  /** The opened entity: how the reader stands to it, its actions, a section per source and the cards about it. */
  async function detail(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
  ): Promise<EntityDetail | undefined> {
    const found = await resolve(persona, kind, key, true);
    if (!found) return undefined;
    const actor = audiencedActorOf(persona);
    const [reads, actions, cards] = await Promise.all([
      deps.sources.reads(actor, kind),
      deps.sources.actions(actor, kind),
      deps.cards(persona, { entity: kind, key: found.entity.key }),
    ]);
    // An action is offered only where the reader stands to the entity as it admits (D117); the registry refuses the rest.
    const offered = actions.filter(a => a.admits.includes(found.relation));
    return { ...found, actions: offered.map(actionOf), sections: sectionsOf(reads), cards };
  }

  /** One source's answer for one entity: any read about the kind the reader may call. */
  async function section(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
  ): Promise<EntitySection | undefined> {
    const byName = (reads: AboutRead[]) => reads.find(r => r.name === capability);
    const read = byName(await deps.sources.reads(audiencedActorOf(persona), kind));
    if (!read) return undefined;
    const found = await resolve(persona, kind, key);
    if (!found) return undefined;
    // A source that does not admit how the reader stands to the entity (D117) is not asked: it has no row for them.
    if (!read.admits.includes(found.relation)) return { capability, status: 'ok' };
    const answer = await ask(persona, kind, read, [found.entity.sourceKey]);
    if (!(await stillAllowed(persona, kind, byName))) return undefined;
    if (answer.status !== 'ok') return { capability, status: answer.status };
    const row = answer.rows[0];
    return { capability, status: 'ok', ...(row ? { row } : {}) };
  }

  return { list, rows, detail, section };
}
const TIMEOUT = Symbol('timeout');
const FAILED = Symbol('failed');
/** Where a reader stands who is asked about themself: their own record is enough, nobody else is read. */
const NOBODY = { units: [], managed: [], above: [], lineReports: [] };
export type EntityUsecases = ReturnType<typeof entityUsecases>;
