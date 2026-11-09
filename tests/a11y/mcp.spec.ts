import { readFile } from 'node:fs/promises';
import type { McpResult } from '@clew/contracts';
import { test, expect, composer } from './support';
import AxeBuilder from '@axe-core/playwright';
import { createPulseService } from '../../fixtures/mcp-pulse/service.mjs';
import { createStatusFixture } from '../../fixtures/mcp-status/service.mjs';

const sources = new WeakMap<import('@playwright/test').Page, ReturnType<typeof createPulseService>>();

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
  sources.set(page, pulse);
  let pollActive = true;
  const readPoll = async () => {
    const result = (await pulse.request('tools/call', { name: 'get_pending_poll' })) as unknown as McpResult;
    if (result.structuredContent?.answered) pollActive = false;
    return result;
  };
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
      const result = await pulse.request('tools/call', input);
      if (!result.isError) await readPoll();
      return route.fulfill({ json: result });
    }
    if (path.endsWith('/example-pulse'))
      return route.fulfill({
        json: { service: services[0], html, result: await readPoll() },
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
        ].filter(delivery => delivery.id !== 'one' || pollActive),
      },
    });
  });
});
const updatesOn = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Från dina tjänster' });
const pollApp = (page: import('@playwright/test').Page) =>
  page.frameLocator('iframe[title="Medarbetarpuls, isolerad tjänst"]').frameLocator('iframe');

test('source cards open a drawer or phone sheet over Home, preserving the page and returning focus', async ({
  page,
}) => {
  await page.goto('/?tab=waiting');
  const updates = updatesOn(page);
  await expect(updates.getByRole('article')).toHaveCount(2);
  for (const size of [
    { width: 1280, height: 800 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(size);
    const open = updates.getByRole('link', { name: 'Öppna Medarbetarpuls' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?tab=waiting&open-service=example-pulse&open-delivery=one$/);
    const overlay = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
    await expect(overlay).toBeVisible();
    if (size.width === 320) await expect(overlay.locator('.astryx-bottom-sheet')).toHaveCount(1);
    else await expect(overlay).toHaveClass(/astryx-drawer/);
    await expect(pollApp(page).getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Från dina tjänster', includeHidden: true })).toHaveCount(1);
    await expect(overlay.getByRole('link', { name: /Driftkollen/ })).toHaveCount(0);
    await settled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      await pollApp(page)
        .locator('body')
        .evaluate(el => el.scrollWidth <= el.ownerDocument.documentElement.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/mcp-overlay-${size.width}.png`, fullPage: true });
    await overlay.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(overlay).not.toBeVisible();
    await expect(page.locator('iframe[title="Medarbetarpuls, isolerad tjänst"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?tab=waiting$/);
    await expect(open).toBeFocused();
  }
});

test('AI-off also gates direct overlay links without requesting provider content', async ({ page, api }) => {
  api.modelChoices = 0;
  let reads = 0;
  page.on('request', r => {
    if (r.url().includes('/api/chat-services')) reads++;
  });
  await page.goto('/chat/services/example-pulse?delivery=one');
  const overlay = page.getByRole('dialog', { name: 'Tjänst', exact: true });
  await expect(overlay.getByText('AI är avstängd', { exact: true })).toBeVisible();
  await expect(overlay.locator('iframe')).toHaveCount(0);
  expect(reads).toBe(0);
  await overlay.getByRole('button', { name: 'Stäng', exact: true }).click();
  await page.goto('/labs/mcp');
  await expect(page.getByText('AI är avstängd', { exact: true })).toBeVisible();
  expect(reads).toBe(0);
});

for (const width of [1280, 320]) {
  test(`provider confirmation stays above the overlay and sends only after approval (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    let writes = 0;
    page.on('request', r => {
      if (r.url().endsWith('/decisions')) writes++;
    });
    await page.goto('/');
    await updatesOn(page).getByRole('link', { name: 'Öppna Medarbetarpuls' }).click();
    const overlay = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
    const app = pollApp(page);
    await app.getByRole('radio', { name: '4, bra', exact: true }).check();
    await app.getByRole('button', { name: 'Skicka svar', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'Bekräfta hos tjänsten' });
    await expect(approval).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(approval).not.toBeVisible();
    await expect(overlay).toBeVisible();
    await expect(app.getByRole('status')).toHaveText('Svaret skickades inte.');
    expect(writes).toBe(0);
    await app.getByRole('button', { name: 'Skicka svar', exact: true }).click();
    await settled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await approval.getByRole('button', { name: 'Bekräfta och skicka' }).click();
    await expect(app.getByRole('status')).toHaveText('Tack! Ditt svar har tagits emot.');
    expect(writes).toBe(1);
    const background = page.getByRole('region', { name: 'Från dina tjänster', includeHidden: true });
    await expect(background.getByRole('link', { name: 'Öppna Medarbetarpuls', includeHidden: true })).toHaveCount(0);
    await expect(overlay).toBeVisible();
    await overlay.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(overlay).not.toBeVisible();
    await expect(updatesOn(page).getByRole('article')).toHaveCount(1);
    await expect(updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' })).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.reload();
    await expect(updatesOn(page).getByRole('article')).toHaveCount(1);
    // The original delivery link remains usable after its card has left attention.
    await page.goto('/?open-service=example-pulse&open-delivery=one');
    await expect(app.getByText('Du har redan besvarat den här enkäten.')).toBeVisible();
  });
}

test('earlier delivery and latest source stay in the same overlay; catalogue remains underneath', async ({ page }) => {
  await page.goto('/chat/services/example-status?delivery=two');
  const overlay = page.getByRole('dialog', { name: 'Driftkollen', exact: true });
  await expect(
    overlay.getByText('E-post har en driftstörning. Meddelanden kan bli försenade.', { exact: true }),
  ).toBeVisible();
  await expect(overlay.getByText('Det här är ett tidigare meddelande. Tjänsten har nyare uppgifter.')).toBeVisible();
  await overlay.getByRole('link', { name: 'Visa senaste från tjänsten' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/\?open-service=example-status$/);
  await expect(overlay.getByText('E-post fungerar normalt igen.', { exact: true })).toBeVisible();
  await settled(page);
  await overlay.press('Escape');
  await expect(overlay).not.toBeVisible();
  await updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' }).click();
  await expect(page.getByText('Interaktiv vy', { exact: true })).toBeVisible();
  await expect(page.getByText('Verktyg i chatten', { exact: true })).toBeVisible();
  const open = page
    .getByRole('article', { name: 'Driftkollen', exact: true })
    .getByRole('link', { name: 'Öppna Driftkollen' });
  await open.click();
  await expect(page).toHaveURL(/\/\?open-services=1&open-service=example-status$/);
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('E-post fungerar normalt igen.', { exact: true })).toBeVisible();
  await overlay.getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(overlay).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?open-services=1$/);
  await expect(open).toBeFocused();
});

test('Back closes a pending provider interaction without sending; Forward reopens the same card', async ({ page }) => {
  let writes = 0;
  page.on('request', r => {
    if (r.url().endsWith('/decisions')) writes++;
  });
  await page.goto('/');
  const open = updatesOn(page).getByRole('link', { name: 'Öppna Medarbetarpuls' });
  await open.click();
  const app = pollApp(page);
  await app.getByRole('radio', { name: '4, bra', exact: true }).check();
  await app.getByRole('button', { name: 'Skicka svar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bekräfta hos tjänsten' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(writes).toBe(0);
  await page.goForward();
  await expect(page).toHaveURL(/open-service=example-pulse&open-delivery=one$/);
  await expect(page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true })).toBeVisible();
  await expect(app.getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Bekräfta hos tjänsten' })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('opening a poll answered elsewhere refreshes Home immediately without closing its view', async ({ page }) => {
  await page.goto('/');
  await expect(updatesOn(page).getByRole('article')).toHaveCount(2);
  await sources
    .get(page)!
    .request('tools/call', { name: 'submit_poll', arguments: { pollId: 'pulse-2026-W46', score: 4 } });
  await updatesOn(page).getByRole('link', { name: 'Öppna Medarbetarpuls' }).click();
  const overlay = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
  await expect(pollApp(page).getByText('Du har redan besvarat den här enkäten.')).toBeVisible();
  const background = page.getByRole('region', { name: 'Från dina tjänster', includeHidden: true });
  await expect(background.getByRole('article', { includeHidden: true })).toHaveCount(1);
  await overlay.getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' })).toBeFocused();
});

for (const width of [1280, 320]) {
  test(`the service catalogue and its App drill in as overlays, preserving Home and its draft (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?tab=waiting');
    await composer(page).fill('Jag vill behålla mitt utkast');
    const all = updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' });
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/\?tab=waiting&open-services=1$/);
    await expect(page).toHaveTitle('Hem · Startsidan');
    const catalogue = page.getByRole('dialog', { name: 'Tjänster i samtalet', exact: true });
    await expect(catalogue).toBeVisible();
    if (width === 320) await expect(catalogue.locator('.astryx-bottom-sheet')).toHaveCount(1);
    else await expect(catalogue).toHaveClass(/astryx-drawer/);
    await expect(catalogue.getByText('Interaktiv vy', { exact: true })).toBeVisible();
    await settled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/mcp-catalogue-${width}.png`, fullPage: true });
    const open = catalogue
      .getByRole('article', { name: 'Medarbetarpuls', exact: true })
      .getByRole('link', { name: 'Öppna Medarbetarpuls' });
    await open.click();
    await expect(page).toHaveURL(/\/\?tab=waiting&open-services=1&open-service=example-pulse$/);
    const app = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
    await expect(pollApp(page).getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(2);
    if (width === 320) {
      await expect(app).toHaveAttribute('data-sheet-stack', 'top');
    }
    await settled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await app.press('Escape');
    await expect(app).not.toBeVisible();
    await expect(open).toBeFocused();
    await expect(page).toHaveURL(/\/\?tab=waiting&open-services=1$/);
    await catalogue.press('Escape');
    await expect(catalogue).not.toBeVisible();
    await expect(page).toHaveURL(/\/\?tab=waiting$/);
    await expect(all).toBeFocused();
    await expect(composer(page)).toHaveText('Jag vill behålla mitt utkast');
  });
}

test('catalogue history and reload retain the parent and old page links redirect into its overlay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/?tab=waiting');
  const all = updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' });
  await all.click();
  const catalogue = page.getByRole('dialog', { name: 'Tjänster i samtalet', exact: true });
  const open = catalogue
    .getByRole('article', { name: 'Medarbetarpuls', exact: true })
    .getByRole('link', { name: 'Öppna Medarbetarpuls' });
  await open.click();
  await expect(pollApp(page).getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
  await page.goBack();
  await expect(open).toBeFocused();
  await page.goBack();
  await expect(all).toBeFocused();
  await page.goForward();
  await expect(catalogue).toBeVisible();
  await page.goForward();
  await expect(pollApp(page).getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
  await page.reload();
  const app = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
  await expect(pollApp(page).getByRole('radio', { name: '4, bra', exact: true })).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(2);
  await app.getByRole('button', { name: 'Stäng', exact: true }).click();
  await expect(catalogue).toBeVisible();
  await expect(page).toHaveURL(/\/\?tab=waiting&open-services=1$/);
  for (const oldPath of ['/chat/services', '/labs/mcp']) {
    await page.goto(oldPath);
    await expect(page).toHaveURL(/\/\?open-services=1$/);
    await expect(catalogue).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hej Testa', includeHidden: true })).toHaveCount(1);
  }
});

for (const width of [1280, 320]) {
  test(`catalogue delivery completion keeps confirmation above the App and returns focus inside the parent (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const all = updatesOn(page).getByRole('link', { name: 'Alla tjänster (2)' });
    await all.click();
    const catalogue = page.getByRole('dialog', { name: 'Tjänster i samtalet', exact: true });
    const invitation = catalogue.getByRole('article', {
      name: 'Kort från Medarbetarpuls: Din veckopuls är redo att besvaras.',
      exact: true,
    });
    await invitation.getByRole('link', { name: 'Öppna Medarbetarpuls' }).click();
    const app = page.getByRole('dialog', { name: 'Medarbetarpuls', exact: true });
    await pollApp(page).getByRole('radio', { name: '4, bra', exact: true }).check();
    await pollApp(page).getByRole('button', { name: 'Skicka svar', exact: true }).click();
    const approval = page.getByRole('dialog', { name: 'Bekräfta hos tjänsten' });
    await expect(approval).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(3);
    await settled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await approval.getByRole('button', { name: 'Bekräfta och skicka' }).click();
    await expect(pollApp(page).getByRole('status')).toHaveText('Tack! Ditt svar har tagits emot.');
    await expect(
      page.getByRole('article', {
        name: 'Kort från Medarbetarpuls: Din veckopuls är redo att besvaras.',
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    await app.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(catalogue).toBeVisible();
    await expect.poll(() => catalogue.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(catalogue.getByRole('article', { name: 'Medarbetarpuls', exact: true })).toBeVisible();
    await catalogue.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(all).toBeFocused();
  });
}
