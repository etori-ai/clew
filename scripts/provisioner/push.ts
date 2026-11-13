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
 * It needs nothing of Clew's but the group keys in `packages/contracts/src/scim-group-key.ts`.
 *
 * The people rows are checked whole first: complete, inside the writer's prefix, every person id and every active
 * account name once, and not withdrawing a large share of the people. Then who has left is deactivated, before anything
 * about the organisation is read from the export, so nothing the export has wrong about a unit or a group keeps a
 * leaver active. Then the organisation is checked whole (every unit id and group id once, no reserved key on a plain
 * group, every unit and plain group the directory lists inside the writer's keys, not withdrawing a large share of a
 * kind of group), and D101's order follows: the organisation, as nodes without people; the people; who is placed
 * where, everybody added before anybody is removed, so a person who moves between two units is never on neither; the
 * groups that left the source; and last the people who return.
 *
 * One row the source has wrong is that row's alone. A person, a unit or a group Clew refuses; a unit whose parent the
 * export does not list or that stands in a cycle; a unit or a group an active person names that the export does not
 * list, with the managers' group of such a unit; and a group that only people's rows give (a manager's group, a
 * capability) outside the writer's keys: each is recorded and skipped with what depends on it, and the run carries on
 * with everybody else's changes and removals and reports them at the end, each once. Somebody the source places on no
 * unit that was written stays on the units Clew holds them on until one is; a newcomer in that place is not created,
 * and one who returns stays inactive. So a fault in the source never takes a person off their last unit, and nobody is
 * created or made active on no unit without the run saying so. Everything else the source withdraws goes all the same:
 * a manager's role, a capability, a plain group, and the old units of somebody it places on a unit that was written.
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
  /**
   * Why the example does not write this unit or group itself, when the directory has it wrong: its parent is not
   * listed, it stands in a cycle, an active person names it and the directory does not list it, or it is the managers'
   * group of such a unit. `push` also sets it on a group that only people's rows give and that is outside the writer's
   * keys. It is never created, renamed, moved or removed; one Clew holds keeps its members as the source gives them.
   */
  refused?: string;
}
export interface PlannedUser {
  externalId: string;
  body: ReturnType<typeof userBody>;
}
export interface Plan {
  users: PlannedUser[];
  groups: PlannedGroup[];
}
/** At most five names and how many more: enough to start looking, as the check names them. */
const some = (names: readonly string[]) =>
  names.slice(0, 5).join(', ') + (names.length > 5 ? ` (and ${names.length - 5} more)` : '');
/** "an active person names: anna", or "3 active people name: anna, bo, cia": who in the export a refusal is about. */
const activePeople = (names: readonly string[], one: string, many: string) =>
  `${names.length === 1 ? `an active person ${one}` : `${names.length} active people ${many}`}: ${some(names)}`;
const isUnit = (key: string) => key.startsWith(UNIT_KEY);
/** The unit a `unit:` or a `unit-manager:` key is about, as its `unit:` key; any other key is its own. */
const unitOf = (key: string) => (key.startsWith(MANAGER_KEY) ? UNIT_KEY + key.slice(MANAGER_KEY.length) : key);
/** A key that places a person on a unit: as one of its people, or as one of its managers (D99). */
const placesOn = (key: string) => isUnit(key) || key.startsWith(MANAGER_KEY);
/**
 * An account name as Clew compares it: without regard to case, and in the composed form (NFC) Clew stores it in, so two
 * spellings of one name are one name here as well.
 */
const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
/**
 * An id names one thing. Two rows with one person's id would be written as one person, the later row's name on the
 * earlier row's placements as well as its own, and Clew cannot tell: both requests are well formed.
 */
function once(what: string, ids: readonly string[], why: string) {
  const seen = new Set<string>(),
    twice = new Set<string>();
  for (const id of ids) (seen.has(id) ? twice : seen).add(id);
  if (twice.size)
    throw new Error(`The source lists ${what} ${[...twice].map(id => `'${id}'`).join(', ')} more than once; ${why}.`);
}
/**
 * The people rows alone, which is all a deactivation needs (D101): every row with its active state, every person id
 * once, and every account name once among the active people. A fault here is in the export as a whole: it throws.
 */
export function planPeople(directory: Directory): PlannedUser[] {
  for (const p of directory.people)
    if (typeof p.active !== 'boolean') throw new Error(`Missing active state for '${p.externalId}'.`);
  // A person with two employments is the usual way a source comes to list an id twice.
  once(
    'the person',
    directory.people.map(p => p.externalId),
    'a person id is one person, with all their placements on one row',
  );
  // Two active people with one account name: only one of them could sign in.
  once(
    'the account name',
    directory.people.filter(p => p.active).map(p => nameKey(p.userName)),
    'an account name is one active person',
  );
  return directory.people.map(p => ({ externalId: p.externalId, body: userBody(p) }));
}
/**
 * The organisation and who is placed where (D68, D99): every unit as a node of the tree, from the root down, then the
 * groups of the units' managers, the plain groups and the capability groups, each with the active people in it.
 *
 * A fault in the export as a whole throws: a unit id or a group id listed twice, or a plain group, or a person's plain
 * group, with a key Clew reserves. A fault in one row is that row's alone and comes back as a group's `refused`: a
 * unit whose parent the directory does not list, units that are each other's parents, a unit or a group an active
 * person names that the directory does not list, and the managers' group of such a unit.
 */
export function planOrganisation(directory: Directory): PlannedGroup[] {
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
  for (const { id } of directory.groups) {
    if (reservedScimGroupKey(id))
      throw new Error(`Directory group '${id}' uses a reserved SCIM key. Give the plain group its own key.`);
  }
  const groups = new Map<string, PlannedGroup>();
  const group = (externalId: string, displayName: string) => {
    const g = groups.get(externalId) ?? { externalId, displayName, members: [] };
    groups.set(externalId, g);
    return g;
  };
  const units = new Map(directory.units.map(u => [u.id, u])),
    listedGroups = new Map(directory.groups.map(g => [g.id, g]));
  // Every unit is a node of the tree, also one nobody is placed on (D99). A unit's depth is how many units stand above
  // it, and orders the writes so that the unit above is written first. A parent the directory does not list, or a
  // chain that never reaches a root, is the source's mistake in those units: they are refused, and the units below
  // them are ordered as if those were roots.
  const depth = new Map<string, number>(),
    fault = new Map<string, string>();
  for (const start of directory.units) {
    const chain: string[] = [];
    let above = -1;
    for (let at = start.id; ;) {
      if (depth.has(at)) {
        above = depth.get(at)!;
        break;
      }
      const loop = chain.indexOf(at);
      if (loop !== -1) {
        const why = `The units ${[...chain.slice(loop), at].join(' → ')} are each other's parents.`;
        for (const id of chain.splice(loop)) {
          fault.set(id, why);
          depth.set(id, 0);
        }
        above = 0;
        break;
      }
      const parent = units.get(at)!.parent;
      if (parent !== undefined && !units.has(parent)) {
        fault.set(at, `The unit '${at}' has parent '${parent}', which the directory does not list.`);
        depth.set(at, 0);
        above = 0;
        break;
      }
      chain.push(at);
      if (parent === undefined) break;
      at = parent;
    }
    for (const id of chain.reverse()) depth.set(id, ++above);
  }
  for (const unit of directory.units) {
    const node = group(UNIT_KEY + unit.id, unit.label);
    if (unit.parent !== undefined) node.parent = UNIT_KEY + unit.parent;
    if (fault.has(unit.id)) node.refused = fault.get(unit.id);
  }
  for (const g of directory.groups) group(g.id, g.label);
  // A unit or a group an active person names and the directory does not list: one the source has lost from its list,
  // or one it names before it lists it. It is planned with the people who name it, so that one Clew holds keeps them.
  const unlisted = new Map<string, string[]>();
  const named = (key: string, p: DirectoryPerson) => {
    const who = unlisted.get(key) ?? [];
    if (!who.includes(p.userName)) who.push(p.userName);
    unlisted.set(key, who);
    return group(key, key.startsWith(UNIT_KEY) ? key.slice(UNIT_KEY.length) : key);
  };
  const unitGroup = (p: DirectoryPerson, id: string) =>
    units.has(id) ? group(UNIT_KEY + id, units.get(id)!.label) : named(UNIT_KEY + id, p);
  for (const p of directory.people) {
    if (!p.active) continue;
    for (const id of [p.department, ...(p.alsoIn ?? [])]) unitGroup(p, id).members.push(p.externalId);
    for (const id of [...(p.manager ? [p.department] : []), ...(p.alsoManages ?? [])]) {
      const unit = unitGroup(p, id);
      group(MANAGER_KEY + id, 'Chefer · ' + unit.displayName).members.push(p.externalId);
    }
    for (const id of p.groups ?? []) {
      if (reservedScimGroupKey(id))
        throw new Error(
          `${p.userName} has group '${id}', which uses a reserved SCIM key. Give the plain group its own key.`,
        );
      const listed = listedGroups.get(id);
      (listed ? group(id, listed.label) : named(id, p)).members.push(p.externalId);
    }
    for (const c of p.capabilities) group(CAPABILITY_KEY + c, 'Clew · ' + c).members.push(p.externalId);
  }
  for (const [key, who] of unlisted)
    groups.get(key)!.refused =
      `The directory does not list the ${isUnit(key) ? `unit '${key.slice(UNIT_KEY.length)}'` : `group '${key}'`}, which ${activePeople(who, 'names', 'name')}.`;
  // The managers' group of such a unit is not written either. It is reported for itself, since it is where a manager's
  // role would have been.
  const userNameOf = new Map(directory.people.map(p => [p.externalId, p.userName]));
  for (const key of unlisted.keys()) {
    const managers = isUnit(key) ? groups.get(MANAGER_KEY + key.slice(UNIT_KEY.length)) : undefined;
    if (managers)
      managers.refused = `The directory does not list the unit '${key.slice(UNIT_KEY.length)}', which ${activePeople(
        [...new Set(managers.members)].map(id => userNameOf.get(id)!),
        'manages',
        'manage',
      )}.`;
  }
  // The units first and from the root down, since a parent has to exist before the unit below it (D99); then the
  // rest by key.
  return [...groups.values()]
    .map(g => ({ ...g, members: [...new Set(g.members)] }))
    .sort((a, b) => levelOf(a, depth) - levelOf(b, depth) || a.externalId.localeCompare(b.externalId));
}
/** From the directory's facts to SCIM resources: pure. */
export function plan(directory: Directory): Plan {
  return { users: planPeople(directory), groups: planOrganisation(directory) };
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
   * The people Clew refused, and those the example does not place as the source has them, each with the reason: a
   * newcomer on no unit that was written is not created, and one who returns to no unit that took them is left
   * inactive; a newcomer no unit took is created and named here. Everybody else was sent: one row the source has wrong
   * does not keep a leaver active or a newcomer out. A run with anybody here has not succeeded, and its caller says so.
   */
  refused: Array<{ externalId: string; userName: string; detail: string }>;
  /**
   * The units and groups that were not written as the source has them, each once, by its key with the first reason the
   * run met: the directory has it wrong, it is outside the writer's keys, the unit it belongs to or stands below was not
   * written, or Clew refused it. Everything that does not depend on them was written, removals included. A run with
   * anything here has not succeeded either.
   */
  groupsRefused: Array<{ externalId: string; detail: string }>;
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
/** What the first complete reads found, kept across a 503 so that a committed write with a lost response counts once. */
interface PushRun {
  /** The source ids of the people Clew held, and how many of them the run deactivates. */
  people?: { held: Set<string>; deactivated: number };
  /** The keys of this writer's groups Clew held, and of those that no longer follow from the source. */
  groups?: { held: Set<string>; gone: ReadonlySet<string> };
  /** What this run has created, or sent a create for whose answer was lost: a row a later read misses may be its own. */
  postedUsers: Set<string>;
  postedGroups: Set<string>;
}
interface HeldGroup {
  id: string;
  externalId: string;
  displayName: string;
  parent?: string;
}
const heldGroup = (g: any): HeldGroup => ({
  id: g.id,
  externalId: g.externalId,
  displayName: g.displayName,
  parent: g[SCIM_UNIT]?.parent,
});
const eq = (attribute: string, value: string) =>
  `?filter=${encodeURIComponent(`${attribute} eq "${value.replace(/(["\\])/g, '\\$1')}"`)}`;
/**
 * Every row, a page at a time. Clew reads each page on its own, so a row another writer adds or removes meanwhile
 * shifts the rows after it: one that comes round again is passed on once, and one that slips past is found by its key
 * where it is written (a unit, a group, a person), or by the next run.
 */
async function* page(client: ScimClient, path: string) {
  const seen = new Set<string>();
  for (let startIndex = 1; ;) {
    const { body } = await client.request(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}startIndex=${startIndex}&count=100`,
    );
    for (const r of body.Resources ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      yield r;
    }
    startIndex += body.itemsPerPage ?? 0;
    if (!body.itemsPerPage || startIndex > body.totalResults) return;
  }
}
const patch = (client: ScimClient, path: string, Operations: unknown[]) =>
  client.request('PATCH', path, { schemas: [SCIM_PATCH], Operations });
const asMembers = (ids: readonly string[]) => ids.map(value => ({ value }));
/** What Clew says is wrong with one request (a 400) or with a key or a name another row holds (a 409). */
const refusal = (error: unknown): error is ScimClientError =>
  error instanceof ScimClientError && (error.status === 400 || error.status === 409);
/** Reconcile one complete snapshot inside its configured ownership boundary. */
export async function push(
  client: ScimClient,
  directory: Directory,
  scope: SourceScope,
  options: PushOptions = {},
): Promise<PushSummary> {
  const run: PushRun = { postedUsers: new Set(), postedGroups: new Set() };
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
    throw new Error('Source ownership requires nonempty prefixes. Nothing was written.');
  const ownsGroup = (key: string) =>
    scope.groupKeys.includes(key) || scope.groupPrefixes.some(prefix => key.startsWith(prefix));
  // The people rows alone, checked whole before the first write: everything a deactivation needs.
  let people: PlannedUser[];
  try {
    people = planPeople(directory);
  } catch (error) {
    throw new Error(`${(error as Error).message} Nothing was written.`);
  }
  for (const u of people)
    if (!u.externalId.startsWith(scope.userPrefix))
      throw new Error(`User '${u.externalId}' is outside the source namespace. Nothing was written.`);
  // What Clew holds of people, read once and before anything is written: whom to replace, and who has left.
  const held: Array<{ id: string; externalId?: string; userName: string; active?: boolean }> = [];
  for await (const user of page(client, '/Users?attributes=externalId,userName,active')) held.push(user);
  const wanted = new Map(people.map(u => [u.externalId, u.body.active])),
    own = held.filter(u => u.externalId?.startsWith(scope.userPrefix) && u.active !== false),
    withdrawals = own.filter(u => wanted.get(u.externalId!) !== true);
  if (!options.force && excessive(withdrawals.length, own.length))
    throw new Error(
      `The source lists ${people.length} people and Clew holds ${own.length} active ones from it, so this push would deactivate ${withdrawals.length}. Nothing was written. An empty or truncated export looks like this; push again with force once a person has decided that the source is right.`,
    );
  const ids = new Map(held.flatMap(u => (u.externalId ? [[u.externalId, u.id] as const] : [])));
  const disabled = new Set(held.filter(u => u.active === false).map(u => u.id));
  run.people ??= { held: new Set(ids.keys()), deactivated: withdrawals.length };
  const initial = run.people;
  const summary: PushSummary = {
    created: 0,
    replaced: 0,
    deactivated: initial.deactivated,
    groupsCreated: 0,
    groupsReplaced: 0,
    groupsRemoved: 0,
    refused: [],
    groupsRefused: [],
  };
  // 1. Who has left, before anything else is written: the people who are gone from the source, and those it now says
  // are inactive. A deactivation depends on the people rows alone, which have passed every check above, so nothing the
  // export has wrong about the organisation, and nothing Clew refuses further down, keeps a leaver active.
  for (const user of withdrawals) {
    await patch(client, '/Users/' + user.id, [{ op: 'replace', path: 'active', value: false }]);
    options.log?.(`deactivated ${user.userName}`);
  }
  // A fault in the export as a whole stops the rest of the run, and says that the leavers have gone already.
  const stop = (detail: string) =>
    new Error(
      `${detail} ${
        summary.deactivated === 0
          ? 'Nothing was written.'
          : `${summary.deactivated === 1 ? 'The person who has left was' : `The ${summary.deactivated} people who have left were`} deactivated; nothing else was written.`
      }`,
    );
  let groups: PlannedGroup[];
  try {
    groups = planOrganisation(directory);
  } catch (error) {
    throw stop((error as Error).message);
  }
  // A unit or a plain group the directory lists outside the writer's keys is the writer's configuration set against
  // the source's own list, and stops the rest. A group that only people's rows give, a manager's group or a capability,
  // is that group's alone: it is not written, and the people the source puts in it are named.
  const lists = new Set([...directory.units.map(u => UNIT_KEY + u.id), ...directory.groups.map(g => g.id)]);
  for (const g of groups)
    if (lists.has(g.externalId) && !ownsGroup(g.externalId))
      throw stop(`Group '${g.externalId}' is outside the source namespace.`);
  const userNameOf = new Map(directory.people.map(p => [p.externalId, p.userName]));
  for (const g of groups)
    if (!g.refused && !ownsGroup(g.externalId))
      g.refused = `Group '${g.externalId}' is outside the source namespace, and ${activePeople(
        g.members.map(id => userNameOf.get(id)!),
        'is in it',
        'are in it',
      )}.`;
  // What Clew holds of this writer's groups, read once as well: which to remove, and each unit as it stands.
  const planned = new Map(groups.map(g => [g.externalId, g])),
    listed = new Map<string, HeldGroup>(),
    gone: HeldGroup[] = [];
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
      row = heldGroup(g);
    count.held++;
    listed.set(row.externalId, row);
    if (!planned.has(row.externalId)) {
      count.removed++;
      gone.push(row);
    }
    counts.set(kind, count);
  }
  for (const [kind, count] of counts)
    if (!options.force && excessive(count.removed, count.held))
      throw stop(
        `The source would remove ${count.removed} of ${count.held} owned ${kind}. Confirm the complete export before using force.`,
      );
  run.groups ??= { held: new Set(listed.keys()), gone: new Set(gone.map(g => g.externalId)) };
  const first = run.groups;
  /** Planned groups that are not in Clew once their round is done. */
  const unwritten = new Set<string>();
  /** Groups that no longer follow from the source and stay, without the people the source has withdrawn from them. */
  const kept = new Set<string>();
  /** Each unit or group is reported once, with the first reason the run met; the log has every one. */
  const refusedKeys = new Set<string>();
  const refuseGroup = (externalId: string, detail: string) => {
    options.log?.(`refused group ${externalId}: ${detail}`);
    if (refusedKeys.has(externalId)) return;
    refusedKeys.add(externalId);
    summary.groupsRefused.push({ externalId, detail });
  };
  for (const g of groups) if (g.refused) refuseGroup(g.externalId, g.refused);
  const findGroup = async (key: string, members = false) =>
    (await client.request('GET', `/Groups${eq('externalId', key)}${members ? '' : '&excludedAttributes=members'}`)).body
      .Resources?.[0];
  /** A group the read above did not show, and Clew holds after all: it counts as kept, not created. */
  const heldAfterAll = (key: string) => {
    if (!run.postedGroups.has(key)) first.held.add(key);
  };
  /**
   * A group's create. Another writer may have created it since it was looked up, or the read missed it: a 409 is then
   * answered by finding it by its key, as one Clew holds. Anything else Clew refuses is recorded.
   */
  const create = async (key: string, body: Record<string, unknown>) => {
    const postedBefore = run.postedGroups.has(key);
    run.postedGroups.add(key);
    try {
      await client.request('POST', '/Groups', { schemas: [SCIM_GROUP], externalId: key, ...body });
      options.log?.(`created group ${key}`);
      return 'created' as const;
    } catch (error) {
      if (!refusal(error)) throw error;
      if (!postedBefore) run.postedGroups.delete(key);
      const found = error.status === 409 ? await findGroup(key, true) : undefined;
      if (found) {
        heldAfterAll(key);
        return found;
      }
      refuseGroup(key, error.message);
      return undefined;
    }
  };
  // 2. The organisation, from the root down (D99): each unit as a node with its name and the unit above it, and
  // nobody on it yet. A unit that moved or was renamed is patched, so the people on it are left as they are. A unit
  // the read did not show is looked up by its key before it is created.
  /** Units Clew does not hold once this step is done: nobody is placed on them and no unit is written below them. */
  const absent = new Set<string>();
  for (const unit of groups.filter(g => g.externalId.startsWith(UNIT_KEY))) {
    const key = unit.externalId;
    let found = listed.get(key);
    if (!found && ownsGroup(key)) {
      const held = await findGroup(key);
      if (held) {
        found = heldGroup(held);
        listed.set(key, found);
        heldAfterAll(key);
      }
    }
    // A unit the directory has wrong is left as Clew holds it, if it does.
    if (unit.refused) {
      if (!found || !ownsGroup(key)) absent.add(key);
      continue;
    }
    if (unit.parent && absent.has(unit.parent)) {
      refuseGroup(key, `The unit above it, '${unit.parent}', was not written.`);
      if (!found) absent.add(key);
      continue;
    }
    if (!found) {
      const created = await create(key, {
        ...(unit.parent ? { schemas: [SCIM_GROUP, SCIM_UNIT], [SCIM_UNIT]: { parent: unit.parent } } : {}),
        displayName: unit.displayName,
      });
      if (created === 'created') continue;
      if (!created) {
        absent.add(key);
        continue;
      }
      found = heldGroup(created);
      listed.set(key, found);
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
    if (!operations.length) continue;
    try {
      await patch(client, '/Groups/' + found.id, operations);
      listed.set(key, { ...found, displayName: unit.displayName, parent: unit.parent });
    } catch (error) {
      // Refused, it stays as it stands, and the people on it are placed all the same.
      if (!refusal(error)) throw error;
      refuseGroup(key, error.message);
    }
  }
  /** What this run leaves named as it stands: every unit and group refused by now, each unit step 2 did not write too. */
  const unnamed = new Set(refusedKeys);
  // 3. The people.
  // An account name that is given to somebody new is first moved off the row that holds it. A person who leaves is
  // deactivated, not erased, and keeps their `userName`, which is unique in the installation, so without this the
  // newcomer is refused with a 409. The old row takes its own `externalId` as its name: it is unique, it is never
  // reused, and nobody signs in with it. This also untangles two people who swap names.
  const taker = new Map(people.filter(u => u.body.active).map(u => [nameKey(u.body.userName), u.externalId])),
    givenAway = (userName: string, externalId: string) => (taker.get(nameKey(userName)) ?? externalId) !== externalId,
    holderOf = new Map(held.map(u => [nameKey(u.userName), u])),
    rowOf = new Map(held.flatMap(u => (u.externalId ? [[u.externalId, u] as const] : [])));
  // A leaver Clew holds is sent with a name nobody else has once the run is done: the source's, if it is free; else the
  // one Clew holds the row under; else the row's own `externalId`. A name is taken when an active person is given it,
  // when a leaver sent before this one has it, or when another row Clew holds has it. So the source may keep a leaver's
  // row or drop it, rename leavers, give two of them one name, or give the name two leavers held in turn to somebody
  // new: none of it is wrong, and nothing is refused.
  const claimed = new Map(taker);
  const taken = (userName: string, externalId: string) => {
    const key = nameKey(userName),
      by = claimed.get(key);
    if (by !== undefined) return by !== externalId;
    const holder = holderOf.get(key);
    return holder !== undefined && holder !== rowOf.get(externalId);
  };
  const users = people.map(u => {
    const row = rowOf.get(u.externalId);
    if (u.body.active || !row) return u;
    const userName = !taken(u.body.userName, u.externalId)
      ? u.body.userName
      : !taken(row.userName, u.externalId)
        ? row.userName
        : u.externalId;
    claimed.set(nameKey(userName), u.externalId);
    return userName === u.body.userName ? u : { ...u, body: { ...u.body, userName } };
  });
  const nameNow = new Map(users.map(u => [u.externalId, u.body.userName]));
  for (const holder of held) {
    const mine = holder.externalId?.startsWith(scope.userPrefix);
    if (!mine || !givenAway(holder.userName, holder.externalId!)) continue;
    if (nameKey(nameNow.get(holder.externalId!) ?? '') === nameKey(holder.userName)) continue;
    try {
      await patch(client, '/Users/' + holder.id, [{ op: 'replace', path: 'userName', value: holder.externalId }]);
      options.log?.(`moved the account name ${holder.userName} off ${holder.externalId}`);
    } catch (error) {
      if (!refusal(error)) throw error;
      summary.refused.push({ externalId: holder.externalId!, userName: holder.userName, detail: error.message });
      options.log?.(`refused ${holder.userName}: ${error.message}`);
    }
  }
  const findUser = async (externalId: string) =>
    (await client.request('GET', `/Users${eq('externalId', externalId)}&attributes=externalId,userName,active`)).body
      .Resources?.[0];
  // Where the source places each person: the units they are on and those they manage (D99).
  const placements = new Map<string, string[]>();
  for (const g of groups)
    if (placesOn(g.externalId))
      for (const externalId of g.members)
        placements.set(externalId, [...(placements.get(externalId) ?? []), unitOf(g.externalId)]);
  /** Whether no unit the source places this person on was written above, so that nothing can place them this run. */
  const nowhere = (externalId: string) => placements.get(externalId)?.every(key => absent.has(key)) === true;
  /** Somebody the run does not place as the source has them, reported with the people Clew refused. */
  const notPlaced = (user: PlannedUser, detail: string) => {
    summary.refused.push({ externalId: user.externalId, userName: user.body.userName, detail });
    options.log?.(`refused ${user.body.userName}: ${detail}`);
  };
  const rehires: Array<{ id: string; user: PlannedUser }> = [];
  /**
   * A person the read did not show, whom Clew holds after all, found by the source's id: sent to as to a row that was
   * read, and one who returns waits for the returners' step as they would have. Whether the request was sent now.
   */
  const sendFound = async (user: PlannedUser, found: { id: string; active?: boolean }) => {
    ids.set(user.externalId, found.id);
    if (!run.postedUsers.has(user.externalId)) initial.held.add(user.externalId);
    if (found.active === false) {
      rehires.push({ id: found.id, user });
      return false;
    }
    await client.request('PUT', '/Users/' + found.id, user.body);
    return true;
  };
  /**
   * One person's request. What Clew says is wrong about one person (a 400) or their name (a 409) is that person's
   * alone: everybody else is sent, and the run reports the refusals when it is done. Anything else stops the run.
   */
  const sendPerson = async (user: PlannedUser, id: string | undefined) => {
    try {
      if (id) {
        await client.request('PUT', '/Users/' + id, user.body);
      } else if (!user.body.active) {
        return;
      } else if (nowhere(user.externalId)) {
        // Somebody new is created once a unit the source places them on is written: active on no unit, they could do
        // nothing. The read may have missed them, so they are looked for first.
        const found = await findUser(user.externalId);
        if (!found) {
          notPlaced(
            user,
            'Not created: no unit the source places this person on was written, so they are not placed yet.',
          );
          return;
        }
        if (!(await sendFound(user, found))) return;
      } else {
        const postedBefore = run.postedUsers.has(user.externalId);
        run.postedUsers.add(user.externalId);
        try {
          const { body } = await client.request('POST', '/Users', user.body);
          ids.set(user.externalId, body.id);
          options.log?.(`created ${user.body.userName}`);
        } catch (error) {
          if (!(error instanceof ScimClientError && error.status === 409)) throw error;
          if (!postedBefore) run.postedUsers.delete(user.externalId);
          // The read above may have missed a row Clew holds while another writer added or removed one: found by the
          // source's id, the person is sent to it as to a row that was read.
          const found = await findUser(user.externalId);
          if (!found) throw error;
          if (!(await sendFound(user, found))) return;
        }
      }
      if (initial.held.has(user.externalId)) summary.replaced++;
      else summary.created++;
    } catch (error) {
      if (!refusal(error)) throw error;
      summary.refused.push({ externalId: user.externalId, userName: user.body.userName, detail: error.message });
      options.log?.(`refused ${user.body.userName}: ${error.message}`);
    }
  };
  for (const user of users) {
    const id = ids.get(user.externalId);
    if (id && disabled.has(id) && user.body.active) rehires.push({ id, user });
    else await sendPerson(user, id);
  }
  // 4. Who is in which group, in two rounds. First everybody a group gains, in every group; then everybody a group
  // loses. A person who moves from one unit to another is in both for a moment and never in neither, so their grant
  // is not taken away and handed back, and they are not signed out in the middle of a push (D101).
  /** Who the source places on a unit, as one of its people or a manager, and who is on one of those once added. */
  const placing = new Set<string>(),
    placed = new Set<string>();
  const trims: Array<{ key: string; id: string; lost: string[]; rename?: string }> = [];
  for (const group of groups) {
    const key = group.externalId,
      places = placesOn(key);
    // A refused newcomer has no SCIM id. An inactive returner already has one for the membership update.
    const members = group.members.flatMap(externalId => ids.get(externalId) ?? []);
    const place = (people: readonly string[]) => {
      if (places) for (const id of people) placed.add(id);
    };
    if (places) for (const id of members) placing.add(id);
    // Nothing is written on a unit Clew does not hold, nor its managers; nor on a group outside this writer's keys.
    if (absent.has(unitOf(key)) || (group.refused && !ownsGroup(key))) {
      // The unit has been reported, and its managers' group is not written either.
      if (!refusedKeys.has(key)) refuseGroup(key, `The unit '${unitOf(key)}' was not written.`);
      unwritten.add(key);
      continue;
    }
    let found = await findGroup(key, true);
    if (found && !listed.has(key)) heldAfterAll(key);
    if (!found) {
      // One the directory has wrong is not created.
      if (group.refused) {
        unwritten.add(key);
        continue;
      }
      const created = await create(key, {
        ...(group.parent ? { schemas: [SCIM_GROUP, SCIM_UNIT], [SCIM_UNIT]: { parent: group.parent } } : {}),
        displayName: group.displayName,
        members: asMembers(members),
      });
      if (created === 'created') {
        place(members);
        continue;
      }
      if (!created) {
        unwritten.add(key);
        continue;
      }
      found = created;
    }
    const has = new Set<string>((found.members ?? []).map((m: { value: string }) => m.value)),
      wants = new Set(members),
      gained = members.filter(id => !has.has(id)),
      lost = [...has].filter(id => !wants.has(id));
    place(members.filter(id => has.has(id)));
    if (gained.length)
      try {
        await patch(client, '/Groups/' + found.id, [{ op: 'add', path: 'members', value: asMembers(gained) }]);
        place(gained);
      } catch (error) {
        if (!refusal(error)) throw error;
        refuseGroup(key, error.message);
      }
    // A group refused before this step keeps the name it has, and so does the managers' group of a unit refused before
    // it: a unit is named in step 2, and one step 2 named is read here with its new name.
    const leaveName = unnamed.has(key) || unnamed.has(unitOf(key));
    trims.push({
      key,
      id: found.id,
      lost,
      ...(!leaveName && found.displayName !== group.displayName ? { rename: group.displayName } : {}),
    });
  }
  /**
   * Who the source places on units none of which has them once the first round is done, because those were not
   * written or did not take them. They stay on the units Clew holds them on until one does, so that a fault in the
   * source never takes a person off their last unit (D101: never on neither). Only the units: a manager's role, a
   * capability or a plain group the source withdraws from them goes as it does from everybody else, and somebody on
   * one unit the source gives them loses the units it withdrew.
   */
  const unplaced = new Set([...placing].filter(id => !placed.has(id)));
  // Somebody new whom no unit took is created on none, and said so; a later run places them once one does.
  for (const user of users)
    if (run.postedUsers.has(user.externalId) && unplaced.has(ids.get(user.externalId) ?? ''))
      notPlaced(user, 'Created, but not placed: no unit the source places this person on took them.');
  for (const trim of trims) {
    const lost = isUnit(trim.key) ? trim.lost.filter(id => !unplaced.has(id)) : trim.lost;
    for (const operations of [
      lost.length ? [{ op: 'remove', path: 'members', value: asMembers(lost) }] : [],
      trim.rename === undefined ? [] : [{ op: 'replace', path: 'displayName', value: trim.rename }],
    ]) {
      if (!operations.length) continue;
      try {
        await patch(client, '/Groups/' + trim.id, operations);
      } catch (error) {
        if (!refusal(error)) throw error;
        refuseGroup(trim.key, error.message);
      }
    }
  }
  // 5. The groups that no longer follow from the source.
  // From the leaves up (D99): a unit goes once no unit that is also going still stands below it. The units that stay
  // were written above, so none of them names a unit that goes. A group that has to stay (somebody on it is on no unit
  // the source gives them yet, a unit below it stays, or Clew refuses to remove it) loses everybody else the source has
  // withdrawn from it.
  const above = new Set<string>();
  /** The units above one that stays, as far up as the source has withdrawn them: they stay while it stands below. */
  const holdsUp = (parent: string | undefined) => {
    for (let at = parent; at !== undefined && !planned.has(at) && !above.has(at); at = listed.get(at)?.parent)
      above.add(at);
  };
  // A unit of the source that stands where Clew holds it, because the directory has it wrong or Clew did not move it,
  // keeps the units above it that the source has withdrawn: they go once it has moved.
  for (const unit of groups) if (unit.externalId.startsWith(UNIT_KEY)) holdsUp(listed.get(unit.externalId)?.parent);
  const membersOf = async (id: string): Promise<string[] | undefined> => {
    try {
      const { body } = await client.request('GET', `/Groups/${id}?attributes=members`);
      return (body.members ?? []).map((m: { value: string }) => m.value);
    } catch (error) {
      if (error instanceof ScimClientError && error.status === 404) return undefined;
      throw error;
    }
  };
  const keep = async (group: HeldGroup, why: string, members?: string[]) => {
    const now = members ?? (await membersOf(group.id));
    if (now === undefined) return;
    kept.add(group.externalId);
    options.log?.(`kept group ${group.externalId}: ${why}`);
    const others = now.filter(id => !isUnit(group.externalId) || !unplaced.has(id));
    if (others.length)
      try {
        await patch(client, '/Groups/' + group.id, [{ op: 'remove', path: 'members', value: asMembers(others) }]);
      } catch (error) {
        if (!refusal(error)) throw error;
        refuseGroup(group.externalId, error.message);
      }
    holdsUp(group.parent);
  };
  while (gone.length) {
    const parents = new Set(gone.map(g => g.parent)),
      next = gone.findIndex(g => !parents.has(g.externalId)),
      [group] = gone.splice(next === -1 ? 0 : next, 1);
    if (above.has(group!.externalId)) {
      await keep(group!, 'a unit below it stays');
      continue;
    }
    if (unplaced.size && isUnit(group!.externalId)) {
      const members = await membersOf(group!.id);
      if (members?.some(id => unplaced.has(id))) {
        await keep(group!, 'somebody on it is on no unit the source gives them yet', members);
        continue;
      }
    }
    try {
      await client.request('DELETE', '/Groups/' + group!.id);
      options.log?.(`removed group ${group!.externalId}`);
    } catch (error) {
      // Another writer removed it after it was read: what this run meant to do is done.
      if (error instanceof ScimClientError && error.status === 404) {
        options.log?.(`group ${group!.externalId} was removed already`);
        continue;
      }
      if (!refusal(error)) throw error;
      refuseGroup(group!.externalId, error.message);
      await keep(group!, 'Clew did not remove it');
    }
  }
  // 6. A returning person regains access only after expired duties have been removed, and only with a row Clew takes.
  // One that no unit the source places them on has taken stays inactive until one does: active, they would be on no
  // unit.
  for (const { id, user } of rehires) {
    if (unplaced.has(id)) {
      notPlaced(user, 'Left inactive: no unit the source places this person on took them, so they are not placed yet.');
      continue;
    }
    await sendPerson(user, id);
  }
  // The groups as the first complete read found them, less what this attempt could not create or had to keep.
  summary.groupsCreated = groups.filter(g => !first.held.has(g.externalId) && !unwritten.has(g.externalId)).length;
  summary.groupsReplaced = groups.filter(g => first.held.has(g.externalId)).length + kept.size;
  summary.groupsRemoved = [...first.gone].filter(key => !kept.has(key)).length;
  return summary;
}
