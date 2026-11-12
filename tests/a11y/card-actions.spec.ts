import type { Locator } from '@playwright/test';
import { NEXT_WEEK } from './data';
import { composer, desktop, expect, expectNoAxeViolations, open, phone, test } from './support';

/** What a person cannot read because it is cut off with an ellipsis. */
const cutOff = (root: Locator) =>
  root.evaluate(element =>
    [...element.querySelectorAll('*')]
      .filter(
        e => getComputedStyle(e).textOverflow === 'ellipsis' && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1,
      )
      .map(e => (e as HTMLElement).innerText),
  );

test.describe('a row is one link; the steps are on the open work item', () => {
  test.use({ viewport: desktop });

  test('a row has no buttons of its own, and the keyboard reaches everything on its work item, the time picker included', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const row = page.locator('#work-omtanke');
    // A row is one link to its work item (D112 item 3): the steps are the item's.
    await expect(row.getByRole('button')).toHaveCount(0);
    await row.getByRole('link').focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Se mönstret' })).toBeVisible();
    // Att göra has no question box, so the card offers no way into one (D111 rule 6).
    await expect(card.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
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
    // The work item in Att göra's reading pane (D112 item 3).
    await open(page, '/todo?item=fakturor');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Påminn mig' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Fler val' }).click();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Påminn mig|Inte nu/ })).toHaveCount(0);
  });

  test('the work item names its source as the source wrote it and promises no undo before a receipt says so', async ({
    page,
    api: _,
  }) => {
    // A source's name is a name ("Nextcloud"), so it is never lower-cased: on the item's source line and where it says
    // why it is here (D112 item 4). Whether a write can be undone is only known from its receipt, so nothing says so before.
    await open(page, '/todo?item=ledighet');
    const card = page.locator('#card-ledighet');
    await expect(card.getByText('Personalsystemet · Personal', { exact: true })).toBeVisible();
    await expect(card.getByText(/Ärendet kom från Personalsystemet /)).toBeVisible();
    await expect(page.getByText(/Ångra/)).toHaveCount(0);
  });

  test('an action that asks first asks in an alert dialog: Avbryt has the focus, Esc sends nothing and gives the focus back, a yes sends it', async ({
    page,
    api,
  }) => {
    // The HR fixture's second decision on a leave request, with the question it really asks.
    api.threads
      .find(t => t.id === 'ledighet')!
      .actions.push({
        id: 'reject',
        label: 'Avslå',
        capability: 'hr.decideLeave',
        kind: 'execute',
        role: 'secondary',
        confirm: 'Avslå ansökan? Medarbetaren meddelas direkt.',
      });
    const sent: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/threads/ledighet/act'))
        sent.push(request.postData() ?? '');
    });
    await open(page, '/todo?item=ledighet');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    const reject = card.getByRole('button', { name: 'Avslå', exact: true });
    await reject.click();
    // The question is the dialog's name and what follows from a yes is its description (the alert dialog pattern).
    const question = page.getByRole('alertdialog', { name: 'Avslå ansökan?' });
    await expect(question).toBeVisible();
    await expect(question).toHaveAccessibleDescription('Medarbetaren meddelas direkt.');
    await expect(question.getByRole('button', { name: 'Avbryt', exact: true })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(reject).toBeFocused();
    expect(sent).toEqual([]);
    await reject.click();
    await question.getByRole('button', { name: 'Avslå', exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toContain('"actionId":"reject"');
  });

  test('a card that waits on someone has one time action too, and says when it will remind', async ({ page, api }) => {
    api.threads.find(t => t.id === 'tillbud')!.timers = [
      { kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state: 'scheduled' },
    ];
    await open(page, '/todo?item=tillbud');
    const card = page.locator('#card-tillbud');
    await expect(card).toContainText('påminner dig');
    await expect(card.getByRole('button', { name: 'Inte nu', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Påminn mig' }).click();
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toHaveCount(0);
  });

  test('the open proposal has the same picker as every other card', async ({ page, api: _ }) => {
    await open(page, '/todo?item=samtal');
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
    await open(page, '/todo?item=omtanke');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
    await page.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog.getByRole('textbox', { name: 'När?' })).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
  });

  test('a card put in the box says so on its button and on its line', async ({ page, api: _ }) => {
    // Where a box is on the page: the card beside a conversation (Hem holds no card since D112).
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/conversations/fraga?card=omtanke');
    const card = page.locator('#card-omtanke');
    await card.getByRole('button', { name: 'Lägg till i samtalet' }).click();
    await expect(card).toContainText('I samtalet');
    await expect(composer(page)).toBeVisible();
    await expect(card.getByRole('button', { name: 'I samtalet' })).toBeDisabled();
  });

  // D92: the chip enters the drawer on Astryx's entry motion, the field has the focus from the same click, and a screen
  // reader hears the chip's name; under reduced motion the chip is there at once.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a card put in the box enters the drawer, is announced, and respects ${reducedMotion} motion`, async ({
      page,
      api: _,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, '/conversations/fraga?card=omtanke');
      await page.locator('#card-omtanke').getByRole('button', { name: 'Lägg till i samtalet' }).click();
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

  test('the one filled button beside the queue is what is due today', async ({ page, api: _ }) => {
    await open(page, '/todo?item=fakturor');
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
    expect(filled.filter(Boolean)).toEqual(['Attestera 2 valda']);
  });
});

test.describe('a phone', () => {
  test.use({ viewport: phone });

  test('what needs the person comes before the day', async ({ page, api: _ }) => {
    await open(page, '/');
    const work = await page.getByRole('heading', { name: 'Behöver dig' }).boundingBox();
    const day = await page.getByRole('region', { name: 'I dag' }).boundingBox();
    expect(work!.y).toBeLessThan(day!.y);
  });

  test('Inte nu opens from Fler val on the work item alone on the page and shows its rows', async ({
    page,
    api: _,
  }) => {
    // On a phone the item is its page with the buttons pinned to the foot (D112 item 12): Inte nu is under Fler val.
    await open(page, '/todo?item=fakturor');
    await page.getByRole('main').getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Inte nu' }).click();
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Skriv själv/ })).toBeVisible();
  });

  test('the question an action asks fits a phone: nothing scrolls sideways, and Avbryt has the focus', async ({
    page,
    api,
  }) => {
    api.threads
      .find(t => t.id === 'ledighet')!
      .actions.push({
        id: 'reject',
        label: 'Avslå',
        capability: 'hr.decideLeave',
        kind: 'execute',
        role: 'secondary',
        confirm: 'Avslå ansökan? Medarbetaren meddelas direkt.',
      });
    await open(page, '/todo?item=ledighet');
    // On a phone a second step is under Fler val beside the pinned next step (D112 item 12).
    await page.getByRole('main').getByRole('button', { name: 'Fler val' }).click();
    await page.getByRole('menuitem', { name: 'Avslå', exact: true }).click();
    const question = page.getByRole('alertdialog', { name: 'Avslå ansökan?' });
    await expect(question.getByRole('button', { name: 'Avbryt', exact: true })).toBeFocused();
    await expect(question.getByRole('button', { name: 'Avslå', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
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

test.describe('Klart', () => {
  test.use({ viewport: desktop });

  test('Klart holds what is done or set aside, each with its state; the conversations are the rail’s', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?tab=done');
    const done = page.getByRole('list', { name: 'Klart' });
    await expect(done.getByRole('listitem')).toHaveCount(2);
    await expect(done.locator('#work-attest').getByRole('img', { name: 'Klart' })).toBeVisible();
    await expect(done.locator('#work-avfardad').getByRole('img', { name: 'Avfärdat' })).toBeVisible();
    await expect(done).not.toContainText('Vem är på plats i dag?');
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
    test(`a row and a work item keep their words beside the rail at ${width} px`, async ({ page, api: _ }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/todo');
      await expect(page.locator('#work-omtanke').getByRole('link')).toBeVisible();
      expect(await cutOff(page.getByRole('main'))).toEqual([]);
      // The pane does not fit beside the list at these widths: the item is its page (D112 items 3 and 4).
      await open(page, '/todo?item=omtanke');
      await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
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
