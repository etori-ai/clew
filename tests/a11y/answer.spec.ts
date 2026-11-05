import type { Page } from '@playwright/test';
import { announcements, composer, desktop, expect, expectNoAxeViolations, open, test } from './support';

test.use({ viewport: desktop });

/**
 * A question on its way (D36): the question is drawn at once with its answer pending under it, the transcript's log is
 * busy until the answer is written, the box rests with Stoppa, and the page never jumps under the person's cursor.
 */
test.describe('the answer on its way', () => {
  test('the question is drawn at once, the log is busy while the answer is written, the box keeps the focus with Stoppa, and the answer takes its place', async ({ page, api }) => {
    await open(page, '/');
    api.answerDelay = 1_500;
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    const log = page.getByRole('log');
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await expect(log).toContainText('Vem är på plats?');
    await expect(page.getByRole('button', { name: 'Stoppa' })).toBeEnabled();
    await expect(page.getByRole('heading', { level: 1, name: 'Vem är på plats?' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The box keeps the focus and takes the next question while the answer is written; Enter waits for the answer.
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type('Och i morgon?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveText('Och i morgon?');
    await expect(log).toContainText('Tio personer är på plats i dag.');
    await expect(log).not.toHaveAttribute('aria-busy', 'true');
    // The question is drawn once: the pending one became the written one in place.
    await expect(log.getByText('Vem är på plats?', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stoppa' })).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveText('Och i morgon?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Tio personer är på plats i dag.'));
  });

  // That a stopped turn writes nothing is the server's promise, tested in tests/unit/conversation.test.ts; here the page lets go of it.
  test('Stoppa puts the question back in the box, says so, and an answer that arrives later is not drawn', async ({ page, api }) => {
    await open(page, '/');
    api.answerDelay = 2_000;
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Stoppa' }).click();
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Vad vill du göra?' })).toBeVisible();
    await expect(composer(page)).toHaveText('Vem är på plats?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Frågan avbröts'));
    await page.waitForTimeout(api.answerDelay + 500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(composer(page)).toHaveText('Vem är på plats?');
  });

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

  /** Where the box's block ends against the middle of the scrolling column, and whether that column scrolls (D39). */
  const boxInColumn = (page: Page) => page.evaluate(() => {
    const block = document.querySelector('section[aria-label="Vad vill du göra"]')!;
    const column = block.parentElement!.parentElement!;
    const style = getComputedStyle(column);
    const top = parseFloat(style.paddingTop), bottom = parseFloat(style.paddingBottom);
    const middle = column.getBoundingClientRect().top + top + (column.clientHeight - top - bottom) / 2;
    return { offset: block.getBoundingClientRect().bottom - middle, scrolls: column.scrollHeight > column.clientHeight };
  });

  test('with nothing above it the box rests on the middle of the column, and "Menar du" under it does not move it', async ({ page, api }) => {
    api.threads = [];
    await open(page, '/');
    const input = composer(page);
    const resting = await boxInColumn(page);
    expect(Math.abs(resting.offset)).toBeLessThanOrEqual(1);
    expect(resting.scrolls).toBe(false);
    // The day line is the column's foot, under the chips, not part of what scrolls.
    await expect(page.getByRole('region', { name: 'I dag' })).toBeVisible();
    const top = (await input.boundingBox())!.y;
    await input.fill('attestera');
    await expect(page.getByRole('list', { name: 'Menar du' })).toBeVisible();
    expect((await input.boundingBox())!.y).toBe(top);
    await expectNoAxeViolations(page);
  });

  test('a brief that fills the upper half pushes the box down instead, and the page gets no scrollbar it does not need', async ({ page, api: _ }) => {
    await open(page, '/');
    const full = await boxInColumn(page);
    expect(full.scrolls).toBe(false);
    // On a lower window the brief no longer fits above the middle: the box follows it, below the line, and nothing overlaps.
    await page.setViewportSize({ width: 1280, height: 600 });
    const low = await boxInColumn(page);
    expect(low.offset).toBeGreaterThan(1);
    const brief = (await page.getByRole('list', { name: 'Det som behöver dig' }).boundingBox())!;
    const heading = (await page.getByRole('heading', { level: 1, name: 'Vad vill du göra?' }).boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(brief.y + brief.height);
  });

  test('while the cards load the brief is drawn as its shape and the page never says that nothing needs you', async ({ page, api }) => {
    api.threadsDelay = 1_500;
    await page.goto('/');
    await expect(page.getByText('Hämtar det som behöver dig …')).toBeAttached();
    await expect(page.getByText(/Inget behöver dig/)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Det som behöver dig' })).toBeVisible();
    await expect(page.getByText('Hämtar det som behöver dig …')).toHaveCount(0);
  });
});
