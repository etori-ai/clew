import type { Locator, Page } from '@playwright/test';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  scrollPage,
  short,
  test,
} from './support';
import {
  ASKED_MANAGER,
  CERTIFICATE_TITLE,
  NOTICE_REASON,
  NOTICE_TEXT,
  NOW,
  asNotice,
  expiredCertificate,
} from './data';

/**
 * A work item as a page (D126 rule 1, board Ärende, `/items/<threadId>`, the `work-item-detail` template): reached by
 * its name in every row and by its title in Att göra's reading pane, with `from` as the way back. The page is the
 * header (the way back with the source, the title with when it is due, the buttons or the status notice directly under
 * it), the read in the column as named sections in one order (the rows, which are also the documents where each has
 * one, Varför ser jag detta?, Händelser folded; D126 item 13) and the facts under "Uppgifter" in the end panel; at
 * 1024 px and below the facts are the read's first section.
 */
const wide = { width: 1440, height: 900 };
const tablet = { width: 1024, height: 768 };
const INVOICES = 'Attestera 3 fakturor, 48 200 kr';

/** The headings' levels as assistive technology gets them, in document order. */
const outline = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .filter(h => (h as HTMLElement).checkVisibility())
      .map(h => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1))),
  );

test.describe('the work item as a page', () => {
  test.use({ viewport: wide });

  test('the title leads from the reading pane to the page, which opens on its heading, keeps one outline and leads back to the pane', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=fakturor');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    // The name is the way in (2026-11-13): the title is the link, and there is no "Öppna som sida" beside it.
    const asPage = pane.getByRole('heading', { name: INVOICES }).getByRole('link', { name: INVOICES });
    await expect(pane.getByRole('link', { name: 'Öppna som sida' })).toHaveCount(0);
    await expect(asPage).toHaveAttribute('href', '/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    await asPage.click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    const title = page.getByRole('heading', { level: 1, name: INVOICES });
    await expect(title).toBeFocused();
    await expect(page).toHaveTitle(`${INVOICES} · Startsidan`);
    // The rail says where the page belongs: Att göra.
    const rail = page.getByRole('navigation', { name: 'Mina sidor', exact: true });
    await expect(rail.getByRole('link', { name: /^Att göra/ })).toHaveAttribute('aria-current', 'page');
    // One outline: the title, then the main column's sections and the rail's, each one level under it.
    const levels = await outline(page);
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    // The sections are the outline's second level, drawn at the size the board gives them (board Ärende): the level a
    // screen reader is told is `aria-level` where the drawn element is a smaller heading.
    // Varför ser jag detta? is folded and no heading (the product owner, 2026-11-16): a region with a button that says so.
    await expect(
      page.getByRole('main').getByRole('region', { name: 'Varför ser jag detta?' }).getByRole('button'),
    ).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Rader']) {
      const section = page.getByRole('main').getByRole('heading', { name, exact: true });
      await expect(section).toBeVisible();
      expect(await section.evaluate(h => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1))), name).toBe(2);
    }
    // A plain to-do has no notice and no state among its facts (D126 item 13): its title and its buttons say what is
    // expected. When it is due is a badge beside the title (board Ärende).
    await expect(page.getByText('Svara i dag', { exact: true })).toBeVisible();
    // Händelser is folded: a button that says it is closed, reached by Tab, opened by Enter, in a region of its name.
    const folded = page.getByRole('main').getByRole('region', { name: 'Händelser' });
    const unfold = folded.getByRole('button', { name: /^Händelser/ });
    await expect(unfold).toHaveAttribute('aria-expanded', 'false');
    await unfold.focus();
    await page.keyboard.press('Enter');
    await expect(unfold).toHaveAttribute('aria-expanded', 'true');
    // The rows are a checklist with how many are chosen, the action's label counting them.
    await expect(page.getByText('2 av 3 valda', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Energibolaget AB/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    // Händelser from the item's audit rows: Clew created it, with why.
    const events = page.getByRole('list', { name: 'Händelser, de senaste först' });
    await expect(events).toContainText('Clew');
    await expect(events).toContainText('skapade ärendet: Fakturorna förfaller i veckan');
    // The facts under Uppgifter in the end panel (board Ärende).
    const details = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Uppgifter$/ })).toBeVisible();
    for (const term of ['Källa', 'Svara senast', 'Kom']) await expect(details).toContainText(term);
    await expect(details).not.toContainText('Status');
    // The way out to the source is under ⋯, marked as leaving Clew (D111 rule 8).
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(
      page.getByRole('menuitem', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
    // From the title the keyboard reaches "Fråga AI" at the end of the title's line (D138, amended 2026-11-20) and then
    // the decision: the buttons stand directly under the title, and the item's own row has no button to ask.
    await expect(page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await title.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Fråga AI' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeFocused();
    // The trail leads back to the pane it was opened from.
    await page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(pane.locator('#card-fakturor')).toBeVisible();
  });

  test('opened from another page, its way back is that page; an address from before is the same page; with no way back it is Att göra', async ({
    page,
    api: _,
  }) => {
    // An address from before D126 that held the item beside Personal leads to its page, Personal as the way back.
    await open(page, '/staff?card=omtanke');
    await expect(page).toHaveURL('/items/omtanke?from=%2Fstaff');
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('href', '/staff');
    await open(page, '/items/omtanke');
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra', exact: true })).toHaveAttribute(
      'href',
      '/todo',
    );
    // An address from before D112 leads to the same page.
    await page.goto('/cards/omtanke');
    await expect(page).toHaveURL('/items/omtanke');
    await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
  });

  test('a calendar proposal opened from Hem is its page, and its title there leads nowhere further', async ({
    page,
    api,
  }) => {
    const proposal = api.threads.find(t => t.proposals.length > 0)!;
    await open(page, `/?card=${proposal.id}`);
    await expect(page).toHaveURL(`/items/${proposal.id}?from=%2F`);
    await expect(page.getByRole('heading', { level: 1, name: proposal.title })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 }).getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('a single receipt row on an item with no input rows shows the source case number', async ({ page, api }) => {
    const item = api.threads.find(t => t.id === 'attest')!;
    item.items = [];
    item.receipt = {
      at: NOW,
      headline: 'Felanmälan är skickad',
      undoCapability: null,
      undoUntil: null,
      rows: [
        { ref: 'pob:123', label: 'Felanmälan', outcome: 'done', detail: 'Ärende 123 är skapat hos IT-supporten.' },
      ],
    };
    await open(page, '/items/attest');
    const rows = page.getByRole('list', { name: 'Kvitto, rad för rad' });
    await expect(rows.getByRole('listitem')).toHaveCount(1);
    await expect(rows).toContainText('Ärende 123 är skapat hos IT-supporten.');
    await expectNoAxeViolations(page);
  });

  test('a decided item shows its receipt row by row, and its Händelser read the decision back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/attest');
    await expect(page.getByRole('heading', { level: 1, name: 'Attesterade fakturor' })).toBeVisible();
    const receipt = page.getByRole('list', { name: 'Kvitto, rad för rad' });
    await expect(receipt.getByRole('listitem')).toHaveCount(2);
    // The row in doubt first, with its state in the vocabulary's word, and the notice under the title says which and why.
    await expect(receipt.getByRole('listitem').first()).toContainText('Obekräftat');
    await expect(page.getByRole('main')).toContainText(
      '2 fakturor attesterade, men Ekonomisystemet gav inget säkert besked',
    );
    // A row the source did not confirm leaves no way back to undo: Ångra waits for the source's answer.
    await expect(page.getByRole('button', { name: /^Ångra/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Händelser/ }).click();
    await expect(page.getByRole('list', { name: 'Händelser, de senaste först' })).toContainText(
      'fick inget säkert besked från Ekonomisystemet',
    );
    await expectNoAxeViolations(page);
  });

  test('a notice as a page: its text first in the column, the way to the whole of it after the text and in the rail, its receipt in the header, and the text still there after it', async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t => (t.id === 'rutin' ? asNotice(t) : t));
    await open(page, '/items/rutin');
    await expect(page.getByRole('heading', { level: 1, name: 'Ny rutin för läkemedelshantering' })).toBeFocused();
    const main = page.getByRole('main');
    const ack = main.getByRole('button', { name: 'Jag har läst' });
    await expect(ack).toBeVisible();
    // The text first in the column, under no heading of its own; then Varför ser jag detta? as the provenance line.
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    const first = main.getByText(NOTICE_TEXT[0]!, { exact: true });
    const why = main.getByRole('region', { name: 'Varför ser jag detta?' });
    expect(await y(first)).toBeGreaterThan(await y(ack));
    expect(await y(why)).toBeGreaterThan(await y(main.getByText(NOTICE_TEXT.at(-1)!, { exact: true })));
    await why.getByRole('button', { name: 'Varför ser jag detta?' }).click();
    await expect(why).toContainText(NOTICE_REASON);
    await expect(why).not.toContainText(NOTICE_TEXT[0]!);
    await expect(page.getByRole('heading', { level: 2, name: 'Rader' })).toHaveCount(0);
    // The way to the whole of it after the text, marked as leaving Clew; not among the header's buttons.
    const out = /^Läs hela nyheten\s*\(öppnas i ny flik\)$/;
    await expect(page.getByRole('button', { name: out })).toHaveCount(1);
    expect(await y(main.getByRole('button', { name: out }).first())).toBeGreaterThan(await y(first));
    // One outline: the title, then the column's sections and the rail's, each one level under it.
    const levels = await outline(page);
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    await expectNoAxeViolations(page);
    // The receipt: the source's answer on the item, and the text still there to read again.
    await ack.focus();
    await page.keyboard.press('Enter');
    // The notice under the title says what came of it; the text and why it came stay (board StatusPanel).
    await expect(main.getByText('Läskvittot är registrerat', { exact: true })).toBeVisible();
    await expect(first).toBeVisible();
    await expect(why).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('an item reminded today that has no day says so on its row, and no badge says it again', async ({
    page,
    api,
  }) => {
    const card = api.threads.find(t => t.id === 'ledighet')!;
    card.deadline = null;
    card.remindedAt = NOW;
    // The row: why it is here, and in its Status column what the state concerns, the reminder; under Behöver dig the
    // state's word is the tab's, said by the dot's name.
    await open(page, '/todo');
    const row = page.getByRole('main').locator('#work-ledighet');
    await expect(row).toContainText('Ansökan väntar på beslut');
    await expect(row).toContainText('påminnelse');
    await expect(row.getByRole('img', { name: 'Behöver dig, påminnelse' })).toBeVisible();
    // The page: a plain to-do, so no notice, and no badge that says the word beside the title.
    await open(page, '/items/ledighet');
    await expect(page.getByRole('heading', { level: 1, name: card.title })).toBeVisible();
    await expect(page.locator('.astryx-badge').filter({ hasText: 'Påminnelse' })).toHaveCount(0);
  });

  test('an item that is not the person’s says so as the page', async ({ page, api: _ }) => {
    await open(page, '/items/okand');
    await expect(page.getByRole('heading', { level: 1, name: 'Ärendet finns inte' })).toBeVisible();
    await expect(page).toHaveTitle('Ärendet finns inte · Startsidan');
    await expectNoAxeViolations(page);
  });

  test('Händelser that cannot be read say so, with Försök igen, and the rest of the item stands', async ({
    page,
    api,
  }) => {
    api.itemEventsFail = true;
    await open(page, '/items/omtanke');
    const events = page.getByRole('region', { name: 'Händelser' });
    await events.getByRole('button', { name: /^Händelser/ }).click();
    await expect(events.getByText('Källan svarade inte.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    api.itemEventsFail = false;
    await events.getByRole('button', { name: 'Försök igen' }).click();
    await expect(events.getByRole('list', { name: 'Händelser, de senaste först' })).toContainText('skapade ärendet');
  });
});

test.describe('the work item page where the end panel does not fit', () => {
  test.use({ viewport: tablet });

  test('the facts stand above the read, and the buttons under the title', async ({ page, api: _ }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('complementary', { name: 'Uppgifter' })).toHaveCount(0);
    const main = page.getByRole('main');
    for (const term of ['Källa', 'Svara senast', 'Kom']) await expect(main).toContainText(term);
    const y = async (l: Locator) => (await l.boundingBox())!.y;
    expect(await y(main.getByRole('heading', { name: 'Uppgifter' }))).toBeLessThan(
      await y(main.getByRole('region', { name: 'Varför ser jag detta?' })),
    );
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the work item page on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the buttons stand under the title, the rest is under Fler åtgärder, and the facts above the read', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/fakturor');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeFocused();
    const step = page.getByRole('button', { name: 'Attestera 2 valda' });
    await expect(step).toBeInViewport();
    await page.getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Uppgifter' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

/**
 * A work item's page scrolls as one (D130 item 8 as amended 2026-11-21): the way back, the title and the decisions
 * scroll away under the shell's header with the read and the facts, so the whole window is the item's. Nothing on the
 * page sticks or is pinned: it has no tabs, and the frame's one sticky is a tab row's.
 */
test.describe('a long work item’s page scrolls as one', () => {
  for (const [name, viewport] of [
    ['1280 px', { width: 1280, height: 640 }],
    ['a phone', { width: 390, height: 700 }],
  ] as const)
    test(`at ${name} the title scrolls away with the read and the facts, and nothing but the shell stays`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/items/fakturor');
      const title = page.getByRole('heading', { level: 1, name: INVOICES });
      await expect(title).toBeVisible();
      const start = await scrollPage(page, 0);
      expect(start.room).toBeGreaterThan(100);
      const at = await scrollPage(page, start.room);
      expect(at.scrolled).toBe(start.room);
      // The title has gone over the top edge, and the foot of the read is in the window.
      const gone = (await title.boundingBox())!;
      expect(gone.y + gone.height).toBeLessThanOrEqual(at.top + 1);
      await expect(page.getByRole('banner')).toBeInViewport();
      // Nothing in the page sticks, and no region inside it scrolls on its own.
      const held = await page.evaluate(() => {
        const main = document.querySelector('main, [role="main"]')!;
        return [...main.querySelectorAll<HTMLElement>('*')]
          .filter(el => {
            const s = getComputedStyle(el);
            return (
              s.position === 'sticky' ||
              ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1)
            );
          })
          .map(el => el.className.toString().slice(0, 60) || el.tagName);
      });
      expect(held).toEqual([]);
      await expectNoAxeViolations(page);
    });
});

test.describe('the work item page at 320 px and on a short screen', () => {
  for (const [name, viewport] of [
    ['320 px', narrow],
    ['a short screen', short],
  ] as const)
    test(`reflows without sideways scrolling at ${name}`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/items/fakturor');
      await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });

  test('on a desktop the page of an item reviewed one row at a time is the review: its rows are the steps, a step shows its document on the same page, and Back leaves the page for the link that opened it', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    const card = api.threads.find(t => t.id === 'fakturor')!;
    card.actions = card.actions.map(a =>
      a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
    );
    await open(page, '/todo?item=fakturor');
    const name = page
      .getByRole('complementary', { name: 'Valt ärende' })
      .getByRole('heading', { name: INVOICES })
      .getByRole('link', { name: INVOICES });
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
    // The item has one page (D142): the rows are its steps, there is no second list of them or of their documents
    // (D126 item 13), and nothing on it leads to a review elsewhere.
    const main = page.getByRole('main');
    const steps = main.getByRole('list', { name: 'Rader', exact: true });
    await expect(steps).toHaveCount(1);
    await expect(main.getByRole('region', { name: 'Dokument' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /^Öppna underlaget för/ })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /^Granska 3|^Visa granskning/ })).toHaveCount(0);
    const row = steps.getByRole('button', { name: /Skolmaterial Norrland AB · 18 300 kr/ });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor&step=2');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Skolmaterial Norrland AB · 18 300 kr' })).toBeVisible();
    await expect(main.getByRole('img', { name: /Skolmaterial Norrland AB/ })).toBeVisible();
    await expectNoAxeViolations(page);
    // A step is rewritten in place: Back leaves the item's page, and the link that opened it has the focus again.
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(name).toBeFocused();
  });
});

/**
 * A work item with nothing to decide (every action it offers is a read): the notice under the title says what holds and
 * how the item ends in the source's words, no button is filled, and the two ways out stand beside the read instead of
 * under ⋯. Nothing on it says an answer is late: the badge by the title is the source's reason and its day is "Sista dag".
 */
test.describe('a work item with nothing to decide', () => {
  const HOLDS = 'Intyget gäller inte längre';
  const ENDS =
    'Prata med din chef om att förnya det. Ärendet avslutas av sig självt när ett giltigt intyg är registrerat.';
  const controls = (scope: Locator) => ({
    read: scope.getByRole('link', { name: 'Visa mina kompetenser' }),
    later: scope.getByRole('button', { name: 'Inte nu' }),
    dismiss: scope.getByRole('button', { name: 'Avfärda' }),
  });

  test('its page says what holds and how it ends, with the read and the two ways out reached by Tab in that order', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(wide);
    api.threads.push(expiredCertificate());
    await open(page, '/items/intyg');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: CERTIFICATE_TITLE })).toBeFocused();
    // The notice: the summary's first sentence as its title, the rest under it.
    await expect(main.getByText(HOLDS, { exact: true })).toBeVisible();
    await expect(main.getByText(ENDS, { exact: true })).toBeVisible();
    // The badge by the title is the source's reason, and no fact asks for an answer.
    await expect(main.locator('.astryx-badge').filter({ hasText: 'Har gått ut' })).toBeVisible();
    await expect(main.getByText('Försenad', { exact: true })).toHaveCount(0);
    await expect(main.getByText('försenad', { exact: true })).toHaveCount(0);
    await expect(main.getByText('Svara senast', { exact: true })).toHaveCount(0);
    const details = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(details).toContainText('Sista dag');
    await expect(details).toContainText('8 oktober');
    // The read is a link to its own page; Inte nu and Avfärda stand beside it, and nothing is left for ⋯.
    const { read, later, dismiss } = controls(main);
    await expect(read).toHaveAttribute('href', '/tools/competence.holdings?from=%2Fitems%2Fintyg');
    await expect(main.getByRole('button', { name: 'Fler åtgärder' })).toHaveCount(0);
    await read.focus();
    await page.keyboard.press('Tab');
    await expect(later).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dismiss).toBeFocused();
    // The summary is said once: Varför ser jag detta? holds the reason and where the item came from.
    const why = main.getByRole('region', { name: 'Varför ser jag detta?' });
    await why.getByRole('button').click();
    await expect(why).toContainText('Har gått ut. Ärendet kom från Personalsystemet');
    await expect(why).not.toContainText('Prata med din chef');
    await expectNoAxeViolations(page);
    // Inte nu is the time picker it has always been (D49), opened from the keyboard.
    await later.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: /Skriv själv/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(later).toBeFocused();
    // Avfärda behaves as it does from ⋯: the item leaves for Att göra, and the toast offers Ångra.
    await dismiss.focus();
    await page.keyboard.press('Enter');
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText(/Avfärdad som inte aktuellt/)).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(page).toHaveURL('/todo');
    await expectNoAxeViolations(page);
  });

  test('Att göra’s reading pane says the same, with the same three controls', async ({ page, api }) => {
    await page.setViewportSize(wide);
    api.threads.push(expiredCertificate());
    await open(page, '/todo?item=intyg');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(pane.getByText(HOLDS, { exact: true })).toBeVisible();
    await expect(pane.getByText(ENDS, { exact: true })).toBeVisible();
    const { read, later, dismiss } = controls(pane);
    await expect(read).toBeVisible();
    await expect(later).toBeVisible();
    await expect(dismiss).toBeVisible();
    await expect(pane.getByText('Svara senast', { exact: true })).toHaveCount(0);
    await expect(pane).toContainText('Sista dag');
    await expectNoAxeViolations(page);
  });

  test('at 320 px the notice and the three controls reflow without sideways scrolling', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    api.threads.push(expiredCertificate());
    await open(page, '/items/intyg');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: CERTIFICATE_TITLE })).toBeVisible();
    await expect(main.getByText(HOLDS, { exact: true })).toBeVisible();
    const { read, later, dismiss } = controls(main);
    for (const control of [read, later, dismiss]) await expect(control).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });

  test('where its source offers it, Jag har bett min chef is the one filled button; pressed, the item waits on the manager, with Påminn mig and the way back', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(wide);
    api.threads.push(expiredCertificate({ handOn: ASKED_MANAGER }));
    await open(page, '/items/intyg');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: CERTIFICATE_TITLE })).toBeFocused();
    await expect(main.getByText(HOLDS, { exact: true })).toBeVisible();
    // The person's statement first, the read beside it, and the two ways out under ⋯ again (board Intyg, variant c).
    const asked = main.getByRole('button', { name: 'Jag har bett min chef' });
    const { read, later, dismiss } = controls(main);
    await expect(later).toHaveCount(0);
    await expect(dismiss).toHaveCount(0);
    await asked.focus();
    await page.keyboard.press('Tab');
    await expect(read).toBeFocused();
    await page.keyboard.press('Tab');
    const more = main.getByRole('button', { name: 'Fler åtgärder' });
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
    // Said from the keyboard: the item waits on whom the source named, the notice says so, and the toast offers Ångra.
    await asked.focus();
    await page.keyboard.press('Enter');
    const toasts = page.getByRole('region', { name: 'Aviseringar' });
    await expect(toasts.getByText('Ärendet väntar på din chef. Det ligger under Väntar på andra.')).toBeVisible();
    await expect(toasts.getByRole('button', { name: 'Ångra' })).toBeVisible();
    await expect(main.getByText('Väntar på din chef', { exact: true })).toBeVisible();
    await expect(main.getByText(/^Du sa ”Jag har bett min chef” /)).toBeVisible();
    await expect(asked).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Påminn mig' })).toBeVisible();
    // Its read is still a button beside ⋯ (board Intyg, variant c2).
    await expect(read).toBeVisible();
    // Still nothing says an answer is late: the reason by the title, the day as Sista dag.
    await expect(main.locator('.astryx-badge').filter({ hasText: 'Har gått ut' })).toBeVisible();
    await expect(main.getByText(/^försenad$/i)).toHaveCount(0);
    await expect(page.getByText('Svara senast', { exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The way back is under ⋯, and gives the item back as it was.
    await more.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Det blev inte gjort' }).click();
    await expect(asked).toBeVisible();
    await expect(main.getByText(HOLDS, { exact: true })).toBeVisible();
    await expect(main.getByText('Väntar på din chef', { exact: true })).toHaveCount(0);
  });

  test('at 320 px the filled button, the read and ⋯ reflow without sideways scrolling, before and after it is said', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(narrow);
    api.threads.push(expiredCertificate({ handOn: ASKED_MANAGER }));
    await open(page, '/items/intyg');
    const main = page.getByRole('main');
    const asked = main.getByRole('button', { name: 'Jag har bett min chef' });
    await expect(asked).toBeVisible();
    await expect(controls(main).read).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await asked.click();
    await expect(main.getByText('Väntar på din chef', { exact: true })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
