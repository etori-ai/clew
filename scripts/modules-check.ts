/**
 * Runs on the host against the published dev port: real Keycloak login, then the connector architecture end to end
 * through the API. Registry listing, areas, pushed cards from the mock integrations, a card action with a receipt
 * read back row by row, undo within the window, snooze, and the employee view. Passwords come from .auth-test.env.
 */
const base = process.env.PUBLIC_URL ?? 'http://localhost:3020';
const env = Object.fromEntries(
  (await Bun.file('.auth-test.env').text()).split('\n').flatMap(line => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    return m ? [[m[1]!, m[2]!]] : [];
  }),
);
async function login(user: string) {
  const password = env['TEST_' + user.toUpperCase() + '_PASSWORD'];
  if (!password) throw new Error('Test password missing in .auth-test.env for ' + user);
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
  if (!jar.has('clew-session')) throw new Error('Ingen session efter inloggning');
  const session = await (await go(base + '/api/auth/session')).json();
  const headers = { 'content-type': 'application/json', origin: base, 'x-csrf-token': session.csrfToken };
  const api = async (path: string, body?: unknown, method = 'POST') => {
    const r = await go(base + path, body !== undefined ? { method, headers, body: JSON.stringify(body) } : { headers });
    const json = await r.json();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  console.log(`\n== ${session.user.name} (${session.user.role})`);
  return api;
}
const ok = (cond: unknown, msg: string) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok', msg);
};

// Manager
{
  const api = await login('hillevi');
  await api('/api/mocks/reset', {});
  console.log('  mocks reset');
  const { connectors, tools } = await api('/api/connectors');
  console.log('  connectors:', connectors.map((m: any) => `${m.id}(${m.kind})`).join(' '));
  console.log('  tools:', tools.join(' '));
  ok(
    connectors.some((m: any) => m.id === 'people' && m.kind === 'core'),
    'core connector people is registered without an adapter',
  );
  ok(
    !tools.some((t: string) => /approve|decide|book|acknowledge|report/.test(t)),
    'no execute capability is a tool (D8)',
  );
  const { areas } = await api('/api/areas');
  console.log(
    '  areas:',
    areas.map((a: any) => `${a.id}[${a.needsYou}/${a.waiting}] ${a.figure?.label ?? ''}`).join(' | '),
  );
  ok(
    areas.map((a: any) => a.id).join() ===
      'medarbetare,budget,arbetsmiljo,viktigt-nu,lon,bemanning,kalender,utvecklingssamtal',
    'manager areas derived from connectors and role',
  );
  let { threads } = await api('/api/threads');
  const open = threads.filter((t: any) => t.state === 'open');
  console.log(
    '  open threads:',
    open.map((t: any) => `${t.connector}:${t.area} "${t.title}"${t.waitingOn ? ' [väntar]' : ''}`).join('\n    '),
  );
  ok(
    open.some((t: any) => t.connector === 'hr' && t.title.includes('omtankesamtal')),
    'the HR mock pushed the rehab card',
  );
  ok(
    open.some((t: any) => t.connector === 'incidents' && t.waitingOn),
    'the incidents card waits on someone else (Pågår utan dig)',
  );
  let inv = open.find((t: any) => t.connector === 'finance');
  ok(
    inv && inv.items.length === 3 && inv.actions.filter((a: any) => a.role === 'primary').length === 1,
    'the finance card has 3 invoice rows and exactly one primary action',
  );
  const me = await api('/api/cap/people.me');
  ok(me.output.role === 'manager' && me.output.capabilities.length > 0, 'people.me reads Clew-native permissions');
  const who = await api('/api/cap/hr.whoIsOn');
  ok(Array.isArray(who.output.onDuty), 'standing action hr.whoIsOn runs through the registry');
  const denied = await fetch(base + '/api/cap/finance.approve').then(r => r.status);
  ok(denied === 401, 'capability routes need a session');
  // Act: approve the two invoices with an order, leave the third.
  const refs = inv.items.filter((i: any) => i.selected).map((i: any) => i.ref);
  const acted = await api(`/api/threads/${inv.id}/act`, { actionId: 'approve', refs });
  const t1 = acted.thread;
  console.log('  receipt:', t1.receipt.headline, '|', t1.receipt.rows.map((r: any) => `${r.outcome}`).join(','));
  ok(
    t1.state === 'handled' && t1.receipt.rows.map((r: any) => r.outcome).join() === 'done,done',
    'receipt read back row by row, thread handled',
  );
  ok(t1.receipt.undoUntil && t1.receipt.undoCapability === 'finance.unapprove', 'receipt is undoable within a window');
  const undone = await api(`/api/threads/${inv.id}/undo-receipt`, {});
  ok(undone.state === 'open' && undone.receipt === null, 'undo reopens the thread and clears the receipt');
  // Unknown outcome: approve the invoice that never answers.
  const slow = inv.items.find((i: any) => !i.selected).ref;
  const acted2 = await api(`/api/threads/${inv.id}/act`, { actionId: 'approve', refs: [slow] });
  ok(acted2.thread.receipt.rows[0].outcome === 'unknown', 'a lost reply is recorded as unknown, never as done');
  await api(`/api/threads/${inv.id}/undo-receipt`, {});
  // Snooze and dismiss on a generic card.
  const rehab = open.find((t: any) => t.connector === 'hr' && t.title.includes('omtankesamtal'));
  const snoozed = await api(`/api/threads/${rehab.id}/snooze`, {});
  ok(snoozed.waitingOn === 'i morgon 06:00', 'snooze moves the card to Pågår utan dig until the next bundle');
  const notice = open.find((t: any) => t.connector === 'kommunikation');
  const ack = await api(`/api/threads/${notice.id}/act`, { actionId: 'ack' });
  ok(
    ack.thread.state === 'handled' && ack.thread.receipt.rows[0].outcome === 'done',
    'read receipt executed through the same path',
  );
  ({ threads } = await api('/api/threads'));
  ok(
    !threads.some((t: any) => t.state === 'open' && t.connector === 'kommunikation'),
    'acknowledged notice is not pushed again',
  );
  // Reopen after Inte nu: the Ångra row.
  const reopened = await api(`/api/threads/${rehab.id}/reopen`, {});
  ok(reopened.state === 'open' && reopened.waitingOn === null, 'reopen clears the snooze');
  // The conversation (D12, D8). Without a configured model the router answers; with one, the same calls still pass.
  const status = await api('/api/assistant/status');
  console.log('  assistant:', JSON.stringify(status));
  const c1 = await api('/api/conversation', { text: 'Fakturor att attestera' });
  console.log('  svar:', c1.assistant, c1.shape, '|', c1.answer.body);
  ok(
    c1.thread.kind === 'question' && c1.answer.body.length > 0,
    'a question becomes a conversation thread with an answer',
  );
  ok(
    status.configured ? ['model', 'router', 'unavailable'].includes(c1.assistant) : c1.assistant === 'router',
    'the answer says how it was produced',
  );
  if (c1.assistant !== 'model')
    ok(c1.view?.capability === 'finance.invoices', 'the router found the capability and offers a view');
  const c2 = await api('/api/conversation', { text: 'Hur ligger budgeten?', conversationId: c1.conversationId });
  ok(
    c2.conversationId === c1.conversationId && c2.thread.messages.length === 4,
    'a follow-up stays in the same conversation with memory',
  );
  const invCard = (await api('/api/threads')).threads.find((t: any) => t.state === 'open' && t.connector === 'finance');
  const chip = { ref: 'thread:' + invCard.id, kind: 'thread', label: invCard.title };
  const c3 = await api('/api/conversation', { text: 'avfärda det', chips: [chip] });
  ok(
    c3.clewActions.length === 1 && c3.clewActions[0].kind === 'dismiss' && c3.verbs?.length > 0,
    'with a chip, "avfärda" is proposed as a Clew action with verbs, nothing executed',
  );
  ok((await api(`/api/threads/${invCard.id}`)).state === 'open', 'the card is still open until the person confirms');
  const c4 = await api('/api/conversation', { text: 'attestera bara Skolgrossisten', chips: [chip] });
  ok(
    c4.draft?.kind === 'select' && c4.draft.thread.items.filter((i: any) => i.selected).length === 2,
    'the conversation drafts the selection on the card',
  );
  ok(
    (await api(`/api/threads/${invCard.id}`)).messages.some((m: any) => m.meta?.draft?.kind === 'select'),
    'the draft is remembered on the card',
  );
  const c5 = await api('/api/conversation', { text: 'varför ser jag detta?', chips: [chip] });
  ok(/Varför nu\?/.test(c5.answer.body) && c5.answer.source === 'Ekonomisystemet', 'why answers from the trigger');
  const { objects } = await api('/api/objects?q=skolgrossisten');
  ok(
    objects.some((o: any) => o.kind === 'item' && o.threadId === invCard.id),
    '@ lists the visible rows first',
  );
  ok(
    (await api('/api/objects?q=attest')).objects.some((o: any) => o.kind === 'capability'),
    '@ lists capabilities after the page',
  );
  const { verbs } = await api(`/api/threads/${invCard.id}/verbs`);
  ok(
    verbs.map((v: any) => v.label).includes('Avfärda det') &&
      verbs.map((v: any) => v.label).includes('Varför ser jag detta?'),
    'verbs for a card',
  );
  const comp = await api('/api/completions');
  ok(
    comp.ask.some((a: any) => a.capability === 'hr.whoIsOn' && a.source === 'Personalsystemet'),
    'completions list questions with their source',
  );
  ok(
    comp.do.some((d: any) => d.capability === 'incidents.report'),
    'completions list things to do',
  );
  ok(
    comp.recent.some((r: any) => r.conversationId === c1.conversationId),
    'completions list the recent conversation',
  );
  const samtal = (await api('/api/threads')).threads.find(
    (t: any) => t.state === 'open' && t.topic === 'utvecklingssamtal',
  );
  if (samtal) {
    ok(
      samtal.items.length === samtal.proposals.filter((p: any) => p.status === 'proposed').length &&
        samtal.items.every((i: any) => i.ref.startsWith('proposal:')),
      'proposal threads carry rows with refs',
    );
    const week = samtal.week.slice(0, 4);
    const next = new Date(samtal.week + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 7);
    const iso = next.toISOString().slice(0, 10);
    const c6 = await api('/api/conversation', {
      text: 'nästa vecka i stället',
      chips: [{ ref: 'thread:' + samtal.id, kind: 'thread', label: samtal.title }],
    });
    ok(
      c6.draft?.kind === 'replan' && c6.draft.thread.week === iso,
      `replan through the conversation moved the card to ${iso} (year ${week})`,
    );
    await api(`/api/threads/${samtal.id}/replan`, { week: samtal.week });
  } else console.log('  (no samtal thread: calendar profile not running, replan skipped)');
  // A person's own timer (D17): "påminn mig om 3 sekunder" starts a Temporal workflow that pushes a card back at the thread.
  const cancelled = await api(`/api/threads/${invCard.id}/remind`, { seconds: 60 });
  ok(/^påminnelsen /.test(cancelled.thread.waitingOn), 'setting a reminder parks the card under Pågår utan dig');
  const restored = await api(`/api/threads/${invCard.id}/remind/cancel`, { workflowId: cancelled.id });
  ok(restored.waitingOn === null, 'Ångra cancels the timer and puts the card back');
  const reminded = await api(`/api/threads/${invCard.id}/remind`, { seconds: 3 });
  ok(
    /^reminder:/.test(reminded.id) && Date.parse(reminded.fireAt) > Date.now(),
    'reminder workflow started with a fire time',
  );
  const invalid = await api(`/api/threads/${invCard.id}/remind`, { seconds: 0 }).catch((e: Error) => e.message);
  ok(typeof invalid === 'string' && /400/.test(invalid), 'reminder time is validated');
  await Bun.sleep(5000);
  const after = (await api('/api/threads')).threads;
  const back = after.find((t: any) => t.id === invCard.id);
  ok(
    back.state === 'open' && back.waitingOn === null && back.remindedAt && /^Du bad /.test(back.trigger.reason),
    'the reminder fired through Temporal and brought the parked card back with the reason',
  );
  ok(
    after.filter((t: any) => t.state === 'open' && t.title === invCard.title).length === 1,
    'a reminder never creates a second card',
  );
  const dismissedCard = await api(`/api/threads/${invCard.id}/dismiss`, {});
  ok(dismissedCard.state === 'dismissed', 'dismiss closes the card');
  ok((await api(`/api/threads/${invCard.id}/reopen`, {})).state === 'open', 'reopen within the window brings it back');
}
// Employee
{
  const api = await login('hassan');
  const { areas } = await api('/api/areas');
  console.log(
    '  areas:',
    areas.map((a: any) => `${a.id}[${a.needsYou}/${a.waiting}] ${a.figure?.label ?? ''}`).join(' | '),
  );
  ok(areas.map((a: any) => a.id).join() === 'mitt-pass,viktigt-nu,kalender', 'employee areas differ from the manager');
  const { threads } = await api('/api/threads');
  const open = threads.filter((t: any) => t.state === 'open');
  console.log(
    '  open threads:',
    open
      .map((t: any) => `${t.connector}:${t.area} "${t.title}"${t.waitingOn ? ' [väntar på ' + t.waitingOn + ']' : ''}`)
      .join('\n    '),
  );
  ok(
    !open.some((t: any) => t.area === 'medarbetare' || t.connector === 'finance'),
    'no manager cards leak to the employee',
  );
  const forbidden = await api('/api/cap/finance.invoices').catch((e: Error) => e.message);
  ok(typeof forbidden === 'string' && /400|behörighet/.test(forbidden), 'scope is enforced on the capability route');
  const shift = await api('/api/cap/hr.myShift');
  console.log('  shift:', JSON.stringify(shift.output));
  const comp = await api('/api/completions');
  ok(!comp.ask.some((a: any) => a.capability === 'hr.absenceOverview'), 'an employee is not offered manager questions');
  const c = await api('/api/conversation', { text: 'Mitt pass' });
  console.log('  svar:', c.assistant, '|', c.answer.body);
  ok(c.answer.body.length > 0, 'the employee gets an answer');
}
// Administration (D23): Mikael limits the finance mock to managers, Hassan loses every trace of it, Mikael restores it. No restart anywhere.
if (!env.TEST_MIKAEL_PASSWORD)
  console.log('\n== (mikael is not provisioned: run `bun run auth:setup` once to get the administration checks)');
else {
  const admin = await login('mikael');
  const denied = await admin('/api/cap/finance.budget').catch((e: Error) => e.message);
  ok(typeof denied === 'string', 'an administrator is still an ordinary employee on the page');
  const { connectors } = await admin('/api/admin/connectors');
  console.log(
    '  governed:',
    connectors.map((c: any) => `${c.id}${c.bundled ? '*' : ''}:${c.state}/${c.health.status}`).join(' '),
  );
  ok(
    connectors.some((c: any) => c.id === 'finance' && c.bundled && c.state === 'enabled'),
    'bundled connectors have rows and are enabled',
  );
  const detail = await admin('/api/admin/connectors/finance');
  ok(
    detail.capabilities.length > 0 && detail.areas.length > 0 && detail.history.length >= 0,
    'the detail view describes a bundled connector like a manifest',
  );
  const narrowed = await admin(
    '/api/admin/connectors/finance',
    { audience: { mode: 'selected', roles: ['manager'] } },
    'PATCH',
  );
  ok(narrowed.audience.mode === 'selected', 'the audience is narrowed to managers');
  const preview = await admin('/api/admin/connectors/finance/preview?role=employee');
  ok(preview.visible === false, 'the structural preview says an employee sees nothing');
  try {
    const hassan = await login('hassan');
    const seen = await hassan('/api/connectors');
    ok(!seen.connectors.some((c: any) => c.id === 'finance'), 'Hassan: finance is not in the connector listing');
    const { areas } = await hassan('/api/areas');
    ok(!areas.some((a: any) => a.connector === 'finance'), 'Hassan: no finance area');
    const { objects } = await hassan('/api/objects?q=budget');
    ok(!objects.some((o: any) => o.ref.startsWith('capability:finance.')), 'Hassan: no finance capability in search');
    const probe = await hassan('/api/cap/finance.budget').catch((e: Error) => e.message);
    ok(
      typeof probe === 'string' && /Okänd förmåga|404/.test(probe) && !/behörighet/.test(probe),
      'Hassan: a finance capability answers like an unknown one, never "denied"',
    );
    const comp = await hassan('/api/completions');
    ok(!comp.ask.some((a: any) => a.capability.startsWith('finance.')), 'Hassan: no finance question in the typeahead');
  } finally {
    const restored = await admin('/api/admin/connectors/finance', { audience: { mode: 'all' } }, 'PATCH');
    ok(restored.audience.mode === 'all', 'the audience is restored to everyone');
  }
  const history = (await admin('/api/admin/connectors/finance')).history;
  ok(
    history.filter((h: any) => h.action === 'connector.audience').length >= 2,
    'both audience changes are in the audit log',
  );
  const forbidden = await (await login('hassan'))('/api/admin/connectors').catch((e: Error) => e.message);
  ok(typeof forbidden === 'string' && /403|behörighet/.test(forbidden), 'administration needs the grant capability');
}
{
  const r = await fetch(base + '/api/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text":"hej"}',
  });
  ok(r.status === 401, 'the conversation needs a session');
}
{
  const api = await login('hillevi');
  await api('/api/mocks/reset', {});
  console.log('  mocks reset again for the next demo');
}
console.log('\nAll connector checks passed.');

export {};
