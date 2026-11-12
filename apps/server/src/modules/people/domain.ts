/**
 * Deriving a person's authority from what was pushed (D68) and mapped (D85). Pure: no I/O, no clock.
 *
 * A group's meaning is a key in its `externalId`: `unit:<unitId>` makes the member an employee of that unit and names
 * it with the group's `displayName`; `unit-manager:<unitId>` makes the member its manager, which wins over `unit:` for
 * the same unit; `capability:<name>` gives a capability of the closed list; `protected` was to keep the person out of
 * lists others see, and D93 refuses that key at the boundary until Clew decides whether it may hold the fact, so the
 * flag below is false in any installation provisioned since. Any other group gives nothing here; a rules row (group
 * to capability) may give a capability. A person with no unit membership has no active grant, so a mapping mistake
 * fails closed.
 */
import {
  CAPABILITIES,
  EmploymentSchema,
  checkContract,
  isCapability,
  type Capability,
  type DirectoryPhone,
  type Employment,
  type OrganisationOverview,
  type OrganisationUnit,
  type Role,
  type UserStatus,
} from '@clew/contracts';
import {
  UNIT_KEY,
  MANAGER_KEY,
  CAPABILITY_KEY,
  PROTECTED_KEY,
  reservedScimGroupKey,
} from '@clew/contracts/scim-group-key';

/** The unit a group's key names, whichever of the unit's two groups it is; undefined for any other key. */
export const unitOfKey = (externalId: string | null | undefined): string | undefined =>
  externalId?.startsWith(MANAGER_KEY)
    ? externalId.slice(MANAGER_KEY.length)
    : externalId?.startsWith(UNIT_KEY)
      ? externalId.slice(UNIT_KEY.length)
      : undefined;
export interface Membership {
  externalId: string;
  label: string;
}
/** One row of D85's table: a group gives its members a capability. */
export interface GroupCapabilityRule {
  groupExternalId: string;
  capability: string;
}
export interface Assignment {
  unitId: string;
  role: Role;
}
/**
 * A unit the person is assigned to: labelled by its `unit:` group, else as the unit table knows it, else by its id. One
 * per assignment, so the unit row exists before the assignment that references it (a manager of a unit nobody has
 * pushed a `unit:` group for yet).
 */
export interface DerivedUnit {
  id: string;
  label: string;
}
/** The grant projection: the one active assignment with its label, and the capabilities (`auth_access_grant`). */
export interface Grant {
  unitId: string;
  unitLabel: string;
  role: Role;
  capabilities: Capability[];
}
export interface Derived {
  /** Every unit the person is assigned to, sorted by unit id. */
  units: DerivedUnit[];
  /** Every assignment, one per unit, sorted by unit id. */
  assignments: Assignment[];
  /** The assignment the person acts as until switching exists: manager before employee, then the lowest unit id. */
  active: Assignment | undefined;
  capabilities: Capability[];
  protected: boolean;
  grant: Grant | undefined;
}
/**
 * The order of unit ids, which decides the active assignment (D101 item 8): character by character, by UTF-16 code
 * unit, as `<` and JavaScript's default sort compare. A unit id is an opaque key, so no locale orders it: `Skola` comes
 * before `förskola`, `z` before `ä`, `10` before `9`, and no upgrade of ICU or Node moves anyone's active unit. Both
 * adapters reach the active unit through this one derivation.
 */
const byUnitId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function activeOf(assignments: readonly Assignment[]): Assignment | undefined {
  return [...assignments].sort(
    (a, b) => Number(b.role === 'manager') - Number(a.role === 'manager') || byUnitId(a.unitId, b.unitId),
  )[0];
}
/**
 * `knownLabels` names units the person manages without a `unit:` membership of their own (a manager who is not also
 * listed as an employee), from the unit table; a unit known nowhere is labelled by its id.
 */
export function deriveAuthority(
  memberships: readonly Membership[],
  rules: readonly GroupCapabilityRule[],
  knownLabels: Readonly<Record<string, string>> = {},
): Derived {
  const roles = new Map<string, Role>(),
    labels = new Map<string, string>(),
    capabilities = new Set<Capability>(),
    held = new Set(memberships.map(m => m.externalId));
  let isProtected = false;
  for (const m of memberships) {
    if (m.externalId.startsWith(MANAGER_KEY)) {
      const unitId = m.externalId.slice(MANAGER_KEY.length);
      if (unitId) roles.set(unitId, 'manager');
    } else if (m.externalId.startsWith(UNIT_KEY)) {
      const unitId = m.externalId.slice(UNIT_KEY.length);
      if (!unitId) continue;
      if (roles.get(unitId) !== 'manager') roles.set(unitId, 'employee');
      labels.set(unitId, m.label);
    } else if (m.externalId.startsWith(CAPABILITY_KEY)) {
      const name = m.externalId.slice(CAPABILITY_KEY.length);
      if (isCapability(name)) capabilities.add(name);
    } else if (m.externalId === PROTECTED_KEY) isProtected = true;
  }
  for (const row of rules)
    if (held.has(row.groupExternalId) && isCapability(row.capability)) capabilities.add(row.capability);
  const assignments = [...roles.entries()]
    .map(([unitId, role]) => ({ unitId, role }))
    .sort((a, b) => byUnitId(a.unitId, b.unitId));
  const active = activeOf(assignments),
    sorted = [...capabilities].sort(),
    labelOf = (unitId: string) => labels.get(unitId) ?? knownLabels[unitId] ?? unitId;
  return {
    units: assignments.map(a => ({ id: a.unitId, label: labelOf(a.unitId) })),
    assignments,
    active,
    capabilities: sorted,
    protected: isProtected,
    grant: active && {
      unitId: active.unitId,
      unitLabel: labelOf(active.unitId),
      role: active.role,
      capabilities: sorted,
    },
  };
}
/** Whether two grant projections carry the same authority and label, so an unchanged derivation writes no audit row. */
export function sameGrant(a: Grant | undefined, b: Grant | undefined) {
  if (!a || !b) return a === b;
  return (
    a.unitId === b.unitId &&
    a.unitLabel === b.unitLabel &&
    a.role === b.role &&
    a.capabilities.length === b.capabilities.length &&
    a.capabilities.every((c, i) => c === b.capabilities[i])
  );
}

// ---- The organisation tree (D99): the pure half. Units and placements in, what a page draws out.

/** A node as pushed: a `unit:` group's unit id, name and the unit above it. */
export interface TreeUnit {
  id: string;
  label: string;
  parentId: string | null;
}
/** One person on one unit, or a person on none (`unitId` and `role` null). */
export interface Placement {
  personId: string;
  name: string;
  enabled: boolean;
  unitId: string | null;
  role: Role | null;
}
export const bySwedish = (a: string, b: string) => a.localeCompare(b, 'sv');
/**
 * D100: what the people list of Administration › Användare is narrowed by, as a store reads it. Every part narrows
 * further and an absent part narrows nothing. `words` each match, without regard to case, somewhere in the name, the
 * title (D110), the user name or the e-mail. `unitIds` is an assignment on one of the units, `role` an assignment
 * with that role, and the two together one assignment that is both. `status` is the row's reading of access
 * (`UserStatus`), `capability` a capability on the grant.
 */
export interface UserSearch {
  words?: readonly string[];
  unitIds?: readonly string[];
  role?: Role;
  status?: UserStatus;
  capability?: string;
}
/** The words of a typed search, in lower case as Swedish folds it; at most eight, so a pasted text stays one query. */
export const searchWords = (text: string | undefined): string[] =>
  (text ?? '').toLocaleLowerCase('sv').split(/\s+/).filter(Boolean).slice(0, 8);
/**
 * A unit with every unit below it in the tree (D99), the unit first. A unit the tree does not name is itself alone,
 * and each unit is taken once, so a stored chain that were ever a cycle ends.
 */
export function branchOf(tree: readonly TreeUnit[], unitId: string): string[] {
  const below = new Map<string, string[]>();
  for (const u of tree) if (u.parentId !== null) below.set(u.parentId, [...(below.get(u.parentId) ?? []), u.id]);
  const branch = new Set([unitId]);
  for (const id of branch) for (const next of below.get(id) ?? []) branch.add(next);
  return [...branch];
}
/**
 * Who leads a unit (D99 item 4): its managers who are active. A deactivated manager leads nobody, so a unit whose only
 * manager is deactivated passes the line through as a unit without one does. Everything that reads the line asks here.
 */
export const leadsUnit = (p: { role: Role | null; enabled: boolean }) => p.enabled && p.role === 'manager';
/**
 * The tree an administrator reads. A unit people are assigned to without a `unit:` group is drawn as a root that was
 * not pushed, named as the unit table knows it; a parent that names no node is read as no parent, so every node is
 * drawn. Deactivated people are left out of every count.
 */
export function organisationOf(
  tree: readonly TreeUnit[],
  placements: readonly Placement[],
  knownLabels: Readonly<Record<string, string>> = {},
): OrganisationOverview {
  const nodes = new Map<string, TreeUnit & { pushed: boolean }>();
  for (const unit of tree) nodes.set(unit.id, { ...unit, pushed: true });
  const active = placements.filter(p => p.enabled);
  for (const p of active)
    if (p.unitId !== null && !nodes.has(p.unitId))
      nodes.set(p.unitId, { id: p.unitId, label: knownLabels[p.unitId] ?? p.unitId, parentId: null, pushed: false });
  const parentOf = (id: string) => {
    const parent = nodes.get(id)?.parentId;
    return parent && parent !== id && nodes.has(parent) ? parent : null;
  };
  const managers = new Map<string, Array<{ id: string; name: string }>>(),
    placed = new Map<string, number>();
  for (const p of active) {
    if (p.unitId === null) continue;
    placed.set(p.unitId, (placed.get(p.unitId) ?? 0) + 1);
    if (leadsUnit(p)) managers.set(p.unitId, [...(managers.get(p.unitId) ?? []), { id: p.personId, name: p.name }]);
  }
  // Each placement counts on its unit and on every unit above it, a person once however many units of the branch they
  // are on; `seen` ends the walk if a stored chain were ever a cycle.
  const branch = new Map<string, Set<string>>();
  for (const p of active) {
    const seen = new Set<string>();
    for (let at = p.unitId; at !== null && !seen.has(at); at = parentOf(at)) {
      seen.add(at);
      branch.set(at, (branch.get(at) ?? new Set()).add(p.personId));
    }
  }
  const lineOf = (id: string): OrganisationUnit['line'] => {
    if (managers.get(id)?.length) return 'own';
    const seen = new Set([id]);
    for (let at = parentOf(id); at !== null && !seen.has(at); at = parentOf(at)) {
      if (managers.get(at)?.length) return 'above';
      seen.add(at);
    }
    return 'none';
  };
  const placedPeople = new Set(active.filter(p => p.unitId !== null).map(p => p.personId));
  return {
    units: [...nodes.values()]
      .map(n => ({
        unitId: n.id,
        unitLabel: n.label,
        parentId: parentOf(n.id),
        managers: (managers.get(n.id) ?? []).sort((a, b) => bySwedish(a.name, b.name) || a.id.localeCompare(b.id)),
        placed: placed.get(n.id) ?? 0,
        branch: branch.get(n.id)?.size ?? 0,
        line: lineOf(n.id),
        pushed: n.pushed,
      }))
      .sort((a, b) => bySwedish(a.unitLabel, b.unitLabel) || a.unitId.localeCompare(b.unitId)),
    unplaced: new Set(active.filter(p => !placedPeople.has(p.personId)).map(p => p.personId)).size,
  };
}

// ---- SCIM (RFC 7643, RFC 7644): the pure half. Records in, resources and new records out; nothing read or written here.

import { SCIM, SCIM_MAX_RESULTS, ScimError, type ScimGroup, type ScimPatchOperation, type ScimUser } from './contracts';

interface DirectoryDetails {
  phoneNumbers: DirectoryPhone[];
  employments: Employment[];
}
/** A person as the store holds it for SCIM: the provisioning columns of `auth_person`. Instants are ISO strings. */
export interface UserRecord extends DirectoryDetails {
  id: string;
  organisationId: string;
  externalId: string | null;
  userName: string | null;
  name: string;
  email: string | null;
  /** D110: the person's title as the source words it; null when the source sent none. */
  title: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface GroupRecord {
  id: string;
  /** The organisation of the provisioner that pushed the group; a client sees its own organisation's groups only. */
  organisationId: string;
  externalId: string | null;
  /** The group's name: SCIM's `displayName`. */
  label: string;
  /** D99: on a `unit:` group, the unit id of the node above it in the organisation tree; null on a root and on any other group. */
  parentUnitId: string | null;
  createdAt: string;
  updatedAt: string;
}
/** The fields a provisioner sets on a person. Contact numbers, employments and the core title are optional. */
export interface UserFields extends DirectoryDetails {
  externalId: string;
  userName: string;
  name: string;
  email: string;
  title: string | null;
  enabled: boolean;
}
export interface GroupFields {
  externalId: string | null;
  label: string;
  /** D99: the unit id of the parent, from the unit extension; null when the group carries none. */
  parent: string | null;
  members: string[];
}
const need = (attribute: string): never => {
  throw new ScimError(400, `Attribute '${attribute}' is required.`, 'invalidValue');
};
/**
 * How a request body is read in, the same way for a full representation and for the values of a patch.
 *
 * RFC 7643 §2.1: attribute names are case insensitive, so `Title`, `Active` or `DisplayName` is the attribute and not
 * an unknown one that is ignored (which once cleared a title and enabled a person). The name as the schema writes it
 * wins over the same name in another case. §2.5: `null` is the same as leaving the attribute out, so a serializer that
 * writes every empty field as `null` is not refused for it. A name Clew does not read, an extension's included, is
 * kept as it stands and not looked into.
 */
type Names = { readonly [name: string]: Names | true };
const CONTACT_NAMES: Names = { value: true, type: true, primary: true, display: true },
  EMPLOYMENT_NAMES: Names = {
    unitId: true,
    title: true,
    employmentType: true,
    startDate: true,
    employmentPercentage: true,
  },
  MEMBER_NAMES: Names = { value: true, display: true, $ref: true, type: true },
  NAME_NAMES: Names = { formatted: true, givenName: true, familyName: true };
const USER_NAMES: Names = {
  schemas: true,
  id: true,
  externalId: true,
  userName: true,
  displayName: true,
  name: NAME_NAMES,
  emails: CONTACT_NAMES,
  phoneNumbers: CONTACT_NAMES,
  [SCIM.employment]: { employments: EMPLOYMENT_NAMES },
  title: true,
  active: true,
};
const GROUP_NAMES: Names = { schemas: true, id: true, externalId: true, displayName: true, members: MEMBER_NAMES };
const PATCH_NAMES: Names = { schemas: true, Operations: { op: true, path: true, value: true } };
/** Deeper than any resource this server reads; a body nested past it is a mistake or an attempt on the stack. */
const MAX_DEPTH = 8;
function plain(body: unknown, names: Names, nulls: 'dropped' | 'kept', depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new ScimError(400, 'The request body is nested too deeply.', 'invalidSyntax');
  if (Array.isArray(body))
    return body.filter(item => nulls === 'kept' || item !== null).map(item => plain(item, names, nulls, depth + 1));
  if (!body || typeof body !== 'object') return body;
  const known = new Map(Object.keys(names).map(name => [name.toLowerCase(), name]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === null && nulls === 'dropped') continue;
    const name = known.get(key.toLowerCase());
    if (name === undefined) out[key] = value;
    else if (name === key || !Object.hasOwn(body, name)) {
      const below = names[name]!;
      out[name] = below === true ? value : plain(value, below, nulls, depth + 1);
    }
  }
  return out;
}
const asResource = (body: unknown, names: Names, what: string): Record<string, unknown> => {
  const read = plain(body, names, 'dropped');
  if (read && typeof read === 'object' && !Array.isArray(read)) return read as Record<string, unknown>;
  throw new ScimError(400, `The request body is not a ${what} resource.`, 'invalidSyntax');
};
/** A text attribute Clew stores: not empty, not only space, at most 512 characters, and nothing PostgreSQL cannot hold. */
const asString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512)
    throw new ScimError(400, `Attribute '${path}' needs a non-empty string of at most 512 characters.`, 'invalidValue');
  if (/\p{Cs}/u.test(value))
    throw new ScimError(400, `Attribute '${path}' contains an invalid Unicode character.`, 'invalidValue');
  if (value.includes('\u0000'))
    throw new ScimError(400, `Attribute '${path}' holds a NUL character, which cannot be stored.`, 'invalidValue');
  return value;
};
/** The same where the attribute may be left out: absent, and an empty string, are both no value. */
const optional = (value: unknown, path: string): string | undefined =>
  value === undefined || value === '' ? undefined : asString(value, path);
/** A user name in the one form it is stored and matched in, so a name sent decomposed is the same name. */
const userNameForm = (value: string) => value.normalize('NFC');
/**
 * What a login is matched on is stored as exactly as a key is (D96). A user name with space at either end or a
 * control character in it matches no claim an identity provider sends, and beside it a second row with the clean
 * spelling would take that person's sign-ins, so it is refused by name; a deactivation beside it still goes through
 * (D113). It is kept NFC, as a filter on it is read.
 */
const asUserName = (value: unknown, path: string): string => {
  const name = asString(typeof value === 'string' ? userNameForm(value) : value, path);
  if (name !== name.trim() || /\p{Cc}/u.test(name))
    throw new ScimError(
      400,
      `Attribute '${path}' cannot begin or end with space or hold a control character.`,
      'invalidValue',
    );
  return name;
};
/** A boolean, or the word for one in any case: Entra sends `"True"` and `"False"`. */
const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === 'boolean') return value;
  const word = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  if (word === 'true') return true;
  if (word === 'false') return false;
  throw new ScimError(400, `Attribute '${path}' needs a boolean.`, 'invalidValue');
};
const asObject = (value: unknown, path: string | undefined): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ScimError(
    400,
    path ? `Path '${path}' needs an object value.` : 'A patch without a path needs an object value.',
    'invalidValue',
  );
};
/**
 * RFC 7644 §3.5.2.1 and §3.5.2.3 (D110 item 4): an `add` or a `replace` carries a value, on every resource and every
 * path, and one without is malformed. It is refused before anything reads the value: read as `null`, a missing value
 * once emptied a person's lists and took a unit's key or parent away, each with a 200. A JavaScript client sends it
 * when a lookup answers `undefined`, since `JSON.stringify` leaves the member out. An explicit `null` and a `remove`
 * are the ways to take an attribute away. `attribute` names the one attribute of an extension's object that the
 * object left out. About one operation's value (`invalidValue`), so beside a deactivation it waits (D113).
 */
const noValue = (op: 'add' | 'replace', path: string | undefined, attribute?: string) =>
  new ScimError(
    400,
    path === undefined
      ? `Operation '${op}' without a path requires a value.`
      : `Operation '${op}' on '${path}' requires a value${attribute ? ` for '${attribute}'` : ''}.`,
    'invalidValue',
  );
interface Email {
  value: string;
  type?: string;
  primary?: boolean;
}
/** SCIM contact values in a body or patch, with case-insensitive attribute names and shorthand string values. */
const contactEntries = (value: unknown, path: string): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : [value])
    .filter(item => item !== null && item !== undefined)
    .map(item => (typeof item === 'string' ? { value: item } : asObject(plain(item, CONTACT_NAMES, 'dropped'), path)));
/**
 * The addresses of a body or a patch value. An entry whose value is absent, `null`, empty or only space is no address
 * and is left out before one is chosen, as an unreadable phone number is (D114): a directory's empty secondary field
 * once refused the whole person. A value that is there and is not an address (a number, an object) is still refused by
 * name.
 */
const emailList = (value: unknown, path: string): Email[] =>
  contactEntries(value, path).flatMap(email =>
    email.value === undefined || (typeof email.value === 'string' && !email.value.trim())
      ? []
      : [
          {
            value: asString(email.value, path + '.value'),
            ...(typeof email.type === 'string' ? { type: email.type } : {}),
            ...(email.primary === true || String(email.primary).toLowerCase() === 'true' ? { primary: true } : {}),
          },
        ],
  );
/**
 * The one address Clew holds, of the addresses a client sent: one with `type: "work"` first, the primary before the
 * first (RFC 7643 §2.4: `primary` marks the preferred value); otherwise one without a type, likewise. `whole` says the
 * list is all the person has (a body, a `replace`): then an address of any other type is taken before none at all,
 * the primary before the first, so a home address is published when the work entry was blank. What an address is
 * called is the source's to answer for (D114); Clew does not refuse a person for it. Without `whole` the list is added
 * to what is held, and an address of another type is beside the one Clew holds.
 */
export function workEmail(emails: readonly Email[], whole: boolean): string | undefined {
  const preferred = (list: readonly Email[]) => list.find(email => email.primary) ?? list[0];
  return (
    preferred(emails.filter(email => email.type?.toLowerCase() === 'work')) ??
    preferred(emails.filter(email => !email.type)) ??
    (whole ? preferred(emails) : undefined)
  )?.value;
}
/**
 * D114: a person's phone numbers and employments are shown and decide nothing, so what Clew cannot read in them is
 * left out and never refuses the person, as a title is (D110): a number that is empty, `null`, not text or longer than
 * a number is; an entry with nothing in it. Having no phone number is not a mistake. What is refused is a request
 * that says something Clew cannot take as said: an employment without a unit or on a unit the organisation does not
 * hold (asked of the store), a list past `DETAIL_LIMIT`, `employments` written without the extension's URN, an `add`
 * or `replace` without a value and a `remove` of a whole list that carries a value.
 */
const DETAIL_LIMIT = 50;
function within<T>(rows: T[], attribute: string): T[] {
  if (rows.length > DETAIL_LIMIT)
    throw new ScimError(400, `Attribute '${attribute}' carries at most ${DETAIL_LIMIT} entries.`, 'invalidValue');
  return rows;
}
/** Text as it is shown: a control character or half a surrogate pair becomes a space, cut at `length` characters. */
const shown = (value: unknown, length: number): string | null =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\p{Cc}\p{Cs}]+/gu, ' ').trim())
        .slice(0, length)
        .join('')
        .trimEnd() || null
    : null;
const canonicalPhoneTypes = new Set(['work', 'mobile', 'home', 'fax', 'pager', 'other']);
const PHONE_LENGTH = 512,
  PHONE_TYPE_LENGTH = 64;
/** A number as sent, less the space around it; one cut short would be another number, so one too long is none. */
const phoneValue = (value: unknown): string | undefined => {
  const text = shown(value, PHONE_LENGTH + 1);
  return text && Array.from(text).length <= PHONE_LENGTH ? text : undefined;
};
/** The category: the standard's in lower case, the directory's own as written, "other" where none can be read. */
const phoneType = (value: unknown, fallback?: string): string => {
  const type = shown(value, PHONE_TYPE_LENGTH) ?? shown(fallback, PHONE_TYPE_LENGTH) ?? 'other';
  return canonicalPhoneTypes.has(type.toLowerCase()) ? type.toLowerCase() : type;
};
/** The numbers of a body or of a patch value: objects with a `value`, or the numbers themselves. */
function phoneList(value: unknown, targetType?: string): DirectoryPhone[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    const entry =
      typeof item === 'string'
        ? { value: item }
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (plain(item, CONTACT_NAMES, 'dropped') as Record<string, unknown>)
          : {};
    const number = phoneValue(entry.value);
    if (!number) return [];
    const type = phoneType(entry.type, targetType);
    if (targetType && targetType.toLowerCase() !== type.toLowerCase())
      throw new ScimError(
        400,
        `The number's type '${type}' is not the one the path names, '${targetType}'.`,
        'invalidValue',
      );
    return [{ type, value: number }];
  });
}

/** The directory's order, each entry once: two that are the same cannot be told apart, and a retried add adds nothing. */
function distinctEntries<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
const phoneKey = (row: DirectoryPhone) => JSON.stringify([row.type.toLowerCase(), row.value]);
const employmentKey = (row: Employment) =>
  JSON.stringify([row.unitId, row.title, row.employmentType, row.startDate, row.employmentPercentage]);
const EMPLOYMENTS = SCIM.employment + ':employments';
/** The employments of a body or of a patch value: a list, or the one entry by itself. */
function employmentList(value: unknown): Employment[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    if (item === null || item === undefined) return [];
    const row = asObject(plain(item, EMPLOYMENT_NAMES, 'dropped'), EMPLOYMENTS),
      title = titleOf(row.title),
      employmentType = shown(row.employmentType, EMPLOYMENT_LABEL_LENGTH),
      startDate = checkContract(EmploymentSchema.properties.startDate, row.startDate) ? row.startDate : undefined,
      employmentPercentage = checkContract(EmploymentSchema.properties.employmentPercentage, row.employmentPercentage)
        ? row.employmentPercentage
        : undefined;
    if (row.unitId === undefined || row.unitId === '') {
      if (!title && !employmentType && !startDate && employmentPercentage === undefined) return [];
      throw new ScimError(
        400,
        `An employment needs a 'unitId': the id of the unit, which is what follows '${UNIT_KEY}' in the externalId of its group. A title that belongs to no unit is sent as the user's 'title'.`,
        'invalidValue',
      );
    }
    return [
      {
        unitId: asString(row.unitId, EMPLOYMENTS + '.unitId'),
        ...(title ? { title } : {}),
        ...(employmentType ? { employmentType } : {}),
        ...(startDate ? { startDate } : {}),
        ...(employmentPercentage !== undefined ? { employmentPercentage } : {}),
      },
    ];
  });
}
function extensionEmployments(value: unknown): unknown {
  if (value === undefined || value === null) return [];
  return asObject(plain(value, { employments: true }, 'dropped'), SCIM.employment).employments;
}
/**
 * `employments` named without the extension's URN. Ignored as an attribute Clew does not hold, it would answer that a
 * person's employments were stored while none were; so it is refused, as a bare `parent` is on a unit.
 */
const isBareEmployments = (name: string) => /^employments(?:[.[]|$)/.test(name.trim().toLowerCase());
const bareEmployments = () =>
  beside(new ScimError(400, `Use '${EMPLOYMENTS}' for a person's employments.`, 'invalidPath'));
/**
 * What a person is called at work, as the product shows and searches it: the titles of the employments, each once in
 * the directory's order; the core `title` where no employment carries one (D110, D114).
 */
export function titlesOf(person: { title: string | null; employments: readonly Employment[] }): string[] {
  const titles = [...new Set(person.employments.flatMap(job => (job.title ? [job.title] : [])))];
  return titles.length ? titles : person.title ? [person.title] : [];
}
const EMPLOYMENT_LABEL_LENGTH = 512;
/**
 * D110: a title is kept as sent, less the space around it and whatever is past 512 characters (counted as characters,
 * so none is cut in half). A control character in it, a line break or the NUL that PostgreSQL cannot hold, becomes a
 * space. An empty one, `null` and a value that is not text all mean the person has none. A title decides nothing, so
 * its value is never a reason to refuse a person or the other changes of the same request. An `add` or `replace` on
 * `title` without a value is another matter: that operation is malformed, and refused as on every path (RFC 7644
 * §3.5.2), except beside a deactivation (D113).
 */
const titleOf = (value: unknown): string | null => shown(value, EMPLOYMENT_LABEL_LENGTH);
/**
 * D113: a deactivation is never refused for what stands beside it. A request that says `active: false` and also
 * carries an attribute Clew cannot take (an address that is gone, a name that is empty, a required attribute removed)
 * deactivates the person and leaves that attribute as it was. Refusing the whole request would keep a leaver active
 * for a mistake about their name. `beside` marks the refusals this applies to: those about one attribute's value.
 */
const required = (path: string) =>
  beside(new ScimError(400, `Attribute '${path}' cannot be removed; Clew requires it.`, 'mutability'));
const besideErrors = new WeakSet<ScimError>();
function beside(error: ScimError) {
  besideErrors.add(error);
  return error;
}
const standsBeside = (error: unknown): error is ScimError =>
  error instanceof ScimError && (error.scimType === 'invalidValue' || besideErrors.has(error));
/** The fields of a request that said `active: false`, for what is asked of the store after the request is read. */
const deactivating = new WeakSet<UserFields>();
export const saysInactive = (fields: UserFields) => deactivating.has(fields);
/**
 * A full user representation (POST, PUT) to the fields Clew holds, with D68's requirements checked by name. `current`
 * is the person a `PUT` replaces: an `externalId` the body leaves out is kept (Okta's update sends none), and so is
 * every required attribute the body gets wrong when it deactivates the person (D113).
 */
export function userFields(body: unknown, current?: UserFields): UserFields {
  const input = asResource(body, USER_NAMES, 'User');
  const enabled = input.active === undefined ? true : asBoolean(input.active, 'active');
  const kept = enabled ? undefined : current;
  const read = <T>(previous: T | undefined, from: () => T): T => {
    try {
      return from();
    } catch (error) {
      if (previous !== undefined && standsBeside(error)) return previous;
      throw error;
    }
  };
  const fields: UserFields = {
    externalId: read(
      kept?.externalId || undefined,
      () => optional(input.externalId, 'externalId') ?? (current?.externalId || need('externalId')),
    ),
    userName: read(kept?.userName || undefined, () => asUserName(input.userName ?? need('userName'), 'userName')),
    name: read(kept?.name || undefined, () => {
      const name = input.name === undefined ? {} : asObject(input.name, 'name'),
        part = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
      return (
        optional(input.displayName, 'displayName') ??
        optional(name.formatted, 'name.formatted') ??
        asString(
          [part(name.givenName), part(name.familyName)].filter(Boolean).join(' ') || need('displayName'),
          'displayName',
        )
      );
    }),
    email: read(kept?.email || undefined, () => {
      const emails = input.emails === undefined ? [] : emailList(input.emails, 'emails');
      return workEmail(emails, true) ?? need('emails');
    }),
    phoneNumbers: read(kept?.phoneNumbers, () =>
      within(distinctEntries(phoneList(input.phoneNumbers), phoneKey), 'phoneNumbers'),
    ),
    employments: read(kept?.employments, () => {
      if (Object.keys(input).some(isBareEmployments)) throw bareEmployments();
      return within(
        distinctEntries(employmentList(extensionEmployments(input[SCIM.employment])), employmentKey),
        EMPLOYMENTS,
      );
    }),
    title: titleOf(input.title),
    enabled,
  };
  if (!enabled) deactivating.add(fields);
  return fields;
}
/** The unit id a `unit:` group's key names; undefined for `unit-manager:` and every other key. */
export const unitGroupOf = (externalId: string | null | undefined): string | undefined =>
  externalId?.startsWith(UNIT_KEY) ? externalId.slice(UNIT_KEY.length) : undefined;
const UNIT_EXTENSION = SCIM.unit.toLowerCase();
/**
 * What a name aims at in the unit extension (D99), without regard to case as a schema URN is: the extension as a
 * whole (its value is an object with `parent`), its `parent` attribute, or nothing.
 */
const unitExtensionTarget = (name: string): 'extension' | 'parent' | undefined => {
  const key = name.trim().toLowerCase();
  return key === UNIT_EXTENSION ? 'extension' : key === UNIT_EXTENSION + ':parent' ? 'parent' : undefined;
};
/**
 * A `parent` named without the extension's URN. On any other group it is an attribute Clew does not hold. On a unit
 * group it is refused: ignoring it would answer that a move was stored while the unit stays where it stood. Asked of
 * the group as the request leaves it, so the order of the keys in a body or of the operations in a patch never decides.
 */
const isBareParent = (name: string) => name.trim().toLowerCase() === 'parent';
const bareParent = () => new ScimError(400, `Use '${SCIM.unit}:parent' for the parent of a unit.`, 'invalidPath');
const PARENT = SCIM.unit + ':parent';
/**
 * The parent a client sent, as a unit id. It is the `externalId` of the parent's `unit:` group, written as exactly as
 * a key is (D96), and text Clew can hold as every stored attribute is (`asString`, naming the parent): a NUL in it once
 * reached PostgreSQL in the parent's lookup and answered 500. null, or nothing, makes the unit a root.
 */
export function parentUnitOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const sent = asString(value, PARENT),
    id = unitGroupOf(sent);
  if (!id || id !== id.trim())
    throw new ScimError(
      400,
      `The parent '${sent}' must be the externalId of the unit group above, '${UNIT_KEY}<unitId>' (D99). The group was not stored.`,
      'invalidValue',
    );
  return id;
}
/**
 * The extension's object, whose one attribute is read without regard to case, as every attribute name is. In a body an
 * object without `parent` names no parent. In a patch's `add` or `replace` (`op`) it is an operation without a value
 * (RFC 7644 §3.5.2): read as no parent, it once made a unit a root with a 200. `parent: null` is the way to make a unit
 * a root.
 */
const parentInExtension = (value: unknown, path: string | undefined, op?: 'add' | 'replace') => {
  if (value === undefined || value === null) return null;
  const extension = asObject(value, path),
    name = Object.keys(extension).find(key => key.toLowerCase() === 'parent');
  if (name === undefined && op) throw noValue(op, path, 'parent');
  return parentUnitOf(name === undefined ? undefined : extension[name]);
};
/** The ids a `members` value names: a list of objects with a `value`, or of the ids themselves. */
const memberIds = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter(member => member !== null)
    .map(member =>
      asString(
        member && typeof member === 'object'
          ? (plain(member, MEMBER_NAMES, 'dropped') as { value?: unknown }).value
          : member,
        'members.value',
      ),
    );
export function groupFields(body: unknown): GroupFields {
  const input = asResource(body, GROUP_NAMES, 'Group');
  const externalId = optional(input.externalId, 'externalId') ?? null;
  if (unitGroupOf(externalId) !== undefined && Object.keys(input).some(isBareParent)) throw bareParent();
  const extension = Object.entries(input).find(([name]) => unitExtensionTarget(name) === 'extension');
  return {
    externalId,
    label: asString(input.displayName ?? need('displayName'), 'displayName'),
    parent: parentInExtension(extension?.[1], SCIM.unit),
    members: [...new Set(memberIds(input.members))],
  };
}
/**
 * The keys a group's `externalId` may carry, checked at the boundary so a mistake fails where it is made.
 *
 * D93: `protected` is refused until D68's open question, whether Clew may hold that fact at all, is answered. Nothing
 * about it is stored, derived into a context or shown; a client that sends it learns why.
 *
 * D96: a key that is written wrong is refused instead of being stored as a plain group that gives nobody anything:
 * a reserved word in another case (`Unit:skola`, `Protected`) or with space in or before it (` unit:skola`,
 * `unit :skola`), `unit:` or `unit-manager:` without a unit id or with space around it, and `capability:` with a name outside the closed list. Any other `externalId` is a plain group.
 */
const refusedKey = (detail: string) => new ScimError(400, `${detail} The group was not stored.`, 'invalidValue');
export function assertAcceptedKey(fields: GroupFields): void {
  const key = fields.externalId;
  if (key === null) return;
  const prefix = reservedScimGroupKey(key);
  if (prefix === PROTECTED_KEY)
    throw refusedKey(
      `The key '${PROTECTED_KEY}' is not accepted: Clew has not decided whether it may hold that fact (D93).`,
    );
  if (!prefix) return;
  if (!key.startsWith(prefix)) throw refusedKey(`The key '${key}' must begin with '${prefix}' in lower case (D96).`);
  const rest = key.slice(prefix.length);
  if (!rest || rest !== rest.trim())
    throw refusedKey(
      `The key '${key}' needs ${prefix === CAPABILITY_KEY ? 'a capability name' : 'a unit id'} directly after '${prefix}' (D96).`,
    );
  if (prefix === CAPABILITY_KEY && !isCapability(rest))
    throw refusedKey(
      `The key '${key}' names no capability of this installation; the capabilities are ${CAPABILITIES.join(', ')} (D96).`,
    );
}
/**
 * D99: where a parent may stand, as far as the group itself says. Only a `unit:` group is a node of the tree, and a
 * unit is not its own parent. Whether the parent exists, and whether it would close a cycle, is asked of the store.
 */
export function assertAcceptedParent(fields: GroupFields): void {
  if (fields.parent === null) return;
  const unit = unitGroupOf(fields.externalId);
  if (unit === undefined)
    throw refusedKey(
      `A parent is carried by a '${UNIT_KEY}' group only; '${fields.externalId ?? fields.label}' is not one (D99).`,
    );
  if (unit === fields.parent) throw refusedKey(`The unit '${unit}' cannot be its own parent (D99).`);
}
/**
 * Whether placing `unit` under `parent` would close a cycle: true when `unit` is `parent` or stands above it. `above`
 * answers the parent of a unit, undefined or null at a root. A chain longer than any organisation is read as a cycle
 * already stored, so the walk always ends.
 */
export async function closesCycle(
  unit: string,
  parent: string,
  above: (unitId: string) => Promise<string | null | undefined>,
): Promise<boolean> {
  let at: string | null | undefined = parent;
  for (let hops = 0; at; hops++) {
    if (at === unit || hops > 256) return true;
    at = await above(at);
  }
  return false;
}
/**
 * `attribute eq "value"` on one of `attributes`, the one filter shape D68 requires; anything else is `invalidFilter`.
 * The attribute may carry its schema's URN (RFC 7644 §3.4.2.2), and the value is a JSON string, escapes included.
 */
export function parseFilter(
  filter: string | undefined,
  attributes: readonly string[],
): { attribute: string; value: string } | undefined {
  if (filter === undefined || filter.trim() === '') return undefined;
  const refused = () =>
    new ScimError(400, `Only '<attribute> eq "value"' on ${attributes.join(', ')} is supported.`, 'invalidFilter');
  const match = /^\s*(?:urn:[A-Za-z0-9:._-]+:)?([A-Za-z][A-Za-z0-9_]*)\s+eq\s+("(?:[^"\\]|\\.)*")\s*$/i.exec(filter);
  const attribute = match && attributes.find(a => a.toLowerCase() === match[1]!.toLowerCase());
  if (!match || !attribute) throw refused();
  let value: unknown;
  try {
    value = JSON.parse(match[2]!);
  } catch {
    throw refused();
  }
  if (typeof value !== 'string') throw refused();
  // Nothing stored holds a NUL (`asString`), and PostgreSQL refuses one in a comparison too: say so here.
  if (value.includes('\u0000'))
    throw new ScimError(400, 'A filter value cannot hold a NUL character.', 'invalidFilter');
  return { attribute, value };
}
/** A filter on users. A `userName` is matched in the NFC form it is stored in, so a name sent decomposed is found. */
export function userFilter(filter: string | undefined) {
  const parsed = parseFilter(filter, ['userName', 'externalId']) as
    { attribute: 'userName' | 'externalId'; value: string } | undefined;
  return parsed?.attribute === 'userName' ? { ...parsed, value: userNameForm(parsed.value) } : parsed;
}
/** A page cannot start past what PostgreSQL takes as an offset; nothing is that far in. */
const LAST_START = 2_147_483_647;
/** `startIndex` is 1-based and `count` is capped (RFC 7644 §3.4.2.4); a missing or broken value takes the default. */
export function pageOf(query: { startIndex?: string; count?: string }) {
  const startIndex = Math.min(LAST_START, Math.max(1, Number.parseInt(query.startIndex ?? '1', 10) || 1)),
    asked = Number.parseInt(query.count ?? '', 10),
    // A negative count reads as zero (the standard); one that is no number at all takes the default.
    count = Number.isNaN(asked) ? SCIM_MAX_RESULTS : Math.min(SCIM_MAX_RESULTS, Math.max(0, asked));
  return { startIndex, count };
}
/**
 * `attributes` and `excludedAttributes` (RFC 7644 §3.4.2.5, §3.9) on a resource this server answers: the first keeps
 * only what it names, the second drops what it names, and `schemas` and `id` are always returned. A name may carry the
 * core schema's URN and a sub-attribute (`members.value`, `name.formatted`), and is matched without regard to case.
 * The result is typed as the whole resource: a caller that projects serialises it and reads nothing back from it.
 */
export interface Projection {
  attributes?: string;
  excludedAttributes?: string;
}
const ALWAYS_RETURNED = new Set(['schemas', 'id']);
const projectionPaths = (list: string | undefined) =>
  (list ?? '')
    .split(',')
    .map(name =>
      name
        .trim()
        .toLowerCase()
        .replace(/^urn:ietf:params:scim:schemas:core:2\.0:(user|group):/, ''),
    )
    .filter(Boolean)
    .map(name => {
      // The unit extension (D99) is named by its URN, which has a dot of its own ('2.0'): the URN is the attribute, and
      // what follows it the sub-attribute.
      for (const urn of [UNIT_EXTENSION, employmentUrn])
        if (name === urn || name.startsWith(urn + ':'))
          return { top: urn, sub: name.slice(urn.length + 1) || undefined };
      const [top, ...sub] = name.split('.');
      return { top: top!, sub: sub.join('.') || undefined };
    });
/** One attribute's value with only, or without, the named sub-attributes; a multi-valued one is narrowed per element. */
const narrow = (value: unknown, subs: readonly string[], keep: boolean): unknown => {
  if (Array.isArray(value)) return value.map(v => narrow(v, subs, keep));
  if (!value || typeof value !== 'object') return value;
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const name = key.toLowerCase();
    const children = subs.filter(path => path.startsWith(name + '.')).map(path => path.slice(name.length + 1));
    if (subs.includes(name)) {
      if (keep) projected[key] = entry;
    } else if (children.length) projected[key] = narrow(entry, children, keep);
    else if (!keep) projected[key] = entry;
  }
  return projected;
};
export function project<T extends object>(resource: T, projection: Projection = {}): T {
  const wanted = projectionPaths(projection.attributes),
    excluded = projectionPaths(projection.excludedAttributes);
  if (!wanted.length && !excluded.length) return resource;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource)) {
    const k = key.toLowerCase();
    if (ALWAYS_RETURNED.has(k)) {
      out[key] = value;
      continue;
    }
    let kept: unknown = value;
    if (wanted.length) {
      const named = wanted.filter(p => p.top === k);
      if (!named.length) continue;
      // The whole attribute when it is named without a sub-attribute; else only the sub-attributes named.
      if (named.every(p => p.sub))
        kept = narrow(
          value,
          named.map(p => p.sub!),
          true,
        );
    }
    const dropped = excluded.filter(p => p.top === k);
    if (dropped.some(p => !p.sub)) continue;
    if (dropped.length)
      kept = narrow(
        kept,
        dropped.map(p => p.sub!),
        false,
      );
    out[key] = kept;
  }
  // An extension that was projected out is not one of the resource's schemas any more.
  if (Array.isArray(out.schemas))
    out.schemas = out.schemas.filter(urn => !Object.hasOwn(resource, urn) || Object.hasOwn(out, urn));
  return out as T;
}
/** Whether a projection leaves `attribute` out entirely, so the query that would fill it need not run. */
export function leavesOut(projection: Projection | undefined, attribute: string): boolean {
  const name = attribute.toLowerCase(),
    wanted = projectionPaths(projection?.attributes),
    excluded = projectionPaths(projection?.excludedAttributes);
  return (wanted.length > 0 && !wanted.some(p => p.top === name)) || excluded.some(p => p.top === name && !p.sub);
}
/** The most operations one patch carries. A group of ten thousand members is replaced with one. */
export const SCIM_MAX_OPERATIONS = 500;
/**
 * A PatchOp message (RFC 7644 §3.5.2) to its operations. The envelope's own names are read without regard to case, as
 * every attribute name is: `value` spelled `Value` once read as no value at all, and emptied a group.
 */
export function patchOperations(body: unknown): ScimPatchOperation[] {
  const message = plain(body, PATCH_NAMES, 'kept'),
    operations = message && typeof message === 'object' ? (message as { Operations?: unknown }).Operations : undefined;
  if (!Array.isArray(operations) || !operations.length || operations.length > SCIM_MAX_OPERATIONS)
    throw new ScimError(
      400,
      `A PatchOp body carries between 1 and ${SCIM_MAX_OPERATIONS} Operations.`,
      'invalidSyntax',
    );
  return operations.map(operation => {
    const { op, path, value } = (operation ?? {}) as { op?: unknown; path?: unknown; value?: unknown };
    if (typeof op !== 'string') throw new ScimError(400, 'A patch operation needs an op.', 'invalidSyntax');
    if (path !== undefined && path !== null && typeof path !== 'string')
      throw new ScimError(400, 'A patch path is a string.', 'invalidPath');
    return { op, ...(typeof path === 'string' && path.trim() ? { path } : {}), value };
  });
}
const opOf = (operation: ScimPatchOperation) => {
  const op = operation.op.trim().toLowerCase();
  if (op !== 'add' && op !== 'replace' && op !== 'remove')
    throw new ScimError(400, `Unknown patch operation '${operation.op}'.`, 'invalidSyntax');
  return op;
};
type Resource = 'user' | 'group';
const CORE_URN: Record<Resource, RegExp> = {
  user: /^urn:ietf:params:scim:schemas:core:2\.0:user:/i,
  group: /^urn:ietf:params:scim:schemas:core:2\.0:group:/i,
};
/** A path without the core schema's URN, as it was sent: a filter in it may carry an id, whose case matters. */
const corePath = (path: string, resource: Resource) => path.trim().replace(CORE_URN[resource], '');
/** The same in lower case, to match on: `urn:…:User:displayName` and `displayName` are one attribute. */
const coreKey = (path: string, resource: Resource) => corePath(path, resource).toLowerCase();
/**
 * What only the server writes: `id`, `schemas` and `meta` on every resource, and a user's `groups`, since a membership
 * is changed on the group. Asked in one place so a `replace` and a `remove` agree.
 */
const isReadOnly = (key: string, resource: Resource) =>
  key === 'schemas' ||
  key === 'id' ||
  key === 'meta' ||
  key.startsWith('meta.') ||
  (resource === 'user' && key === 'groups');
const readOnly = (path: string) => new ScimError(400, `Attribute '${path}' is read-only.`, 'mutability');
/**
 * A read-only attribute in a path-less value. Such a value is the resource as the client holds it, so what it repeats
 * of `id`, `schemas` and `meta` is ignored, as a `PUT` ignores it (RFC 7644 §3.5.1; Okta sends the id with every
 * path-less patch). An `id` that names another resource is a mistake about which one is being changed, and refused.
 */
const repeated = (key: string, value: unknown, id: string | undefined) => {
  if (key === 'id' && id !== undefined && value !== id)
    throw new ScimError(400, "Attribute 'id' is read-only and names another resource than the address.", 'mutability');
};
/**
 * What a path under `emails` aims at. Clew holds one address, the work one, so:
 * - `emails`, `emails.value`, and a filter that picks the work address (`type eq "work"`, `primary eq true`, or both)
 *   are that address;
 * - a filter that names another type (`type eq "home"`) is an address Clew does not hold, which is nothing to change;
 * - any other filter is one this server cannot evaluate, and is refused: read as the one address, it once replaced it
 *   with another.
 * `sub` is the sub-attribute after the filter; without one the value is the address as an object.
 */
const emailTarget = (key: string, path: string): { held: boolean; sub: string | undefined } | undefined => {
  const match = /^emails(?:\[(.*)\])?(?:\.([a-z$]+))?$/.exec(key);
  if (!match) return undefined;
  const [, filter, sub] = match;
  if (filter === undefined) return { held: true, sub };
  if (
    /^\s*(type\s+eq\s+"work"(\s+and\s+primary\s+eq\s+true)?|primary\s+eq\s+true(\s+and\s+type\s+eq\s+"work")?)\s*$/.test(
      filter,
    )
  )
    return { held: true, sub };
  if (/^\s*type\s+eq\s+"[^"]*"(\s+and\s+primary\s+eq\s+(true|false))?\s*$/.test(filter)) return { held: false, sub };
  throw beside(
    new ScimError(
      400,
      `Path '${path}' is not supported: Clew holds one address, reached as emails[type eq "work"].value.`,
      'invalidPath',
    ),
  );
};
/**
 * A path under `phoneNumbers`: the list, or the numbers a filter picks, by type (every number of that category) or by
 * value (across categories). Clew holds a type and a value. A client can qualify a single match with `primary`,
 * but Clew has no primary flag to distinguish multiple matches. Other sub-attributes have nothing to update.
 */
function patchPhones(next: UserFields, path: string, op: 'add' | 'replace' | 'remove', value?: unknown) {
  const target = corePath(path, 'user');
  const store = (rows: DirectoryPhone[]) => {
    next.phoneNumbers = within(distinctEntries(rows, phoneKey), 'phoneNumbers');
  };
  if (target.toLowerCase() === 'phonenumbers')
    return store(op === 'remove' ? [] : [...(op === 'add' ? next.phoneNumbers : []), ...phoneList(value)]);
  const match =
    /^phonenumbers\[\s*(type|value)\s+eq\s+("(?:[^"\\]|\\.)*")(?:\s+and\s+primary\s+eq\s+(true|false))?\s*\](?:\.([a-z$]+))?$/i.exec(
      target,
    );
  let filter: unknown;
  try {
    filter = match && JSON.parse(match[2]!);
  } catch {
    filter = undefined;
  }
  if (!match || typeof filter !== 'string')
    throw beside(
      new ScimError(
        400,
        `Path '${path}' is not supported: use 'phoneNumbers', phoneNumbers[type eq "<type>"] or phoneNumbers[value eq "<number>"], with '.value' or '.type' after a filter.`,
        'invalidPath',
      ),
    );
  const picked = filter,
    byType = match[1]!.toLowerCase() === 'type',
    matches = (row: DirectoryPhone) =>
      byType ? row.type.toLowerCase() === picked.toLowerCase() : row.value === picked,
    rows = next.phoneNumbers,
    others = rows.filter(row => !matches(row)),
    matchCount = rows.length - others.length,
    sub = match[4]?.toLowerCase();
  if (sub !== undefined && sub !== 'value' && sub !== 'type') return;
  if (match[3] !== undefined && matchCount > 1)
    throw beside(
      new ScimError(
        400,
        `Path '${path}' matches multiple numbers. Replace the complete phoneNumbers list to select the intended number.`,
        'invalidPath',
      ),
    );
  const noTarget = () => beside(new ScimError(400, `No phone number matches the filter of '${path}'.`, 'noTarget'));
  if (sub === 'type') {
    // A type taken away, or set to nothing readable, leaves the number in the category for those without one.
    if (op !== 'remove' && matchCount === 0) throw noTarget();
    const type = op === 'remove' ? 'other' : phoneType(value);
    return store(rows.map(row => (matches(row) ? { ...row, type } : row)));
  }
  if (op === 'remove') return store(others);
  if (sub === 'value') {
    const number = phoneValue(value);
    if (!number) return store(others);
    if (matchCount > 0) return store(rows.map(row => (matches(row) ? { ...row, value: number } : row)));
    // Entra adds a person's first number of a type as `phoneNumbers[type eq "mobile"].value`.
    if (byType) return store([...rows, { type: phoneType(picked), value: number }]);
    throw noTarget();
  }
  if (op === 'replace' && !byType && matchCount === 0) throw noTarget();
  store([...(op === 'add' ? rows : others), ...phoneList(value, byType ? picked : undefined)]);
}
const employmentUrn = SCIM.employment.toLowerCase();
/**
 * The employments are replaced, added to or taken away as a list: an entry has no id to be picked by. Named by the
 * extension, the value is the extension's object, whose one attribute is read without regard to case: `null` there
 * takes the list away, as it does by the attribute's own path, and an object that leaves the attribute out is an
 * operation without a value (RFC 7644 §3.5.2), which once emptied the list with a 200.
 */
function patchEmployment(
  next: UserFields,
  key: string,
  path: string,
  op: 'add' | 'replace' | 'remove',
  value?: unknown,
) {
  if (key !== employmentUrn && key !== employmentUrn + ':employments')
    throw beside(
      new ScimError(
        400,
        `Path '${path}' is not supported: send the whole list of employments to '${EMPLOYMENTS}'.`,
        'invalidPath',
      ),
    );
  let list = value;
  if (op !== 'remove' && key === employmentUrn) {
    const extension = asObject(plain(value, { employments: true }, 'kept'), path);
    if (!Object.hasOwn(extension, 'employments')) throw noValue(op, path, 'employments');
    list = extension.employments;
  }
  const sent = op === 'remove' || list === null ? [] : employmentList(list);
  next.employments = within(
    distinctEntries([...(op === 'add' && list !== null ? next.employments : []), ...sent], employmentKey),
    EMPLOYMENTS,
  );
}
const isPhonePath = (key: string) =>
  key === 'phonenumbers' || key.startsWith('phonenumbers[') || key.startsWith('phonenumbers.');
/**
 * A `remove` of a whole list (the numbers, or the employments, by any of the names they go by) takes the whole list
 * away. One that carries a value reads like a removal of the entries it names, as on a group's `members`, and taking
 * the whole list instead once answered 200; so it is refused, with the way to say it. A filtered `remove` of numbers
 * takes what its filter names. About one operation's value, so beside a deactivation it waits (D113).
 */
function removedWithValue(key: string, path: string): ScimError | undefined {
  if (key === 'phonenumbers')
    return new ScimError(
      400,
      `Operation 'remove' on '${path}' takes no value: it takes away every number. To take away one number, remove phoneNumbers[value eq "<number>"]; to set the list, replace 'phoneNumbers'.`,
      'invalidValue',
    );
  if (key === employmentUrn || key === employmentUrn + ':employments')
    return new ScimError(
      400,
      `Operation 'remove' on '${path}' takes no value: it takes away every employment. To change the list, replace '${EMPLOYMENTS}' with the employments that remain.`,
      'invalidValue',
    );
  return undefined;
}
/** Removal of other user attributes. A required value (D68) is refused and the optional title (D110) is cleared. */
const userRemoval = (key: string, path: string): 'required' | 'readOnly' | 'title' | 'notHeld' => {
  if (isReadOnly(key, 'user')) return 'readOnly';
  if (key === 'title') return 'title';
  if (['username', 'externalid', 'displayname', 'active', 'name', 'name.formatted'].includes(key)) return 'required';
  const email = emailTarget(key, path);
  // A sub-attribute Clew does not hold (`emails[…].display`) is nothing to remove; the address or its value is.
  return email?.held && (email.sub === undefined || email.sub === 'value') ? 'required' : 'notHeld';
};
const USER_URN = SCIM.user.toLowerCase(),
  GROUP_URN = SCIM.group.toLowerCase();
/**
 * PATCH on a user (RFC 7644 §3.5.2), as the clients Clew expects send it: a path per operation, or one operation
 * without a path whose value is an object of attributes (Entra, Okta), which may itself hold the core schema's URN as
 * a key. An attribute Clew does not hold is accepted and ignored whatever the operation; one it requires cannot be
 * taken away. `id` is the resource's own, for a path-less value that repeats it.
 *
 * D113: when the patch says `active: false`, what it gets wrong about another attribute is left as it was and the
 * person is deactivated. Entra sends the emptied mailbox of a leaver beside the deactivation.
 */
export function applyUserPatch(
  current: UserFields,
  operations: readonly ScimPatchOperation[],
  id?: string,
): UserFields {
  let next = { ...current },
    deactivates = false;
  const wrong: ScimError[] = [];
  const unset = (key: string, path: string) => {
    if (isPhonePath(key)) return patchPhones(next, path, 'remove');
    if (key === employmentUrn || key.startsWith(employmentUrn + ':')) return patchEmployment(next, key, path, 'remove');
    if (isBareEmployments(key)) throw bareEmployments();
    const aim = userRemoval(key, path);
    if (aim === 'readOnly') throw readOnly(path);
    if (aim === 'required') throw required(path);
    if (aim === 'title') next.title = null;
  };
  const set = (path: string, value: unknown, op: 'add' | 'replace', pathless: boolean) => {
    const key = coreKey(path, 'user');
    if (value === undefined) throw noValue(op, path);
    // RFC 7643 §2.5: a value of `null` is the attribute taken away.
    if (value === null) {
      if (pathless && isReadOnly(key, 'user')) return;
      return unset(key, path);
    }
    if (pathless && (key === USER_URN || key === USER_URN + ':')) {
      for (const [name, inner] of Object.entries(asObject(value, path))) attempt(() => set(name, inner, op, true));
      return;
    }
    if (isPhonePath(key)) return patchPhones(next, path, op, value);
    if (key === employmentUrn || key.startsWith(employmentUrn + ':'))
      return patchEmployment(next, key, path, op, value);
    if (isBareEmployments(key)) throw bareEmployments();
    const email = emailTarget(key, path);
    if (key === 'username') next.userName = asUserName(value, path);
    else if (key === 'externalid') next.externalId = asString(value, path);
    else if (key === 'displayname' || key === 'name.formatted') next.name = asString(value, path);
    else if (key === 'active') {
      next.enabled = asBoolean(value, path);
      deactivates = !next.enabled;
    } else if (key === 'title') next.title = titleOf(value);
    else if (email) {
      if (!email.held || (email.sub !== undefined && email.sub !== 'value')) return;
      if (email.sub === 'value') next.email = asString(value, path);
      else {
        const sent = emailList(value, path),
          // A filter that picked the work address has said which one it is; a list says it by type. `replace` on
          // `emails` gives the whole list, as a body does; `add` appends (RFC 7644 §3.5.2.1), and an address of another
          // type is then beside the one Clew holds and changes nothing.
          work = workEmail(sent, key === 'emails' && op === 'replace');
        if (work !== undefined) next.email = work;
        else if (key !== 'emails' && sent.length)
          throw new ScimError(
            400,
            `Path '${path}' names the work address, and the value says it is of another type. It was not stored.`,
            'invalidValue',
          );
        else if (!sent.length) need('emails');
      }
    } else if (key === 'name') {
      // Given and family names are not held: a name object sets the name only through `formatted`, as the paths do.
      const formatted = asObject(plain(value, NAME_NAMES, 'dropped'), path).formatted;
      if (formatted !== undefined) next.name = asString(formatted, 'name.formatted');
    } else if (isReadOnly(key, 'user')) {
      if (!pathless) throw readOnly(path);
      repeated(key, value, id);
    }
    /* `name.givenName`, an extension or any other attribute Clew does not hold is accepted and ignored, as the standard asks */
  };
  /** One change; a refusal about its value waits until it is known whether the patch deactivates the person. */
  function attempt(change: () => void) {
    try {
      change();
    } catch (error) {
      if (!standsBeside(error)) throw error;
      wrong.push(error);
    }
  }
  for (const operation of operations) {
    const op = opOf(operation),
      { path, value } = operation;
    if (op === 'remove') {
      if (!path) throw new ScimError(400, 'A remove operation needs a path.', 'noTarget');
      attempt(() => {
        const key = coreKey(path, 'user'),
          refused = value === undefined || value === null ? undefined : removedWithValue(key, path);
        if (refused) throw refused;
        unset(key, path);
      });
    } else if (path) attempt(() => set(path, value, op, false));
    else
      // Read inside `attempt`, as the nested form is: a path-less value that is missing or no object is about that
      // operation's value, and once kept a leaver active by refusing the deactivation beside it (D113).
      attempt(() => {
        if (value === undefined) throw noValue(op, undefined);
        for (const [key, inner] of Object.entries(asObject(value, undefined))) attempt(() => set(key, inner, op, true));
      });
  }
  if (wrong.length && !deactivates) throw wrong[0];
  if (deactivates) deactivating.add(next);
  return next;
}
/**
 * PATCH on a group: `members` added, removed (by path filter or by value list) or replaced; the name and external id
 * replaced; the external id removed; the unit extension's `parent` set or removed (D99), by its schema-qualified path
 * or as the extension's object in a path-less value. A group whose key stops being a `unit:` key stops being a node,
 * so the parent it had goes with the key; a parent the patch itself names is kept, and refused where it stands.
 * Anything else is not held and is ignored, a read-only attribute as for a user.
 */
export function applyGroupPatch(
  current: GroupFields,
  operations: readonly ScimPatchOperation[],
  id?: string,
): GroupFields {
  let members = new Set(current.members),
    next = { ...current },
    placed = false,
    bare = false;
  /** `add` and `replace` on `members` say who: with `null`, a `replace` would empty the group. */
  const named = (value: unknown, path: string) => {
    if (value === null)
      throw new ScimError(
        400,
        `Path '${path}' needs a value: the members to set. To take everyone out, remove 'members'.`,
        'invalidValue',
      );
    return memberIds(value);
  };
  const setAttribute = (path: string, value: unknown, op: 'add' | 'replace', pathless: boolean) => {
    if (value === undefined) throw noValue(op, path);
    const key = coreKey(path, 'group'),
      extension = unitExtensionTarget(path);
    if (isBareParent(key)) bare = true;
    else if (extension) {
      next.parent = extension === 'parent' ? parentUnitOf(value) : parentInExtension(value, path, op);
      placed = true;
    } else if (pathless && (key === GROUP_URN || key === GROUP_URN + ':')) {
      for (const [name, inner] of Object.entries(asObject(value, path))) setAttribute(name, inner, op, true);
    } else if (key === 'members') {
      if (op === 'add') for (const member of named(value, path)) members.add(member);
      else members = new Set(named(value, path));
    } else if (key === 'displayname') {
      if (value === null) throw required(path);
      next.label = asString(value, path);
    } else if (key === 'externalid') next.externalId = value === null ? null : asString(value, path);
    else if (isReadOnly(key, 'group')) {
      if (!pathless) throw readOnly(path);
      repeated(key, value, id);
    }
  };
  for (const operation of operations) {
    const op = opOf(operation),
      path = operation.path && corePath(operation.path, 'group'),
      key = path?.toLowerCase();
    // RFC 7644 §3.5.2: the value of an `add` or `replace` is checked before any branch reads it, a path-less one's too.
    if (op !== 'remove' && operation.value === undefined) throw noValue(op, operation.path);
    if (path && key?.startsWith('members') && key !== 'members') {
      // Matched on the path as it was sent: the attribute's case does not matter, the id's does. Any other path under
      // `members` is one this server cannot evaluate, and saying so is the only honest answer: accepted and ignored,
      // it told a provisioner that a manager had been taken out of a group they were still in. A quoted id that is
      // not a JSON string (an escape such as `\x`) matches nothing, as in the phone filter, and is refused the same
      // way: parsed unguarded, it once threw past every SCIM answer and came back as a 500.
      const filtered = /^members\[\s*value\s+eq\s+("(?:[^"\\]|\\.)*")\s*\]$/i.exec(path);
      let member: unknown;
      try {
        member = filtered && JSON.parse(filtered[1]!);
      } catch {
        member = undefined;
      }
      if (typeof member !== 'string')
        throw new ScimError(
          400,
          `Path '${path}' is not supported: use 'members' with a list of values, or members[value eq "<id>"] to remove one.`,
          'invalidPath',
        );
      if (op !== 'remove') throw new ScimError(400, `Path '${path}' supports remove only.`, 'invalidPath');
      members.delete(asString(member, 'members.value'));
      continue;
    }
    if (op === 'remove') {
      if (!path || !key) throw new ScimError(400, 'A remove operation needs a path.', 'noTarget');
      if (key === 'members') {
        if (operation.value === undefined || operation.value === null) members.clear();
        else for (const member of memberIds(operation.value)) members.delete(member);
      } else if (isBareParent(key)) bare = true;
      else if (unitExtensionTarget(path)) next.parent = null;
      else if (key === 'externalid') next.externalId = null;
      else if (key === 'displayname') throw required(path);
      else if (isReadOnly(key, 'group')) throw readOnly(path);
      continue;
    }
    if (path) setAttribute(path, operation.value, op, false);
    else
      for (const [name, value] of Object.entries(asObject(operation.value, undefined)))
        setAttribute(name, value, op, true);
  }
  if (bare && unitGroupOf(next.externalId) !== undefined) throw bareParent();
  if (!placed && unitGroupOf(next.externalId) === undefined) next.parent = null;
  return { ...next, members: [...members] };
}
export function userResource(
  record: UserRecord,
  groups: ReadonlyArray<{ id: string; label: string }>,
  base: string,
): ScimUser {
  return {
    schemas: record.employments.length ? [SCIM.user, SCIM.employment] : [SCIM.user],
    ...(record.employments.length ? { [SCIM.employment]: { employments: record.employments } } : {}),
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    userName: record.userName ?? record.id,
    displayName: record.name,
    name: { formatted: record.name },
    emails: record.email ? [{ value: record.email, type: 'work', primary: true }] : [],
    ...(record.phoneNumbers.length ? { phoneNumbers: record.phoneNumbers } : {}),
    ...(record.title ? { title: record.title } : {}),
    active: record.enabled,
    groups: groups.map(g => ({ value: g.id, display: g.label, $ref: `${base}/Groups/${g.id}` })),
    meta: {
      resourceType: 'User',
      created: record.createdAt,
      lastModified: record.updatedAt,
      location: `${base}/Users/${record.id}`,
    },
  };
}
export function groupResource(
  record: GroupRecord,
  members: ReadonlyArray<{ id: string; name: string }>,
  base: string,
): ScimGroup {
  return {
    schemas: record.parentUnitId ? [SCIM.group, SCIM.unit] : [SCIM.group],
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    displayName: record.label,
    members: members.map(m => ({ value: m.id, display: m.name, $ref: `${base}/Users/${m.id}` })),
    ...(record.parentUnitId ? { [SCIM.unit]: { parent: UNIT_KEY + record.parentUnitId } } : {}),
    meta: {
      resourceType: 'Group',
      created: record.createdAt,
      lastModified: record.updatedAt,
      location: `${base}/Groups/${record.id}`,
    },
  };
}
/** RFC 7643 §5: what this server supports. Bulk, sorting, ETags and password change are not offered. */
export const serviceProviderConfig = (base: string) => ({
  schemas: [SCIM.serviceProviderConfig],
  documentationUri:
    'https://github.com/etori-ai/clew/blob/main/docs/decisions/D68-people-are-pushed-into-clew-through-standard-scim.md',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'Bearer token',
      description: 'A bearer token issued to the provisioner by a Clew administrator.',
      primary: true,
    },
  ],
  meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
});
export const resourceTypes = (base: string) => [
  {
    schemas: [SCIM.resourceType],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    description: 'A person who may sign in to Clew.',
    schema: SCIM.user,
    schemaExtensions: [{ schema: SCIM.employment, required: false }],
    meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
  },
  {
    schemas: [SCIM.resourceType],
    id: 'Group',
    name: 'Group',
    endpoint: '/Groups',
    description: 'A group as the source knows it; keys in externalId carry its meaning in Clew.',
    schema: SCIM.group,
    schemaExtensions: [{ schema: SCIM.unit, required: false }],
    meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
  },
];
const attribute = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});
export const schemaDocuments = (base: string) => [
  {
    schemas: [SCIM.schema],
    id: SCIM.user,
    name: 'User',
    description: 'A person who may sign in to Clew. Requires an externalId, a userName, a name and an e-mail address.',
    attributes: [
      attribute('userName', 'string', { required: true, uniqueness: 'server' }),
      attribute('externalId', 'string', { required: true, caseExact: true, uniqueness: 'server' }),
      attribute('displayName', 'string', { required: true }),
      attribute('name', 'complex', {
        subAttributes: [
          attribute('formatted', 'string'),
          // Read when a person is sent without a display name, and not held: the name is one string.
          attribute('givenName', 'string', { mutability: 'writeOnly', returned: 'never' }),
          attribute('familyName', 'string', { mutability: 'writeOnly', returned: 'never' }),
        ],
      }),
      attribute('emails', 'complex', {
        multiValued: true,
        required: true,
        description:
          'Clew publishes one address: a work address, otherwise one without a type, otherwise any other that was sent. Within each it takes the primary address before the first. An entry whose value is empty or missing is left out. The selected address is returned with type "work" and primary true.',
        subAttributes: [attribute('value', 'string'), attribute('type', 'string'), attribute('primary', 'boolean')],
      }),
      attribute('phoneNumbers', 'complex', {
        multiValued: true,
        subAttributes: [
          attribute('value', 'string'),
          attribute('type', 'string', { canonicalValues: [...canonicalPhoneTypes] }),
        ],
      }),
      attribute('title', 'string'),
      attribute('active', 'boolean'),
      attribute('groups', 'complex', {
        multiValued: true,
        mutability: 'readOnly',
        subAttributes: [
          attribute('value', 'string', { mutability: 'readOnly' }),
          attribute('display', 'string', { mutability: 'readOnly' }),
          attribute('$ref', 'reference', { mutability: 'readOnly', referenceTypes: ['Group'] }),
        ],
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.user}` },
  },
  {
    schemas: [SCIM.schema],
    id: SCIM.group,
    name: 'Group',
    description:
      'A group; unit:, unit-manager: and capability: keys in externalId carry meaning in Clew. The key protected is refused (D93), and so is a key written wrong (D96). Members are users; a group as a member is refused. A unit: group may name the unit above it in the unit extension (D99).',
    attributes: [
      attribute('displayName', 'string', { required: true }),
      attribute('externalId', 'string', { caseExact: true, uniqueness: 'server' }),
      attribute('members', 'complex', {
        multiValued: true,
        subAttributes: [
          attribute('value', 'string', { mutability: 'immutable' }),
          attribute('display', 'string', { mutability: 'readOnly' }),
          attribute('$ref', 'reference', { mutability: 'readOnly', referenceTypes: ['User'] }),
        ],
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.group}` },
  },
  {
    schemas: [SCIM.schema],
    id: SCIM.employment,
    name: 'Employment',
    description: 'Current employments with their unit and optional details about each job.',
    attributes: [
      attribute('employments', 'complex', {
        multiValued: true,
        subAttributes: [
          attribute('unitId', 'string', { required: true, caseExact: true }),
          attribute('title', 'string'),
          attribute('employmentType', 'string', { description: "The source's label for the form of employment." }),
          attribute('startDate', 'string', { description: 'First calendar day of this employment, YYYY-MM-DD.' }),
          attribute('employmentPercentage', 'decimal', {
            description:
              'Percentage of full-time hours for this employment. Send a JSON number from 0 to 100 inclusive without a percent sign. Use 50 for half time.',
          }),
        ],
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.employment}` },
  },
  {
    schemas: [SCIM.schema],
    id: SCIM.unit,
    name: 'Unit',
    description:
      'The place of a unit: group in the organisation tree (D99). Carried by a unit: group only; a tree is pushed from the root down and removed from the leaves up.',
    attributes: [
      attribute('parent', 'string', {
        caseExact: true,
        description:
          'The externalId of the unit group above this one, unit:<unitId>; absent on a root. It must exist in the same organisation and may not close a cycle.',
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.unit}` },
  },
];
