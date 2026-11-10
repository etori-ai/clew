import type { ScimClient } from './client';
import { fullName, type Directory, type DirectoryPerson } from './directory';

/**
 * The synthetic provisioner (D68 item 7): reads a directory and pushes it to Clew's SCIM server, mapping the source's
 * facts to D68's contract and nothing else. Idempotent: a person is created or replaced by `externalId`, a group by its
 * `externalId` key, a person who left the directory is deactivated, and a group this provisioner owns that no longer
 * follows from the directory is removed. Clew learns nothing about the source: the mapping below is the whole of it.
 */
const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User',
  SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group',
  SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  /** D99: the extension a `unit:` group names the unit above it in. */
  SCIM_UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
/**
 * The keys this provisioner writes, plus `ad:`, the development directory's plain groups; a group with another key
 * belongs to somebody else and is left alone.
 */
const OWNED = ['unit:', 'unit-manager:', 'capability:', 'ad:'];
export interface PlannedGroup {
  externalId: string;
  displayName: string;
  /** D99: on a `unit:` group below another, the `externalId` of the unit group above it. */
  parent?: string;
  members: string[];
}
export interface Plan {
  users: Array<{ externalId: string; body: Record<string, unknown> }>;
  groups: PlannedGroup[];
}
/** From the directory's facts to SCIM resources: pure. */
export function plan(directory: Directory): Plan {
  const groups = new Map<string, PlannedGroup>();
  const group = (externalId: string, displayName: string) => {
    const g = groups.get(externalId) ?? { externalId, displayName, members: [] };
    groups.set(externalId, g);
    return g;
  };
  const unitOf = (p: DirectoryPerson, id: string, what: string) => {
    const unit = directory.units.find(u => u.id === id);
    if (!unit) throw new Error(`${p.userName} has ${what} '${id}', which the directory does not list.`);
    return unit;
  };
  // Every unit is a node of the tree, also one nobody is placed on (D99). A unit's depth is how many units stand
  // above it; a parent the directory does not list, or a chain that never reaches a root, is the source's mistake.
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: string[] = []): number => {
    if (depth.has(id)) return depth.get(id)!;
    const unit = directory.units.find(u => u.id === id);
    if (!unit) throw new Error(`The unit '${seen.at(-1)}' has parent '${id}', which the directory does not list.`);
    if (seen.includes(id)) throw new Error(`The units ${[...seen, id].join(' → ')} are each other's parents.`);
    const d = unit.parent === undefined ? 0 : depthOf(unit.parent, [...seen, id]) + 1;
    depth.set(id, d);
    return d;
  };
  for (const unit of directory.units) {
    depthOf(unit.id);
    const node = group('unit:' + unit.id, unit.label);
    if (unit.parent !== undefined) node.parent = 'unit:' + unit.parent;
  }
  for (const g of directory.groups) group(g.id, g.label);
  for (const p of directory.people) {
    const home = unitOf(p, p.department, 'department');
    group('unit:' + home.id, home.label).members.push(p.externalId);
    for (const id of p.alsoIn ?? []) {
      const unit = unitOf(p, id, 'unit');
      group('unit:' + unit.id, unit.label).members.push(p.externalId);
    }
    for (const id of [...(p.manager ? [home.id] : []), ...(p.alsoManages ?? [])]) {
      const unit = unitOf(p, id, 'unit');
      group('unit-manager:' + unit.id, 'Chefer · ' + unit.label).members.push(p.externalId);
    }
    for (const id of p.groups ?? []) {
      const g = directory.groups.find(g => g.id === id);
      if (!g) throw new Error(`${p.userName} has group '${id}', which the directory does not list.`);
      group(g.id, g.label).members.push(p.externalId);
    }
    for (const c of p.capabilities) group('capability:' + c, 'Clew · ' + c).members.push(p.externalId);
  }
  return {
    users: directory.people.map(p => ({ externalId: p.externalId, body: userBody(p) })),
    // The units first and from the root down, since a parent has to exist before the unit below it (D99); then the
    // rest by key.
    groups: [...groups.values()]
      .map(g => ({ ...g, members: [...new Set(g.members)] }))
      .sort((a, b) => levelOf(a, depth) - levelOf(b, depth) || a.externalId.localeCompare(b.externalId)),
  };
}
const UNIT = 'unit:';
/** A unit group's depth in the tree; every other group sorts after the last unit. */
const levelOf = (g: PlannedGroup, depth: ReadonlyMap<string, number>) =>
  g.externalId.startsWith(UNIT) ? (depth.get(g.externalId.slice(UNIT.length)) ?? 0) : Number.MAX_SAFE_INTEGER;
const userBody = (p: DirectoryPerson) => ({
  schemas: [SCIM_USER],
  externalId: p.externalId,
  userName: p.userName,
  displayName: fullName(p),
  name: { formatted: fullName(p), givenName: p.givenName, familyName: p.familyName },
  emails: [{ value: p.email, type: 'work', primary: true }],
  active: true,
});
export interface PushSummary {
  created: number;
  replaced: number;
  deactivated: number;
  groupsCreated: number;
  groupsReplaced: number;
  groupsRemoved: number;
}
const eq = (attribute: string, value: string) =>
  `?filter=${encodeURIComponent(`${attribute} eq "${value.replace(/(["\\])/g, '\\$1')}"`)}`;
async function* page(client: ScimClient, path: string) {
  for (let startIndex = 1; ;) {
    const { body } = await client.request(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}startIndex=${startIndex}&count=100`,
    );
    for (const r of body.Resources ?? []) yield r;
    startIndex += body.itemsPerPage ?? 0;
    if (!body.itemsPerPage || startIndex > body.totalResults) return;
  }
}
/** Push the directory. `ownPrefix` says which users are this provisioner's to deactivate when they disappear. */
export async function push(
  client: ScimClient,
  directory: Directory,
  ownPrefix = 'dev:',
  log: (line: string) => void = () => {},
): Promise<PushSummary> {
  const planned = plan(directory),
    summary: PushSummary = {
      created: 0,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 0,
      groupsRemoved: 0,
    },
    ids = new Map<string, string>();
  for (const user of planned.users) {
    const found = (await client.request('GET', '/Users' + eq('externalId', user.externalId))).body.Resources?.[0];
    if (found) {
      await client.request('PUT', '/Users/' + found.id, user.body);
      ids.set(user.externalId, found.id);
      summary.replaced++;
    } else {
      const { body } = await client.request('POST', '/Users', user.body);
      ids.set(user.externalId, body.id);
      summary.created++;
      log(`created ${user.body.userName}`);
    }
  }
  for await (const user of page(client, '/Users')) {
    if (!user.externalId?.startsWith(ownPrefix) || ids.has(user.externalId) || user.active === false) continue;
    await client.request('PATCH', '/Users/' + user.id, {
      schemas: [SCIM_PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    });
    summary.deactivated++;
    log(`deactivated ${user.userName}`);
  }
  for (const group of planned.groups) {
    const body = {
      schemas: group.parent ? [SCIM_GROUP, SCIM_UNIT] : [SCIM_GROUP],
      externalId: group.externalId,
      displayName: group.displayName,
      members: group.members.map(externalId => ({ value: ids.get(externalId)! })),
      // Left out for a root: a PUT without the extension is how a unit loses the one it had.
      ...(group.parent ? { [SCIM_UNIT]: { parent: group.parent } } : {}),
    };
    const found = (await client.request('GET', '/Groups' + eq('externalId', group.externalId))).body.Resources?.[0];
    if (found) {
      await client.request('PUT', '/Groups/' + found.id, body);
      summary.groupsReplaced++;
    } else {
      await client.request('POST', '/Groups', body);
      summary.groupsCreated++;
      log(`created group ${group.externalId}`);
    }
  }
  const keep = new Set(planned.groups.map(g => g.externalId)),
    gone: Array<{ id: string; externalId: string; parent?: string }> = [];
  for await (const group of page(client, '/Groups?excludedAttributes=members')) {
    if (!group.externalId || keep.has(group.externalId) || !OWNED.some(k => group.externalId.startsWith(k))) continue;
    gone.push({ id: group.id, externalId: group.externalId, parent: group[SCIM_UNIT]?.parent });
  }
  // From the leaves up (D99): a unit goes once no unit that is also going still stands below it. The units that stay
  // were written above, so none of them names a unit that goes.
  while (gone.length) {
    const parents = new Set(gone.map(g => g.parent)),
      next = gone.findIndex(g => !parents.has(g.externalId)),
      [group] = gone.splice(next === -1 ? 0 : next, 1);
    await client.request('DELETE', '/Groups/' + group!.id);
    summary.groupsRemoved++;
    log(`removed group ${group!.externalId}`);
  }
  return summary;
}
