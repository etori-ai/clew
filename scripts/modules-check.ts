/**
 * Runs on the host against the published dev port: real Keycloak login, then the module architecture end to end
 * through the API. Registry listing, areas, pushed cards from the mock integrations, a card action with a receipt
 * read back row by row, undo within the window, snooze, and the employee view. Passwords come from .auth-test.env.
 */
const base = process.env.PUBLIC_URL ?? 'http://localhost:3020';
const env = Object.fromEntries((await Bun.file('.auth-test.env').text()).split('\n').flatMap(line => { const m = /^([A-Z_]+)=(.*)$/.exec(line); return m ? [[m[1]!, m[2]!]] : []; }));
async function login(user: string) {
  const password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
  if (!password) throw new Error('Test password missing in .auth-test.env for ' + user);
  const jar = new Map<string, string>();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair!.indexOf('='); jar.set(pair!.slice(0, i), pair!.slice(i + 1)); } };
  async function go(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie: cookieHeader() } }); remember(r);
    if ([301, 302, 303, 307].includes(r.status)) return go(new URL(r.headers.get('location')!, url).href); return r;
  }
  const form = await go(base + '/api/auth/login?returnTo=/'); const html = await form.text();
  const action = /action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (!action) throw new Error('Keycloak login form not found');
  await go(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: user, password, credentialId: '' }) });
  if (!jar.has('clew-session')) throw new Error('Ingen session efter inloggning');
  const session = await (await go(base + '/api/auth/session')).json();
  const headers = { 'content-type': 'application/json', origin: base, 'x-csrf-token': session.csrfToken };
  const api = async (path: string, body?: unknown) => { const r = await go(base + path, body !== undefined ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }); const json = await r.json(); if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(json)}`); return json; };
  console.log(`\n== ${session.user.name} (${session.user.role})`);
  return api;
}
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok', msg); };

// Manager
{
  const api = await login('hillevi');
  await api('/api/mocks/reset', {});
  console.log('  mocks reset');
  const { modules, tools } = await api('/api/modules');
  console.log('  modules:', modules.map((m: any) => `${m.id}(${m.kind})`).join(' '));
  console.log('  tools:', tools.join(' '));
  ok(modules.some((m: any) => m.id === 'people' && m.kind === 'core'), 'core module people is registered without an adapter');
  ok(!tools.some((t: string) => /approve|decide|book|acknowledge|report/.test(t)), 'no execute capability is a tool (D8)');
  const { areas } = await api('/api/areas');
  console.log('  areas:', areas.map((a: any) => `${a.id}[${a.needsYou}/${a.waiting}] ${a.figure?.label ?? ''}`).join(' | '));
  ok(areas.map((a: any) => a.id).join() === 'medarbetare,budget,arbetsmiljo,viktigt-nu,kalender,utvecklingssamtal', 'manager areas derived from modules and role');
  let { threads } = await api('/api/threads');
  const open = threads.filter((t: any) => t.state === 'open');
  console.log('  open threads:', open.map((t: any) => `${t.module}:${t.area} "${t.title}"${t.waitingOn ? ' [väntar]' : ''}`).join('\n    '));
  ok(open.some((t: any) => t.module === 'heroma' && t.title.includes('omtankesamtal')), 'Heroma pushed the rehab card');
  ok(open.some((t: any) => t.module === 'treserva' && t.waitingOn), 'Treserva card waits on someone else (Pågår utan dig)');
  let inv = open.find((t: any) => t.module === 'raindance');
  ok(inv && inv.items.length === 3 && inv.actions.filter((a: any) => a.role === 'primary').length === 1, 'Raindance card has 3 invoice rows and exactly one primary action');
  const me = await api('/api/cap/people.me');
  ok(me.output.role === 'manager' && me.output.capabilities.length > 0, 'people.me reads Clew-native permissions');
  const who = await api('/api/cap/heroma.whoIsOn');
  ok(Array.isArray(who.output.onDuty), 'standing action heroma.whoIsOn runs through the registry');
  const denied = await fetch(base + '/api/cap/raindance.approve').then(r => r.status);
  ok(denied === 401, 'capability routes need a session');
  // Act: approve the two invoices with an order, leave the third.
  const refs = inv.items.filter((i: any) => i.selected).map((i: any) => i.ref);
  const acted = await api(`/api/threads/${inv.id}/act`, { actionId: 'approve', refs });
  const t1 = acted.thread;
  console.log('  receipt:', t1.receipt.headline, '|', t1.receipt.rows.map((r: any) => `${r.outcome}`).join(','));
  ok(t1.state === 'handled' && t1.receipt.rows.map((r: any) => r.outcome).join() === 'done,done', 'receipt read back row by row, thread handled');
  ok(t1.receipt.undoUntil && t1.receipt.undoCapability === 'raindance.unapprove', 'receipt is undoable within a window');
  const undone = await api(`/api/threads/${inv.id}/undo-receipt`, {});
  ok(undone.state === 'open' && undone.receipt === null, 'undo reopens the thread and clears the receipt');
  // Unknown outcome: approve the invoice that never answers.
  const slow = inv.items.find((i: any) => !i.selected).ref;
  const acted2 = await api(`/api/threads/${inv.id}/act`, { actionId: 'approve', refs: [slow] });
  ok(acted2.thread.receipt.rows[0].outcome === 'unknown', 'a lost reply is recorded as unknown, never as done');
  await api(`/api/threads/${inv.id}/undo-receipt`, {});
  // Snooze and dismiss on a generic card.
  const rehab = open.find((t: any) => t.module === 'heroma' && t.title.includes('omtankesamtal'));
  const snoozed = await api(`/api/threads/${rehab.id}/snooze`, {});
  ok(snoozed.waitingOn === 'i morgon 06:00', 'snooze moves the card to Pågår utan dig until the next bundle');
  const notice = open.find((t: any) => t.module === 'kommunikation');
  const ack = await api(`/api/threads/${notice.id}/act`, { actionId: 'ack' });
  ok(ack.thread.state === 'handled' && ack.thread.receipt.rows[0].outcome === 'done', 'read receipt executed through the same path');
  ({ threads } = await api('/api/threads'));
  ok(!threads.some((t: any) => t.state === 'open' && t.module === 'kommunikation'), 'acknowledged notice is not pushed again');
}
// Employee
{
  const api = await login('hassan');
  const { areas } = await api('/api/areas');
  console.log('  areas:', areas.map((a: any) => `${a.id}[${a.needsYou}/${a.waiting}] ${a.figure?.label ?? ''}`).join(' | '));
  ok(areas.map((a: any) => a.id).join() === 'mitt-pass,viktigt-nu,kalender', 'employee areas differ from the manager');
  const { threads } = await api('/api/threads');
  const open = threads.filter((t: any) => t.state === 'open');
  console.log('  open threads:', open.map((t: any) => `${t.module}:${t.area} "${t.title}"${t.waitingOn ? ' [väntar på ' + t.waitingOn + ']' : ''}`).join('\n    '));
  ok(!open.some((t: any) => t.area === 'medarbetare' || t.module === 'raindance'), 'no manager cards leak to the employee');
  const forbidden = await api('/api/cap/raindance.invoices').catch((e: Error) => e.message);
  ok(typeof forbidden === 'string' && /400|behörighet/.test(forbidden), 'scope is enforced on the capability route');
  const shift = await api('/api/cap/heroma.myShift');
  console.log('  shift:', JSON.stringify(shift.output));
}
{ const api = await login('hillevi'); await api('/api/mocks/reset', {}); console.log('  mocks reset again for the next demo'); }
console.log('\nAll module checks passed.');

export {};
