import type { Actor, Related } from '@clew/connectors';
import type { EntityKind, Relation } from '@clew/contracts';
import { foldKey, isKey, personKey, personRelation, registrarFor, reportById, reportOf, unitRelation } from './domain';
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
   * person, of a person without a user name, outside the actor's organisation or outside `admits` is absent. Every
   * spelling asked is answered on its own, with the directory's spelling in `key`. A colleague is looked up in the
   * directory only when `admits` lets one through, so a strict read costs one read of where the actor stands. A reader
   * who holds the grant `registrar` (D121, from their current access record) stands so to such a person instead, but
   * only for a read that admits it: to any other read they are the colleague they are, so the grant reaches nothing
   * else and no source is told it unasked. With `ids` (a core capability of Clew's own domains), a person without a
   * user name may also be named by Clew's id, as themself or as a report; never as a colleague or a registrar's, and
   * never someone who has a user name.
   */
  async function relate(
    actor: Actor,
    entity: EntityKind,
    keys: readonly string[],
    admits: readonly Relation[],
    options: { ids?: boolean } = {},
  ): Promise<Related[]> {
    if (!keys.length || !admits.length) return [];
    const reader = await deps.reader(actor);
    if (!reader || reader.id !== actor.id) return [];
    const reach = await deps.directory.reach(reader);
    if (entity === 'unit')
      return keys.flatMap(asked => {
        const relation = isKey(asked) ? unitRelation(reach, asked) : undefined;
        return relation && admits.includes(relation) ? [{ asked, key: asked, relation }] : [];
      });
    const colleagues = new Map<string, DirectoryPerson | undefined>();
    // D121: a registrar stands so to everyone else of their organisation, for a read that admits it alone.
    const registrar = registrarFor(reader, admits);
    const out: Related[] = [];
    for (const asked of keys) {
      if (!isKey(asked)) continue;
      const folded = foldKey('person', asked);
      let person: DirectoryPerson | undefined =
        reader.userName && foldKey('person', reader.userName) === folded
          ? { id: reader.id, name: reader.name, userName: reader.userName, enabled: true }
          : reportOf(reach, asked)?.person;
      if (!person && (admits.includes('colleague') || registrar)) {
        if (!colleagues.has(folded)) colleagues.set(folded, await deps.directory.person(reader, asked, false));
        person = colleagues.get(folded);
      }
      const key = person && personKey(person);
      if (person && key) {
        const relation = personRelation(reader, reach, { id: person.id, userName: key }, registrar);
        if (relation && admits.includes(relation)) out.push({ asked, key, relation });
        continue;
      }
      // Clew's own id, for a person without a user name, where a core capability takes one (D117).
      if (!options.ids) continue;
      const relation: Relation | undefined =
        asked === reader.id && !reader.userName ? 'self' : reportById(reach, asked) ? 'managed' : undefined;
      if (relation && admits.includes(relation)) out.push({ asked, key: asked, relation });
    }
    return out;
  }
  return { relate };
}
export type RelationUsecases = ReturnType<typeof relationUsecases>;
