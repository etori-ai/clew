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
import { competenceConversation } from './data';
import { competenceTypes } from './competence';

test.use({ viewport: desktop });

/**
 * A question on its way (D36): the question is drawn at once with its answer pending under it, the transcript's log is
 * busy until the answer is written, the box rests with Stoppa, and the page never jumps under the person's cursor.
 */
test.describe('the answer on its way', () => {
  test('the question is drawn at once, the log is busy while the answer is written, the box keeps the focus with Stoppa, and the answer takes its place', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    // Held, not timed: the axe scan below takes over a second here and longer in CI, and an answer that comes first would let Enter send the next question.
    const release = api.holdAnswer();
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    const log = page.getByRole('log');
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await expect(log).toContainText('Vem är på plats?');
    await expect(page.getByRole('button', { name: 'Stoppa' })).toBeEnabled();
    await expect(heading(page, 1, 'Vem är på plats?')).toBeVisible();
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
    await expect(heading(page, 1, 'Vad vill du få gjort?')).toBeVisible();
    await expect(composer(page)).toHaveText('Vem är på plats?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Frågan avbröts'));
    await page.waitForTimeout(api.answerDelay + 500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(composer(page)).toHaveText('Vem är på plats?');
  });

  // D92: the conversation takes Hem's place with Astryx's fade and Hem comes back with one; under reduced motion both are
  // there at once. (Hem's own first entrance is D76's, tested in loading.spec.ts.)
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`the conversation fades in over Hem, Hem fades back, and ${reducedMotion} motion is respected`, async ({
      page,
      api,
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
      const release = api.holdAnswer();
      const input = composer(page);
      await input.fill('Vem är på plats?');
      await input.press('Enter');
      const log = page.getByRole('log');
      await expect(log).toContainText('Vem är på plats?');
      expect(await entering(log)).toBe(reducedMotion === 'no-preference');
      release();
      await expect(log).not.toHaveAttribute('aria-busy', 'true');
      await page.getByRole('button', { name: 'Stäng samtalet' }).click();
      const greeting = heading(page, 1, 'Vad vill du få gjort?');
      await expect(greeting).toBeVisible();
      expect(await entering(greeting)).toBe(reducedMotion === 'no-preference');
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
    const greeting = (await heading(page, 1, 'Vad vill du få gjort?').boundingBox())!;
    const top = (await input.boundingBox())!.y;
    expect(top).toBeGreaterThan(greeting.y);
    // The quiet page (D112 item 2): Behöver dig says that nothing does, and the day stands beside it.
    await expect(
      page.getByRole('region', { name: 'Behöver dig' }).getByText('Inget behöver dig just nu.'),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'I dag' })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Sedan i går' })
        .getByText('Inget har blivit klart sedan i går, och inget väntar på andra.'),
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
    await expect(page.locator('#work-fakturor')).toBeVisible();
    await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  });
});

/**
 * Every answer keeps its card (D38): the latest answer's is open and draws the rows the answer names, every one, their
 * names leading to the person; an older answer's stays folded in its place, saying what the turn recorded, and is read
 * only when the person unfolds it, once. Where the answer came from is the turn's line, never the answer's text.
 */
test.describe('the cards in a conversation', () => {
  /** The capabilities the page reads, in the order it reads them. */
  const readsOf = (page: Page) => {
    const reads: string[] = [];
    page.on('request', request => {
      const read = /\/api\/cap\/(competence\.[a-z]+)/.exec(request.url());
      if (read) reads.push(read[1]!);
    });
    return reads;
  };

  test('the latest card draws the row the answer names and the name leads to the person; an older card is folded, says its count and is read once, when unfolded', async ({
    page,
    api,
  }) => {
    await page.setViewportSize(desktop);
    api.competenceTypes = competenceTypes();
    api.threads = [...api.threads, competenceConversation];
    const reads = readsOf(page);
    await open(page, '/conversations/kompetens');
    const log = page.getByRole('log');
    // The latest card: Maria's row alone, though it is the fourth of the read, and her name is the way to her page.
    const maria = log.getByRole('link', { name: 'Maria Källström', exact: true });
    await expect(maria).toHaveAttribute('href', /^\/people\/maria\.kallstrom\?from=%2Fconversations%2Fkompetens/);
    await expect(log.getByText('Anna Lindqvist')).toHaveCount(0);
    await expect(log.getByText(/^1 av 4 rader\./)).toBeVisible();
    // Where the answer came from is the turn's line; the answer's text carries no system and no time.
    await expect(log.getByText('Assistenten · läste Kompetenser att åtgärda', { exact: true })).toBeVisible();
    await expect(log.getByText('Maria Källströms brandskydd går ut 20 januari 2027.', { exact: true })).toBeVisible();
    await expect(log.getByText(/Kompetens \d\d:\d\d/)).toHaveCount(0);
    // The older answer's card, folded in its place: its title, its system and its count as the turn recorded them.
    const folded = log.getByRole('button', { name: 'Mina kompetenser · Kompetens · 1 av 6 rader', exact: true });
    await expect(folded).toHaveAttribute('aria-expanded', 'false');
    // Opening the conversation read the latest card's view alone.
    await expect.poll(() => reads).toEqual(['competence.attention']);
    await expectNoAxeViolations(page);
    // The person goes back up the history to the older answer. (At the foot of the conversation ChatLayout follows the
    // newest message and scrolls to it as the card grows: the Astryx gap in docs/maintainers/open-questions.md.)
    const box = (await log.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -2000);
    await expect(folded).toBeInViewport();
    // Unfolded from the keyboard: the focus stays, the state is said, and the read is made then, once.
    await folded.focus();
    const before = (await folded.boundingBox())!.y;
    await page.keyboard.press('Enter');
    await expect(folded).toHaveAttribute('aria-expanded', 'true');
    await expect(folded).toBeFocused();
    await expect(log.getByText('Brandskydd', { exact: true })).toBeVisible();
    await expect(log.getByText(/^1 av 6 rader\./)).toBeVisible();
    await expect(log.getByText('Heta arbeten', { exact: true })).toHaveCount(0);
    // What unfolds opens under the toggle; the toggle itself stays where the person pressed it.
    await expect(folded).toBeInViewport();
    expect((await folded.boundingBox())!.y).toBe(before);
    await page.keyboard.press('Enter');
    await expect(folded).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(folded).toHaveAttribute('aria-expanded', 'true');
    await expect(log.getByText('Brandskydd', { exact: true })).toBeVisible();
    expect(reads).toEqual(['competence.attention', 'competence.holdings']);
    await expectNoAxeViolations(page);
  });

  test('the cards reflow at 320 px, folded and unfolded', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    api.competenceTypes = competenceTypes();
    api.threads = [...api.threads, competenceConversation];
    await open(page, '/conversations/kompetens');
    const log = page.getByRole('log');
    await expect(log.getByRole('link', { name: 'Maria Källström', exact: true })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    const folded = log.getByRole('button', { name: /^Mina kompetenser · Kompetens/ });
    await folded.click();
    await expect(log.getByText('Brandskydd', { exact: true })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
