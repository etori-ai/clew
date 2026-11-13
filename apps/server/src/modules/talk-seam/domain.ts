import {
  foldSourceKey,
  type CommitmentRow,
  type CommitmentsResult,
  type TalkRow,
  type TalksResult,
} from '@clew/contracts';
import type { DirectoryPerson } from './model';

/**
 * The pure part of the talks seam (D96 item 8): how the one source's rows, keyed on the SCIM user name, become rows
 * about people the reader may see. No I/O: what is kept depends only on the answer and the reader's directory.
 */

/** The key another system knows a person by: the user name, or the id for a person provisioned without one. */
export const personKey = (person: DirectoryPerson) => person.userName ?? person.id;
/**
 * A key as the seam compares it (D97, A3): without regard to case and in its composed form, as the protocol says a
 * person key is compared and as SCIM keeps user names apart, so a source that writes `Anna.Berg` for the directory's
 * `anna.berg` keeps its rows.
 */
export const foldKey = (key: string) => foldSourceKey('person', key);

/**
 * Folded key to person id. A key two different people share names neither of them, so its rows are dropped rather than
 * shown under the wrong person. Look a row up with `foldKey(row.userName)`.
 */
export function keyIndex(people: DirectoryPerson[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const person of people) {
    const key = foldKey(personKey(person));
    const known = index.get(key);
    if (known !== undefined && known !== person.id) ambiguous.add(key);
    else index.set(key, person.id);
  }
  for (const key of ambiguous) index.delete(key);
  return index;
}

/** A manager's rows: only the people on the units the reader manages now. A system never widens what the reader sees. */
export function mapTalkRows(rows: TalkRow[], staff: DirectoryPerson[]): TalksResult['rows'] {
  const index = keyIndex(staff);
  return rows.flatMap(row => {
    const personId = index.get(foldKey(row.userName));
    return personId === undefined ? [] : [{ ...row, personId }];
  });
}

/** The longest id the result contract takes (`id` in `@clew/contracts`). */
const ID_MAX = 80;
/** The built-in module's own id of an action point, from its ref `commitment:<built-in id>:<id>`; undefined when the ref has another form. */
export function builtInId(ref: string, connectorId: string): string | undefined {
  const prefix = 'commitment:' + connectorId + ':';
  if (!ref.startsWith(prefix)) return undefined;
  const id = ref.slice(prefix.length);
  return id.length > 0 && id.length <= ID_MAX ? id : undefined;
}

export interface CommitmentMapping {
  self: DirectoryPerson;
  staff: DirectoryPerson[];
  /** The `person` the reader asked about: only rows about that key are kept. */
  person?: string;
  /** Set when the built-in module answered: each row gets its own id from the ref, and a row without one is dropped. */
  builtIn?: string;
  /**
   * The person ids of the keys `ownedElsewhere` returns, by the key as the row has it (M2): a point the reader
   * owns about someone they no longer manage stays theirs until it is done (D96 As built item 5), so it keeps its row on
   * the reader's Hem with the employee's id from `Holders`. Read only for the built-in module, whose `mine` is Clew's own.
   */
  owned?: ReadonlyMap<string, string>;
}
/**
 * The keys of the built-in module's rows that the reader owns about someone who is neither the reader nor one of the
 * people they manage now (M2): a former manager's own action points. Each key once, as the rows have it.
 */
export function ownedElsewhere(rows: CommitmentRow[], mapping: Pick<CommitmentMapping, 'self' | 'staff'>): string[] {
  const index = keyIndex([mapping.self, ...mapping.staff]);
  return [...new Set(rows.filter(row => row.mine && !index.has(foldKey(row.userName))).map(row => row.userName))];
}
/**
 * Action points about the reader or about the people they manage now, each with the employee's person id; with the
 * built-in module, also the points the reader owns about someone they managed before (`owned`).
 */
export function mapCommitmentRows(rows: CommitmentRow[], mapping: CommitmentMapping): CommitmentsResult['rows'] {
  const index = keyIndex([mapping.self, ...mapping.staff]);
  const person = mapping.person === undefined ? undefined : foldKey(mapping.person);
  return rows.flatMap(row => {
    const key = foldKey(row.userName);
    if (person !== undefined && key !== person) return [];
    const personId =
      index.get(key) ??
      (mapping.builtIn !== undefined && person === undefined && row.mine
        ? mapping.owned?.get(row.userName)
        : undefined);
    if (personId === undefined) return [];
    if (mapping.builtIn === undefined) return [{ ...row, personId }];
    const id = builtInId(row.ref, mapping.builtIn);
    return id === undefined ? [] : [{ ...row, personId, id }];
  });
}
