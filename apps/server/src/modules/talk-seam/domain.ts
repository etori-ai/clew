import type { CommitmentRow, CommitmentsResult, TalkRow, TalksResult } from '@clew/contracts';
import type { DirectoryPerson } from './model';

/**
 * The pure part of the talks seam (D96 item 8): how the one source's rows, keyed on the SCIM user name, become rows
 * about people the reader may see. No I/O: what is kept depends only on the answer and the reader's directory.
 */

/** The key another system knows a person by: the user name, or the id for a person provisioned without one. */
export const personKey = (person: DirectoryPerson) => person.userName ?? person.id;

/**
 * Key to person id. A key two different people share names neither of them, so its rows are dropped rather than
 * shown under the wrong person.
 */
export function keyIndex(people: DirectoryPerson[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const person of people) {
    const key = personKey(person);
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
    const personId = index.get(row.userName);
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
}
/** Action points about the reader or about the people they manage now, each with the employee's person id. */
export function mapCommitmentRows(rows: CommitmentRow[], mapping: CommitmentMapping): CommitmentsResult['rows'] {
  const index = keyIndex([mapping.self, ...mapping.staff]);
  return rows.flatMap(row => {
    if (mapping.person !== undefined && row.userName !== mapping.person) return [];
    const personId = index.get(row.userName);
    if (personId === undefined) return [];
    if (mapping.builtIn === undefined) return [{ ...row, personId }];
    const id = builtInId(row.ref, mapping.builtIn);
    return id === undefined ? [] : [{ ...row, personId, id }];
  });
}
