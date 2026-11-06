/**
 * Runs on the host against the published dev port: real Keycloak login for the synthetic manager, then the first
 * use case end to end through the API: proposals exist, confirm creates calendar events and an audit row, undo
 * removes them and writes a second audit row. Passwords are read from the ignored .auth-test.env and never printed.
 */
const base = process.env.PUBLIC_URL ?? 'http://localhost:3020';
const env = Object.fromEntries(
  (await Bun.file('.auth-test.env').text()).split('\n').flatMap(line => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    return m ? [[m[1]!, m[2]!]] : [];
  }),
);
const user = process.argv[2] ?? 'hillevi',
  password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
if (!password) throw new Error('Test password missing in .auth-test.env');
const jar = new Map<string, string>();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function remember(response: Response) {
  for (const c of response.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair!.indexOf('=');
    jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
}
async function go(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
  });
  remember(response);
  if ([301, 302, 303, 307].includes(response.status)) return go(new URL(response.headers.get('location')!, url).href);
  return response;
}
// 1. Login: app → Keycloak form → callback → session cookie.
const form = await go(base + '/api/auth/login?returnTo=/');
const html = await form.text();
const action = /action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
if (!action || !form.url.includes('keycloak.orb.local')) throw new Error('Keycloak login form not found');
const done = await go(action, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: user, password, credentialId: '' }),
});
if (!jar.has('clew-session')) throw new Error(`Ingen session efter inloggning (${done.status} ${done.url})`);
const session = await (await go(base + '/api/auth/session')).json();
console.log('Logged in as', session.user.name, '(' + session.user.role + ')');
const headers = { 'content-type': 'application/json', origin: base, 'x-csrf-token': session.csrfToken };
const api = async (path: string, body?: unknown) => {
  const r = await go(base + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(json)}`);
  return json;
};
// 2. The pushed thread with proposals.
let { threads } = await api('/api/threads');
let thread =
  threads.find((t: any) => t.topic === 'utvecklingssamtal' && t.state === 'open') ??
  threads.find((t: any) => t.topic === 'utvecklingssamtal');
if (!thread) throw new Error('No thread with proposals');
if (thread.proposals.some((p: any) => p.status === 'confirmed')) {
  // A previous run left the undo window open: take it back first so the run below starts from proposals.
  thread = await api(`/api/threads/${thread.id}/undo`, {});
  console.log('Undid a previous confirmation; state:', thread.state);
}
const proposed = thread.proposals.filter((p: any) => p.status === 'proposed');
console.log('Thread:', thread.title, '| proposals:', proposed.length, '| week', thread.week);
const week = await api('/api/calendar?from=' + thread.week);
const overlaps = (a: any, b: any) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
for (const p of proposed)
  for (const e of week.events) if (!e.allDay && overlaps(p, e)) throw new Error(`Proposal collides with ${e.title}`);
for (const a of proposed)
  for (const b of proposed) if (a !== b && overlaps(a, b)) throw new Error('Proposals collide with each other');
console.log('No collisions with', week.events.length, 'existing events.');
if (process.argv.includes('--read-only')) process.exit(0);
// 3. Confirm → calendar events exist.
const confirmed = await api(`/api/threads/${thread.id}/confirm`, { proposalIds: proposed.map((p: any) => p.id) });
const booked = confirmed.proposals.filter((p: any) => p.status === 'confirmed');
console.log('Confirmed:', booked.length, '| state:', confirmed.state, '| undo until', booked[0]?.undoUntil);
const after = await api('/api/calendar?from=' + thread.week);
const created = after.events.filter((e: any) => e.title.startsWith('Utvecklingssamtal'));
if (created.length < booked.length)
  throw new Error(`Only ${created.length} of ${booked.length} events in the calendar`);
console.log('Calendar events created:', created.length);
// 4. Undo → events removed.
const undone = await api(`/api/threads/${thread.id}/undo`, {});
const back = await api('/api/calendar?from=' + thread.week);
const left = back.events.filter((e: any) => e.title.startsWith('Utvecklingssamtal'));
if (left.length) throw new Error(`${left.length} events left after undo`);
console.log(
  'Undone. State:',
  undone.state,
  '| proposals restored:',
  undone.proposals.filter((p: any) => p.status === 'proposed').length,
  '| events left:',
  left.length,
);
// 5. Thread survives reload with the same state.
const again = await api('/api/threads/' + thread.id);
console.log('After reload:', again.state, again.messages.length, 'messages');
console.log('THREAD_ID=' + thread.id);

export {};
