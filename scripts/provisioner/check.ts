/**
 * What an installation holds after a push, read through SCIM alone (D68): the check a team writing a provisioner
 * points at Clew to see whether its mapping did what it meant. It only reads. A finding is `ok`, a `warn` (the push
 * was accepted and somebody will not get what the source intended) or a `fail` (the endpoint or the token is wrong).
 */
import {
  UNIT_KEY,
  MANAGER_KEY,
  CAPABILITY_KEY,
  POSITION_KEY,
  PROTECTED_KEY,
  reservedScimGroupKey,
} from '../../packages/contracts/src/scim-group-key';
import { ScimClientError, type Fetch, type ScimClient } from './client';

export interface Finding {
  level: 'ok' | 'warn' | 'fail';
  text: string;
}
interface UserRow {
  id: string;
  userName: string;
  active: boolean;
  title?: string;
  phoneNumbers?: Array<{ value: string }>;
  [EMPLOYMENT_EXTENSION]?: { employments?: Array<{ unitId: string; title?: string }> };
  groups?: Array<{ value: string }>;
}
/** D114: the extension a user's current employments travel in. Written out here so the check needs nothing of Clew's. */
const EMPLOYMENT_EXTENSION = 'urn:clew:params:scim:schemas:extension:employment:2.0:User';
/** D99: the extension a `unit:` group names the unit above it in. */
const UNIT_EXTENSION = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
interface GroupRow {
  id: string;
  externalId?: string;
  displayName: string;
  [UNIT_EXTENSION]?: { parent?: string };
}
const PAGE = 200;
async function all<T>(client: ScimClient, path: string, query: string): Promise<T[]> {
  const rows: T[] = [];
  for (let startIndex = 1; ;) {
    const { body } = await client.request('GET', `${path}?startIndex=${startIndex}&count=${PAGE}&${query}`);
    rows.push(...((body.Resources ?? []) as T[]));
    startIndex += body.itemsPerPage ?? 0;
    if (!body.itemsPerPage || startIndex > body.totalResults) return rows;
  }
}
/** At most five names and how many more: a finding names enough to start looking, not a whole directory. */
const some = (names: string[]) =>
  names.slice(0, 5).join(', ') + (names.length > 5 ? ` (and ${names.length - 5} more)` : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the caller knows the source to hold, for the check to compare with: how many roots its tree has. */
export interface Expected {
  roots?: number;
}
export async function checkProvisioning(
  baseUrl: string,
  client: ScimClient,
  fetchImpl: Fetch = fetch,
  expected: Expected = {},
) {
  const findings: Finding[] = [],
    say = (level: Finding['level'], text: string) => void findings.push({ level, text });
  const anonymous = await fetchImpl(baseUrl.replace(/\/+$/, '') + '/ServiceProviderConfig');
  if (anonymous.status === 401 && (anonymous.headers.get('content-type') ?? '').startsWith('application/scim+json'))
    say('ok', 'Without a token the endpoint answers 401 with the SCIM error resource.');
  else
    say(
      'fail',
      `Without a token the endpoint answered ${anonymous.status} (${anonymous.headers.get('content-type') ?? 'no content type'}); a SCIM server at this address answers 401 as application/scim+json. Check the address: it ends in /scim/v2.`,
    );
  let config: any;
  try {
    config = (await client.request('GET', '/ServiceProviderConfig')).body;
  } catch (error) {
    say(
      'fail',
      error instanceof ScimClientError && error.status === 401
        ? 'The token was refused: it is mistyped, revoked, or rotated out and past its grace period.'
        : `The service provider configuration could not be read: ${(error as Error).message}`,
    );
    return findings;
  }
  say(
    'ok',
    `The token is accepted. PATCH ${config.patch?.supported ? 'yes' : 'no'}, filter ${config.filter?.supported ? `yes (at most ${config.filter.maxResults} rows a page)` : 'no'}, bulk ${config.bulk?.supported ? 'yes' : 'no'}, sort ${config.sort?.supported ? 'yes' : 'no'}, ETags ${config.etag?.supported ? 'yes' : 'no'}.`,
  );
  const users = await all<UserRow>(
      client,
      '/Users',
      `attributes=userName,active,title,groups.value,phoneNumbers.value,${EMPLOYMENT_EXTENSION}:employments`,
    ),
    groups = await all<GroupRow>(client, '/Groups', 'excludedAttributes=members');
  const active = users.filter(u => u.active),
    keyOf = new Map(groups.map(g => [g.id, g.externalId ?? ''])),
    keyed = (prefix: string) => groups.filter(g => g.externalId?.startsWith(prefix)),
    units = keyed(UNIT_KEY),
    managers = keyed(MANAGER_KEY),
    capabilities = keyed(CAPABILITY_KEY),
    positions = keyed(POSITION_KEY),
    plain = groups.length - units.length - managers.length - capabilities.length - positions.length;
  say(
    'ok',
    `${plural(users.length, 'user', 'users')}: ${active.length} active, ${users.length - active.length} deactivated.`,
  );
  say(
    'ok',
    `${plural(groups.length, 'group', 'groups')}: ${units.length} unit, ${managers.length} unit-manager, ${capabilities.length} capability, ${positions.length} position, ${plain} plain (${groups.filter(g => !g.externalId).length} without an externalId).`,
  );
  const membersOf = new Map<string, number>();
  for (const u of users) for (const g of u.groups ?? []) membersOf.set(g.value, (membersOf.get(g.value) ?? 0) + 1);
  const unassigned = active.filter(
    u =>
      !(u.groups ?? []).some(g => {
        const key = keyOf.get(g.value) ?? '';
        return key.startsWith(UNIT_KEY) || key.startsWith(MANAGER_KEY);
      }),
  );
  if (unassigned.length)
    say(
      'warn',
      `${plural(unassigned.length, 'active user has', 'active users have')} no unit: or unit-manager: group and can do nothing in Clew: ${some(unassigned.map(u => u.userName))}.`,
    );
  else if (active.length) say('ok', 'Every active user is in a unit.');
  // A title Clew cannot read is left out and never refused (D110), so a mapping that sends none, or sends something
  // else in its place, shows here and nowhere else. A person's title is the titles of their employments, or the core
  // `title` (D114): what the user list shows.
  const jobsOf = (u: UserRow) => u[EMPLOYMENT_EXTENSION]?.employments ?? [];
  const titled = active.filter(u => u.title || jobsOf(u).some(job => job.title)).length;
  if (active.length)
    say(
      'ok',
      titled
        ? `${titled} of ${plural(active.length, 'active user', 'active users')} ${titled === 1 ? 'has' : 'have'} a title.`
        : 'No active user has a title: the source sends none, or sends one Clew could not read as text.',
    );
  // D114: phone numbers and employments are shown on a person's profile. What Clew cannot read of them is left out
  // without a refusal, so the counts are where a mapping that sends nothing readable shows.
  if (active.length)
    say(
      'ok',
      `Phone numbers on ${active.filter(u => u.phoneNumbers?.length).length} of ${plural(active.length, 'active user', 'active users')}, employments on ${active.filter(u => jobsOf(u).length).length}.`,
    );
  // D108 item 5: a position is membership of a `position:` group and gives no access, so a mapping that sends none
  // shows here and nowhere else.
  if (active.length && positions.length) {
    const held = active.filter(u => (u.groups ?? []).some(g => keyOf.get(g.value)?.startsWith(POSITION_KEY))).length;
    say(
      'ok',
      `Positions on ${held} of ${plural(active.length, 'active user', 'active users')}, from ${plural(positions.length, 'position', 'positions')}.`,
    );
  }
  const named = new Set(units.map(g => g.externalId!.slice(UNIT_KEY.length)));
  // An employment is refused when it is written on a unit Clew does not hold; a unit removed afterwards leaves it.
  const adrift = active.flatMap(u =>
    jobsOf(u)
      .filter(job => !named.has(job.unitId))
      .map(job => `${u.userName} (${job.unitId})`),
  );
  if (adrift.length)
    say(
      'warn',
      `${plural(adrift.length, 'employment names', 'employments name')} a unit that is no longer held. Send current employments for the affected users: ${some(adrift)}.`,
    );
  const unnamed = managers.map(g => g.externalId!.slice(MANAGER_KEY.length)).filter(id => !named.has(id));
  if (unnamed.length)
    say(
      'warn',
      `${plural(unnamed.length, 'unit has', 'units have')} a unit-manager: group and no unit: group, so the unit is shown by its id instead of a name: ${some(unnamed)}.`,
    );
  // The tree (D99): which unit stands above which, as the unit groups say it.
  const above = new Map(
    units.map(g => [g.externalId!.slice(UNIT_KEY.length), g[UNIT_EXTENSION]?.parent?.slice(UNIT_KEY.length)]),
  );
  const hasBelow = new Set([...above.values()].filter((id): id is string => id !== undefined));
  const depthOf = (id: string) => {
    let depth = 0;
    for (let at = above.get(id); at !== undefined && depth < above.size; at = above.get(at)) depth++;
    return depth;
  };
  const roots = [...above].filter(([, parent]) => parent === undefined || !above.has(parent)).map(([id]) => id);
  if (hasBelow.size) {
    const levels = Math.max(...[...above.keys()].map(depthOf)) + 1;
    say(
      'ok',
      `The units form a tree: ${plural(roots.length, 'root', 'roots')}, ${plural(levels, 'level', 'levels')} deep.`,
    );
  } else if (units.length) say('ok', 'No unit names a unit above it: the organisation is flat.');
  // A unit group written without the extension is a root (D99), so a client that replaces a unit's members and
  // leaves its parent out flattens the tree one unit at a time. Only the source knows how many roots there should be.
  if (expected.roots !== undefined && roots.length !== expected.roots)
    say(
      'warn',
      `The tree has ${plural(roots.length, 'root', 'roots')} where ${expected.roots} ${expected.roots === 1 ? 'was' : 'were'} expected. Check the parent links. Roots: ${some(roots.map(id => UNIT_KEY + id)) || 'none'}.`,
    );
  // A unit with units below it may be a heading nobody is placed on; one without is a unit somebody should be in.
  const empty = [...units.filter(g => !hasBelow.has(g.externalId!.slice(UNIT_KEY.length))), ...managers].filter(
    g => !membersOf.get(g.id),
  );
  if (empty.length)
    say(
      'warn',
      `${plural(empty.length, 'unit or unit-manager group has', 'unit or unit-manager groups have')} no members: ${some(empty.map(g => g.externalId!))}.`,
    );
  // Who the people on a unit report to is the manager of that unit or of the nearest unit above with one (D99).
  // Deactivated people lead nobody and are counted nowhere, as Administration › Organisation reads the same tree.
  const activeIn = new Map<string, number>();
  for (const u of active) for (const g of u.groups ?? []) activeIn.set(g.value, (activeIn.get(g.value) ?? 0) + 1);
  const led = new Set(managers.filter(g => activeIn.get(g.id)).map(g => g.externalId!.slice(MANAGER_KEY.length)));
  const leaderless = units.filter(g => {
    if (!activeIn.get(g.id)) return false;
    let at: string | undefined = g.externalId!.slice(UNIT_KEY.length);
    for (let hops = 0; at !== undefined && hops <= above.size; at = above.get(at), hops++)
      if (led.has(at)) return false;
    return true;
  });
  if (leaderless.length)
    say(
      'warn',
      `${plural(leaderless.length, 'unit has', 'units have')} people and no manager, on the unit or on any unit above it, so its people report to nobody: ${some(leaderless.map(g => g.externalId!))}.`,
    );
  // Stored before the server began refusing them (D96): they mean nothing, and the next write of them is refused.
  const miswritten = groups.filter(g => {
    const key = g.externalId ?? '',
      prefix = reservedScimGroupKey(key);
    if (!prefix) return false;
    if (prefix === PROTECTED_KEY) return true;
    const rest = key.slice(prefix.length);
    return !key.startsWith(prefix) || !rest || rest !== rest.trim();
  });
  if (miswritten.length)
    say(
      'warn',
      `${plural(miswritten.length, 'group carries', 'groups carry')} a key that is written wrong and gives nobody anything: ${some(miswritten.map(g => `'${g.externalId}'`))}.`,
    );
  return findings;
}
