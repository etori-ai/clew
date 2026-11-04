import { test as base, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Thread } from '@clew/contracts';
import { NOW, areas, attention, conversation, events, threads, today, user } from './data';

export const desktop = { width: 1280, height: 800 };
export const phone = { width: 375, height: 667 };
/** 1.4.10: 320 CSS px wide and 256 high are the two reflow limits; 256 is a landscape phone or 400 % zoom. */
export const narrow = { width: 320, height: 640 };
export const short = { width: 320, height: 256 };

const session = { csrfToken: 'test', sessionKey: 'test', expiresAt: '2026-11-04T16:00:00.000Z', user };

/** The API as the browser sees it, held in memory per test. `/api/**` never leaves the page. */
export class MockApi {
  threads = threads();
  answerDelay = 0;
  sessionDelay = 0;
  signedIn = true;
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
      return this.signedIn ? json(session) : route.fulfill({ status: 401, json: { error: 'Ingen session' } });
    }
    if (path === '/auth/activity') return json({ expiresAt: session.expiresAt });
    if (path === '/threads') return json({ threads: this.threads });
    if (path === '/areas') return json({ areas });
    if (path === '/today') return json(today);
    if (path === '/attention') return json(attention);
    if (path === '/assistant/status') return json({ configured: true, available: true, model: 'test', checkedAt: NOW });
    if (path === '/calendar') { const from = url.searchParams.get('from') ?? '2026-11-02'; return json({ from, events: events(from), proposals: [] }); }
    if (path === '/objects') return json({ objects: [] });
    if (path.startsWith('/cap/')) return json({ output: this.output });
    if (path === '/conversation') {
      const body = request.postDataJSON() as { text: string; conversationId?: string };
      if (this.answerDelay) await new Promise(resolve => setTimeout(resolve, this.answerDelay));
      const response = conversation(this.threads, body.text, body.conversationId);
      this.threads = [...this.threads.filter(t => t.id !== response.conversationId), response.thread];
      return json(response);
    }
    if (path.endsWith('/verbs')) return json({ verbs: [] });
    if (path.endsWith('/snooze') && post) return json(this.update(id, { waitingOn: 'i morgon 06:00' }));
    if (path.endsWith('/dismiss') && post) return json(this.update(id, { state: 'dismissed', handledAt: NOW }));
    if (path.endsWith('/reopen') && post) return json(this.update(id, { state: 'open', handledAt: null, waitingOn: null }));
    if (path.endsWith('/act') && post) return json({ kind: 'read', output: this.output });
    if (path.startsWith('/threads/') && !post) return json(this.threads.find(t => t.id === id));
    this.unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: 'Inte mockat' } });
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
export const composer = (page: Page) => page.getByRole('combobox', { name: 'Fråga, be om något eller svara om ett kort' });
/** A heading by the level assistive technology gets: `aria-level` when Astryx separates it from the visual level. */
export const heading = (page: Page, level: number, name: string) => page.locator(`h${level}:not([aria-level]), [aria-level="${level}"]`).filter({ hasText: name });
export const announcements = (page: Page) => page.evaluate(() => (window as unknown as { announcements: string[] }).announcements);

/** Renders a route and waits for its data, so a check never runs against the empty shell. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText(/Testa/).locator('visible=true').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Every rule tagged for WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices: landmarks, headings and regions. */
export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(violations.map(v => `${v.id}: ${v.help}\n  ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join('\n  ')}`)).toEqual([]);
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
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); Object.assign(window, { unmarked: [] }); });
  const hidden: string[] = [];
  const seen = new Set<string>();
  for (let stop = 0; stop < limit; stop++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const unmarked = (window as unknown as { unmarked: string[] }).unmarked;
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      const r = active.getBoundingClientRect();
      const name = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 50)}" at ${Math.round(r.left)},${Math.round(r.top)}`;
      const ring = (el: Element | null, depth: number): boolean => {
        if (!el || depth > 3) return false;
        const s = getComputedStyle(el);
        return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (el === active && s.boxShadow !== 'none') || ring(el.parentElement, depth + 1);
      };
      if (!ring(active, 0)) unmarked.push(name);
      const box = { left: Math.max(r.left, 0), right: Math.min(r.right, innerWidth), top: Math.max(r.top, 0), bottom: Math.min(r.bottom, innerHeight) };
      if (box.right <= box.left || box.bottom <= box.top) return { name, covered: 'outside the viewport' };
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position !== 'sticky' && s.position !== 'fixed') continue;
        if (el.contains(active) || s.visibility === 'hidden') continue;
        const paints = s.backgroundImage !== 'none' || s.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const o = el.getBoundingClientRect();
        if (paints && box.top >= o.top && box.bottom <= o.bottom && box.left >= o.left && box.right <= o.right) return { name, covered: el.className.toString().slice(0, 40) || el.tagName };
      }
      return { name, covered: null };
    });
    if (!result) { if (seen.size) break; continue; }
    if (seen.has(result.name)) break;
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
