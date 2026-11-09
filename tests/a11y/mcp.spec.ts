import { readFile } from 'node:fs/promises';
import { test, expect } from './support';
import AxeBuilder from '@axe-core/playwright';
import { createPulseService } from '../../fixtures/mcp-pulse/service.mjs';
import { createStatusFixture } from '../../fixtures/mcp-status/service.mjs';

const settled = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    );
  });
test.beforeEach(async ({ page, api }) => {
  void api;
  const html = await readFile(new URL('../../fixtures/mcp-pulse/poll.html', import.meta.url), 'utf8');
  const pulse = createPulseService(html),
    status = createStatusFixture();
  status.setDown(true);
  const outage = await status.request('tools/call', { name: 'get_service_status' });
  status.setDown(false);
  const services = [
    {
      id: 'example-pulse',
      title: 'Medarbetarpuls',
      tools: (await pulse.request('tools/list')).tools,
      intervalSeconds: 604800,
    },
    {
      id: 'example-status',
      title: 'Driftkollen',
      tools: (await status.request('tools/list')).tools,
      intervalSeconds: 900,
    },
  ];
  await page.route('**/api/chat-services**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/decisions')) {
      const input = route.request().postDataJSON();
      return route.fulfill({ json: await pulse.request('tools/call', input) });
    }
    if (path.endsWith('/example-pulse'))
      return route.fulfill({
        json: { service: services[0], html, result: await pulse.request('tools/call', { name: 'get_pending_poll' }) },
      });
    if (path.endsWith('/example-status'))
      return route.fulfill({
        json: {
          service: services[1],
          result:
            new URL(route.request().url()).searchParams.get('delivery') === 'two'
              ? outage
              : await status.request('tools/call', { name: 'get_service_status' }),
          isCurrent: !new URL(route.request().url()).searchParams.has('delivery'),
        },
      });
    return route.fulfill({
      json: {
        services,
        deliveries: [
          {
            id: 'one',
            connectionId: 'example-pulse',
            title: 'Medarbetarpuls',
            text: 'Din veckopuls är redo att besvaras.',
            createdAt: '2026-11-08T10:00:00Z',
          },
          {
            id: 'two',
            connectionId: 'example-status',
            title: 'Driftkollen',
            text: outage.content[0].text,
            createdAt: '2026-11-08T10:01:00Z',
          },
        ],
      },
    });
  });
});
test('home shows separate source cards; opening one excludes other services and messages', async ({ page }) => {
  await page.goto('/');
  const updates = page.getByRole('region', { name: 'Från dina tjänster' });
  await expect(updates.getByRole('article')).toHaveCount(2);
  await expect(updates.getByRole('heading', { name: 'Din veckopuls är redo att besvaras.' })).toBeVisible();
  await settled(page);
  await updates.scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/mcp-home-cards-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await settled(page);
  await updates.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/mcp-home-cards-mobile.png', fullPage: true });
  await updates.getByRole('link', { name: 'Öppna Medarbetarpuls' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/chat\/services\/example-pulse\?delivery=one$/);
  await expect(page.getByRole('heading', { name: 'Medarbetarpuls', exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: /Driftkollen/ })).toHaveCount(0);
  await expect(page.getByText('Meddelanden från dina tjänster')).toHaveCount(0);
  await page.getByRole('link', { name: 'Till Hem' }).click();
  await updates.getByRole('link', { name: 'Alla tjänster (2)' }).click();
  await expect(page.getByText('Interaktiv vy', { exact: true })).toBeVisible();
  await expect(page.getByText('Verktyg i chatten', { exact: true })).toBeVisible();
});
test('AI-off hides services and does not request the source', async ({ page, api }) => {
  api.modelChoices = 0;
  let reads = 0;
  page.on('request', r => {
    if (r.url().includes('/api/chat-services')) reads++;
  });
  await page.goto('/labs/mcp');
  await expect(page.getByText('AI är avstängd', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Öppna Medarbetarpuls' })).toHaveCount(0);
  expect(reads).toBe(0);
});
test('provider App crosses the bridge only after human confirmation; cancel sends nothing', async ({ page }) => {
  let writes = 0;
  page.on('request', r => {
    if (r.url().endsWith('/decisions')) writes++;
  });
  await page.goto('/chat/services/example-pulse');
  const app = page.frameLocator('iframe[title="Medarbetarpuls, isolerad tjänst"]').frameLocator('iframe');
  await app.getByRole('radio', { name: '4, bra', exact: true }).check();
  await app.getByRole('button', { name: 'Skicka svar', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Bekräfta hos tjänsten' });
  await approval.getByRole('button', { name: 'Avbryt' }).click();
  await expect(app.getByRole('status')).toHaveText('Svaret skickades inte.');
  expect(writes).toBe(0);
  await app.getByRole('button', { name: 'Skicka svar', exact: true }).click();
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await approval.getByRole('button', { name: 'Bekräfta och skicka' }).click();
  await expect(app.getByRole('status')).toHaveText('Tack! Ditt svar har tagits emot.');
  expect(writes).toBe(1);
});
test('tool-only result, keyboard navigation and 320px reflow', async ({ page }) => {
  await page.goto('/chat/services/example-status?delivery=two');
  await expect(
    page.getByText('E-post har en driftstörning. Meddelanden kan bli försenade.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Det här är ett tidigare meddelande. Tjänsten har nyare uppgifter.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Medarbetarpuls/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Visa senaste från tjänsten' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('E-post fungerar normalt igen.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Till Hem' }).click();
  await page
    .getByRole('region', { name: 'Från dina tjänster' })
    .getByRole('link', { name: 'Öppna Medarbetarpuls' })
    .click();
  await expect(page.locator('iframe[title="Medarbetarpuls, isolerad tjänst"]')).toBeVisible();
  await settled(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/mcp-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/mcp-mobile.png', fullPage: true });
});
