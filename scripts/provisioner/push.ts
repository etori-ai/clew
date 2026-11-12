import { ScimClientError, type ScimClient } from './client';
import { fullName, type Directory, type DirectoryPerson } from './directory';

/**
 * The synthetic provisioner (D68 item 7): reads a directory and pushes it to Clew's SCIM server, mapping the source's
 * facts to D68's contract and nothing else. Idempotent: a person is created or replaced by `externalId`, a group by its
 * `externalId` key, a person who left the directory is deactivated, and a group this provisioner owns that no longer
 * follows from the directory is removed. Clew learns nothing about the source: the mapping below is the whole of it.
 *
 * The order is D101's: the organisation first, as nodes without people; then the people; then who is placed where,
 * everybody added before anybody is removed, so a person who moves between two units is never on neither; then what
 * left the source. A push that would withdraw a large share of the people, or of a kind of group, is refused before
 * anything is written.
 */
const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User',
  SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group',
  SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  /** D99: the extension a `unit:` group names the unit above it in. */
  SCIM_UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
/** Stable namespaces assigned to one writer, independent of today's export. */
export interface SourceScope {
  userPrefix: string;
  groupPrefixes: readonly string[];
  groupKeys: readonly string[];
}
export interface PlannedGroup {
  externalId: string;
  displayName: string;
  /** D99: on a `unit:` group below another, the `externalId` of the unit group above it. */
  parent?: string;
  members: string[];
}
export interface Plan {
  users: Array<{ externalId: string; body: ReturnType<typeof userBody> }>;
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
    if (typeof p.active !== 'boolean') throw new Error(`Missing active state for '${p.externalId}'.`);
    if (!p.active) continue;
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
  // D110: the standard attribute, sent when the source holds one. A `PUT` without it clears the title in Clew.
  ...(p.title ? { title: p.title } : {}),
  active: p.active,
});
export interface PushSummary {
  created: number;
  replaced: number;
  deactivated: number;
  groupsCreated: number;
  /** The groups Clew already held and this push kept, changed or not. */
  groupsReplaced: number;
  groupsRemoved: number;
  /**
   * The people Clew refused, each with the reason. Everybody else was sent: one row the source has wrong does not
   * keep a leaver active or a newcomer out. A run with anybody here has not succeeded, and its caller says so.
   */
  refused: Array<{ externalId: string; userName: string; detail: string }>;
}
export interface PushOptions {
  log?: (line: string) => void;
  /** An operator confirmed these withdrawals against a complete source export. */
  force?: boolean;
}
/**
 * A withdrawal an operator confirms against the complete snapshot before it is sent: everything Clew holds of a kind
 * at once, which is what an empty export looks like, or more than one row and more than this share of them. One row
 * is an ordinary day in a source of any size, so a source of three people can lose one of them without `force`.
 */
const withdrawalShare = 0.2;
const excessive = (withdrawn: number, held: number) =>
  withdrawn > 0 && (withdrawn === held || withdrawn > Math.max(1, held * withdrawalShare));
/** What a push has counted so far, kept from the attempt a 503 interrupted to the one that follows it. */
interface Tally {
  summary: PushSummary;
  /** The `externalId` of every user and group already counted as created or replaced. */
  users: Set<string>;
  groups: Set<string>;
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
const patch = (client: ScimClient, path: string, Operations: unknown[]) =>
  client.request('PATCH', path, { schemas: [SCIM_PATCH], Operations });
const asMembers = (ids: readonly string[]) => ids.map(value => ({ value }));
/** Reconcile one complete snapshot inside its configured ownership boundary. */
export async function push(
  client: ScimClient,
  directory: Directory,
  scope: SourceScope,
  options: PushOptions = {},
): Promise<PushSummary> {
  const tally: Tally = {
    summary: {
      created: 0,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 0,
      groupsRemoved: 0,
      refused: [],
    },
    users: new Set(),
    groups: new Set(),
  };
  try {
    return await reconcile(client, directory, scope, options, tally);
  } catch (error) {
    if (!(error instanceof ScimClientError) || error.status !== 503 || !error.retryAfter) throw error;
    const header = error.retryAfter.trim();
    const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    if (!Number.isFinite(delay) || delay > 60_000) throw error;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
    // Everything is read again, in case the service committed a write before the proxy answered 503. The summary
    // goes on from what the first attempt counted, so it says what the push did and not what its second half did.
    return reconcile(client, directory, scope, options, tally);
  }
}

async function reconcile(
  client: ScimClient,
  directory: Directory,
  scope: SourceScope,
  options: PushOptions,
  tally: Tally,
): Promise<PushSummary> {
  if (directory.complete !== true) throw new Error('Incomplete source snapshot. Nothing was written.');
  if (!scope.userPrefix || scope.groupPrefixes.some(prefix => !prefix))
    throw new Error('Source ownership requires nonempty prefixes.');
  const ownsGroup = (key: string) =>
    scope.groupKeys.includes(key) || scope.groupPrefixes.some(prefix => key.startsWith(prefix));
  const planned = plan(directory),
    { summary } = tally;
  // A second attempt after a 503 sends everybody again, so it says again who was refused.
  summary.refused = [];
  for (const u of planned.users)
    if (!u.externalId.startsWith(scope.userPrefix))
      throw new Error(`User '${u.externalId}' is outside the source namespace.`);
  for (const g of planned.groups)
    if (!ownsGroup(g.externalId)) throw new Error(`Group '${g.externalId}' is outside the source namespace.`);
  // What Clew holds of people, read once and before anything is written: whom to replace, and who has left.
  const held: Array<{ id: string; externalId?: string; userName: string; active?: boolean }> = [];
  for await (const user of page(client, '/Users?attributes=externalId,userName,active')) held.push(user);
  const wanted = new Map(planned.users.map(u => [u.externalId, u.body.active])),
    own = held.filter(u => u.externalId?.startsWith(scope.userPrefix) && u.active !== false),
    leavers = own.filter(u => !wanted.has(u.externalId!)),
    withdrawing = own.filter(u => wanted.get(u.externalId!) !== true).length;
  if (!options.force && excessive(withdrawing, own.length))
    throw new Error(
      `The source lists ${planned.users.length} people and Clew holds ${own.length} active ones from it, so this push would deactivate ${withdrawing}. Nothing was written. An empty or truncated export looks like this; push again with force once a person has decided that the source is right.`,
    );
  // What Clew holds of this writer's groups, read once as well: which to remove, and each unit as it stands.
  const keep = new Set(planned.groups.map(g => g.externalId)),
    listed = new Map<string, { id: string; displayName: string; parent?: string }>(),
    gone: Array<{ id: string; externalId: string; parent?: string }> = [];
  const counts = new Map<string, { held: number; removed: number }>();
  for await (const g of page(client, '/Groups?excludedAttributes=members')) {
    if (!g.externalId || !ownsGroup(g.externalId)) continue;
    // Units and plain groups are independent exports. Managers and capabilities are derived from people.
    const kind = g.externalId.startsWith(UNIT)
      ? 'units'
      : g.externalId.startsWith('unit-manager:') || g.externalId.startsWith('capability:')
        ? 'role groups'
        : 'directory groups';
    const count = counts.get(kind) ?? { held: 0, removed: 0 },
      parent: string | undefined = g[SCIM_UNIT]?.parent;
    count.held++;
    listed.set(g.externalId, { id: g.id, displayName: g.displayName, parent });
    if (!keep.has(g.externalId)) {
      count.removed++;
      gone.push({ id: g.id, externalId: g.externalId, parent });
    }
    counts.set(kind, count);
  }
  for (const [kind, count] of counts)
    if (!options.force && excessive(count.removed, count.held))
      throw new Error(
        `The source would remove ${count.removed} of ${count.held} owned ${kind}. Nothing was written. Confirm the complete export before using force.`,
      );
  // 1. The organisation, from the root down (D99): each unit as a node with its name and the unit above it, and
  // nobody on it yet. A unit that moved or was renamed is patched, so the people on it are left as they are.
  for (const unit of planned.groups.filter(g => g.externalId.startsWith(UNIT))) {
    const found = listed.get(unit.externalId);
    if (!found) {
      await client.request('POST', '/Groups', {
        schemas: unit.parent ? [SCIM_GROUP, SCIM_UNIT] : [SCIM_GROUP],
        externalId: unit.externalId,
        displayName: unit.displayName,
        ...(unit.parent ? { [SCIM_UNIT]: { parent: unit.parent } } : {}),
      });
      tally.groups.add(unit.externalId);
      summary.groupsCreated++;
      options.log?.(`created group ${unit.externalId}`);
      continue;
    }
    const operations: unknown[] = [];
    if (found.displayName !== unit.displayName)
      operations.push({ op: 'replace', path: 'displayName', value: unit.displayName });
    if (found.parent !== unit.parent)
      operations.push(
        unit.parent
          ? { op: 'replace', path: SCIM_UNIT + ':parent', value: unit.parent }
          : { op: 'remove', path: SCIM_UNIT + ':parent' },
      );
    if (operations.length) await patch(client, '/Groups/' + found.id, operations);
  }
  // 2. The people.
  const ids = new Map(held.flatMap(u => (u.externalId ? [[u.externalId, u.id] as const] : [])));
  const disabled = new Set(held.filter(u => u.active === false).map(u => u.id)),
    rehires: string[] = [];
  // An account name that is given to somebody new is first moved off the row that holds it. A person who leaves is
  // deactivated, not erased, and keeps their `userName`, which is unique in the installation, so without this the
  // newcomer is refused with a 409. The old row takes its own `externalId` as its name: it is unique, it is never
  // reused, and nobody signs in with it. This also untangles two people who swap names.
  const lower = (name: string) => name.toLowerCase(),
    taker = new Map(planned.users.filter(u => u.body.active).map(u => [lower(u.body.userName), u.externalId])),
    givenAway = (userName: string, externalId: string) => (taker.get(lower(userName)) ?? externalId) !== externalId;
  // The source may keep the leaver's row with the name it has given to somebody else: that row is sent parked too.
  const users = planned.users.map(u =>
    !u.body.active && givenAway(u.body.userName, u.externalId)
      ? { ...u, body: { ...u.body, userName: u.externalId } }
      : u,
  );
  const nameNow = new Map(users.map(u => [u.externalId, u.body.userName]));
  for (const holder of held) {
    const own = holder.externalId?.startsWith(scope.userPrefix);
    if (!own || !givenAway(holder.userName, holder.externalId!)) continue;
    if (lower(nameNow.get(holder.externalId!) ?? '') === lower(holder.userName)) continue;
    await patch(client, '/Users/' + holder.id, [{ op: 'replace', path: 'userName', value: holder.externalId }]);
    options.log?.(`moved the account name ${holder.userName} off ${holder.externalId}`);
  }
  // Who has left the source, before anybody is created or changed: nothing that goes wrong below keeps them active.
  for (const user of leavers) {
    await patch(client, '/Users/' + user.id, [{ op: 'replace', path: 'active', value: false }]);
    summary.deactivated++;
    options.log?.(`deactivated ${user.userName}`);
  }
  for (const user of users) {
    const id = ids.get(user.externalId);
    try {
      if (id) {
        const rehire = disabled.has(id) && user.body.active;
        await client.request('PUT', '/Users/' + id, rehire ? { ...user.body, active: false } : user.body);
        if (rehire) rehires.push(id);
        if (!user.body.active && !disabled.has(id)) summary.deactivated++;
        if (!tally.users.has(user.externalId)) summary.replaced++;
      } else if (user.body.active) {
        const { body } = await client.request('POST', '/Users', user.body);
        ids.set(user.externalId, body.id);
        summary.created++;
        options.log?.(`created ${user.body.userName}`);
      }
      // Else the source keeps a person who left before Clew ever held them. Nothing is created: a disabled row would
      // only hold their `userName` against the next person who is given it.
    } catch (error) {
      // What Clew says is wrong about one person (a 400) or their name (a 409) is that person's alone. Everybody
      // else is sent, and the run reports the refusals when it is done. Anything else stops the run.
      if (!(error instanceof ScimClientError) || (error.status !== 400 && error.status !== 409)) throw error;
      summary.refused.push({ externalId: user.externalId, userName: user.body.userName, detail: error.message });
      options.log?.(`refused ${user.body.userName}: ${error.message}`);
    }
    tally.users.add(user.externalId);
  }
  // 3. Who is in which group, in two rounds. First everybody a group gains, in every group; then everybody a group
  // loses. A person who moves from one unit to another is in both for a moment and never in neither, so their grant
  // is not taken away and handed back, and they are not signed out in the middle of a push (D101).
  const trims: Array<{ id: string; operations: unknown[] }> = [];
  for (const group of planned.groups) {
    // A person Clew refused has no id, and is in no group until the source is right about them.
    const members = group.members.flatMap(externalId => ids.get(externalId) ?? []),
      found = (await client.request('GET', '/Groups' + eq('externalId', group.externalId))).body.Resources?.[0];
    if (!found) {
      await client.request('POST', '/Groups', {
        schemas: [SCIM_GROUP],
        externalId: group.externalId,
        displayName: group.displayName,
        members: asMembers(members),
      });
      tally.groups.add(group.externalId);
      summary.groupsCreated++;
      options.log?.(`created group ${group.externalId}`);
      continue;
    }
    if (!tally.groups.has(group.externalId)) summary.groupsReplaced++;
    tally.groups.add(group.externalId);
    const has = new Set<string>((found.members ?? []).map((m: { value: string }) => m.value)),
      wants = new Set(members),
      gained = members.filter(id => !has.has(id)),
      lost = [...has].filter(id => !wants.has(id)),
      operations: unknown[] = [];
    if (gained.length)
      await patch(client, '/Groups/' + found.id, [{ op: 'add', path: 'members', value: asMembers(gained) }]);
    if (found.displayName !== group.displayName)
      operations.push({ op: 'replace', path: 'displayName', value: group.displayName });
    if (lost.length) operations.push({ op: 'remove', path: 'members', value: asMembers(lost) });
    if (operations.length) trims.push({ id: found.id, operations });
  }
  for (const trim of trims) await patch(client, '/Groups/' + trim.id, trim.operations);
  // 4. The groups that no longer follow from the source.
  // From the leaves up (D99): a unit goes once no unit that is also going still stands below it. The units that stay
  // were written above, so none of them names a unit that goes.
  while (gone.length) {
    const parents = new Set(gone.map(g => g.parent)),
      next = gone.findIndex(g => !parents.has(g.externalId)),
      [group] = gone.splice(next === -1 ? 0 : next, 1);
    await client.request('DELETE', '/Groups/' + group!.id);
    summary.groupsRemoved++;
    options.log?.(`removed group ${group!.externalId}`);
  }
  // A returning person regains access only after expired duties have been removed.
  for (const id of rehires) await patch(client, '/Users/' + id, [{ op: 'replace', path: 'active', value: true }]);
  return summary;
}
