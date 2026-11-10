/**
 * What an installation holds after a push, read through SCIM alone (D68): the check a team writing a provisioner
 * points at Clew to see whether its mapping did what it meant. It only reads. A finding is `ok`, a `warn` (the push
 * was accepted and somebody will not get what the source intended) or a `fail` (the endpoint or the token is wrong).
 */
import { ScimClientError, type Fetch, type ScimClient } from './client';

export interface Finding {
  level: 'ok' | 'warn' | 'fail';
  text: string;
}
interface UserRow {
  id: string;
  userName: string;
  active: boolean;
  groups?: Array<{ value: string }>;
}
/** D99: the extension a `unit:` group names the unit above it in. */
const UNIT_EXTENSION = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
interface GroupRow {
  id: string;
  externalId?: string;
  displayName: string;
  [UNIT_EXTENSION]?: { parent?: string };
}
const UNIT = 'unit:',
  MANAGER = 'unit-manager:',
  CAPABILITY = 'capability:',
  RESERVED = [MANAGER, UNIT, CAPABILITY];
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

export async function checkProvisioning(baseUrl: string, client: ScimClient, fetchImpl: Fetch = fetch) {
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
  const users = await all<UserRow>(client, '/Users', 'attributes=userName,active,groups.value'),
    groups = await all<GroupRow>(client, '/Groups', 'excludedAttributes=members');
  const active = users.filter(u => u.active),
    keyOf = new Map(groups.map(g => [g.id, g.externalId ?? ''])),
    keyed = (prefix: string) => groups.filter(g => g.externalId?.startsWith(prefix)),
    units = keyed(UNIT),
    managers = keyed(MANAGER),
    capabilities = keyed(CAPABILITY),
    plain = groups.length - units.length - managers.length - capabilities.length;
  say(
    'ok',
    `${plural(users.length, 'user', 'users')}: ${active.length} active, ${users.length - active.length} deactivated.`,
  );
  say(
    'ok',
    `${plural(groups.length, 'group', 'groups')}: ${units.length} unit, ${managers.length} unit-manager, ${capabilities.length} capability, ${plain} plain (${groups.filter(g => !g.externalId).length} without an externalId).`,
  );
  const membersOf = new Map<string, number>();
  for (const u of users) for (const g of u.groups ?? []) membersOf.set(g.value, (membersOf.get(g.value) ?? 0) + 1);
  const unassigned = active.filter(
    u =>
      !(u.groups ?? []).some(g => {
        const key = keyOf.get(g.value) ?? '';
        return key.startsWith(UNIT) || key.startsWith(MANAGER);
      }),
  );
  if (unassigned.length)
    say(
      'warn',
      `${plural(unassigned.length, 'active user has', 'active users have')} no unit: or unit-manager: group and can do nothing in Clew: ${some(unassigned.map(u => u.userName))}.`,
    );
  else if (active.length) say('ok', 'Every active user is in a unit.');
  const named = new Set(units.map(g => g.externalId!.slice(UNIT.length)));
  const unnamed = managers.map(g => g.externalId!.slice(MANAGER.length)).filter(id => !named.has(id));
  if (unnamed.length)
    say(
      'warn',
      `${plural(unnamed.length, 'unit has', 'units have')} a unit-manager: group and no unit: group, so the unit is shown by its id instead of a name: ${some(unnamed)}.`,
    );
  // The tree (D99): which unit stands above which, as the unit groups say it.
  const above = new Map(
    units.map(g => [g.externalId!.slice(UNIT.length), g[UNIT_EXTENSION]?.parent?.slice(UNIT.length)]),
  );
  const hasBelow = new Set([...above.values()].filter((id): id is string => id !== undefined));
  const depthOf = (id: string) => {
    let depth = 0;
    for (let at = above.get(id); at !== undefined && depth < above.size; at = above.get(at)) depth++;
    return depth;
  };
  if (hasBelow.size) {
    const roots = [...above].filter(([, parent]) => parent === undefined || !above.has(parent)).length,
      levels = Math.max(...[...above.keys()].map(depthOf)) + 1;
    say('ok', `The units form a tree: ${plural(roots, 'root', 'roots')}, ${plural(levels, 'level', 'levels')} deep.`);
  } else if (units.length) say('ok', 'No unit names a unit above it: the organisation is flat.');
  // A unit with units below it may be a heading nobody is placed on; one without is a unit somebody should be in.
  const empty = [...units.filter(g => !hasBelow.has(g.externalId!.slice(UNIT.length))), ...managers].filter(
    g => !membersOf.get(g.id),
  );
  if (empty.length)
    say(
      'warn',
      `${plural(empty.length, 'unit or unit-manager group has', 'unit or unit-manager groups have')} no members: ${some(empty.map(g => g.externalId!))}.`,
    );
  // Who the people on a unit report to is the manager of that unit or of the nearest unit above with one (D99).
  const led = new Set(managers.filter(g => membersOf.get(g.id)).map(g => g.externalId!.slice(MANAGER.length)));
  const leaderless = units.filter(g => {
    if (!membersOf.get(g.id)) return false;
    let at: string | undefined = g.externalId!.slice(UNIT.length);
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
      prefix = RESERVED.find(p => key.toLowerCase().startsWith(p));
    if (!prefix) return key.toLowerCase() === 'protected';
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
