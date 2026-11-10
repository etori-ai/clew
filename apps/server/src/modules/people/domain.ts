import { CAPABILITIES, isCapability, type Capability, type Role } from '@clew/contracts';

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
export const UNIT_KEY = 'unit:',
  MANAGER_KEY = 'unit-manager:',
  CAPABILITY_KEY = 'capability:',
  PROTECTED_KEY = 'protected';
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
export function activeOf(assignments: readonly Assignment[]): Assignment | undefined {
  return [...assignments].sort(
    (a, b) => Number(b.role === 'manager') - Number(a.role === 'manager') || a.unitId.localeCompare(b.unitId),
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
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
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

// ---- SCIM (RFC 7643, RFC 7644): the pure half. Records in, resources and new records out; nothing read or written here.

import {
  SCIM,
  SCIM_MAX_RESULTS,
  ScimError,
  type ScimGroup,
  type ScimGroupInput,
  type ScimPatchOperation,
  type ScimUser,
  type ScimUserInput,
} from './contracts';

/** A person as the store holds it for SCIM: the provisioning columns of `auth_person`. Instants are ISO strings. */
export interface UserRecord {
  id: string;
  organisationId: string;
  externalId: string | null;
  userName: string | null;
  name: string;
  email: string | null;
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
  createdAt: string;
  updatedAt: string;
}
/** The fields a provisioner sets on a person; D68 requires every one of them. */
export interface UserFields {
  externalId: string;
  userName: string;
  name: string;
  email: string;
  enabled: boolean;
}
export interface GroupFields {
  externalId: string | null;
  label: string;
  members: string[];
}
const need = (attribute: string): never => {
  throw new ScimError(400, `Attribute '${attribute}' is required.`, 'invalidValue');
};
/** The work address: `type: "work"` first, then the primary, then the first one given. */
export function workEmail(emails: ScimUserInput['emails']): string | undefined {
  const list = emails ?? [];
  return (list.find(e => e.type?.toLowerCase() === 'work') ?? list.find(e => e.primary) ?? list[0])?.value;
}
/** A full user representation (POST, PUT) to the fields Clew holds, with D68's requirements checked by name. */
export function userFields(input: ScimUserInput): UserFields {
  const name =
    input.displayName ??
    input.name?.formatted ??
    [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ');
  return {
    externalId: input.externalId ?? need('externalId'),
    userName: input.userName,
    name: name || need('displayName'),
    email: workEmail(input.emails) ?? need('emails'),
    enabled: input.active ?? true,
  };
}
export function groupFields(input: ScimGroupInput): GroupFields {
  return {
    externalId: input.externalId ?? null,
    label: input.displayName,
    members: [...new Set((input.members ?? []).map(m => m.value))],
  };
}
/**
 * The keys a group's `externalId` may carry, checked at the boundary so a mistake fails where it is made.
 *
 * D93: `protected` is refused until D68's open question, whether Clew may hold that fact at all, is answered. Nothing
 * about it is stored, derived into a context or shown; a client that sends it learns why.
 *
 * D96: a key that is written wrong is refused instead of being stored as a plain group that gives nobody anything:
 * a reserved word in another case (`Unit:skola`, `Protected`), `unit:` or `unit-manager:` without a unit id or with
 * space around it, and `capability:` with a name outside the closed list. Any other `externalId` is a plain group.
 */
const RESERVED_PREFIXES = [MANAGER_KEY, UNIT_KEY, CAPABILITY_KEY] as const;
const refusedKey = (detail: string) => new ScimError(400, `${detail} The group was not stored.`, 'invalidValue');
export function assertAcceptedKey(fields: GroupFields): void {
  const key = fields.externalId;
  if (key === null) return;
  const lower = key.toLowerCase();
  if (lower === PROTECTED_KEY)
    throw refusedKey(
      `The key '${PROTECTED_KEY}' is not accepted: Clew has not decided whether it may hold that fact (D93).`,
    );
  const prefix = RESERVED_PREFIXES.find(p => lower.startsWith(p));
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
/** `attribute eq "value"` on one of `attributes`, the one filter shape D68 requires; anything else is `invalidFilter`. */
export function parseFilter(
  filter: string | undefined,
  attributes: readonly string[],
): { attribute: string; value: string } | undefined {
  if (filter === undefined || filter.trim() === '') return undefined;
  const match = /^\s*([A-Za-z][A-Za-z0-9_.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  const attribute = match && attributes.find(a => a.toLowerCase() === match[1]!.toLowerCase());
  if (!match || !attribute)
    throw new ScimError(
      400,
      `Only '<attribute> eq "value"' on ${attributes.join(', ')} is supported.`,
      'invalidFilter',
    );
  return { attribute, value: match[2]!.replace(/\\(.)/g, '$1') };
}
/** `startIndex` is 1-based and `count` is capped (RFC 7644 §3.4.2.4); a missing or broken value takes the default. */
export function pageOf(query: { startIndex?: string; count?: string }) {
  const startIndex = Math.max(1, Number.parseInt(query.startIndex ?? '1', 10) || 1),
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
      const [top, ...sub] = name.split('.');
      return { top: top!, sub: sub.join('.') || undefined };
    });
/** One attribute's value with only, or without, the named sub-attributes; a multi-valued one is narrowed per element. */
const narrow = (value: unknown, subs: readonly string[], keep: boolean): unknown => {
  if (Array.isArray(value)) return value.map(v => narrow(v, subs, keep));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => subs.includes(k.toLowerCase()) === keep));
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
  return out as T;
}
/** Whether a projection leaves `attribute` out entirely, so the query that would fill it need not run. */
export function leavesOut(projection: Projection | undefined, attribute: string): boolean {
  const name = attribute.toLowerCase(),
    wanted = projectionPaths(projection?.attributes),
    excluded = projectionPaths(projection?.excludedAttributes);
  return (wanted.length > 0 && !wanted.some(p => p.top === name)) || excluded.some(p => p.top === name && !p.sub);
}
const opOf = (operation: ScimPatchOperation) => {
  const op = operation.op.toLowerCase();
  if (op !== 'add' && op !== 'replace' && op !== 'remove')
    throw new ScimError(400, `Unknown patch operation '${operation.op}'.`, 'invalidSyntax');
  return op;
};
const asObject = (value: unknown, path: string | undefined): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new ScimError(
    400,
    path ? `Path '${path}' needs an object value.` : 'A patch without a path needs an object value.',
    'invalidValue',
  );
};
const asString = (value: unknown, path: string): string => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 512) return value;
  throw new ScimError(400, `Attribute '${path}' needs a non-empty string.`, 'invalidValue');
};
const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'True') return true;
  if (value === 'false' || value === 'False') return false;
  throw new ScimError(400, `Attribute '${path}' needs a boolean.`, 'invalidValue');
};
/** A path without the core schema's URN, in lower case: `urn:…:User:displayName` and `displayName` are one attribute. */
const coreKey = (path: string, resource: 'user' | 'group') =>
  path
    .trim()
    .toLowerCase()
    .replace(
      resource === 'user'
        ? /^urn:ietf:params:scim:schemas:core:2\.0:user:/
        : /^urn:ietf:params:scim:schemas:core:2\.0:group:/,
      '',
    );
const READ_ONLY = new Set(['schemas', 'id', 'meta', 'groups']);
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
/** RFC 7644 §3.5.2.2: removing an attribute the schema requires answers `mutability`. */
const required = (path: string) =>
  new ScimError(400, `Attribute '${path}' cannot be removed; Clew requires it.`, 'mutability');
/**
 * What a `remove` on a user is aimed at. Clew holds five attributes and requires them all (D68 item 1); every other
 * attribute, an extension's included, is not held, so removing it changes nothing and is accepted, as adding it is.
 * An address of another type than the work one is not the one Clew holds either.
 */
const userRemoval = (key: string): 'required' | 'readOnly' | 'notHeld' => {
  if (READ_ONLY.has(key) || key.startsWith('meta.')) return 'readOnly';
  if (['username', 'externalid', 'displayname', 'active', 'emails', 'emails.value'].includes(key)) return 'required';
  const filtered = /^emails\[(.*)\](?:\.[a-z]+)?$/.exec(key);
  if (filtered) {
    const type = /^\s*type\s+eq\s+"([^"]*)"\s*$/.exec(filtered[1]!);
    return type && type[1] !== 'work' ? 'notHeld' : 'required';
  }
  return 'notHeld';
};
/**
 * PATCH on a user (RFC 7644 §3.5.2), as the clients Clew expects send it: a path per operation, or one operation
 * without a path whose value is an object of attributes (Entra, Okta). An attribute Clew does not hold is accepted and
 * ignored whatever the operation; removing one Clew requires is refused. `id` is the resource's own, for a path-less
 * value that repeats it.
 */
export function applyUserPatch(
  current: UserFields,
  operations: readonly ScimPatchOperation[],
  id?: string,
): UserFields {
  let next = { ...current };
  const set = (path: string, value: unknown, pathless: boolean) => {
    const key = coreKey(path, 'user');
    if (key === 'username') next.userName = asString(value, path);
    else if (key === 'externalid') next.externalId = asString(value, path);
    else if (key === 'displayname' || key === 'name.formatted') next.name = asString(value, path);
    else if (key === 'active') next.enabled = asBoolean(value, path);
    else if (key === 'emails') {
      const list = Array.isArray(value) ? value : [value];
      const email = workEmail(
        list
          .map(e =>
            e && typeof e === 'object'
              ? (e as { value?: string; type?: string; primary?: boolean })
              : { value: String(e) },
          )
          .filter(e => typeof e.value === 'string') as Array<{ value: string; type?: string; primary?: boolean }>,
      );
      next.email = email ?? need('emails');
    } else if (/^emails\[.*\]\.value$/.test(key) || key === 'emails.value') next.email = asString(value, path);
    else if (key === 'name') {
      // Given and family names are not held: a name object sets the name only through `formatted`, as the paths do.
      const formatted = asObject(value, path).formatted;
      if (formatted !== undefined) next.name = asString(formatted, 'name.formatted');
    } else if (READ_ONLY.has(key)) {
      if (!pathless) throw readOnly(path);
      repeated(key, value, id);
    }
    /* `name.givenName`, an extension or any other attribute Clew does not hold is accepted and ignored, as the standard asks */
  };
  for (const operation of operations) {
    const op = opOf(operation);
    if (op === 'remove') {
      if (!operation.path) throw new ScimError(400, 'A remove operation needs a path.', 'noTarget');
      const aim = userRemoval(coreKey(operation.path, 'user'));
      if (aim === 'readOnly') throw readOnly(operation.path);
      if (aim === 'required') throw required(operation.path);
      continue;
    }
    if (operation.path) set(operation.path, operation.value, false);
    else for (const [key, value] of Object.entries(asObject(operation.value, undefined))) set(key, value, true);
  }
  return next;
}
/**
 * PATCH on a group: `members` added, removed (by path filter or by value list) or replaced; the name and external id
 * replaced; the external id removed. Anything else is not held and is ignored, a read-only attribute as for a user.
 */
export function applyGroupPatch(
  current: GroupFields,
  operations: readonly ScimPatchOperation[],
  id?: string,
): GroupFields {
  let members = new Set(current.members),
    next = { ...current };
  const memberIds = (value: unknown): string[] => {
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return list.map(m => {
      const member = m && typeof m === 'object' ? (m as { value?: unknown }).value : m;
      return asString(member, 'members.value');
    });
  };
  const setAttribute = (path: string, value: unknown, pathless: boolean) => {
    const key = coreKey(path, 'group');
    if (key === 'displayname') next.label = asString(value, path);
    else if (key === 'externalid') next.externalId = asString(value, path);
    else if (key === 'members') members = new Set(memberIds(value));
    else if (READ_ONLY.has(key) && key !== 'groups') {
      if (!pathless) throw readOnly(path);
      repeated(key, value, id);
    }
  };
  for (const operation of operations) {
    const op = opOf(operation),
      path = operation.path?.trim(),
      key = path ? coreKey(path, 'group') : undefined;
    const filtered = key && /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(key);
    if (filtered) {
      // The id as it was sent: the key is lower-cased for matching, an id is not.
      const sent = /"((?:[^"\\]|\\.)*)"\s*\]$/.exec(path!)![1]!.replace(/\\(.)/g, '$1');
      if (op === 'remove') members.delete(sent);
      else throw new ScimError(400, `Path '${path}' supports remove only.`, 'invalidPath');
      continue;
    }
    if (key === 'members') {
      if (op === 'add') for (const member of memberIds(operation.value)) members.add(member);
      else if (op === 'remove') {
        if (operation.value === undefined) members.clear();
        else for (const member of memberIds(operation.value)) members.delete(member);
      } else members = new Set(memberIds(operation.value));
      continue;
    }
    if (op === 'remove') {
      if (!path || !key) throw new ScimError(400, 'A remove operation needs a path.', 'noTarget');
      if (key === 'externalid') next.externalId = null;
      else if (key === 'displayname') throw required(path);
      else if (READ_ONLY.has(key) || key.startsWith('meta.')) throw readOnly(path);
      continue;
    }
    if (path) setAttribute(path, operation.value, false);
    else
      for (const [name, value] of Object.entries(asObject(operation.value, undefined)))
        if (name.toLowerCase() === 'members' && op === 'add')
          for (const member of memberIds(value)) members.add(member);
        else setAttribute(name, value, true);
  }
  return { ...next, members: [...members] };
}
export function userResource(
  record: UserRecord,
  groups: ReadonlyArray<{ id: string; label: string }>,
  base: string,
): ScimUser {
  return {
    schemas: [SCIM.user],
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    userName: record.userName ?? record.id,
    displayName: record.name,
    name: { formatted: record.name },
    emails: record.email ? [{ value: record.email, type: 'work', primary: true }] : [],
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
    schemas: [SCIM.group],
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    displayName: record.label,
    members: members.map(m => ({ value: m.id, display: m.name, $ref: `${base}/Users/${m.id}` })),
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
    schemaExtensions: [],
    meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
  },
  {
    schemas: [SCIM.resourceType],
    id: 'Group',
    name: 'Group',
    endpoint: '/Groups',
    description: 'A group as the source knows it; keys in externalId carry its meaning in Clew.',
    schema: SCIM.group,
    schemaExtensions: [],
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
    description: 'A person who may sign in to Clew. externalId, userName, displayName and a work e-mail are required.',
    attributes: [
      attribute('userName', 'string', { required: true, uniqueness: 'server' }),
      attribute('externalId', 'string', { required: true, caseExact: true, uniqueness: 'server' }),
      attribute('displayName', 'string', { required: true }),
      attribute('name', 'complex', { subAttributes: [attribute('formatted', 'string')] }),
      attribute('emails', 'complex', {
        multiValued: true,
        required: true,
        subAttributes: [attribute('value', 'string'), attribute('type', 'string'), attribute('primary', 'boolean')],
      }),
      attribute('active', 'boolean'),
      attribute('groups', 'complex', {
        multiValued: true,
        mutability: 'readOnly',
        subAttributes: [attribute('value', 'string'), attribute('display', 'string'), attribute('$ref', 'reference')],
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.user}` },
  },
  {
    schemas: [SCIM.schema],
    id: SCIM.group,
    name: 'Group',
    description:
      'A group; unit:, unit-manager: and capability: keys in externalId carry meaning in Clew. The key protected is refused (D93), and so is a key written wrong (D96). Members are users; a group as a member is refused.',
    attributes: [
      attribute('displayName', 'string', { required: true }),
      attribute('externalId', 'string', { caseExact: true, uniqueness: 'server' }),
      attribute('members', 'complex', {
        multiValued: true,
        subAttributes: [attribute('value', 'string'), attribute('display', 'string'), attribute('$ref', 'reference')],
      }),
    ],
    meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM.group}` },
  },
];
