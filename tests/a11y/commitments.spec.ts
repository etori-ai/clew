import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { allCommitments, TALKS_FAIL_ERROR, TALKS_READ_ONLY_SOURCE, type CommitmentEntry } from './data';

/**
 * Mina åtgärdspunkter on Hem (D96 item 7): the open action points the person owns and those about them, after the day's
 * work, the first five and the rest in place. The owner ticks one off with Klar, and the completion toast's Ångra opens
 * it again. Nothing is drawn without a talks system or with nothing open; another system answering is read-only.
 */
const section = (page: Page) => page.getByRole('region', { name: 'Mina åtgärdspunkter' });
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const row = (page: Page, text: string) => section(page).getByRole('listitem').filter({ hasText: text });
const point = (id: string): CommitmentEntry => allCommitments().find(c => c.id === id)!;

/** How often a sentence was announced: the completion toast carries Ångra from the start, so it is said once. */
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;

/** By keyboard alone: Tab until `target` has the focus. */
async function tabTo(page: Page, target: Locator, limit = 250) {
  for (let stop = 0; stop < limit; stop++) {
    if (await target.evaluate(el => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('the focus never reached the control');
}

/** The manager's own (Anna's and Erik's talks, their own talk) first, then the one about them that their manager owns. */
const ORDER = ['c-anna-2', 'c-erik-1', 'c-me-1', 'c-me-2', 'c-me-3'].map(id => point(id).text);

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['phone', phone],
] as const)
  test.describe(`Mina åtgärdspunkter on Hem, ${layout}`, () => {
    test.use({ viewport });

    test('lists the open action points after the day’s work, each with its due day and whom it concerns; axe and focus hold', async ({
      page,
      api: _,
    }) => {
      await open(page, '/');
      const mine = section(page);
      await expect(heading(page, 2, 'Mina åtgärdspunkter · 5')).toBeVisible();
      // After the day's work and after Läget, with Mina ärenden (D90) under the board's parts (D112, amended 2026-11-11).
      const work = heading(page, 2, 'Behöver dig'),
        own = heading(page, 2, 'Mina åtgärdspunkter'),
        lage = heading(page, 2, 'Läget på Skönsmons skola');
      expect((await own.boundingBox())!.y).toBeGreaterThan((await work.boundingBox())!.y);
      expect((await own.boundingBox())!.y).toBeGreaterThan((await lage.boundingBox())!.y);

      // The reader's own first, in the server's order; a done point is not listed.
      const items = mine.getByRole('listitem');
      await expect(items).toHaveCount(5);
      for (const [i, text] of ORDER.entries()) await expect(items.nth(i)).toContainText(text);
      await expect(mine.getByText(point('c-me-4').text)).toHaveCount(0);

      // A manager's own point concerns an employee and names them; one from an earlier talk and overdue says so.
      await expect(row(page, point('c-anna-2').text)).toContainText(`Samtal med ${point('c-anna-2').name}`);
      await expect(row(page, point('c-anna-2').text)).toContainText('Senast fre 27 nov.');
      // The employee's name leads to them (D97 item 6, artboard M): their user name is the key, Hem the way back.
      await expect(
        row(page, point('c-anna-2').text).getByRole('link', { name: point('c-anna-2').name, exact: true }),
      ).toHaveAttribute('href', `/people/${point('c-anna-2').userName}?from=%2F`);
      // A point about the reader names nobody, so nothing in it is a link.
      await expect(row(page, point('c-me-2').text).getByRole('link')).toHaveCount(0);
      await expect(row(page, point('c-me-3').text).getByRole('link')).toHaveCount(0);
      const erik = row(page, point('c-erik-1').text);
      await expect(erik).toContainText('Från tidigare samtal');
      await expect(erik).toContainText('Försenad');
      // Their own point is about themselves and names nobody; the one their manager owns says who answers for it, without a control.
      await expect(row(page, point('c-me-2').text)).not.toContainText('Samtal med');
      const theirs = row(page, point('c-me-3').text);
      await expect(theirs).toContainText('Din chef ansvarar');
      await expect(theirs.getByRole('button')).toHaveCount(0);
      // Each Klar is named for its row.
      await expect(mine.getByRole('button', { name: /^Klar: / })).toHaveCount(4);
      await expect(mine.getByRole('button', { name: `Klar: ${point('c-anna-2').text}` })).toBeVisible();

      await expectNoAxeViolations(page);
      const { hidden, unmarked, stops } = await hiddenFocusStops(page, 300);
      expect(stops.some(stop => stop.includes(`Klar: ${point('c-anna-2').text}`))).toBe(true);
      expect(hidden).toEqual([]);
      expect(unmarked).toEqual([]);
    });

    test('by keyboard alone: tick one off, it leaves, the toast says so, and Ångra brings it back', async ({
      page,
      api,
    }) => {
      await open(page, '/');
      const text = point('c-anna-2').text;
      const klar = section(page).getByRole('button', { name: `Klar: ${text}` });
      await tabTo(page, klar);
      await page.keyboard.press('Enter');
      await expect(row(page, text)).toHaveCount(0);
      await expect(section(page).getByRole('listitem')).toHaveCount(4);
      await expect(heading(page, 2, 'Mina åtgärdspunkter · 4')).toBeVisible();
      await expect(notices(page).getByText('Åtgärdspunkten är klar.')).toBeVisible();
      await expect.poll(() => said(page, 'Åtgärdspunkten är klar.')).toBe(1);
      // The focus is not lost with the row: it is on the next row's own control.
      await expect(section(page).getByRole('button', { name: `Klar: ${point('c-erik-1').text}` })).toBeFocused();
      expect(api.talkWrites).toEqual([{ method: 'POST', path: '/talks/commitments/c-anna-2/done', body: {} }]);
      await expectNoAxeViolations(page);

      const undo = notices(page).getByRole('button', { name: 'Ångra', exact: true });
      await tabTo(page, undo);
      await page.keyboard.press('Enter');
      await expect(row(page, text)).toHaveCount(1);
      await expect(section(page).getByRole('listitem')).toHaveCount(5);
      await expect(notices(page).getByText('Åtgärdspunkten är öppen igen.')).toBeVisible();
      await expect(klar).toBeFocused();
      expect(api.talkWrites.at(-1)).toEqual({ method: 'DELETE', path: '/talks/commitments/c-anna-2/done', body: null });
    });

    test('a failing write shows the server’s sentence and the row stays', async ({ page, api }) => {
      await open(page, '/');
      api.talksFail = true;
      const text = point('c-me-2').text;
      const klar = section(page).getByRole('button', { name: `Klar: ${text}` });
      await klar.focus();
      await page.keyboard.press('Enter');
      await expect(row(page, text).getByRole('alert')).toHaveText(TALKS_FAIL_ERROR);
      await expect(section(page).getByRole('listitem')).toHaveCount(5);
      await expect(klar).toBeFocused();
      await expect(notices(page).getByText('Åtgärdspunkten är klar.')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('an employee sees the points about them, the manager’s without a control', async ({ page, api }) => {
      api.employee = true;
      await open(page, '/');
      const items = section(page).getByRole('listitem');
      await expect(items).toHaveCount(3);
      for (const [i, id] of ['c-me-1', 'c-me-2', 'c-me-3'].entries())
        await expect(items.nth(i)).toContainText(point(id).text);
      await expect(section(page).getByText(point('c-anna-2').text)).toHaveCount(0);
      await expect(section(page).getByText(/Samtal med/)).toHaveCount(0);
      await expect(section(page).getByRole('button', { name: /^Klar: / })).toHaveCount(2);
      const theirs = row(page, point('c-me-3').text);
      await expect(theirs).toContainText('Din chef ansvarar');
      await expect(theirs.getByRole('button')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('an employee ticks off their own by keyboard and Ångra brings it back; the manager’s has no control', async ({
      page,
      api,
    }) => {
      api.employee = true;
      await open(page, '/');
      const text = point('c-me-2').text;
      const klar = section(page).getByRole('button', { name: `Klar: ${text}` });
      await tabTo(page, klar);
      await page.keyboard.press('Enter');
      await expect(row(page, text)).toHaveCount(0);
      await expect(section(page).getByRole('listitem')).toHaveCount(2);
      await expect(notices(page).getByText('Åtgärdspunkten är klar.')).toBeVisible();
      await expect.poll(() => said(page, 'Åtgärdspunkten är klar.')).toBe(1);
      expect(api.talkWrites).toEqual([{ method: 'POST', path: '/talks/commitments/c-me-2/done', body: {} }]);
      await expect(row(page, point('c-me-3').text).getByRole('button')).toHaveCount(0);

      await tabTo(page, notices(page).getByRole('button', { name: 'Ångra', exact: true }));
      await page.keyboard.press('Enter');
      await expect(row(page, text)).toHaveCount(1);
      await expect(section(page).getByRole('listitem')).toHaveCount(3);
      await expect(notices(page).getByText('Åtgärdspunkten är öppen igen.')).toBeVisible();
      await expect(klar).toBeFocused();
      expect(api.talkWrites.at(-1)).toEqual({ method: 'DELETE', path: '/talks/commitments/c-me-2/done', body: null });
      await expectNoAxeViolations(page);
    });

    test('read-only, when another system answers: no controls, each point opens that system, its name said once', async ({
      page,
      api,
    }) => {
      api.talksWritable = false;
      await open(page, '/');
      const mine = section(page);
      await expect(mine.getByRole('listitem')).toHaveCount(5);
      await expect(mine.getByRole('button')).toHaveCount(0);
      await expect(mine.getByRole('link', { name: point('c-anna-2').text })).toHaveAttribute(
        'href',
        'https://personal.clew.test/atgarder/c-anna-2',
      );
      await expect(mine.locator('a[href^="https://personal.clew.test/"]')).toHaveCount(5);
      // Besides those, only the employees a manager's own points name lead anywhere: to the person (D97 item 6).
      await expect(mine.getByRole('link')).toHaveCount(7);
      await expect(mine.locator('a[href^="/people/"]')).toHaveCount(2);
      await expect(mine.getByText(TALKS_READ_ONLY_SOURCE, { exact: true })).toHaveCount(1);
      await expectNoAxeViolations(page);
    });

    test('more than five: the rest is shown in place and the focus stays in the section', async ({ page, api }) => {
      const sixth: CommitmentEntry = {
        ...point('c-anna-2'),
        id: 'c-anna-5',
        ref: 'commitment:talks:c-anna-5',
        text: 'Planera ämneskonferensen i matematik',
        dueOn: '2026-12-04',
      };
      api.commitments = [...allCommitments(), sixth];
      await open(page, '/');
      const mine = section(page);
      await expect(heading(page, 2, 'Mina åtgärdspunkter · 6')).toBeVisible();
      await expect(mine.getByRole('listitem')).toHaveCount(5);
      const more = mine.getByRole('button', { name: 'Visa alla 6 åtgärdspunkter' });
      await tabTo(page, more);
      await page.keyboard.press('Enter');
      await expect(mine.getByRole('listitem')).toHaveCount(6);
      await expect(more).toHaveCount(0);
      await expect(mine.getByRole('heading', { name: /^Mina åtgärdspunkter/ })).toBeFocused();
      await expectNoAxeViolations(page);
    });
  });

test.describe('Mina åtgärdspunkter is absent', () => {
  test.use({ viewport: desktop });

  test('when nothing is open', async ({ page, api }) => {
    api.commitments = allCommitments().filter(c => c.done);
    await open(page, '/');
    await expect(heading(page, 2, 'Behöver dig')).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test('without a talks system, and no error is shown', async ({ page, api }) => {
    api.talksOffered = false;
    await open(page, '/');
    await expect(heading(page, 2, 'Behöver dig')).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await expect(page.getByText('Du saknar behörighet för åtgärden.')).toHaveCount(0);
  });
});

test.describe('Mina åtgärdspunkter when the read fails', () => {
  test.use({ viewport: desktop });

  test('the section says so and can be tried again', async ({ page, api: _ }) => {
    let down = true;
    await page.route('**/api/cap/clew.commitments**', route =>
      down
        ? route.fulfill({ status: 502, json: { error: 'Utvecklingssamtalen svarar inte just nu.' } })
        : route.fallback(),
    );
    await open(page, '/');
    await expect(section(page).getByRole('alert')).toHaveText('Utvecklingssamtalen svarar inte just nu.');
    await expect(section(page).getByRole('listitem')).toHaveCount(0);
    await expectNoAxeViolations(page);
    down = false;
    await section(page).getByRole('button', { name: 'Försök igen' }).click();
    await expect(section(page).getByRole('listitem')).toHaveCount(5);
  });
});

test.describe('1.4.10: Mina åtgärdspunkter at 320 px', () => {
  test('the section reflows', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    await expect(section(page).getByRole('button', { name: `Klar: ${point('c-anna-2').text}` })).toBeVisible();
    expect(await reflowProblems(page, section(page))).toEqual([]);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
