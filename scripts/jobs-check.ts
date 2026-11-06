/**
 * Runs on the host against the published dev port: real Keycloak login as the manager, then a job across systems (D55)
 * end to end through the API on the fixture connectors. The bindings must exist first (`bun run dev:connectors`,
 * inside the container). Assembles the job for a sick report, approves it once, waits for the HR system and time
 * reporting to be written and read back, then waits for payroll's watch to expire and the card to reach the stream.
 * Passwords come from .auth-test.env (or the file AUTH_TEST_ENV names). Takes the binding's window plus a minute.
 */
export {};
const base = process.env.PUBLIC_URL ?? 'http://localhost:3020';
const envFile = process.env.AUTH_TEST_ENV ?? '.auth-test.env';
const env = Object.fromEntries(
  (await Bun.file(envFile).text()).split('\n').flatMap(line => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    return m ? [[m[1]!, m[2]!]] : [];
  }),
);
async function login(user: string) {
  const password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
  if (!password) throw new Error('Test password missing in ' + envFile + ' for ' + user);
  const jar = new Map<string, string>();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (r: Response) => {
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      jar.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
  };
  async function go(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
    });
    remember(r);
    if ([301, 302, 303, 307].includes(r.status)) return go(new URL(r.headers.get('location')!, url).href);
    return r;
  }
  const form = await go(base + '/api/auth/login?returnTo=/');
  const html = await form.text();
  const action = /action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (!action) throw new Error('Keycloak login form not found');
  await go(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: user, password, credentialId: '' }),
  });
  if (!jar.has('clew-session')) throw new Error('No session after login');
  const session = await (await go(base + '/api/auth/session')).json();
  const headers = { 'content-type': 'application/json', origin: base, 'x-csrf-token': session.csrfToken };
  const api = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const r = await go(base + path, body !== undefined ? { method, headers, body: JSON.stringify(body) } : { headers });
    const json = await r.json();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  console.log(`\n== ${session.user.name} (${session.user.role})`);
  return api;
}
const ok = (cond: unknown, msg: string) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok', msg);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(what: string, read: () => Promise<T | undefined>, deadline: number) {
  for (;;) {
    const v = await read();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('FAIL: timed out waiting for ' + what);
    await sleep(2000);
  }
}

const api = await login('hillevi');
const today = new Date().toISOString().slice(0, 10),
  person = 'hr:emp:1004';
const { connectors } = await api('/api/connectors');
ok(
  ['hr', 'timesheet', 'payroll'].every(id => connectors.some((c: any) => c.id === id)),
  'the HR, time-reporting and payroll connectors are registered',
);
const fact = { kind: 'hr:absence', attributes: { person, from: today, extent: 100 } };
const proposal = await api('/api/jobs/assemble', { fact });
console.log(
  '  sources:',
  proposal.sources.map((s: any) => `${s.source}:${s.status}${s.reason ? ' (' + s.reason + ')' : ''}`).join(' '),
);
console.log(
  '  steps:',
  proposal.steps.map((s: any) => `${s.id} ${s.draft.kind} ${s.draft.operation} "${s.draft.title}"`).join('\n         '),
);
ok(
  !proposal.partial && proposal.sources.length === 3 && proposal.sources.every((s: any) => s.status === 'ok'),
  'three bound systems answered, none missing',
);
ok(
  proposal.steps.map((s: any) => [s.connector, s.draft.kind].join(':')).join() ===
    'hr:execute,timesheet:execute,payroll:watch',
  'one step per system: two writes and a watch',
);
const decisionId = `job:absence:${person.split(':').pop()}:${today}:${Date.now().toString(36)}`;
const approved = await api('/api/jobs', { decisionId, proposal });
ok(
  approved.steps.length === 3 && approved.steps.every((s: any) => ['pending', 'waiting'].includes(s.state)),
  `approved once as ${decisionId}; job ${approved.id}`,
);
const watch = approved.steps.find((s: any) => s.kind === 'watch');
console.log(
  '  watch checks:',
  watch.checks.map((c: string) => c.slice(11, 19)).join(' '),
  'expires',
  watch.expiresAt.slice(11, 19),
  'UTC',
);
const done = await until(
  'the two writes',
  async () => {
    const j = await api('/api/jobs/' + approved.id);
    return j.steps.filter((s: any) => s.kind === 'execute').every((s: any) => s.state === 'succeeded') ? j : undefined;
  },
  Date.now() + 90_000,
);
for (const s of done.steps.filter((s: any) => s.kind === 'execute'))
  console.log(`  ${s.connector}: ${s.result.headline} ${s.result.rows.map((r: any) => r.detail).join('; ')}`);
ok(
  done.steps.filter((s: any) => s.kind === 'execute').every((s: any) => s.result?.rows?.[0]?.outcome === 'done'),
  'the HR system and time reporting confirm their writes row by row',
);
const payroll: any = await api(
  `/api/cap/payroll.absenceStatus?input=${encodeURIComponent(JSON.stringify({ person, date: today }))}`,
);
ok(
  (payroll.output ?? payroll).status === 'pending',
  'payroll has not read the report yet (it reads the HR system at night)',
);
const wait = Date.parse(watch.expiresAt) - Date.now();
console.log(`  waiting ${Math.ceil(wait / 1000)} s for the watch window to end…`);
const card = await until(
  "the expired watch's card",
  async () => {
    const { threads } = await api('/api/threads');
    // The card's id is the watch's own (watch:<job>:<step>), so an earlier run's card never counts.
    return threads.find(
      (t: any) =>
        t.id === `watch:${approved.id}:${watch.id}` &&
        t.connector === 'payroll' &&
        t.kind === 'pushed' &&
        t.state === 'open' &&
        t.title === 'Lönesystemet har inte visat det som bevakades' &&
        t.summary.startsWith('Bevakas i lönesystemet'),
    );
  },
  Date.parse(watch.expiresAt) + 90_000,
);
console.log(`  card: "${card.title}" · ${card.summary}`);
ok(card.area === 'payroll', "the card is filed under payroll's area");
const final = await api('/api/jobs/' + approved.id);
const w = final.steps.find((s: any) => s.kind === 'watch');
ok(w.state === 'expired' && w.observations >= 3, `the watch is expired after ${w.observations} observations`);
console.log('\nJob across systems: OK');
