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
  SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
/** The keys this provisioner writes; a group with another key belongs to somebody else and is left alone. */
const OWNED = ['unit:', 'unit-manager:', 'capability:'];
export interface PlannedGroup {
  externalId: string;
  displayName: string;
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
  for (const unit of directory.units) group('unit:' + unit.id, unit.label);
  for (const p of directory.people) {
    const unit = directory.units.find(u => u.id === p.department);
    if (!unit) throw new Error(`${p.userName} has department '${p.department}', which the directory does not list.`);
    group('unit:' + unit.id, unit.label).members.push(p.externalId);
    if (p.manager) group('unit-manager:' + unit.id, 'Chefer · ' + unit.label).members.push(p.externalId);
    for (const c of p.capabilities) group('capability:' + c, 'Clew · ' + c).members.push(p.externalId);
  }
  return {
    users: directory.people.map(p => ({ externalId: p.externalId, body: userBody(p) })),
    groups: [...groups.values()].sort((a, b) => a.externalId.localeCompare(b.externalId)),
  };
}
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
    const { body } = await client.request('GET', `${path}?startIndex=${startIndex}&count=100`);
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
      schemas: [SCIM_GROUP],
      externalId: group.externalId,
      displayName: group.displayName,
      members: group.members.map(externalId => ({ value: ids.get(externalId)! })),
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
  const keep = new Set(planned.groups.map(g => g.externalId));
  for await (const group of page(client, '/Groups')) {
    if (!group.externalId || keep.has(group.externalId) || !OWNED.some(k => group.externalId.startsWith(k))) continue;
    await client.request('DELETE', '/Groups/' + group.id);
    summary.groupsRemoved++;
    log(`removed group ${group.externalId}`);
  }
  return summary;
}
