import { isCapability, type Capability, type Role } from '@clew/contracts';

/**
 * Deriving a person's authority from what was pushed (D68) and mapped (D85). Pure: no I/O, no clock.
 *
 * A group's meaning is a key in its `externalId`: `unit:<unitId>` makes the member an employee of that unit and names
 * it with the group's `displayName`; `unit-manager:<unitId>` makes the member its manager, which wins over `unit:` for
 * the same unit; `capability:<name>` gives a capability of the closed list; `protected` keeps the person out of lists
 * others see. Any other group gives nothing here; a rules row (group to capability) may give a capability. A person
 * with no unit membership has no active grant, so a mapping mistake fails closed.
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
  /** Units named by a `unit:` group, labelled by that group. */
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
    sorted = [...capabilities].sort();
  return {
    units: [...labels.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.id.localeCompare(b.id)),
    assignments,
    active,
    capabilities: sorted,
    protected: isProtected,
    grant: active && {
      unitId: active.unitId,
      unitLabel: labels.get(active.unitId) ?? knownLabels[active.unitId] ?? active.unitId,
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
    count = Math.min(SCIM_MAX_RESULTS, Math.max(0, Number.parseInt(query.count ?? String(SCIM_MAX_RESULTS), 10) || 0));
  return { startIndex, count };
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
/**
 * PATCH on a user (RFC 7644 §3.5.2), as the clients Clew expects send it: a path per operation, or one operation
 * without a path whose value is an object of attributes (Entra). Removing a required attribute is refused.
 */
export function applyUserPatch(current: UserFields, operations: readonly ScimPatchOperation[]): UserFields {
  let next = { ...current };
  const set = (path: string, value: unknown) => {
    const key = path.toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:user:/, '');
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
    } else if (/^emails\[.*\]\.value$/i.test(key) || key === 'emails.value') next.email = asString(value, path);
    else if (key === 'name') next.name = asString(asObject(value, path).formatted, 'name.formatted');
    else if (key.startsWith('name.')) {
      /* given and family names are not held; the formatted name is what Clew shows */
    } else if (key === 'schemas' || key === 'id' || key === 'meta' || key === 'groups')
      throw new ScimError(400, `Attribute '${path}' is read-only.`, 'mutability');
    /* an extension or unknown attribute is accepted and ignored, as the standard asks */
  };
  for (const operation of operations) {
    const op = opOf(operation);
    if (op === 'remove') {
      if (!operation.path) throw new ScimError(400, 'A remove operation needs a path.', 'noTarget');
      throw new ScimError(
        400,
        `Attribute '${operation.path}' cannot be removed; every attribute Clew holds is required.`,
        'invalidValue',
      );
    }
    if (operation.path) set(operation.path, operation.value);
    else for (const [key, value] of Object.entries(asObject(operation.value, undefined))) set(key, value);
  }
  return next;
}
/** PATCH on a group: `members` added, removed (by path filter or by value list) or replaced; the name and external id replaced. */
export function applyGroupPatch(current: GroupFields, operations: readonly ScimPatchOperation[]): GroupFields {
  let members = new Set(current.members),
    next = { ...current };
  const memberIds = (value: unknown): string[] => {
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return list.map(m => {
      const id = m && typeof m === 'object' ? (m as { value?: unknown }).value : m;
      return asString(id, 'members.value');
    });
  };
  const setAttribute = (path: string, value: unknown) => {
    const key = path.toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:group:/, '');
    if (key === 'displayname') next.label = asString(value, path);
    else if (key === 'externalid') next.externalId = asString(value, path);
    else if (key === 'members') members = new Set(memberIds(value));
    else if (key === 'schemas' || key === 'id' || key === 'meta')
      throw new ScimError(400, `Attribute '${path}' is read-only.`, 'mutability');
  };
  for (const operation of operations) {
    const op = opOf(operation),
      path = operation.path?.trim();
    const filtered = path && /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i.exec(path);
    if (filtered) {
      const id = filtered[1]!.replace(/\\(.)/g, '$1');
      if (op === 'remove') members.delete(id);
      else throw new ScimError(400, `Path '${path}' supports remove only.`, 'invalidPath');
      continue;
    }
    if (path && path.toLowerCase() === 'members') {
      if (op === 'add') for (const id of memberIds(operation.value)) members.add(id);
      else if (op === 'remove') {
        if (operation.value === undefined) members.clear();
        else for (const id of memberIds(operation.value)) members.delete(id);
      } else members = new Set(memberIds(operation.value));
      continue;
    }
    if (op === 'remove') {
      if (path?.toLowerCase() === 'externalid') next.externalId = null;
      else throw new ScimError(400, `Attribute '${path ?? ''}' cannot be removed.`, path ? 'invalidValue' : 'noTarget');
      continue;
    }
    if (path) setAttribute(path, operation.value);
    else
      for (const [key, value] of Object.entries(asObject(operation.value, undefined)))
        if (key.toLowerCase() === 'members' && op === 'add') for (const id of memberIds(value)) members.add(id);
        else setAttribute(key, value);
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
    description: 'A group; unit:, unit-manager:, capability: and protected keys in externalId carry meaning in Clew.',
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
