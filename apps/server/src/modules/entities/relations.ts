import type { AboutSubject, Actor, Related } from '@clew/connectors';
import { foldSourceKey, type EntityKind, type Relation } from '@clew/contracts';
import {
  isKey,
  isSourceKey,
  personKey,
  personRelation,
  registrarFor,
  reportById,
  reportOf,
  unitRelation,
} from './domain';
import type { DirectoryPerson, RelationDeps } from './model';

/**
 * Who may be asked about, for every call (D97 item 8, D117). The registry asks this before it runs a capability whose
 * input names people or units, on every path: a route, a card, a tool, a connector's callback, a nested call, a
 * document's bytes. It is the entities module's own rule, the one the opened entity follows (`personRelation`,
 * `unitRelation`), read from the people directory on every call so a change of unit or a deactivation counts from the
 * next call on. Nothing is stored. A directory that cannot be read throws; it never answers "nobody".
 */
export function relationUsecases(deps: RelationDeps) {
  /**
   * How the actor stands to each of these keys, for the relations in `admits` only; a key of nobody, of a deactivated
   * person, outside the actor's organisation or outside `admits` is absent, and so is a person without a user name
   * unless `ids` lets them be named by their id (below). The keys are a source's keys (D122): a person's user name,
   * compared as Clew compares one (`foldSourceKey`). Every spelling asked is answered on its own, with the directory's
   * spelling in `key`. A colleague is looked up (who holds the name, then the directory) only when `admits` lets one
   * through, so a strict read costs one read of where the actor stands. A reader who holds the grant `registrar` (D121,
   * from their current access record) stands so to such a person instead, but only for a read that admits it: to any
   * other read they are the colleague they are, so the grant reaches nothing else and no source is told it unasked.
   * With `ids` (a core capability of Clew's own domains), a person may also be named by Clew's id, as themself or as a
   * report, and only where `admits` lets that relation through; never as a colleague or a registrar's. Someone with a
   * user name is answered by it in `key`, the key the capability reads, so Clew's own records may name them by id
   * (D122, a card's action); someone without one is answered by the id.
   *
   * For units, `identifiers` names the types of unit identifier the capability reads (D148): each unit the reader may
   * ask about is answered with what the directory pushed of those types, and of no other; without it nothing is read.
   */
  async function relate(
    actor: Actor,
    entity: EntityKind,
    keys: readonly string[],
    admits: readonly Relation[],
    options: { ids?: boolean; identifiers?: readonly string[] } = {},
  ): Promise<Related[]> {
    if (!keys.length || !admits.length) return [];
    const reader = await deps.reader(actor);
    if (!reader || reader.id !== actor.id) return [];
    const reach = await deps.directory.reach(reader);
    if (entity === 'unit') {
      const related = keys.flatMap((asked): Related[] => {
        const relation = isKey('unit', asked) ? unitRelation(reach, asked) : undefined;
        return relation && admits.includes(relation) ? [{ asked, key: asked, relation, id: asked }] : [];
      });
      const types = options.identifiers ?? [];
      if (!types.length || !related.length) return related;
      // Only for the units the reader may ask about, and only the types the capability reads.
      const known = await deps.directory.unitIdentifiers(reader, [...new Set(related.map(r => r.key))]);
      return related.map(r => {
        const identifiers = (known.get(r.key) ?? []).filter(i => types.includes(i.type));
        return identifiers.length ? { ...r, identifiers } : r;
      });
    }
    // Who holds the names that are neither the reader's own nor a report's, read once for every key, and only when a
    // colleague, or a registrar's, may be asked about.
    const own = (asked: string) =>
      !!reader.userName && foldSourceKey('person', reader.userName) === foldSourceKey('person', asked);
    // D121: a registrar stands so to everyone else of their organisation, for a read that admits it alone.
    const registrar = registrarFor(reader, admits);
    const others =
      admits.includes('colleague') || registrar
        ? keys.filter(asked => isSourceKey(asked) && !own(asked) && !reportOf(reach, asked))
        : [];
    const held = others.length ? await deps.holders(reader.id, [...new Set(others)]) : new Map<string, string>();
    const colleagues = new Map<string, DirectoryPerson | undefined>();
    const out: Related[] = [];
    for (const asked of keys) {
      if (!isSourceKey(asked)) continue;
      let person: DirectoryPerson | undefined = own(asked)
        ? { id: reader.id, name: reader.name, userName: reader.userName!, enabled: true }
        : reportOf(reach, asked)?.person;
      const id = person ? undefined : held.get(asked);
      if (id) {
        if (!colleagues.has(id)) colleagues.set(id, await deps.directory.person(reader, id, false));
        person = colleagues.get(id);
      }
      const key = person && personKey(person);
      if (person && key && foldSourceKey('person', key) === foldSourceKey('person', asked)) {
        const relation = personRelation(reader, reach, person, registrar);
        if (admits.includes(relation)) out.push({ asked, key, relation, id: person.id });
        continue;
      }
      // Clew's own id, where a core capability takes one (D117): the reader or a report, never anyone else.
      if (!options.ids) continue;
      const self = asked === reader.id;
      const byId: DirectoryPerson | undefined = self
        ? { id: reader.id, name: reader.name, userName: reader.userName ?? null, enabled: true }
        : reportById(reach, asked);
      const relation: Relation = self ? 'self' : 'managed';
      const named = byId && (byId.userName === null ? asked : personKey(byId));
      if (named && byId && admits.includes(relation)) out.push({ asked, key: named, relation, id: byId.id });
    }
    return out;
  }
  /**
   * Whether the actor stands today to each of these people and units as one of the relations it was read under (D150):
   * what decides whether a saved answer about them is shown again. Asked by Clew's own key, the person's id (D122), so a
   * user name that has passed to somebody else means nothing here. `self` and `managed` are read from where the actor
   * stands, once for them all; a `colleague` is anyone active of the actor's organisation, looked up only where the
   * read admitted one. A relation held by grant is never among `admits`: the assistant's reads resolve none (D122
   * item 5). An actor the directory does not hold stands to nobody. A directory that cannot be read throws.
   */
  async function stands(actor: Actor, subjects: readonly AboutSubject[]): Promise<boolean[]> {
    if (!subjects.length) return [];
    const reader = await deps.reader(actor);
    if (!reader || reader.id !== actor.id) return subjects.map(() => false);
    const reach = await deps.directory.reach(reader);
    const active = new Map<string, boolean>();
    const out: boolean[] = [];
    for (const subject of subjects) {
      if (subject.entity === 'unit') {
        const relation = isKey('unit', subject.id) ? unitRelation(reach, subject.id) : undefined;
        out.push(!!relation && subject.admits.includes(relation));
        continue;
      }
      // By Clew's key a report is one whether or not they have a user name, as `relate` reads one named by id.
      const relation =
        subject.id === reader.id ? 'self' : reportById(reach, subject.id) ? 'managed' : ('colleague' as const);
      if (relation !== 'colleague' || !subject.admits.includes('colleague')) {
        out.push(relation !== 'colleague' && subject.admits.includes(relation));
        continue;
      }
      if (!active.has(subject.id)) active.set(subject.id, !!(await deps.directory.person(reader, subject.id, false)));
      out.push(active.get(subject.id)!);
    }
    return out;
  }
  return { relate, stands };
}
export type RelationUsecases = ReturnType<typeof relationUsecases>;
