import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  openNav,
  phone,
  reflowProblems,
  test,
} from './support';
import { menuRow } from './phonebook';
import { NOW } from './data';

/**
 * The shell (D31, D88, D115): the shared header is the top bar on every page, with the bell and the person on its band
 * and Clew's own pages in the row under it. There is no rail (D115 item 3); on a phone the header's own "Meny" holds
 * the places and those pages.
 */
for (const viewport of [desktop, narrow])
  test(`the header's bell works by keyboard at ${viewport.width}px`, async ({ page, api: _ }) => {
    await page.setViewportSize(viewport);
    await open(page, '/');
    // The shared header (D88) is the shell's banner: the home link, the bell and the person, on a phone as the bar.
    const header = page.getByRole('banner');
    const bell = header.getByRole('button', { name: 'Påminnelser: 0', exact: true });
    await expect(bell).toBeVisible();
    const home = header.getByRole('link', { name: /Startsidan/ });
    await expect(home).toBeVisible();
    await expect(home.locator('button')).toHaveCount(0);
    await bell.focus();
    await page.keyboard.press('Enter');
    const reminders = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(reminders).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();
  });

for (const viewport of [desktop, narrow])
  test(`the person is a button in the header that opens the settings by keyboard at ${viewport.width}px`, async ({
    page,
    api,
  }) => {
    api.admin = true;
    await page.setViewportSize(viewport);
    await open(page, '/');
    const header = page.getByRole('banner');
    const account = header.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });
    await expect(account).toBeVisible();
    await expect(account).toHaveAttribute('aria-haspopup', 'dialog');
    // Clew's own pages are links alone (D115 item 3), the row under the band or the drawer behind "Meny": no account
    // row and no settings among them, and an administrator's way in is one of the links.
    const nav = await openNav(page);
    await expect(nav.getByRole('button', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Inställningar', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Administration', exact: true })).toHaveAttribute(
      'href',
      '/admin/connectors',
    );
    if (viewport === narrow) {
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
    }
    await account.focus();
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Testa Testsson', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Skönsmons skola', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
    await expect(settings.getByRole('button', { name: 'Logga ut', exact: true })).toBeVisible();
    expect((await reflowProblems(page)).filter(problem => !problem.startsWith('clipped: '))).toEqual([]);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(settings).not.toBeVisible();
    await expect(account).toBeFocused();
  });

test("the phone bar holds the heading, the bell, the person and Meny, which opens the places and Clew's pages by keyboard and hands the focus back", async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/calendar');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: /Startsidan/ })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
  // The places and the pages are behind "Meny" alone: the bar has no row of links, and the shell has no drawer of its own.
  await expect(header.getByRole('link', { name: 'Kalender', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Öppna navigering' })).toHaveCount(0);
  const menu = header.getByRole('button', { name: 'Meny', exact: true });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.focus();
  await page.keyboard.press('Enter');
  // A modal dialog named after the site, with the focus inside it.
  const drawer = page.getByRole('dialog', { name: 'Startsidan', exact: true });
  await expect(drawer).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  const places = drawer.getByRole('group', { name: 'Huvudmeny' });
  await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
  // Clew's own pages stand under Start, the current place, open and with the page marked.
  const pages = places.getByRole('group', { name: 'Start', exact: true });
  await expect(pages.getByRole('link')).toHaveText(['Mina aktiviteter', 'Min AI', 'Kalender', 'Personal']);
  await expect(pages.locator('[aria-current]')).toHaveText(['Kalender']);
  await expect(pages.getByRole('link', { name: 'Kalender', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await reflowProblems(page, drawer)).toEqual([]);
  await expectNoAxeViolations(page);
  // The place's own toggle says whether its pages show, and works by keyboard.
  const toggle = places.getByRole('button', { name: 'Komprimera Start', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(pages.getByRole('link', { name: 'Kalender', exact: true })).toBeHidden();
  const expand = places.getByRole('button', { name: 'Expandera Start', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pages.getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
  // Escape closes the drawer and the focus is back on Meny; so does the drawer's own close button.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole('button', { name: 'Stäng navigering', exact: true });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
});

test('a page chosen in Meny opens inside the app, and the drawer is closed on the new page', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/');
  // A mark a page load would lose: the pages are Clew's own, so they go through its router (D115 item 3).
  await page.evaluate(() => void ((window as unknown as { sameDocument: true }).sameDocument = true));
  const drawer = await openNav(page);
  const link = drawer.getByRole('link', { name: 'Kalender', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/calendar');
  await expect(page).toHaveTitle(/ · Kalender · Startsidan$/);
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: true }).sameDocument === true)).toBe(true);
  // The focus is not left on something that is gone: it is in the page, or on the document for the next Tab.
  expect(await page.evaluate(() => document.activeElement !== null && document.activeElement.isConnected)).toBe(true);
  expect(await reflowProblems(page)).toEqual([]);
});

for (const source of ['/calendar', '/activities?area=budget'])
  test(`a reminder opens and focuses its card from ${source}`, async ({ page, api }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, source);
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(list).toBeVisible();
    await expectNoAxeViolations(page);
    await list.getByRole('link', { name: /Ledighetsansökan/ }).click();
    await expect(page).toHaveURL('/?card=ledighet');
    await expect(list).not.toBeVisible();
    // The card opens in Hem's panel (D50, D53), over the page at this width, and the focus is in it.
    const panel = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(
      panel.getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Waiting on others and handled cards never count as outstanding reminders; the address still shows the card as it is now.
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, state: 'handled' } : t));
    await page.reload();
    await expect(
      page
        .getByRole('dialog', { name: 'Kort', exact: true })
        .getByRole('article', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeAttached();
  });

test('an empty bell says what will appear, leads to the overview and restores focus on Escape', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(narrow);
  await open(page, '/activities?area=personal');
  const bell = page.getByRole('banner').getByRole('button', { name: 'Påminnelser: 0', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
  expect(await reflowProblems(page, list)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(bell).toBeFocused();
  await bell.click();
  await list.getByRole('link', { name: 'Öppna Hem', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(list).not.toBeVisible();
});

test('the reminders hang from the bell at the desktop and the count is part of the button', async ({ page, api }) => {
  api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
  await page.setViewportSize(desktop);
  await open(page, '/calendar');
  const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
  await expect(bell).toContainText('1');
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.and(page.locator('.astryx-popover'))).toBeVisible();
  const trigger = (await bell.boundingBox())!;
  const surface = (await list.boundingBox())!;
  expect(surface.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
  expect(surface.height).toBeLessThan(desktop.height / 2);
  expect(surface.width).toBeLessThanOrEqual(380);
  await expect(list.getByRole('link', { name: /Ledighetsansökan/ })).toBeVisible();
  await page.mouse.click(desktop.width - 40, desktop.height - 40);
  await expect(list).not.toBeVisible();
});

test.describe('on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: narrow });
  test('the reminders rise as a sheet with the same content', async ({ page, api }) => {
    api.threads = api.threads.map(t => (t.id === 'ledighet' ? { ...t, remindedAt: NOW } : t));
    await open(page, '/calendar');
    const bell = page.getByRole('button', { name: 'Påminnelser: 1', exact: true });
    await bell.click();
    const sheet = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.and(page.locator('dialog'))).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, sheet)).toEqual([]);
    await sheet.getByRole('link', { name: /Ledighetsansökan/ }).click();
    await expect(page).toHaveURL('/?card=ledighet');
    await expect(sheet).not.toBeVisible();
    // On a phone the card rises in its own sheet (D71), and the focus is in it.
    const card = page.getByRole('dialog', { name: 'Kort: Ledighetsansökan från Johan Byström', exact: true });
    await expect(card).toBeVisible();
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
  });
});

test('a failed reminder read is explicit and can be retried', async ({ page, api: _ }) => {
  await page.route('**/api/threads', route => route.fulfill({ status: 503, json: { error: 'Tillfälligt fel' } }));
  await page.goto('/calendar');
  const bell = page.getByRole('button', { name: 'Påminnelser – kunde inte uppdateras', exact: true });
  await bell.click();
  const list = page.getByRole('dialog', { name: 'Påminnelser', exact: true });
  await expect(list.getByText('Tillfälligt fel', { exact: true })).toBeVisible();
  await page.unroute('**/api/threads');
  await list.getByRole('button', { name: 'Försök igen', exact: true }).click();
  await expect(list.getByText('Inga aktuella påminnelser')).toBeVisible();
});

test('a blocked browser preference stays usable without claiming it was saved', async ({ page, api: _ }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await open(page, '/');
  await page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
  await page.getByRole('radio', { name: 'Mörkt', exact: true }).check();
  await expect(page.getByText(/Webbläsaren tillåter inte att valet sparas/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mörkt', exact: true })).toBeChecked();
});

test('logout reports failure, then ends the session after a successful retry', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await open(page, '/');
  const account = page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });
  await account.click();
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect
    .poll(() => announcements(page))
    .toContainEqual(expect.stringContaining('Utloggningen kunde inte bekräftas. Försök igen.'));
  // The dialog closed with the attempt; the retry opens it again.
  await account.click();
  await page.unroute('**/api/auth/logout');
  await page.route('**/api/auth/logout', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('test');
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
  await expect(account).toHaveCount(0);
});

test('the person signs out from the phone bar', async ({ page, api }) => {
  await page.route('**/api/auth/logout', route => {
    api.signedIn = false;
    return route.fulfill({ json: { url: '/' } });
  });
  await page.setViewportSize(narrow);
  await open(page, '/');
  await page.getByRole('banner').getByRole('button', { name: 'Testa Testsson, inställningar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Logga ut', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Logga in', exact: true })).toBeVisible();
});

/**
 * The assistant on a page without a box of its own (D115 item 5): a floating "Fråga AI" in the lower corner that opens
 * the assistant in a modal panel over the page, with the box, the answer and the way on to Min AI. The page and its
 * address stay; Escape or the panel's close button gives the focus back to the button.
 */
test.describe('the floating Fråga AI', () => {
  for (const viewport of [desktop, narrow])
    test(`opens its panel by keyboard, answers in it and hands the focus back at ${viewport.width}px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/activities');
      const ask = page.getByRole('button', { name: 'Fråga AI', exact: true });
      await expect(ask).toBeInViewport();
      await expect(ask).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await ask.focus();
      await page.keyboard.press('Enter');
      const panel = page.getByRole('dialog', { name: 'Fråga AI', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Fråga AI' })).toBeVisible();
      await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await expect(panel.getByText('Vad vill du göra?', { exact: true })).toBeVisible();
      const box = panel.getByRole('combobox', { name: 'Vad vill du göra' });
      // The box says what it starts (its placeholder, drawn as text in the field).
      await expect(panel.getByText(/^Nytt samtal: skriv eller säg vad du vill göra/)).toBeVisible();
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page, panel)).toEqual([]);
      // A question is answered in the panel; the page under it and its address stay as they were.
      await box.fill('Vem är på plats?');
      await box.press('Enter');
      await expect(
        panel.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/activities$/);
      const onward = panel.getByRole('link', { name: 'Fortsätt i Min AI', exact: true });
      await expect(onward).toHaveAttribute('href', /^\/conversations\/[^/?]+$/);
      await expect(panel.getByRole('combobox', { name: 'Svara i samtalet' })).toBeVisible();
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page, panel)).toEqual([]);
      // Escape closes the panel and the focus is back on the button that opened it (2.4.3).
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(ask).toBeFocused();
      expect(api.asked).toHaveLength(1);
      // Opened again it shows the same conversation; its close button hands the focus back too.
      await page.keyboard.press('Enter');
      await expect(
        panel.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' }),
      ).toBeVisible();
      await panel.getByRole('button', { name: 'Stäng', exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(ask).toBeFocused();
    });

  test('is on the pages without a box, not on the start page or in Min AI, and on a tool page asks about the page', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    const ask = page.getByRole('button', { name: 'Fråga AI', exact: true });
    for (const path of ['/activities', '/calendar', '/staff', '/tools/phonebook.directory']) {
      await open(page, path);
      await expect(ask, path).toBeVisible();
    }
    // A tool page has no docked box any more (D115 item 5): the question about it is asked in the panel.
    await expect(composer(page)).toHaveCount(0);
    await ask.click();
    const panel = page.getByRole('dialog', { name: 'Fråga AI', exact: true });
    await expect(panel.getByText('Fråga om Telefonbok …', { exact: true })).toBeVisible();
    await expect(panel.getByText('Fråga om Telefonbok, eller om något annat.', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ask).toBeFocused();
    for (const path of ['/', '/conversations', '/conversations/fraga']) {
      await open(page, path);
      await expect(ask, path).toHaveCount(0);
    }
  });
});

/**
 * Min AI (D115 item 5): the conversations' full-window place. The banner is one narrow bar in the band's colours, the
 * way back to the start page, the mode's name and the person; the list of conversations is a column from 768 px and a
 * drawer from the start edge on a phone.
 */
test.describe('Min AI', () => {
  test('the bar holds the way back, the name and the person, and the list beside the page is a navigation with the open conversation marked', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/conversations');
    await expect(page).toHaveTitle('Min AI · Startsidan');
    const banner = page.getByRole('banner');
    const bar = banner.getByRole('navigation', { name: 'Min AI', exact: true });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Startsidan', exact: true })).toHaveAttribute('href', '/');
    // The mode's name is not a heading: the page's own title is the first heading under the bar.
    await expect(bar.getByText('Min AI', { exact: true })).toBeVisible();
    await expect(banner.getByRole('heading')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
    // No places, no row of Clew's pages and no bell on this page.
    await expect(banner.getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Huvudmeny' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Start', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('button', { name: /^Påminnelser/ })).toHaveCount(0);
    // With nothing open: one h1 that says what the place is for, the box under it.
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText([
      'Hej Testa! Vad vill du ha hjälp med?',
    ]);
    await expect(composer(page)).toBeVisible();
    const list = page.getByRole('main').getByRole('navigation', { name: 'Dina samtal', exact: true });
    await expect(list.getByRole('heading', { name: 'Dina samtal' })).toHaveAttribute('aria-level', '2');
    await expect(list.getByRole('button', { name: 'Nytt samtal', exact: true })).toBeVisible();
    const conversation = list
      .getByRole('list', { name: 'Samtal' })
      .getByRole('link', { name: /^Vem är på plats i dag\?/ });
    await expect(conversation).toHaveAttribute('href', '/conversations/fraga');
    await expect(conversation).toContainText('I dag');
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // A conversation opens from the list by keyboard: its question is the h1, and the list marks it as the open one.
    await conversation.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/fraga$/);
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText(['Vem är på plats i dag?']);
    await expect(list.locator('[aria-current="page"], [aria-current="true"], [aria-selected="true"]')).toContainText(
      'Vem är på plats i dag?',
    );
    await expect(page.getByRole('log')).toContainText('Tio personer är på plats.');
    await expect(composer(page)).toHaveAccessibleName('Svara i samtalet');
    await expectNoAxeViolations(page);
    // "Nytt samtal" leads back to the place with nothing open; the bar's link leads to the start page.
    await list.getByRole('button', { name: 'Nytt samtal', exact: true }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    await bar.getByRole('link', { name: 'Startsidan', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Huvudmeny' })).toBeVisible();
  });

  for (const viewport of [phone, narrow])
    test(`on a phone at ${viewport.width}px the list is a drawer from the start edge that takes and gives back the focus`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/conversations');
      // No column at this width: the list is behind its own button.
      await expect(page.getByRole('navigation', { name: 'Dina samtal' })).toHaveCount(0);
      const opener = page.getByRole('main').getByRole('button', { name: 'Dina samtal', exact: true });
      await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
      expect(await reflowProblems(page)).toEqual([]);
      await opener.focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog', { name: 'Dina samtal', exact: true });
      await expect(drawer).toBeVisible();
      await expect.poll(() => drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
      const list = drawer.getByRole('navigation', { name: 'Dina samtal', exact: true });
      await expect(list.getByRole('button', { name: 'Nytt samtal', exact: true })).toBeVisible();
      await expect(list.getByRole('link', { name: /^Vem är på plats i dag\?/ })).toHaveAttribute(
        'href',
        '/conversations/fraga',
      );
      // It opens from the start edge.
      expect((await drawer.boundingBox())!.x).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page, drawer)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(opener).toBeFocused();
      // A conversation chosen in the drawer opens, and the drawer closes; the conversation's own menu opens the list too.
      await opener.click();
      await drawer.getByRole('link', { name: /^Vem är på plats i dag\?/ }).click();
      await expect(page).toHaveURL(/\/conversations\/fraga$/);
      await expect(drawer).toBeHidden();
      const more = page.getByRole('button', { name: 'Fler val', exact: true });
      await more.click();
      await page.getByRole('menuitem', { name: 'Dina samtal', exact: true }).click();
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByRole('navigation', { name: 'Dina samtal' }).locator('[aria-current], [aria-selected="true"]'),
      ).toContainText('Vem är på plats i dag?');
      expect(await reflowProblems(page, drawer)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(more).toBeFocused();
    });
});
