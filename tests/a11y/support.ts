import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Thread } from '@clew/contracts';
import { NEXT_WEEK, NOW, WEEK, areas, attention, checkReport, completions, connectorDetail, connectorPreview, connectors, conversation, events, figures, searchOutput, snoozePresets, threads, today, units, user } from './data';
import { assistantStatus, modelDetail, modelProviders, models, providerDetail, providerReport } from './data';
import type { ModelSummary, ProviderSummary } from '@clew/contracts';

export const desktop = { width: 1280, height: 800 };
export const phone = { width: 375, height: 667 };
/** 1.4.10: 320 CSS px wide and 256 high are the two reflow limits; 256 is a landscape phone or 400 % zoom. */
export const narrow = { width: 320, height: 640 };
export const short = { width: 320, height: 256 };

const session = { csrfToken: 'test', sessionKey: 'test', expiresAt: '2026-11-04T16:00:00.000Z', user };
import type { ConnectorSummary } from '@clew/contracts';

/** The API as the browser sees it, held in memory per test. `/api/**` never leaves the page. */
export class MockApi {
  threads = threads();
  answerDelay = 0;
  /** How long the first read of the cards takes, so a test can see the page while they load (D36). */
  threadsDelay = 0;
  sessionDelay = 0;
  signedIn = true;
  /** The session says the person may administer connectors (D23). Off by default so the other suites see the ordinary page. */
  admin = false;
  connectors: ConnectorSummary[] = connectors();
  /** Modeller (D24): the providers and models the admin pages show, and how many models the person may pick in the box (two shows the menu). */
  providers: ProviderSummary[] = modelProviders();
  models: ModelSummary[] = models();
  modelChoices = 1;
  currentModel = 'gpt-oss-120b';
  output: unknown = { date: '2026-11-04', onDuty: ['Anna Lindqvist 07:00–16:00'], absent: [{ name: 'Sara Nyström', kind: 'short' }] };
  unmocked: string[] = [];
  private update(id: string, change: Partial<Thread>) {
    this.threads = this.threads.map(t => t.id === id ? { ...t, ...change, updatedAt: NOW } : t);
    return this.threads.find(t => t.id === id)!;
  }
  async handle(route: Route) {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api', ''), post = request.method() === 'POST';
    const json = (body: unknown) => route.fulfill({ json: body });
    const id = path.split('/')[2] ?? '';
    if (path === '/auth/session') {
      if (this.sessionDelay) await new Promise(resolve => setTimeout(resolve, this.sessionDelay));
      return this.signedIn ? json({ ...session, admin: this.admin }) : route.fulfill({ status: 401, json: { error: 'Ingen session' } });
    }
    if (path === '/auth/activity') return json({ expiresAt: session.expiresAt });
    if (path.startsWith('/admin/')) {
      if (!this.admin) return route.fulfill({ status: 403, json: { error: 'Du saknar behörighet för åtgärden.', code: 'denied' } });
      const method = request.method();
      const cid = path.split('/')[3] ?? '';
      const found = () => this.connectors.find(c => c.id === cid);
      if (path === '/admin/units') return json({ units });
      if (path.startsWith('/admin/models') || path.startsWith('/admin/providers')) return this.handleModels(route, method, path);
      if (path === '/admin/connectors' && method === 'GET') return json({ connectors: this.connectors });
      if (path === '/admin/connectors' && method === 'POST') {
        const input = request.postDataJSON() as { id: string; url: string };
        const c: ConnectorSummary = { ...connectorDetail({ ...this.connectors[2]!, id: input.id, source: 'Nytt system', url: input.url, state: 'draft', registered: false, health: { status: 'ok', at: NOW } }) };
        this.connectors = [...this.connectors, c];
        return route.fulfill({ status: 201, json: { connector: connectorDetail(c), report: { ok: true, findings: checkReport.findings.filter(f => f.level === 'ok') } } });
      }
      if (path === `/admin/connectors/${cid}/test`) return json({ ...checkReport, health: { status: 'secret-rejected', at: NOW } });
      if (path === `/admin/connectors/${cid}/refresh`) { const c = found(); return c ? json({ diff: { added: ['hello.remind'], removed: ['hello.openItems'], changed: [], areasAdded: [], areasRemoved: [], same: false }, connector: connectorDetail(c) }) : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } }); }
      if (path === `/admin/connectors/${cid}/preview`) return json(connectorPreview(url.searchParams.get('role') === 'employee' ? 'employee' : 'manager'));
      if (path === `/admin/connectors/${cid}/secret`) { const c = found(); return c ? json(connectorDetail({ ...c, secretChangedAt: NOW })) : route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } }); }
      if (path === `/admin/connectors/${cid}`) {
        const c = found();
        if (!c) return route.fulfill({ status: 400, json: { error: 'Anslutningen finns inte.' } });
        if (method === 'DELETE') { this.connectors = this.connectors.filter(x => x.id !== cid); return json({ closedCards: 1 }); }
        if (method === 'PATCH') { const patch = request.postDataJSON() as Partial<ConnectorSummary>; const next = { ...c, ...('state' in patch ? { state: patch.state! } : {}), ...('audience' in patch ? { audience: patch.audience! } : {}), ...('scanEnabled' in patch ? { scanEnabled: patch.scanEnabled! } : {}), ...('toolsEnabled' in patch ? { toolsEnabled: patch.toolsEnabled! } : {}), updatedAt: NOW }; this.connectors = this.connectors.map(x => x.id === cid ? next : x); return json(connectorDetail(next)); }
        return json(connectorDetail(c));
      }
    }
    if (path === '/threads') { if (this.threadsDelay) await new Promise(resolve => setTimeout(resolve, this.threadsDelay)); return json({ threads: this.threads }); }
    if (path === '/areas') return json({ areas });
    if (path === '/today') return json(today);
    if (path === '/attention') return json(attention);
    if (path === '/figures') return json({ figures });
    if (path === '/completions') return json(completions);
    if (path === '/assistant/status') return json(assistantStatus(this.modelChoices, this.currentModel));
    if (path === '/assistant/model' && request.method() === 'PATCH') { this.currentModel = (request.postDataJSON() as { modelId: string }).modelId; return json(assistantStatus(this.modelChoices, this.currentModel)); }
    if (path === '/calendar') { const from = url.searchParams.get('from') ?? '2026-11-02'; return json({ from, events: events(from), proposals: from === NEXT_WEEK ? this.threads.find(t => t.id === 'samtal')?.proposals ?? [] : [] }); }
    // A person's own bookings and proposal moves (D32): the form's lists, the free-busy check, and the writes answered as the server would.
    if (path === '/calendar/members') return json({ members: [{ name: 'Anna Lindqvist', email: 'anna@clew.test' }, { name: 'Erik Sandström', email: 'erik@clew.test' }] });
    if (path === '/calendar/rooms') return json({ rooms: [{ ref: 'room:a12', name: 'A12', capacity: 8, equipment: ['skärm'] }] });
    if (path === '/calendar/availability' && post) return json({ mine: 'free', participants: [{ email: 'anna@clew.test', name: 'Anna Lindqvist', state: 'busy' }], room: { ref: 'room:a12', name: 'A12', state: 'free' } });
    if (path === '/calendar/events' && post) { const b = request.postDataJSON() as { title: string; start: string; end: string }; return route.fulfill({ status: 201, json: { event: { ...events(WEEK)[0]!, id: 'new', ref: 'memory:new', title: b.title, start: b.start, end: b.end } } }); }
    if (path === '/calendar/events/reschedule' && post) { const b = request.postDataJSON() as { ref: string; start: string; end: string }; return json({ event: { ...events(WEEK)[0]!, ref: b.ref, start: b.start, end: b.end, revision: 'r2' } }); }
    if (path === '/calendar/events/cancel' && post) return json({ cancelled: true });
    if (/^\/threads\/[^/]+\/proposals\/[^/]+\/move$/.test(path) && post) { const b = request.postDataJSON() as { start: string; end: string }; const pid = path.split('/')[4]; const t = this.threads.find(t => t.id === id)!; return json(this.update(id, { proposals: t.proposals.map(p => p.id === pid ? { ...p, start: b.start, end: b.end } : p) })); }
    if (path === '/cap/calendar.day') { const date = (JSON.parse(url.searchParams.get('input') ?? '{}') as { date?: string }).date ?? '2026-11-04'; return json({ output: { from: date, events: events(date).filter(e => e.start.startsWith(date)), proposals: [] } }); }
    // `@` as the server answers it: with nothing typed only the context the box sends (`near`), with text everything open, the context first.
    if (path === '/objects') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase(), near = (url.searchParams.get('near') ?? '').split(',');
      const all = this.threads.filter(t => t.state === 'open' && t.kind === 'pushed').flatMap(t => [{ ref: 'thread:' + t.id, kind: 'thread', label: t.title, detail: 'kort', threadId: t.id, visible: near.includes('thread:' + t.id) },
        ...t.items.map(i => ({ ref: i.ref, kind: 'item', label: i.label, detail: 'rad', threadId: t.id, visible: near.includes('thread:' + t.id) }))]);
      const hits = q ? all.filter(o => o.label.toLowerCase().includes(q)) : all.filter(o => o.visible);
      return json({ objects: [...hits.filter(o => o.visible), ...hits.filter(o => !o.visible)].slice(0, 12) });
    }
    if (path === '/cap/clew.search') return json({ output: searchOutput });
    if (path === '/cap/clew.cardFromAnswer' && post) return json({ output: { threadId: 'rutin' } });
    if (path.startsWith('/cap/')) return json({ output: this.output });
    // A turn as the server streams it (D36): a read as a step, the answer in two deltas, then the finished turn. Playwright
    // answers in one piece, so the pending turn is what `answerDelay` holds open.
    if (path === '/conversation/stream') {
      const body = request.postDataJSON() as { text: string; conversationId?: string };
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      const step = { id: 'steg-1', capability: 'mock.read', title: 'Läser', source: response.answer.source };
      const half = Math.ceil(response.answer.body.length / 2);
      const events = [{ type: 'step', step: { ...step, status: 'running' } }, { type: 'step', step: { ...step, status: 'complete', ms: 800 } },
        { type: 'text', delta: response.answer.body.slice(0, half) }, { type: 'text', delta: response.answer.body.slice(half) }, { type: 'done', response }];
      try { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') }); }
      catch { return; }
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return;
    }
    if (path === '/conversation') {
      const body = request.postDataJSON() as { text: string; conversationId?: string };
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return json(response);
    }
    if (path.endsWith('/verbs')) return json({ verbs: [] });
    if (path === '/snooze/presets') return json({ presets: snoozePresets });
    if (path.endsWith('/snooze') && post) {
      const body = (request.postDataJSON() ?? {}) as { preset?: string; until?: string; text?: string };
      const until = body.until ?? snoozePresets.find(p => p.id === body.preset)?.at ?? '2026-11-05T05:00:00.000Z';
      return json(this.update(id, { snoozedUntil: until }));
    }
    if (path.endsWith('/dismiss') && post) return json(this.update(id, { state: 'dismissed', handledAt: NOW }));
    if (path.endsWith('/remind-invitees') && post) { const t = this.threads.find(t => t.id === id)!; return json(this.update(id, { proposals: t.proposals.map(p => p.status === 'confirmed' ? { ...p, reminders: p.reminders + 1, remindedAt: NOW } : p) })); }
    if (path.endsWith('/reopen') && post) return json(this.update(id, { state: 'open', handledAt: null, snoozedUntil: null }));
    if (path.endsWith('/act') && post) return json({ kind: 'read', output: this.output });
    if (path.startsWith('/threads/') && !post) return json(this.threads.find(t => t.id === id));
    this.unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: 'Inte mockat' } });
  }
  /** Modeller (D24), answered as the server would: the list, one model or provider, the writes, and a test that lists three models. */
  private handleModels(route: Route, method: string, path: string) {
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const missing = (what: string) => route.fulfill({ status: 400, json: { error: `${what} finns inte.` } });
    const [, , kind, id = '', action] = path.split('/');
    const body = () => (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const counted = () => { this.providers = this.providers.map(p => ({ ...p, models: this.models.filter(m => m.providerId === p.id).length, enabledModels: this.models.filter(m => m.providerId === p.id && m.state === 'enabled').length })); };
    if (kind === 'models') {
      if (!id && method === 'GET') return json({ providers: this.providers, models: this.models });
      if (!id && method === 'POST') {
        const input = body() as { providerId: string; model: string; title?: string; description?: string };
        const p = this.providers.find(x => x.id === input.providerId)!;
        const m: ModelSummary = { ...this.models[0]!, id: input.model.replace(/[^a-z0-9]+/g, '-'), model: input.model, title: input.title ?? input.model, description: input.description ?? '', providerId: p.id, providerTitle: p.title, state: 'disabled', isDefault: false, audience: { mode: 'all' } };
        this.models = [...this.models, m]; counted();
        return json(modelDetail(m), 201);
      }
      const m = this.models.find(x => x.id === id);
      if (!m) return missing('Modellen');
      if (action === 'test') return json({ ok: true, models: [], health: { status: 'ok', at: NOW }, findings: [{ level: 'ok', text: `${m.title} svarar.` }] });
      if (method === 'DELETE') { this.models = this.models.filter(x => x.id !== id); counted(); return json({ removed: true }); }
      if (method === 'PATCH') {
        const patch = body() as Partial<ModelSummary>;
        if (patch.isDefault) this.models = this.models.map(x => ({ ...x, isDefault: false }));
        const next = { ...m, ...patch, ...(patch.state === 'disabled' ? { isDefault: false } : {}), updatedAt: new Date().toISOString() };
        this.models = this.models.map(x => x.id === id ? next : x); counted();
        return json(modelDetail(next));
      }
      return json(modelDetail(m));
    }
    if (!id && method === 'POST') {
      const input = body() as { id: string; title: string; baseUrl: string; apiKey?: string };
      const p: ProviderSummary = { ...this.providers[0]!, id: input.id, title: input.title, baseUrl: input.baseUrl, hasKey: !!input.apiKey, models: 0, enabledModels: 0 };
      this.providers = [...this.providers, p];
      return json({ provider: providerDetail(p), report: providerReport }, 201);
    }
    const p = this.providers.find(x => x.id === id);
    if (!p) return missing('Leverantören');
    if (action === 'test') return json(providerReport);
    if (action === 'key') { const next = { ...p, hasKey: !!body().apiKey, keyChangedAt: NOW }; this.providers = this.providers.map(x => x.id === id ? next : x); return json(providerDetail(next)); }
    if (method === 'DELETE') { this.providers = this.providers.filter(x => x.id !== id); return json({ removed: true }); }
    if (method === 'PATCH') { const next = { ...p, ...(body() as Partial<ProviderSummary>), updatedAt: new Date().toISOString() }; this.providers = this.providers.map(x => x.id === id ? next : x); return json(providerDetail(next)); }
    return json(providerDetail(p));
  }
}

/** Records text that changes inside a live region. A region mounted together with its text is not announced, so it is not recorded. */
function recordAnnouncements() {
  const log: string[] = [];
  Object.assign(window, { announcements: log });
  const live = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const node = mutation.target;
      const region = (node instanceof Element ? node : node.parentElement)?.closest(live);
      const text = region?.textContent?.trim();
      if (text && log.at(-1) !== text) log.push(text);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript(recordAnnouncements);
    await page.route('**/api/**', route => api.handle(route));
    await use(api);
    expect(api.unmocked).toEqual([]);
  },
});
export { expect };

export const answer = (page: Page) => page.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' });
/** The box: named after the landing's heading, "Svara i samtalet" once a conversation is open (the scope line, H3.3). */
export const composer = (page: Page) => page.getByRole('combobox', { name: /^(Vad vill du göra|Svara i samtalet)$/ });
/** A heading by the level assistive technology gets: `aria-level` when Astryx separates it from the visual level. */
/** "Inte nu" on the first card, the way a person does it (D29): open the picker, choose "I morgon". */
export async function snoozeFirst(page: Page) {
  await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^I morgon/ }).click();
}
export const heading = (page: Page, level: number, name: string) => page.locator(`h${level}:not([aria-level]), [aria-level="${level}"]`).filter({ hasText: name });
export const announcements = (page: Page) => page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);
/** The areas live in the shell's SideNav (D31); below the shell's breakpoint AppShell keeps it in a modal drawer that this opens. */
export async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Öppna navigering' });
  if (!await toggle.isVisible()) return page.getByRole('navigation', { name: 'Sidonavigering' });
  await toggle.click();
  return page.getByRole('dialog', { name: 'Navigering' });
}
/** The areas are lenses at the rail's foot, collapsed until asked for (the canvas's H3 item 7): open the disclosure in the given rail. */
export async function openAreas(nav: Locator) {
  const toggle = nav.getByRole('button', { name: 'Områden' });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
/** The surface that docks the composer: ChatLayout's sticky wrapper (D31), or null when the row is in the page flow. */
const dockOf = (page: Page) => page.evaluate(() => {
  let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
  while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position)) el = el.parentElement;
  return el ? el.getBoundingClientRect().toJSON() as DOMRect : null;
});
export { dockOf };

/** Renders a route and waits for its data, so a check never runs against the empty shell. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText(/Testa/).locator('visible=true').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Every rule tagged for WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices: landmarks, headings and regions. */
export async function expectNoAxeViolations(page: Page) {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const { violations } = await new AxeBuilder({ page }).withTags(tags).disableRules(['target-size']).analyze();
  // 2.5.8 is about the targets themselves: measured with the dock in the flow, so a row that has scrolled under the sticky dock is not read as too close to its buttons.
  const undock = (on: boolean) => page.evaluate(on => {
    let el = document.querySelector('[role="combobox"]')?.parentElement ?? null;
    while (el && !['sticky', 'fixed'].includes(getComputedStyle(el).position) && !el.dataset.undocked) el = el.parentElement;
    if (!el) return;
    if (on) { el.dataset.undocked = el.style.position; el.style.position = 'static'; } else { el.style.position = el.dataset.undocked ?? ''; delete el.dataset.undocked; }
  }, on);
  await undock(true);
  const { violations: sizes } = await new AxeBuilder({ page }).withTags(tags).withRules(['target-size']).analyze();
  await undock(false);
  expect([...violations, ...sizes].map(v => `${v.id}: ${v.help}\n  ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join('\n  ')}`)).toEqual([]);
}

/** 1.4.10: nothing may need sideways scrolling, and no text may be clipped to fit. */
export async function reflowProblems(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 50)}"`;
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > width) problems.push(`page is ${document.documentElement.scrollWidth} px wide at ${width} px`);
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const position = getComputedStyle(el).position;
      if (position === 'absolute' && el.getBoundingClientRect().width <= 1) continue;
      if (el.getBoundingClientRect().right > width + 1 && el.children.length === 0 && el.textContent?.trim()) problems.push(`beyond the edge: ${label(el)}`);
      const style = getComputedStyle(el);
      const clips = style.overflowX === 'hidden' || style.textOverflow === 'ellipsis';
      const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (clips && hasText && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${label(el)}`);
    }
    return [...new Set(problems)];
  });
}

/** Tabs through the page and names every stop entirely hidden by sticky or fixed content (2.4.11) or without a focus ring (2.4.7). */
export async function hiddenFocusStops(page: Page, limit = 150) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); Object.assign(window, { unmarked: [], visited: [] }); });
  const hidden: string[] = [];
  const seen = new Set<string>();
  for (let stop = 0; stop < limit; stop++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(async () => {
      // A ring that animates in (an Astryx field's border and inset shadow, 125 ms) is measured once it has settled, not in the instant of the Tab.
      await Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition && a.playState === 'running').map(a => a.finished.catch(() => undefined)));
      const { unmarked, visited } = window as unknown as { unmarked: string[]; visited: Element[] };
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      // The element itself decides whether the walk has come round, not its label and place: a row that scrolls into the previous row's spot is still a new stop.
      const again = visited.includes(active);
      visited.push(active);
      const r = active.getBoundingClientRect();
      const name = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 50)}" at ${Math.round(r.left)},${Math.round(r.top)}`;
      const ring = (el: Element | null, depth: number): boolean => {
        if (!el || depth > 3) return false;
        const s = getComputedStyle(el);
        // An Astryx field (TextInput, Typeahead) draws its ring as an inset shadow on the wrapper around the input; an elevation shadow is never inset.
        const fieldRing = el !== active && /inset/.test(s.boxShadow) && !/^rgba\(0, 0, 0, 0\)/.test(s.boxShadow) && !/ 0px 0px 0px 0px inset/.test(s.boxShadow);
        return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (el === active && s.boxShadow !== 'none') || fieldRing || ring(el.parentElement, depth + 1);
      };
      if (!ring(active, 0)) unmarked.push(name);
      const box = { left: Math.max(r.left, 0), right: Math.min(r.right, innerWidth), top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight) };
      if (box.right <= box.left || box.bottom <= box.top) return { name, again, covered: 'outside the viewport' };
      // The top layer (an open popover: the toast stack, a dialog) paints over everything else, so nothing below can obscure it.
      if (active.closest(':popover-open, dialog[open]')) return { name, again, covered: null };
      const layer = (e: Element) => parseInt(getComputedStyle(e).zIndex) || 0;
      const a = getComputedStyle(active);
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'sticky' && s.position !== 'fixed') continue;
        if (el.contains(active) || s.visibility === 'hidden') continue;
        // A stop that is itself lifted above the surface (the shell's skip link over its header) is on top, not under it.
        if ((a.position === 'fixed' || a.position === 'absolute') && layer(active) > layer(el)) continue;
        // A frosted layer (ChatLayout's dock) hides what is under it as surely as a painted one (D31).
        const frosted = (e: Element) => getComputedStyle(e).backdropFilter !== 'none' || [...e.children].some(c => getComputedStyle(c).backdropFilter !== 'none');
        const paints = s.backgroundImage !== 'none' || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || frosted(el);
        const o = el.getBoundingClientRect();
        if (paints && box.top >= o.top && box.bottom <= o.bottom && box.left >= o.left && box.right <= o.right) return { name, again, covered: el.className.toString().slice(0, 40) || el.tagName };
      }
      return { name, again, covered: null };
    });
    if (!result) { if (seen.size) break; continue; }
    if (result.again) break;
    seen.add(result.name);
    if (result.covered) hidden.push(`${result.name} is under ${result.covered}`);
  }
  expect(seen.size, 'the walk reached the controls').toBeGreaterThan(3);
  const unmarked = await page.evaluate(() => (window as unknown as { unmarked: string[] }).unmarked);
  return { hidden, unmarked, stops: [...seen] };
}

/** The focused element, as a person using a screen reader would be told about it. `body` means focus was lost. */
export const focused = (page: Page) => page.evaluate(() => {
  const active = document.activeElement;
  return { tag: active?.tagName.toLowerCase(), text: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim() };
});
