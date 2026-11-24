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
    // A row's name is its one link to its work item (D126 rule 4): the steps are the item's.
    await expect(row.getByRole('button')).toHaveCount(0);
    await row.getByRole('link').focus();
    await page.keyboard.press('Enter');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    // Att göra has no question box, so the card offers no way into one (D111 rule 6).
    await expect(card.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // The item's reads and Inte nu are under ⋯ (D126, board Att göra): a read is a link to its own page.
    await card.getByRole('button', { name: 'Fler åtgärder' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Se mönstret' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Inte nu' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Fler åtgärder' })).toBeFocused();
  });

  test('an open card has one time action: Inte nu under ⋯, and no Påminn mig', async ({ page, api: _ }) => {
    // The work item in Att göra's reading pane (D126 rule 2).
    await open(page, '/todo?item=fakturor');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.getByRole('button', { name: 'Påminn mig' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: /Påminn mig/ })).toHaveCount(0);
  });

  test('the work item names its source as the source wrote it and promises no undo before a receipt says so', async ({
    page,
    api: _,
  }) => {
    // A source's name is a name ("Nextcloud"), so it is never lower-cased: on the item's source line and where it says
    // why it is here (D112 item 4). Whether a write can be undone is only known from its receipt, so nothing says so before.
    await open(page, '/todo?item=ledighet');
    const card = page.locator('#card-ledighet');
    await expect(card.getByText('Personalsystemet · Personal', { exact: true }).first()).toBeVisible();
    await card.getByRole('button', { name: 'Varför ser jag detta?' }).click();
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
    await page.getByRole('button', { name: 'Fler åtgärder' }).first().click();
    await page.getByRole('menuitem', { name: 'Inte nu' }).click();
    await page.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog.getByRole('textbox', { name: 'När?' })).toBeVisible();
    await expect.poll(() => dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
  });

  test('a card put in the box says so on its button and on its line', async ({ page, api: _ }) => {
    // Where a box is on the page: a card an answer draws in a conversation (Hem holds no card since D112; the item in
    // the pane beside the conversation goes with every question and is not put in the box).
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/conversations/fraga');
    await composer(page).fill('Vad ska jag attestera?');
    await composer(page).press('Enter');
    const card = page.getByRole('log').locator('#thread-fakturor');
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
      await open(page, '/conversations/fraga');
      await composer(page).fill('Vad ska jag attestera?');
      await composer(page).press('Enter');
      await page
        .getByRole('log')
        .locator('#thread-fakturor')
        .getByRole('button', { name: 'Lägg till i samtalet' })
        .click();
      const remove = page.getByRole('button', { name: 'Ta bort Attestera 3 fakturor, 48 200 kr' });
      await expect(remove).toBeVisible();
      await expect(composer(page)).toBeFocused();
      await expect(page.getByRole('status').filter({ hasText: 'är med i samtalet' })).toContainText(
        'Attestera 3 fakturor, 48 200 kr är med i samtalet',
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

  test('Inte nu opens from Fler åtgärder on the work item’s page and shows its rows', async ({ page, api: _ }) => {
    // On a phone there is no pane: the item is its page, its buttons under its title (D126 rule 2).
    await open(page, '/todo?item=fakturor');
    await expect(page).toHaveURL(/\/items\/fakturor\?from=%2Ftodo$/);
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
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
    // Two opposed decisions stand side by side at every width (D126 rule 2).
    await page.getByRole('main').getByRole('button', { name: 'Avslå', exact: true }).click();
    const question = page.getByRole('alertdialog', { name: 'Avslå ansökan?' });
    await expect(question.getByRole('button', { name: 'Avbryt', exact: true })).toBeFocused();
    await expect(question.getByRole('button', { name: 'Avslå', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

/**
 * D116, D126: a work item's read is a link to the read's page, never the panel; "Se i personalsystemet" on a leave
 * request (every open request in a table) is a row under ⋯, and the page names the place the item was on as its way back.
 */
test.describe('a read that answers with a table', () => {
  test.use({ viewport: desktop });
  const leaveRequests = {
    kind: 'table' as const,
    capability: 'hr.leaveRequests',
    connector: 'hr',
    source: 'Personalsystemet',
    chip: false,
    title: 'name',
    noun: { one: 'ansökan', other: 'ansökningar' },
    fields: [
      { key: 'name', label: 'Medarbetare' },
      { key: 'period', label: 'Period' },
    ],
  };
  test('Se i personalsystemet leads to the read’s page with the item’s page as the way back, and Back returns to the item', async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t =>
      t.id === 'ledighet'
        ? {
            ...t,
            actions: [
              ...t.actions,
              {
                id: 'open',
                label: 'Se i personalsystemet',
                capability: 'hr.leaveRequests',
                kind: 'read' as const,
                role: 'secondary' as const,
                target: 'panel' as const,
              },
            ],
          }
        : t,
    );
    const asked: string[] = [];
    await page.route('**/api/cap/hr.leaveRequests*', route => {
      asked.push(route.request().url());
      return route.fulfill({
        json: {
          source: 'Personalsystemet',
          view: leaveRequests,
          output: {
            rows: [
              { name: 'Johan Byström', period: '22–23 december' },
              { name: 'Sara Nyström', period: '2–4 januari' },
            ],
          },
        },
      });
    });
    // An address from before D126 that held the item beside Hem leads to the item's page.
    await open(page, '/?card=ledighet');
    await expect(page).toHaveURL('/items/ledighet?from=%2F');
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
    const link = page.getByRole('menuitem', { name: 'Se i personalsystemet' });
    await expect(link).toHaveAttribute('href', '/tools/hr.leaveRequests?from=%2Fitems%2Fledighet');
    await link.click();
    await expect(page).toHaveURL('/tools/hr.leaveRequests?from=%2Fitems%2Fledighet');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Ledighetsansökningar' })).toBeVisible();
    await expect(main.getByRole('row')).toHaveCount(3);
    expect(asked).toHaveLength(1);
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/items/ledighet?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: /ledighet/i })).toBeVisible();
  });
});

test.describe('one thing is its own page (D126 rule 1)', () => {
  test.use({ viewport: desktop });

  test('a plain read from before beside Hem is its page, says where it comes from and writes a date as a date', async ({
    page,
    api,
  }) => {
    api.output = { date: '2026-11-04', onDuty: 'Anna Lindqvist' };
    // A read that declares no view, among the reads the person may open (D116: one they may not open has no page).
    api.views.push({ capability: 'hr.staffing', title: 'Bemanning' });
    await open(page, '/?open=hr.staffing&open-title=Bemanning');
    await expect(page).toHaveURL('/tools/hr.staffing?title=Bemanning&from=%2F');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const main = page.getByRole('main');
    await expect(main).toContainText('4 november 2026');
    await expect(main).toContainText('Hämtat ur Personalsystemet. Inget av det sparas på Startsidan.');
  });
});

test.describe('Klart', () => {
  test.use({ viewport: desktop });

  test('Klart holds what is done or set aside, each with its state; the conversations are the rail’s', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?tab=done');
    const done = page.getByRole('table', { name: 'Klart' });
    await expect(done.getByRole('row')).toHaveCount(3);
    // Each in the status vocabulary's word (D126 item 13): a decision with a row in doubt is unconfirmed, a dismissal is
    // done and says so.
    await expect(done.locator('#work-attest')).toContainText('Obekräftat\u00a0· 1 av 2');
    await expect(done.locator('#work-avfardad')).toContainText('Klart\u00a0· avfärdat');
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

  // The head in the one page frame (D126, D130): where the page stands, the title's line, and two rows of controls,
  // where in time with how it is shown and what can be done. The title no longer shares a line with what can be done
  // (with the frame's 24 px inset the two need 339 of 327 px), so the head is one text line and the title's line
  // taller than the 165 px this case once allowed. What it keeps is that nothing adds a row: "Fråga AI" is its mark
  // alone at the end of the title's line, and each pair of controls shares its row, with proposals waiting too.
  test('leaves the screen to the calendar: the title’s line with Fråga AI on it and two rows of controls, with proposals waiting too', async ({
    page,
    api: _,
  }) => {
    await open(page, '/calendar');
    const main = page.getByRole('main');
    const title = (await page.getByRole('heading', { level: 1, name: 'Vecka 45' }).boundingBox())!;
    const door = (await main.getByRole('button', { name: 'Fråga AI' }).boundingBox())!;
    expect(door.y, 'Fråga AI is on the title’s line').toBeLessThan(title.y + title.height);
    expect(door.y + door.height).toBeGreaterThan(title.y);
    expect(door.x, 'and ends it').toBeGreaterThan(title.x + title.width);
    // D74, amended 2026-11-23: under the title's line the controls are two rows, the steps with the view menu and
    // Förslag with Ny bokning. `touch.spec.ts` holds the same at a finger's 44 px.
    const controls = [
      page.getByRole('group', { name: /^Byt / }),
      page.getByRole('button', { name: /^Vy: / }),
      page.getByRole('button', { name: /^Förslag/ }),
      page.getByRole('button', { name: 'Ny bokning' }),
    ];
    for (const control of controls) await expect(control).toBeVisible();
    const tops = await Promise.all(controls.map(async control => Math.round((await control.boundingBox())!.y)));
    expect([...new Set(tops)]).toHaveLength(2);
    expect(Math.min(...tops), 'the controls stand under the title’s line').toBeGreaterThanOrEqual(
      Math.round(door.y + door.height),
    );
    // Measured from the shell's bar, whose height is not the calendar's. Under a mouse the two rows are 28 px controls.
    const list = await page.getByRole('group', { name: /^Vecka 45/ }).boundingBox();
    const bar = await page.getByRole('banner').boundingBox();
    expect(list!.y - (bar!.y + bar!.height)).toBeLessThan(230);
  });
});

test.describe('nothing is cut off', () => {
  for (const width of [1024, 768])
    test(`a row and a work item keep their words at ${width} px`, async ({ page, api: _ }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/todo');
      await expect(page.locator('#work-omtanke').getByRole('link')).toBeVisible();
      expect(await cutOff(page.getByRole('main'))).toEqual([]);
      await open(page, '/todo?item=omtanke');
      if (width >= 1024) {
        // With no rail the page has the room of the `table-inbox` template at 1024 px: the item stands beside the list.
        await expect(page).toHaveURL('/todo?item=omtanke');
        await expect(
          page
            .getByRole('complementary', { name: 'Valt ärende' })
            .getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist', exact: true }),
        ).toBeVisible();
      } else {
        // The pane does not fit beside the list at this width: the item is its page (D126 rule 2).
        await expect(page).toHaveURL(/\/items\/omtanke/);
        await expect(page.getByRole('heading', { level: 1, name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
      }
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
