import { actorOf, type AboutRead } from '@clew/connectors';
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
  checkRows,
  chunk,
  columnsOf,
  combine,
  foldKey,
  groupsOf,
  isKey,
  lensesOf,
  listedKeys,
  managedPerson,
  memberUnit,
  personKey,
  personRef,
  placed,
  sourceOf,
  unitRef,
  type Checked,
} from './domain';
import { DEFAULT_BUDGET, type EntityDeps } from './model';

type Answer = ({ status: 'ok' } & Checked) | { status: 'unavailable' | 'timeout' };
type Found = { entity: EntityDetail['entity']; relation: EntityDetail['relation'] };

/**
 * Entities (D97): a person or a unit, and what the sources that declare `about` say of it, placed by Clew. Who may be
 * asked about is the core rule here, checked before any source is called; a source is then sent only those keys, at
 * most what one of its calls takes, and narrows further as the person. A read runs as the figure batch does (D75): one
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
    return !!accept(await deps.sources.reads(actorOf(persona), kind));
  }

  /**
   * The entity behind a key, and how the reader stands to it; undefined outside the rule. A person: the reader
   * (`self`), someone on a unit the reader manages (`managed`) or another active person of the directory (`colleague`).
   * A unit: one the reader manages or belongs to (`member`).
   */
  async function resolve(persona: AuthenticatedContext, kind: EntityKind, key: string): Promise<Found | undefined> {
    if (!isKey(key)) return undefined;
    if (kind === 'unit') {
      const unit = memberUnit(await deps.directory.reach(persona), key);
      return unit && { entity: { ...unitRef(unit) }, relation: 'member' };
    }
    if (persona.userName && foldKey('person', persona.userName) === foldKey('person', key)) {
      const unit = persona.unitId ? { unitId: persona.unitId, unitLabel: persona.unitLabel } : null;
      return {
        entity: {
          ...personRef({ id: persona.id, name: persona.name, userName: persona.userName, enabled: true }, unit),
          ...(unit ? { unit: { id: unit.unitId, label: unit.unitLabel } } : {}),
        },
        relation: 'self',
      };
    }
    const managed = managedPerson(await deps.directory.reach(persona), key);
    if (managed)
      return {
        entity: {
          ...personRef(managed.person, managed.unit),
          unit: { id: managed.unit.unitId, label: managed.unit.unitLabel },
        },
        relation: 'managed',
      };
    const colleague = await deps.directory.colleague(persona, key);
    if (!colleague || colleague.id === persona.id || !personKey(colleague)) return undefined;
    return {
      entity: {
        ...personRef({ ...colleague, userName: colleague.userName! }, colleague.unit),
        ...(colleague.unit ? { unit: { id: colleague.unit.unitId, label: colleague.unit.unitLabel } } : {}),
      },
      relation: 'colleague',
    };
  }

  /** The reader's people or units in groups, with the administrator's columns and lenses and the actions. */
  async function list(persona: AuthenticatedContext, kind: EntityKind): Promise<EntityList> {
    const actor = actorOf(persona);
    const [reach, reads, actions] = await Promise.all([
      deps.directory.reach(persona),
      deps.sources.reads(actor, kind),
      deps.sources.actions(actor, kind),
    ]);
    return {
      kind,
      groups: groupsOf(kind, reach),
      columns: columnsOf(reads),
      lenses: lensesOf(reads),
      actions: actions.map(actionOf),
    };
  }

  /** One source over every entity of the list (a lens, a column, the marks); only a source an administrator placed. */
  async function rows(
    persona: AuthenticatedContext,
    kind: EntityKind,
    capability: string,
  ): Promise<EntityRows | undefined> {
    const read = placed(await deps.sources.reads(actorOf(persona), kind), capability);
    if (!read) return undefined;
    const answer = await ask(persona, kind, read, listedKeys(kind, await deps.directory.reach(persona)));
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
    const found = await resolve(persona, kind, key);
    if (!found) return undefined;
    const actor = actorOf(persona);
    const [reads, actions, cards] = await Promise.all([
      deps.sources.reads(actor, kind),
      deps.sources.actions(actor, kind),
      deps.cards(persona, { entity: kind, key: found.entity.key }),
    ]);
    return { ...found, actions: actions.map(actionOf), sections: reads.map(sourceOf), cards };
  }

  /** One source's answer for one entity: any read about the kind the reader may call. */
  async function section(
    persona: AuthenticatedContext,
    kind: EntityKind,
    key: string,
    capability: string,
  ): Promise<EntitySection | undefined> {
    const byName = (reads: AboutRead[]) => reads.find(r => r.name === capability);
    const read = byName(await deps.sources.reads(actorOf(persona), kind));
    if (!read) return undefined;
    const found = await resolve(persona, kind, key);
    if (!found) return undefined;
    const answer = await ask(persona, kind, read, [found.entity.key]);
    if (!(await stillAllowed(persona, kind, byName))) return undefined;
    if (answer.status !== 'ok') return { capability, status: answer.status };
    const row = answer.rows[0];
    return { capability, status: 'ok', ...(row ? { row } : {}) };
  }

  return { list, rows, detail, section };
}
const TIMEOUT = Symbol('timeout');
const FAILED = Symbol('failed');
export type EntityUsecases = ReturnType<typeof entityUsecases>;
