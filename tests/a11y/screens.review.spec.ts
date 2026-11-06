import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { NEXT_WEEK } from './data';
import { composer, desktop, type MockApi, open, openNav, phone, test } from './support';
import { menuRows } from './telefonbok';

/**
 * Not a test: every surface and state for the UX review (docs/reviews/2026-11-05-ux-review.md). Run on demand with
 * `CLEW_SCREENS=1 … playwright test -c tests/a11y screens.review`. Images land in test-results/screens/review/, one JSON
 * per image in test-results/screens/review/metrics/ with what can be counted about the screen: tab stops, words, type sizes.
 */
const dir = 'test-results/screens/review';
const wide = { width: 1600, height: 1000 };
const tall = { width: 1280, height: 1900 };
const laptop = { width: 1024, height: 768 };
const tablet = { width: 768, height: 1024 };
const sizes = { '1280': desktop, '1600': wide, '375': phone, tall, '1024': laptop, '768': tablet } as const;
type Size = keyof typeof sizes;

/** What can be counted: tab stops in the whole page and in main, tab stops before the box, words, type sizes and colours in view, text cut off, words broken in two. */
const measure = (page: Page) => page.evaluate(() => {
  const visible = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const focusables = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(visible);
  const main = document.querySelector('main,[role="main"]');
  const nav = document.querySelector('nav,[role="navigation"]');
  const words = (e: Element | null) => (e as HTMLElement | null)?.innerText?.split(/\s+/).filter(Boolean).length ?? 0;
  const box = focusables.findIndex(e => e.getAttribute('role') === 'combobox' && /Vad vill du|Svara/.test(e.getAttribute('aria-label') ?? ''));
  const inView = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const sizesSeen = new Map<string, number>(), weights = new Set<string>(), colors = new Set<string>(), brokenWords: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const p = n.parentElement!; if (!visible(p)) continue;
    for (const word of n.textContent.matchAll(/[^\s-]+/g)) {
      const range = document.createRange();
      range.setStart(n, word.index); range.setEnd(n, word.index + word[0].length);
      if (new Set([...range.getClientRects()].map(r => Math.round(r.top))).size > 1) brokenWords.push(word[0]);
    }
    if (!inView(p.getBoundingClientRect())) continue;
    const s = getComputedStyle(p);
    sizesSeen.set(s.fontSize, (sizesSeen.get(s.fontSize) ?? 0) + 1); weights.add(s.fontWeight); colors.add(s.color);
  }
  const truncated = [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && visible(e)).map(e => (e as HTMLElement).innerText.slice(0, 50));
  return {
    tabStops: focusables.length,
    tabStopsInMain: focusables.filter(e => main?.contains(e)).length,
    tabStopsInNav: focusables.filter(e => nav?.contains(e)).length,
    tabStopsBeforeBox: box,
    buttonsInMain: main ? [...main.querySelectorAll('button')].filter(visible).length : 0,
    wordsInMain: words(main),
    wordsInNav: words(nav),
    typeSizes: Object.fromEntries([...sizesSeen].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))),
    typeWeights: [...weights],
    textColours: colors.size,
    scrollWidthOverflow: document.documentElement.scrollWidth - innerWidth,
    truncated,
    brokenWords,
    bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
  };
});

async function snap(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${dir}/${name}.png` });
  mkdirSync(`${dir}/metrics`, { recursive: true });
  writeFileSync(`${dir}/metrics/${name}.json`, JSON.stringify(await measure(page)));
}

type Setup = (page: Page, api: MockApi, size: Size) => Promise<void>;
const full = (api: MockApi) => { api.admin = true; api.menu = menuRows; api.modelChoices = 2; };

/** One screen, on the sizes named; `dark` adds a dark capture of the first size. */
function shot(name: string, setup: Setup, on: Size[] = ['1280', '375'], dark = false) {
  for (const size of on) test(`${name} ${size}`, async ({ page, api }) => {
    await page.setViewportSize(sizes[size]);
    await setup(page, api, size);
    await snap(page, `${name}-${size}`);
  });
  if (dark) test(`${name} dark`, async ({ page, api }) => {
    await page.addInitScript(() => localStorage.setItem('clew:color-mode', 'dark'));
    await page.setViewportSize(sizes[on[0]!]);
    await setup(page, api, on[0]!);
    await snap(page, `${name}-${on[0]}-dark`);
  });
}

test.describe('review', () => {
  test.skip(!process.env.CLEW_SCREENS, 'screenshots are taken on demand: CLEW_SCREENS=1');
  test.describe.configure({ mode: 'default' });
  test.setTimeout(45_000);

  // The landing.
  shot('01-landing', async (page, api) => { full(api); await open(page, '/'); }, ['1280', '1600', '375'], true);
  shot('02-landing-empty', async (page, api) => { api.threads = []; await open(page, '/'); });
  shot('03-landing-area', async page => {
    await open(page, '/');
    await page.getByRole('group', { name: 'Områden' }).getByRole('button', { name: 'Budget' }).click();
    await page.getByRole('group', { name: 'Budget', exact: true }).waitFor();
  });
  shot('04-landing-typing', async page => { await open(page, '/'); await composer(page).fill('attestera'); });
  shot('05-landing-at', async page => { await open(page, '/'); await composer(page).pressSequentially('@'); });
  shot('06-landing-loading', async (page, api) => { api.threadsDelay = 8000; await page.goto('/'); await page.getByRole('main').waitFor(); });
  shot('07-model-menu', async (page, api) => {
    api.modelChoices = 2; await open(page, '/');
    await page.getByRole('button', { name: /^Modell:/ }).click();
  }, ['1280']);

  // The overview and its piles.
  shot('10-overview', async (page, api) => { full(api); await open(page, '/'); }, ['1280', '1600', '375', 'tall'], true);
  shot('11-overview-card', async page => { await open(page, '/?card=fakturor'); }, ['1280', '375']);
  shot('12-overview-snooze', async page => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
  }, ['1280', '375']);
  shot('13-overview-more', async page => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Fler val' }).first().click();
  }, ['1280']);
  shot('14-area', async page => { await open(page, '/?area=personal'); });
  shot('15-waiting', async page => { await open(page, '/?tab=waiting'); });
  shot('16-snoozed', async page => { await open(page, '/?tab=snoozed'); });
  shot('17-handled', async page => { await open(page, '/?tab=done'); }, ['1280', '375', 'tall']);

  // The conversation.
  shot('20-conversation', async page => { await open(page, '/conversations/fraga'); }, ['1280', '375'], true);
  const ask = (text: string): Setup => async page => {
    await open(page, '/'); await composer(page).fill(text); await composer(page).press('Enter');
    await page.getByRole('button', { name: 'Stäng samtalet' }).first().waitFor();
    await page.waitForTimeout(700);
  };
  shot('21-answer-steps', ask('Vad gör jag om någon ramlat?'));
  shot('22-answer-card', ask('attestera fakturorna'));
  shot('23-answer-view', ask('telefonboken lärare'));
  shot('24-answer-pending', async (page, api) => {
    api.holdAnswer(); await open(page, '/'); await composer(page).fill('Vem är på plats?'); await composer(page).press('Enter');
  }, ['1280']);

  // The side panel.
  shot('30-panel-view', async page => { await open(page, '/?open=hr.whoIsOn&open-title=Bemanning'); });
  shot('31-panel-sources', async page => { await open(page, '/?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D'); });
  shot('32-panel-card', async page => { await open(page, '/?open-card=omtanke&open-action=pattern'); }, ['1280']);

  // The calendar.
  shot('40-calendar-week', async page => { await open(page, '/calendar'); }, ['1280', '1600', '375'], true);
  shot('41-calendar-proposals', async page => { await open(page, `/calendar?date=${NEXT_WEEK}`); });
  shot('42-calendar-day', async page => { await open(page, '/calendar?view=day'); }, ['1280']);
  shot('43-calendar-month', async page => { await open(page, '/calendar?view=month'); }, ['1280', '375']);
  shot('44-calendar-booking', async page => {
    await open(page, '/calendar'); await page.getByRole('button', { name: 'Ny bokning' }).click();
    await page.getByRole('dialog', { name: 'Ny bokning' }).waitFor();
  });
  shot('45-calendar-event', async page => {
    await open(page, '/calendar?view=day'); await page.locator('.clew-cal-column-event').first().click({ force: true });
    await page.getByRole('dialog').first().waitFor({ timeout: 8000 });
  }, ['1280']);

  // A tool.
  shot('50-tool', async (page, api) => { full(api); await open(page, '/tools/telefonbok.directory'); });
  shot('51-tool-results', async (page, api) => {
    full(api); await open(page, '/tools/telefonbok.directory');
    await page.getByRole('searchbox').first().fill('lärare').catch(() => undefined);
    await page.waitForTimeout(600);
  }, ['1280']);

  // Administration.
  const admin = (path: string): Setup => async (page, api) => { api.admin = true; await open(page, path); };
  shot('60-admin-connectors', admin('/admin/connectors'), ['1280', '375'], true);
  shot('61-admin-connector-add', async (page, api) => {
    api.admin = true; await open(page, '/admin/connectors');
    await page.getByRole('button', { name: 'Anslut system' }).click();
    await page.getByRole('dialog').first().waitFor();
  }, ['1280']);
  shot('62-admin-connector', admin('/admin/connectors/hello'));
  shot('63-admin-connector-bundled', admin('/admin/connectors/finance'), ['1280']);
  shot('64-admin-connector-capabilities', async (page, api) => {
    api.admin = true; await open(page, '/admin/connectors/finance');
    await page.getByRole('tab').nth(1).click();
  }, ['1280']);
  shot('65-admin-connector-audience', async (page, api) => {
    api.admin = true; await open(page, '/admin/connectors/finance');
    await page.getByRole('tab', { name: 'Vem ser det' }).click();
  }, ['1280']);
  shot('66-admin-models', admin('/admin/models'));
  shot('67-admin-provider-add', async (page, api) => {
    api.admin = true; await open(page, '/admin/models');
    await page.getByRole('button', { name: 'Lägg till leverantör' }).click();
    await page.getByRole('dialog').first().waitFor();
  }, ['1280']);
  shot('68-admin-model', admin('/admin/models/gpt-oss-20b'), ['1280']);
  shot('69-admin-provider', admin('/admin/models/providers/pilot'), ['1280']);

  // The shell.
  shot('70-account-menu', async (page, api) => {
    full(api); await open(page, '/'); await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
  }, ['1280']);
  shot('71-settings', async (page, api, size) => {
    full(api); await open(page, '/'); if (size === '375') await openNav(page);
    await page.getByRole('button', { name: 'Testa Testsson', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Inställningar' }).or(page.getByRole('button', { name: 'Inställningar', exact: true })).first().click();
    await page.getByRole('dialog').first().waitFor();
  }, ['1280', '375']);
  shot('72-reminders', async page => {
    await open(page, '/'); await page.getByRole('button', { name: /^Påminnelser/ }).first().click();
    await page.waitForTimeout(300);
  }, ['1280']);
  shot('73-mobile-nav', async (page, api) => {
    full(api); await open(page, '/'); await page.getByRole('button', { name: 'Öppna navigering' }).click();
  }, ['375']);
  shot('74-rail-open', async (page, api) => {
    full(api); await open(page, '/');
    await page.getByRole('button', { name: 'Områden', exact: true }).click();
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
  }, ['1280', 'tall']);
  shot('75-rail-search', async page => {
    await open(page, '/'); await page.getByRole('combobox', { name: 'Sök i samtal och kort' }).fill('fak');
  }, ['1280']);
  shot('76-signed-out', async (page, api) => { api.signedIn = false; await page.goto('/'); await page.waitForTimeout(800); });
  shot('77-not-found-card', async page => { await open(page, '/?card=finns-inte'); }, ['1280']);
  // Where the layouts fold: a small laptop or 125 % zoom, and a tablet.
  shot('80-fold-landing', async (page, api) => { full(api); await open(page, '/'); }, ['1024', '768']);
  shot('81-fold-overview', async (page, api) => { full(api); await open(page, '/'); }, ['1024', '768']);
  shot('82-fold-calendar', async page => { await open(page, '/calendar'); }, ['1024', '768']);
  shot('83-fold-admin', async (page, api) => { api.admin = true; await open(page, '/admin/connectors'); }, ['1024', '768']);
  shot('84-fold-conversation', ask('Vad gör jag om någon ramlat?'), ['1024']);

  // Dark, the screens not yet seen in it.
  shot('85-dark-overview-card', async page => { await open(page, '/'); }, ['tall'], true);

  // The first Tab stops, in order, as a keyboard person meets the landing.
  test('tab order', async ({ page, api }) => {
    full(api); await page.setViewportSize(desktop); await open(page, '/');
    const stops: string[] = [];
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => { const e = document.activeElement as HTMLElement; return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''} ${(e.getAttribute('aria-label') ?? e.innerText ?? '').replace(/\s+/g, ' ').slice(0, 50)}`; }));
    }
    writeFileSync(`${dir}/metrics/tab-order.txt`, stops.join('\n'));
  });

  // What axe cannot see: contrast of status dots and fills against their ground (1.4.11), sizes of targets (2.5.8), and the text under 12 px.
  const audit = (name: string, path: string, size: Size, setup?: (api: MockApi) => void) => test(`audit ${name}`, async ({ page, api }) => {
    setup?.(api); await page.setViewportSize(sizes[size]); await open(page, path);
    const report = await page.evaluate(() => {
      const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return { r: m[0]!, g: m[1]!, b: m[2]!, a: m[3] ?? 1 }; };
      const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const ground = (e: Element | null): string => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (parse(c).a > 0.95) return c; } return 'rgb(255,255,255)'; };
      const visible = (e: Element) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const text = (e: Element) => { const h = e as HTMLElement; return (h.getAttribute('aria-label') ?? h.innerText ?? '').replace(/\s+/g, ' ').slice(0, 40); };
      const dots = [...document.querySelectorAll('[class*="status-dot"]')].filter(visible).map(e => {
        const inner = [e, ...e.querySelectorAll('*')].map(x => getComputedStyle(x).backgroundColor).find(c => parse(c).a > 0.5) ?? 'rgb(0,0,0)';
        return { label: text(e), colour: inner, ground: ground(e.parentElement), ratio: +ratio(lum(parse(inner)), lum(parse(ground(e.parentElement)))).toFixed(2) };
      });
      const targets = [...document.querySelectorAll('a[href],button:not([disabled]),[role=button],input:not([type=hidden])')].filter(visible).map(e => { const r = e.getBoundingClientRect(); return { label: text(e), w: Math.round(r.width), h: Math.round(r.height) }; });
      const small = targets.filter(t => t.h < 44 || t.w < 44);
      const under24 = targets.filter(t => t.h < 24 || t.w < 24);
      const textRows = new Map<string, { size: string; colour: string; ground: string; ratio: number; sample: string; n: number }>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent?.trim(); if (!t) continue; const p = n.parentElement!; if (!visible(p)) continue;
        const s = getComputedStyle(p), g = ground(p), key = `${s.fontSize}|${s.color}|${g}`;
        const row = textRows.get(key) ?? { size: s.fontSize, colour: s.color, ground: g, ratio: +ratio(lum(parse(s.color)), lum(parse(g))).toFixed(2), sample: t.slice(0, 36), n: 0 };
        row.n++; textRows.set(key, row);
      }
      return { dots, targetsTotal: targets.length, under44: small.length, under24, smallestHeights: [...new Set(targets.map(t => t.h))].sort((a, b) => a - b).slice(0, 8), text: [...textRows.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 14) };
    });
    writeFileSync(`${dir}/metrics/audit-${name}.json`, JSON.stringify(report, null, 1));
  });
  audit('overview', '/', '1280', full);
  audit('overview-phone', '/', '375', full);
  audit('calendar', '/calendar', '1280');
  audit('calendar-phone', '/calendar', '375');
  audit('admin', '/admin/connectors', '1280', api => { api.admin = true; });
  audit('landing-phone', '/', '375', full);
});
