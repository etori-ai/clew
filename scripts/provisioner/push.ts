import {
  UNIT_KEY,
  MANAGER_KEY,
  CAPABILITY_KEY,
  reservedScimGroupKey,
} from '../../packages/contracts/src/scim-group-key';
import { ScimClientError, type ScimClient } from './client';
import { fullName, type Directory, type DirectoryPerson } from './directory';

/**
 * The synthetic provisioner (D68 item 7): reads a directory and pushes it to Clew's SCIM server, mapping the source's
 * facts to D68's contract and nothing else. Idempotent: a person is created or replaced by `externalId`, a group by its
 * `externalId` key, a person who left the directory is deactivated, and a group this provisioner owns that no longer
 * follows from the directory is removed. Clew learns nothing about the source: the mapping below is the whole of it.
 *
 * The export is checked whole before the first write: complete, inside its own prefixes, every id once, and not
 * withdrawing a large share of the people or of a kind of group. Then who has left is deactivated, before anything
 * that could go wrong. Then D101's order: the organisation, as nodes without people; the people; who is placed where,
 * everybody added before anybody is removed, so a person who moves between two units is never on neither; the groups
 * that left the source; and last the people who return.
 */
/** D114: the extension a user's current employments travel in. */
const SCIM_EMPLOYMENT_SCHEMA = 'urn:clew:params:scim:schemas:extension:employment:2.0:User';
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
  // An id names one thing. Two rows with one person's id would be written as one person, the later row's name on the
  // earlier row's placements as well as its own, and Clew cannot tell: both requests are well formed. A person with
  // two employments is the usual way a source comes to list an id twice. So the export is refused whole, before the
  // first write. Two active people with one account name likewise: only one of them could sign in.
  const once = (what: string, ids: readonly string[], why: string) => {
    const seen = new Set<string>(),
      twice = new Set<string>();
    for (const id of ids) (seen.has(id) ? twice : seen).add(id);
    if (twice.size)
      throw new Error(
        `The source lists ${what} ${[...twice].map(id => `'${id}'`).join(', ')} more than once; ${why}. Nothing was written.`,
      );
  };
  once(
    'the unit',
    directory.units.map(u => u.id),
    'a unit id is one unit',
  );
  once(
    'the group',
    directory.groups.map(g => g.id),
    'a group id is one group',
  );
  once(
    'the person',
    directory.people.map(p => p.externalId),
    'a person id is one person, with all their placements on one row',
  );
  once(
    'the account name',
    directory.people.filter(p => p.active).map(p => p.userName.toLowerCase()),
    'an account name is one active person',
  );
  for (const { id } of directory.groups) {
    if (reservedScimGroupKey(id))
      throw new Error(
        `Directory group '${id}' uses a reserved SCIM key. Give the plain group its own key. Nothing was written.`,
      );
  }
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
    const node = group(UNIT_KEY + unit.id, unit.label);
    if (unit.parent !== undefined) node.parent = UNIT_KEY + unit.parent;
  }
  for (const g of directory.groups) group(g.id, g.label);
  for (const p of directory.people) {
    if (typeof p.active !== 'boolean') throw new Error(`Missing active state for '${p.externalId}'.`);
    if (!p.active) continue;
    const home = unitOf(p, p.department, 'department');
    group(UNIT_KEY + home.id, home.label).members.push(p.externalId);
    for (const id of p.alsoIn ?? []) {
      const unit = unitOf(p, id, 'unit');
      group(UNIT_KEY + unit.id, unit.label).members.push(p.externalId);
    }
    for (const id of [...(p.manager ? [home.id] : []), ...(p.alsoManages ?? [])]) {
      const unit = unitOf(p, id, 'unit');
      group(MANAGER_KEY + unit.id, 'Chefer · ' + unit.label).members.push(p.externalId);
    }
    for (const id of p.groups ?? []) {
      const g = directory.groups.find(g => g.id === id);
      if (!g) throw new Error(`${p.userName} has group '${id}', which the directory does not list.`);
      group(g.id, g.label).members.push(p.externalId);
    }
    for (const c of p.capabilities) group(CAPABILITY_KEY + c, 'Clew · ' + c).members.push(p.externalId);
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
/** A unit group's depth in the tree; every other group sorts after the last unit. */
const levelOf = (g: PlannedGroup, depth: ReadonlyMap<string, number>) =>
  g.externalId.startsWith(UNIT_KEY) ? (depth.get(g.externalId.slice(UNIT_KEY.length)) ?? 0) : Number.MAX_SAFE_INTEGER;
function userBody(p: DirectoryPerson) {
  const employments = p.employments ?? [];
  // Every employment travels in the extension with its own title, and Clew shows those. The core `title` is what a
  // source without employments sends; here a person with one employment carries the same title there too.
  const title = employments.length === 1 ? employments[0]!.title : undefined;
  return {
    schemas: employments.length ? [SCIM_USER, SCIM_EMPLOYMENT_SCHEMA] : [SCIM_USER],
    externalId: p.externalId,
    userName: p.userName,
    displayName: fullName(p),
    name: { formatted: fullName(p), givenName: p.givenName, familyName: p.familyName },
    emails: [{ value: p.email, type: 'work', primary: true }],
    phoneNumbers: p.phoneNumbers ?? [],
    ...(employments.length ? { [SCIM_EMPLOYMENT_SCHEMA]: { employments } } : {}),
    ...(title ? { title } : {}),
    active: p.active,
  };
}
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
/** The first complete read, kept across a 503 so a committed write with a lost response is counted correctly. */
interface PushRun {
  initial?: {
    users: ReadonlySet<string>;
    counts: Pick<PushSummary, 'deactivated' | 'groupsCreated' | 'groupsReplaced' | 'groupsRemoved'>;
  };
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
  const run: PushRun = {};
  try {
    return await reconcile(client, directory, scope, options, run);
  } catch (error) {
    if (!(error instanceof ScimClientError) || error.status !== 503 || !error.retryAfter) throw error;
    const header = error.retryAfter.trim();
    const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    if (!Number.isFinite(delay) || delay > 60_000) throw error;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
    // Everything is read again, in case the service committed a write before the proxy answered 503. The summary
    // compares the completed run with its first read.
    return reconcile(client, directory, scope, options, run);
  }
}

async function reconcile(
  client: ScimClient,
  directory: Directory,
  scope: SourceScope,
  options: PushOptions,
  run: PushRun,
): Promise<PushSummary> {
  if (directory.complete !== true) throw new Error('Incomplete source snapshot. Nothing was written.');
  if (!scope.userPrefix || scope.groupPrefixes.some(prefix => !prefix))
    throw new Error('Source ownership requires nonempty prefixes.');
  const ownsGroup = (key: string) =>
    scope.groupKeys.includes(key) || scope.groupPrefixes.some(prefix => key.startsWith(prefix));
  const planned = plan(directory);
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
    withdrawals = own.filter(u => wanted.get(u.externalId!) !== true);
  if (!options.force && excessive(withdrawals.length, own.length))
    throw new Error(
      `The source lists ${planned.users.length} people and Clew holds ${own.length} active ones from it, so this push would deactivate ${withdrawals.length}. Nothing was written. An empty or truncated export looks like this; push again with force once a person has decided that the source is right.`,
    );
  // What Clew holds of this writer's groups, read once as well: which to remove, and each unit as it stands.
  const keep = new Set(planned.groups.map(g => g.externalId)),
    listed = new Map<string, { id: string; displayName: string; parent?: string }>(),
    gone: Array<{ id: string; externalId: string; parent?: string }> = [];
  const counts = new Map<string, { held: number; removed: number }>();
  for await (const g of page(client, '/Groups?excludedAttributes=members')) {
    if (!g.externalId || !ownsGroup(g.externalId)) continue;
    // Units and plain groups are independent exports. Managers and capabilities are derived from people.
    const kind = g.externalId.startsWith(UNIT_KEY)
      ? 'units'
      : g.externalId.startsWith(MANAGER_KEY) || g.externalId.startsWith(CAPABILITY_KEY)
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
  const ids = new Map(held.flatMap(u => (u.externalId ? [[u.externalId, u.id] as const] : [])));
  const disabled = new Set(held.filter(u => u.active === false).map(u => u.id));
  if (!run.initial) {
    const keptGroups = listed.size - gone.length;
    run.initial = {
      users: new Set(ids.keys()),
      counts: {
        deactivated: withdrawals.length,
        groupsCreated: keep.size - keptGroups,
        groupsReplaced: keptGroups,
        groupsRemoved: gone.length,
      },
    };
  }
  const initial = run.initial;
  const summary: PushSummary = { ...initial.counts, created: 0, replaced: 0, refused: [] };
  // 1. Who has left, before anything else is written: the people who are gone from the source, and those it now says
  // are inactive. The export has passed every check above, and a deactivation depends on nothing below. So nothing
  // that goes wrong further down, a unit Clew refuses, a name that is taken, keeps a leaver active.
  for (const user of withdrawals) {
    await patch(client, '/Users/' + user.id, [{ op: 'replace', path: 'active', value: false }]);
    options.log?.(`deactivated ${user.userName}`);
  }
  // 2. The organisation, from the root down (D99): each unit as a node with its name and the unit above it, and
  // nobody on it yet. A unit that moved or was renamed is patched, so the people on it are left as they are.
  for (const unit of planned.groups.filter(g => g.externalId.startsWith(UNIT_KEY))) {
    const found = listed.get(unit.externalId);
    if (!found) {
      await client.request('POST', '/Groups', {
        schemas: unit.parent ? [SCIM_GROUP, SCIM_UNIT] : [SCIM_GROUP],
        externalId: unit.externalId,
        displayName: unit.displayName,
        ...(unit.parent ? { [SCIM_UNIT]: { parent: unit.parent } } : {}),
      });
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
  // 3. The people.
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
    const mine = holder.externalId?.startsWith(scope.userPrefix);
    if (!mine || !givenAway(holder.userName, holder.externalId!)) continue;
    if (lower(nameNow.get(holder.externalId!) ?? '') === lower(holder.userName)) continue;
    await patch(client, '/Users/' + holder.id, [{ op: 'replace', path: 'userName', value: holder.externalId }]);
    options.log?.(`moved the account name ${holder.userName} off ${holder.externalId}`);
  }
  /**
   * One person's request. What Clew says is wrong about one person (a 400) or their name (a 409) is that person's
   * alone: everybody else is sent, and the run reports the refusals when it is done. Anything else stops the run.
   */
  const sendPerson = async (user: (typeof users)[number], id: string | undefined) => {
    try {
      if (id) {
        await client.request('PUT', '/Users/' + id, user.body);
      } else {
        if (!user.body.active) return;
        const { body } = await client.request('POST', '/Users', user.body);
        ids.set(user.externalId, body.id);
        options.log?.(`created ${user.body.userName}`);
      }
      if (initial.users.has(user.externalId)) summary.replaced++;
      else summary.created++;
    } catch (error) {
      if (!(error instanceof ScimClientError) || (error.status !== 400 && error.status !== 409)) throw error;
      summary.refused.push({ externalId: user.externalId, userName: user.body.userName, detail: error.message });
      options.log?.(`refused ${user.body.userName}: ${error.message}`);
    }
  };
  const rehires: Array<{ id: string; user: (typeof users)[number] }> = [];
  for (const user of users) {
    const id = ids.get(user.externalId);
    if (id && disabled.has(id) && user.body.active) rehires.push({ id, user });
    else await sendPerson(user, id);
  }
  // 4. Who is in which group, in two rounds. First everybody a group gains, in every group; then everybody a group
  // loses. A person who moves from one unit to another is in both for a moment and never in neither, so their grant
  // is not taken away and handed back, and they are not signed out in the middle of a push (D101).
  const trims: Array<{ id: string; operations: unknown[] }> = [];
  for (const group of planned.groups) {
    // A refused newcomer has no SCIM id. An inactive returner already has one for the membership update.
    const members = group.members.flatMap(externalId => ids.get(externalId) ?? []),
      found = (await client.request('GET', '/Groups' + eq('externalId', group.externalId))).body.Resources?.[0];
    if (!found) {
      await client.request('POST', '/Groups', {
        schemas: [SCIM_GROUP],
        externalId: group.externalId,
        displayName: group.displayName,
        members: asMembers(members),
      });
      options.log?.(`created group ${group.externalId}`);
      continue;
    }
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
  // 5. The groups that no longer follow from the source.
  // From the leaves up (D99): a unit goes once no unit that is also going still stands below it. The units that stay
  // were written above, so none of them names a unit that goes.
  while (gone.length) {
    const parents = new Set(gone.map(g => g.parent)),
      next = gone.findIndex(g => !parents.has(g.externalId)),
      [group] = gone.splice(next === -1 ? 0 : next, 1);
    await client.request('DELETE', '/Groups/' + group!.id);
    options.log?.(`removed group ${group!.externalId}`);
  }
  // 6. A returning person regains access only after expired duties have been removed, and only with a row Clew takes.
  for (const { id, user } of rehires) await sendPerson(user, id);
  return summary;
}
