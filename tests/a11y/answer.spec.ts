import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';

test.use({ viewport: desktop });

/** The answer under the box on the start page (D115 item 5): a section named "Svar" with its h2, its two buttons and the transcript. */
const answerCard = (page: Page) => page.getByRole('region', { name: 'Svar', exact: true });
/** The start page's h1 (D115 item 4): the greeting by the time of day and the first name; it stays while a question is answered. */
const greeting = (page: Page) => page.locator('h1#hem');

/** Asks on the start page and waits until the answer is written under the box. */
async function ask(page: Page, question = 'Vem är på plats?') {
  const input = composer(page);
  await input.fill(question);
  await input.press('Enter');
  const log = answerCard(page).getByRole('log');
  await expect(log).toContainText('Tio personer är på plats i dag.');
  await expect(log).not.toHaveAttribute('aria-busy', 'true');
  return log;
}

/**
 * A question on its way (D36): the question is drawn at once with its answer pending under it, the transcript's log is
 * busy until the answer is written, the box rests with Stoppa, and the page never jumps under the person's cursor. On
 * the start page the answer is drawn under the box and the address stays `/` (D115 item 5).
 */
test.describe('the answer on its way', () => {
  test('the question is drawn at once under the box, the log is busy while the answer is written, the box keeps the focus with Stoppa, and the answer takes its place', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    // Held, not timed: the axe scan below takes over a second here and longer in CI, and an answer that comes first would let Enter send the next question.
    const release = api.holdAnswer();
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    const card = answerCard(page);
    await expect(card).toBeVisible();
    await expect(heading(page, 2, 'Svar')).toBeVisible();
    const log = card.getByRole('log');
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await expect(log).toContainText('Vem är på plats?');
    await expect(page.getByRole('button', { name: 'Stoppa' })).toBeEnabled();
    // The start page stays the start page: its address, its title and its h1 (D115 item 5).
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Hem · Startsidan');
    await expect(greeting(page)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    // The answer is under the box, not above it.
    expect((await card.boundingBox())!.y).toBeGreaterThan((await input.boundingBox())!.y);
    await expectNoAxeViolations(page);
    // The box keeps the focus and takes the next question while the answer is written; Enter waits for the answer.
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type('Och i morgon?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveText('Och i morgon?');
    release();
    await expect(log).toContainText('Tio personer är på plats i dag.');
    await expect(log).not.toHaveAttribute('aria-busy', 'true');
    // The question is drawn once: the pending one became the written one in place.
    await expect(log.getByText('Vem är på plats?', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stoppa' })).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveText('Och i morgon?');
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Tio personer är på plats i dag.'));
    // The transcript's closing words say where the conversation is kept.
    await expect(card).toContainText('samtalet sparas i Min AI');
    await expect(page).toHaveURL(/\/$/);
  });

  // That a stopped turn writes nothing is the server's promise, tested in tests/unit/conversation.test.ts; here the page lets go of it.
  test('Stoppa puts the question back in the box, says so, and an answer that arrives later is not drawn', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    api.answerDelay = 2_000;
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Stoppa' }).click();
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(answerCard(page)).toHaveCount(0);
    await expect(greeting(page)).toBeVisible();
    await expect(composer(page)).toHaveText('Vem är på plats?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Frågan avbröts'));
    await page.waitForTimeout(api.answerDelay + 500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(composer(page)).toHaveText('Vem är på plats?');
  });

  // D92: the column fades in when it changes hands. On the start page the answer is drawn in place under the box
  // (D115 item 5), so the hand-over is to Min AI and back: the conversation takes the column with Astryx's fade, and
  // the start page comes back with one; under reduced motion both are there at once. (Hem's own first entrance is
  // D76's, tested in loading.spec.ts.)
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`Min AI fades in over the start page, the start page fades back, and ${reducedMotion} motion is respected`, async ({
      page,
      api: _,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await open(page, '/');
      /** Whether anything from the element up to the main region is animated. */
      const entering = (from: Locator) =>
        from.evaluate(el => {
          for (let e: Element | null = el; e && e.tagName !== 'MAIN'; e = e.parentElement) {
            const s = getComputedStyle(e);
            if (s.animationName !== 'none' && s.animationDuration.split(',').some(value => parseFloat(value) > 0))
              return true;
          }
          return false;
        });
      await ask(page);
      await answerCard(page).getByRole('link', { name: 'Fortsätt i Min AI' }).click();
      await expect(page).toHaveURL(/\/conversations\/konversation$/);
      const log = page.getByRole('log');
      await expect(log).toContainText('Vem är på plats?');
      expect(await entering(log)).toBe(reducedMotion === 'no-preference');
      await page.getByRole('button', { name: 'Stäng samtalet' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(greeting(page)).toBeVisible();
      expect(await entering(greeting(page))).toBe(reducedMotion === 'no-preference');
    });
  }

  test('the box stays where it is while "Menar du" comes and goes under it', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    const top = async () => (await input.boundingBox())!.y;
    const before = await top();
    await input.fill('attestera');
    await expect(page.getByRole('list', { name: 'Menar du' })).toBeVisible();
    expect(await top()).toBe(before);
    await input.fill('attestera xq');
    await input.fill('');
    await expect(page.getByRole('list', { name: 'Menar du' })).toHaveCount(0);
    expect(await top()).toBe(before);
  });

  test('with nothing pushed the page says so under the box, which stays under the greeting, and "Menar du" under it does not move it', async ({
    page,
    api,
  }) => {
    api.threads = [];
    await open(page, '/');
    const input = composer(page);
    const lead = (await greeting(page).boundingBox())!;
    const top = (await input.boundingBox())!.y;
    expect(top).toBeGreaterThan(lead.y);
    // The quiet day's card stands where the work would (D115 item 4: in the section "Att agera på").
    await expect(
      page.getByRole('region', { name: 'Att agera på' }).getByRole('heading', { name: 'Lugnt läge' }),
    ).toBeVisible();
    await expect(heading(page, 2, 'Lugnt läge')).toBeVisible();
    await expect(page.getByRole('region', { name: 'I dag' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Sedan i går' }).getByText('Inget är klart och inget väntar på andra.'),
    ).toBeVisible();
    await input.fill('attestera');
    await expect(page.getByRole('list', { name: 'Menar du' })).toBeVisible();
    expect((await input.boundingBox())!.y).toBe(top);
    await expectNoAxeViolations(page);
  });

  test('while the cards load the rows are drawn as their shape and the page never says that nothing needs you', async ({
    page,
    api,
  }) => {
    api.threadsDelay = 1_500;
    await page.goto('/');
    await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
    await expect(page.getByText(/Lugnt läge|Inget brådskar/)).toHaveCount(0);
    // The board's one list (D115 item 4): its heading carries the count once the cards are here.
    await expect(heading(page, 2, 'Att agera på · ')).toBeVisible();
    await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  });
});

/**
 * The answer under the box (D115 item 5): what is asked on the start page is answered there, in a card named "Svar"
 * with the way on to Min AI and the way to put it away. The address stays `/`; Esc or "Stäng svaret" puts the answer
 * away and the box keeps the focus; a second question continues the same conversation.
 */
test.describe('the answer under the box', () => {
  test('"Stäng svaret" puts the answer away and the focus is in the box; the address never changed', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await ask(page);
    const card = answerCard(page);
    // The heading names the card, at the board's level; the closing button says what it closes.
    await expect(card.locator('[aria-level="2"], h2:not([aria-level])').filter({ hasText: 'Svar' })).toBeVisible();
    const close = card.getByRole('button', { name: 'Stäng svaret' });
    await expect(close).toBeVisible();
    await expectNoAxeViolations(page);
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();
  });

  test('Esc puts the answer away from the box and the box keeps the focus', async ({ page, api: _ }) => {
    await open(page, '/');
    await ask(page);
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(answerCard(page)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a second question continues the same conversation under the box', async ({ page, api }) => {
    await open(page, '/');
    const log = await ask(page);
    await composer(page).fill('Och i morgon?');
    await composer(page).press('Enter');
    await expect(log).toContainText('Och i morgon?');
    await expect(log).not.toHaveAttribute('aria-busy', 'true');
    await expect(log).toContainText('Vem är på plats?');
    await expect(answerCard(page)).toHaveCount(1);
    expect(api.asked.at(-1)).toMatchObject({ text: 'Och i morgon?', conversationId: 'konversation' });
    await expect(page).toHaveURL(/\/$/);
    await expect(composer(page)).toBeFocused();
  });

  test('"Fortsätt i Min AI" leads to the conversation in Min AI', async ({ page, api: _ }) => {
    await open(page, '/');
    await ask(page);
    const onward = answerCard(page).getByRole('link', { name: 'Fortsätt i Min AI' });
    await expect(onward).toHaveAttribute('href', '/conversations/konversation');
    await onward.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/konversation$/);
    // The conversation's page header: its title as the page's h1 (the mocked conversation is titled by the server).
    await expect(heading(page, 1, 'Vem är på plats')).toBeVisible();
    await expect(page.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    await expect(page).toHaveTitle('Min AI · Startsidan');
    await expectNoAxeViolations(page);
  });

  test('1.4.10: the answer under the box reflows at 320 px, with the box docked at the foot', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    const release = api.holdAnswer();
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    const card = answerCard(page);
    await expect(card.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await expect(composer(page)).toBeFocused();
    expect(await reflowProblems(page, card)).toEqual([]);
    release();
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    await expect(card.getByRole('button', { name: 'Stäng svaret' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Fortsätt i Min AI' })).toBeVisible();
    expect(await reflowProblems(page, card)).toEqual([]);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
  });
});
