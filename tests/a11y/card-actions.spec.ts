import type { Locator } from '@playwright/test';
import { NEXT_WEEK } from './data';
import { composer, desktop, expect, open, phone, test } from './support';

/** What a person cannot read because it is cut off with an ellipsis. */
const cutOff = (root: Locator) =>
  root.evaluate(element =>
    [...element.querySelectorAll('*')]
      .filter(
        e => getComputedStyle(e).textOverflow === 'ellipsis' && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1,
      )
      .map(e => (e as HTMLElement).innerText),
  );

test.describe('a row shows the next step and Lägg till i samtalet; the rest is on the open card', () => {
  test.use({ viewport: desktop });

  test('a row has its two buttons, and the keyboard reaches everything else on its card, the time picker included', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const row = page.locator('#thread-omtanke');
    await expect(row.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Se mönstret' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Inte nu', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Fler val' })).toHaveCount(0);
    // The title is the way to the card (artboard E), where the rest stands: at this width the card is over the page.
    await row.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(card.getByRole('button', { name: 'Se mönstret' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
    await card.getByRole('button', { name: 'Fler val' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Inte nu', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toBeFocused();
  });

  test('an open card has one time action: Inte nu among its buttons, and no second list under Fler val', async ({
    page,
    api: _,
  }) => {
    // The row opened as a card, in the panel (D50); over the page here, where the panel's header is the drawer's top.
    await open(page, '/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Påminn mig' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Fler val' }).click();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Påminn mig|Inte nu/ })).toHaveCount(0);
  });

  test('what the next step does names the source as the source wrote it and promises no undo before a receipt says so', async ({
    page,
    api: _,
  }) => {
    // A source's name is a name ("Nextcloud"), so it is never lower-cased; and whether a write can be undone is only
    // known from its receipt, so the line under the buttons says nothing about undo.
    await open(page, '/?card=ledighet');
    await expect(
      page.getByText('Godkänn skrivs till Personalsystemet och läses tillbaka som kvitto. Fungerar utan modellen.'),
    ).toBeVisible();
    await expect(page.getByText(/Ångra i 10 minuter/)).toHaveCount(0);
  });

  test('a card that waits on someone has one time action too, and says when it will remind', async ({ page, api }) => {
    api.threads.find(t => t.id === 'tillbud')!.timers = [
      { kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state: 'scheduled' },
    ];
    await open(page, '/?tab=waiting');
    const card = page.locator('#thread-tillbud');
    await expect(card).toContainText('väntar på skyddsombudet · påminner dig');
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Påminn mig' }).click();
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.getByRole('button', { name: 'Fler val' })).toHaveCount(0);
  });

  test('the open proposal has the same picker as every other card', async ({ page, api: _ }) => {
    await open(page, '/?card=samtal');
    await page.getByRole('button', { name: 'Skicka', exact: false }).first().waitFor();
    const proposal = page
      .getByRole('article')
      .filter({ has: page.getByRole('button', { name: /^Skicka/ }) })
      .first();
    await proposal.getByRole('button', { name: 'Inte nu', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Skriv själv/ })).toBeVisible();
  });

  test('Skriv själv opens its dialog from the picker and the focus lands in the field', async ({ page, api: _ }) => {
    await open(page, '/?card=omtanke');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
    await page.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog.getByRole('textbox', { name: 'När?' })).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
  });

  test('a card put in the box says so on its button and on its line', async ({ page, api: _ }) => {
    await open(page, '/');
    const row = page.locator('#thread-omtanke');
    await row.getByRole('button', { name: 'Lägg till i samtalet' }).click();
    await expect(row).toContainText('i samtalet');
    await expect(composer(page)).toBeVisible();
    await expect(row.getByRole('button', { name: 'I samtalet' })).toBeDisabled();
  });

  // D92: the chip enters the drawer on Astryx's entry motion, the field has the focus from the same click, and a screen
  // reader hears the chip's name; under reduced motion the chip is there at once.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a card put in the box enters the drawer, is announced, and respects ${reducedMotion} motion`, async ({
      page,
      api: _,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await open(page, '/');
      await page.locator('#thread-omtanke').getByRole('button', { name: 'Lägg till i samtalet' }).click();
      const remove = page.getByRole('button', { name: 'Ta bort Omtankesamtal med Anna Lindqvist' });
      await expect(remove).toBeVisible();
      await expect(composer(page)).toBeFocused();
      await expect(page.getByRole('status').filter({ hasText: 'är med i samtalet' })).toContainText(
        'Omtankesamtal med Anna Lindqvist är med i samtalet',
      );
      // The chip and the drawer around it, up to the box's region: what entered is animated, or nothing is.
      const animations = await remove.evaluate(el => {
        const out: { name: string; duration: string }[] = [];
        for (let e = el.parentElement; e && e.getAttribute('role') !== 'region'; e = e.parentElement) {
          const s = getComputedStyle(e);
          out.push({ name: s.animationName, duration: s.animationDuration });
        }
        return out;
      });
      const still = (a: { name: string; duration: string }) =>
        a.name === 'none' || a.duration.split(',').every(value => parseFloat(value) === 0);
      if (reducedMotion === 'reduce') expect(animations.every(still)).toBe(true);
      else expect(animations.some(a => !still(a))).toBe(true);
    });
  }
});

test.describe('the page says one thing at a time', () => {
  test.use({ viewport: desktop });

  test('the one filled button on the overview is what is due today', async ({ page, api: _ }) => {
    await open(page, '/');
    // Filled means opaque and dark: black in Neutral, the profile's own colour under a municipal one. A secondary button is a translucent tint.
    const filled = await page.getByRole('main').evaluate(main =>
      [...main.querySelectorAll('button')]
        .filter(button => {
          const [r = 255, g = 255, b = 255, a = 1] = (
            getComputedStyle(button).backgroundColor.match(/[\d.]+/g) ?? []
          ).map(Number);
          return button.checkVisibility() && a > 0.9 && r + g + b < 450;
        })
        .map(button => button.textContent?.trim()),
    );
    // The box's send button is an icon with no text, and rests dimmed until something is written.
    expect(filled.filter(Boolean)).toEqual(['Attestera 2']);
  });
});

test.describe('a phone', () => {
  test.use({ viewport: phone });

  test("the day's work comes before the day", async ({ page, api: _ }) => {
    await open(page, '/');
    const work = await page.getByRole('heading', { name: 'Nu · 1' }).boundingBox();
    const day = await page.getByRole('region', { name: 'I dag' }).boundingBox();
    expect(work!.y).toBeLessThan(day!.y);
  });

  test('Inte nu opens from the card in the sheet and shows its rows', async ({ page, api: _ }) => {
    await open(page, '/?card=fakturor');
    await page
      .getByRole('dialog', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' })
      .getByRole('article', { name: 'Kort: Attestera 3 fakturor, 48 200 kr' })
      .getByRole('button', { name: 'Inte nu', exact: true })
      .click();
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Skriv själv/ })).toBeVisible();
  });
});

test.describe('the side panel', () => {
  test.use({ viewport: desktop });

  test('a plain read says where it comes from and writes a date as a date', async ({ page, api }) => {
    api.output = { date: '2026-11-04', onDuty: 'Anna Lindqvist' };
    await open(page, '/?open=hr.staffing&open-title=Bemanning');
    const panel = page.getByRole('dialog', { name: 'Bemanning' });
    await expect(panel).toContainText('4 november 2026');
    await expect(panel).toContainText('Hämtat ur Personalsystemet. Inget av det sparas på Startsidan.');
  });
});

test.describe('Redan hanterat', () => {
  test.use({ viewport: desktop });

  test('when and what are two choices, and the times stand under each other', async ({ page, api: _ }) => {
    await open(page, '/?tab=done');
    await expect(page.getByRole('radiogroup', { name: 'Tid' }).getByRole('radio', { name: 'I dag' })).toBeChecked();
    await page.getByRole('radiogroup', { name: 'Typ' }).getByRole('radio', { name: 'Frågor' }).click();
    const region = page.getByRole('region', { name: 'Redan hanterat' });
    await expect(region).toContainText('Fråga: Vem är på plats i dag?');
    await expect(region).not.toContainText('Attesterade fakturor');
  });
});

test.describe('a booking', () => {
  test.use({ viewport: desktop });

  test('says what is missing while Boka is greyed', async ({ page, api: _ }) => {
    await open(page, '/calendar');
    await page.getByRole('button', { name: 'Ny bokning' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Skriv en rubrik så går det att boka.');
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeDisabled();
    await dialog.getByRole('textbox').first().fill('Möte');
    await expect(dialog).not.toContainText('Skriv en rubrik så går det att boka.');
    await expect(dialog.getByRole('button', { name: 'Boka' })).toBeEnabled();
  });
});

test.describe('the calendar on a phone', () => {
  test.use({ viewport: phone });

  test('leaves the screen to the calendar: a head of two rows, with proposals waiting too', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar');
    await expect(page.getByRole('button', { name: /^Förslag/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Förra veckan' })).toBeVisible();
    const list = await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox();
    expect(list!.y).toBeLessThan(165);
  });
});

test.describe('nothing is cut off', () => {
  for (const width of [1024, 768])
    test(`a row and a card keep their words beside the rail at ${width} px`, async ({ page, api: _ }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/');
      await expect(
        page.locator('#thread-omtanke').getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist' }),
      ).toBeVisible();
      expect(await cutOff(page.getByRole('main'))).toEqual([]);
    });

  test('the action on an administration page keeps its whole label beside a long lead', async ({ page, api }) => {
    await page.setViewportSize(desktop);
    api.admin = true;
    await open(page, '/admin/connectors');
    expect(await cutOff(page.getByRole('main'))).toEqual([]);
    await page.getByRole('button', { name: 'Anslut system' }).click();
    expect(await cutOff(page.getByRole('dialog'))).toEqual([]);
  });

  test('what the box suggests on a phone keeps its whole title', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/');
    await composer(page).fill('attestera');
    await expect(page.getByText('Menar du')).toBeVisible();
    expect(await cutOff(page.getByRole('main'))).toEqual([]);
  });

  test('a proposal in a week says who it is on a line of its own', async ({ page, api: _ }) => {
    await page.setViewportSize(desktop);
    await open(page, `/calendar?date=${NEXT_WEEK}`);
    const block = page.locator('.clew-cal-event-proposal').first();
    await expect(block).toContainText('Anna');
    const words = await block.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
        found: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          if (new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1) found.push(word[0]);
        }
      return found;
    });
    expect(words).toEqual([]);
  });
});
