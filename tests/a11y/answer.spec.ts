import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  hemLine,
  narrow,
  open,
  reflowProblems,
  test,
} from './support';
import { NOW, competenceConversation } from './data';
import { competenceTypes } from './competence';

test.use({ viewport: desktop });
/** Hem's heading (board Hem): the greeting at the mocked clock, as `hem.spec.ts` reads it. */
const GREETING = 'God morgon, Testa';

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
    await expect(heading(page, 1, GREETING)).toBeVisible();
    // Back on Hem, the question stands in Hem's line, a plain field whose value it is.
    await expect(hemLine(page)).toHaveValue('Vem är på plats?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Frågan avbröts'));
    await page.waitForTimeout(api.answerDelay + 500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('log')).toHaveCount(0);
    await expect(hemLine(page)).toHaveValue('Vem är på plats?');
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
      // Esc leads back to where the conversation was asked (the conversation's page has no close button, board Samtal).
      await page.keyboard.press('Escape');
      const greeting = heading(page, 1, GREETING);
      await expect(greeting).toBeVisible();
      expect(await entering(greeting)).toBe(reducedMotion === 'no-preference');
    });
  }

  test('with nothing pushed the page says so under the box, which stays under the greeting and does not move as the person types', async ({
    page,
    api,
  }) => {
    api.threads = [];
    await open(page, '/');
    const input = composer(page);
    const greeting = (await heading(page, 1, GREETING).boundingBox())!;
    const top = (await input.boundingBox())!.y;
    expect(top).toBeGreaterThan(greeting.y);
    // The quiet page (D112 item 2): Behöver dig says that nothing does, and the day stands beside it.
    await expect(
      page.getByRole('region', { name: 'Behöver dig' }).getByText('Inget behöver dig just nu.'),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'I dag' })).toBeVisible();
    await input.fill('attestera');
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
    // What the turn read is its call (board SamtalVerktyg); the answer's text carries no system and no time.
    await expect(log.getByText('Läste Krav som inte uppfylls', { exact: true })).toBeVisible();
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

/**
 * A conversation about a thing (D126 rules 2 and 5, board Samtal): "Öppna som samtal" in the assistant's pane on a thing's
 * page (D131 item 9) lands on a new conversation's page, `/conversations/new` with the thing in its address, before
 * anything is asked in the pane. The header names the thing, the thing stands
 * beside the transcript drawn with the queue's pane's parts, the box has the focus and nothing is sent until the person
 * writes; the question then goes with the thing. ✕ lets go of the thing and keeps the conversation. Narrower, the thing
 * is one link away in the header.
 */
test.describe('a conversation about a thing', () => {
  const TITLE = 'Attestera 3 fakturor, 48 200 kr';
  /** The thing's page asks through the frame's pane (D131 item 9), which leads to the conversation's page. */
  const asConversation = async (page: Page) => {
    await page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' }).click();
    // Beside the page from 1340 px, a drawer over it below: the same pane either way.
    await page.getByRole('link', { name: 'Öppna som samtal' }).click();
  };
  test('"Öppna som samtal" lands on an empty conversation with the thing beside it, and nothing is sent until the person writes', async ({
    page,
    api,
  }) => {
    // Nothing on the way throws (the start page once failed at this address before it drew anything).
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await open(page, '/items/fakturor');
    await asConversation(page);
    await expect(page).toHaveURL(/\/conversations\/new\?card=fakturor$/);
    // The page says what it is before anything is written (the product owner, 2026-11-14): never "Nytt samtal" for a
    // conversation about a thing.
    await expect(heading(page, 1, `Fråga om ${TITLE}`)).toBeVisible();
    await expect(page.getByText('Samtal med assistenten', { exact: true })).toBeVisible();
    const pane = page.getByRole('complementary', { name: TITLE });
    // The pane's title is the link to the item's page, the decisions stand under it, and it has no "Fråga assistenten".
    await expect(pane.getByRole('link', { name: TITLE })).toHaveAttribute('href', /^\/items\/fakturor\?from=/);
    await expect(pane.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    // Nor "Lägg till i samtalet": the thing beside the transcript goes with every question as it is.
    await expect(pane.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // A conversation about one thing has nothing else to put beside it: no menu that leads nowhere.
    await expect(pane.getByRole('button', { name: 'Annat i samtalet' })).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('log')).toHaveCount(0);
    expect(api.asked).toHaveLength(0);
    expect(errors).toEqual([]);
    await expectNoAxeViolations(page);
    // A reload is the same empty conversation, never Hem.
    await page.reload();
    await expect(heading(page, 1, `Fråga om ${TITLE}`)).toBeVisible();
    await expect(pane.getByRole('link', { name: TITLE })).toBeVisible();
    // The question goes with the thing, which keeps its place beside the conversation once it has an address.
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(page.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    // It also says that the thing stands open beside the transcript, so the assistant reads "det öppna ärendet" as it.
    expect(api.asked.at(-1)).toMatchObject({
      text: 'Vem är på plats?',
      chips: [{ ref: 'thread:fakturor' }],
      beside: 'thread:fakturor',
    });
    // Once asked, the question is the title and the line under it says what the conversation is about.
    await expect(page.getByText(`Samtal med assistenten\u00a0· om ${TITLE}`, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/konversation\?card=fakturor$/);
    // The thing's chip is not drawn again above the question: it stands beside it.
    await expect(page.getByRole('log').getByText(TITLE)).toHaveCount(0);
    // ✕ lets go of the thing; the conversation stays and the box has the focus.
    await pane.getByRole('button', { name: 'Stäng ärendet' }).click();
    await expect(page).toHaveURL(/\/conversations\/konversation$/);
    await expect(page.getByRole('complementary', { name: TITLE })).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    // With nothing beside the transcript a question goes alone.
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(page.getByRole('log').getByText('Tio personer är på plats i dag.')).toHaveCount(2);
    expect(api.asked.at(-1)).toEqual({ text: 'Vem är på plats?', chips: [], conversationId: 'konversation' });
  });
  test('Esc in the pane lets go of the thing, and Esc in the conversation leads back to where it was asked', async ({
    page,
    api: _,
  }) => {
    await open(page, '/items/fakturor');
    await asConversation(page);
    const pane = page.getByRole('complementary', { name: TITLE });
    await pane.getByRole('link', { name: TITLE }).focus();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/conversations\/new$/);
    await expect(composer(page)).toBeFocused();
    // Back to the item's page as it stood, the assistant's pane open beside it.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/items\/fakturor\?ask=1$/);
  });
  test('the pane has a menu over what the conversation has named, a row where the item was drawn, and a width of its own', async ({
    page,
    api,
  }) => {
    const OTHER = 'Ledighetsansökan från Johan Byström';
    // A conversation whose answers are about two work items, one each.
    api.threads.push({
      ...api.threads.find(t => t.id === 'fraga')!,
      id: 'tva-saker',
      title: 'Vad väntar på mig?',
      messages: [
        { id: 'm1', role: 'user', body: 'Vad väntar på mig?', createdAt: NOW },
        {
          id: 'm2',
          role: 'assistant',
          body: 'Tre fakturor att attestera.',
          createdAt: NOW,
          meta: { cards: ['fakturor'] },
        },
        { id: 'm3', role: 'user', body: 'Något mer?', createdAt: NOW },
        { id: 'm4', role: 'assistant', body: 'En ledighetsansökan.', createdAt: NOW, meta: { cards: ['ledighet'] } },
      ],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/conversations/tva-saker?card=fakturor');
    const log = page.getByRole('log');
    let pane = page.getByRole('complementary', { name: TITLE });
    await expect(pane.getByRole('link', { name: TITLE })).toBeVisible();
    // One item, one place: where the item beside the transcript was drawn, a row says where it is. The other is drawn.
    await expect(log.getByText('Visas bredvid samtalet', { exact: true })).toHaveCount(1);
    await expect(log.getByRole('link', { name: TITLE })).toHaveCount(0);
    await expect(log.getByRole('link', { name: OTHER })).toBeVisible();
    await expectNoAxeViolations(page);

    // The menu: by kind and with how many, each row a link, the thing beside the transcript now said as such.
    await pane.getByRole('button', { name: 'Annat i samtalet' }).click();
    const menu = page.getByRole('menu', { name: 'Annat i samtalet' });
    await expect(
      menu.getByRole('group', { name: 'Ärenden · 2' }).or(menu.getByRole('group', { name: 'Ärenden · 2' })),
    ).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: new RegExp(TITLE) })).toContainText('Visas nu');
    await expect(menu.getByRole('menuitem', { name: new RegExp(OTHER) })).toHaveAttribute(
      'href',
      '/conversations/tva-saker?card=ledighet',
    );
    await expectNoAxeViolations(page);
    // A row puts its thing beside the transcript in the place of the one that stood there; the menu on it has the focus.
    // Opened with the pointer, the menu takes the first arrow key on its first row.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: new RegExp(OTHER) })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/conversations\/tva-saker\?card=ledighet$/);
    pane = page.getByRole('complementary', { name: OTHER });
    await expect(pane.getByRole('link', { name: OTHER })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Annat i samtalet' })).toBeFocused();
    await expect(log.getByText('Visas bredvid samtalet', { exact: true })).toHaveCount(1);
    await expect(log.getByRole('link', { name: TITLE })).toBeVisible();
    await expect(log.getByRole('link', { name: OTHER })).toHaveCount(0);

    // "Visa här" lets the pane go of the item: the answer draws it again, and its title there has the focus.
    await log.getByRole('button', { name: 'Visa här' }).click();
    await expect(page).toHaveURL(/\/conversations\/tva-saker$/);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(log.getByRole('heading', { name: OTHER })).toBeFocused();
    await expect(log.getByText('Visas bredvid samtalet', { exact: true })).toHaveCount(0);

    // The pane's width is the person's own: the grip takes the arrow keys, and the width is kept over a reload.
    await open(page, '/conversations/tva-saker?card=fakturor');
    const grip = page.getByRole('separator', { name: 'Ändra rutans bredd' });
    await expect(grip).toHaveAttribute('aria-valuenow', '440');
    await grip.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(grip).not.toHaveAttribute('aria-valuenow', '440');
    const wider = Number(await grip.getAttribute('aria-valuenow'));
    expect(wider).toBeGreaterThan(440);
    expect(Math.round((await page.getByRole('complementary', { name: TITLE }).boundingBox())!.width)).toBe(wider);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Ändra rutans bredd' })).toHaveAttribute(
      'aria-valuenow',
      String(wider),
    );
    await expectNoAxeViolations(page);
  });
  test('the menu leads to the work items an answer names among its rows, and to what the person has put beside the conversation', async ({
    page,
    api,
  }) => {
    const OTHER = 'Ledighetsansökan från Johan Byström';
    await page.setViewportSize({ width: 1440, height: 900 });
    // An answer that names two work items among the rows of a list keeps their ids (`viewItems`): with the first one
    // beside the transcript the menu already leads to the other.
    api.threads.push({
      ...api.threads.find(t => t.id === 'fraga')!,
      id: 'forsenade',
      title: 'Vilka är försenade?',
      messages: [
        { id: 'm1', role: 'user', body: 'Vilka är försenade?', createdAt: NOW },
        {
          id: 'm2',
          role: 'assistant',
          body: 'Två ärenden är försenade.',
          createdAt: NOW,
          meta: { viewItems: ['fakturor', 'ledighet'] },
        },
      ],
    });
    // With nothing beside the transcript the header says how many the conversation holds, and is the way to the pane.
    await open(page, '/conversations/forsenade');
    await expect(page.getByRole('complementary')).toHaveCount(0);
    const held = page.getByRole('button', { name: /^I samtalet\s·\s2$/ });
    await held.click();
    const all = page.getByRole('menu', { name: /^I samtalet/ });
    await expect(all.getByRole('menuitem')).toHaveCount(2);
    await expectNoAxeViolations(page);
    await all.getByRole('menuitem', { name: new RegExp(TITLE) }).click();
    await expect(page).toHaveURL(/\/conversations\/forsenade\?card=fakturor$/);
    // The button stays where it is, and so does the focus; the pane has its own menu to the other item.
    await expect(held).toBeFocused();
    await page.getByRole('complementary', { name: TITLE }).getByRole('button', { name: 'Annat i samtalet' }).click();
    await expect(page.getByRole('menu', { name: 'Annat i samtalet' }).getByRole('menuitem')).toHaveCount(2);
    await page.keyboard.press('Escape');
    // The conversation's answers name no work item (they may name theirs only through a list's rows): with one thing
    // beside it there is nowhere else to lead.
    await open(page, '/conversations/fraga?card=fakturor');
    await expect(page.getByRole('complementary', { name: TITLE }).getByRole('link', { name: TITLE })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Annat i samtalet' })).toHaveCount(0);
    // A second thing beside it: the menu now leads back to the first, also after a reload.
    await open(page, '/conversations/fraga?card=ledighet');
    const pane = page.getByRole('complementary', { name: OTHER });
    await pane.getByRole('button', { name: 'Annat i samtalet' }).click();
    const menu = page.getByRole('menu', { name: 'Annat i samtalet' });
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: new RegExp(OTHER) })).toContainText('Visas nu');
    await menu.getByRole('menuitem', { name: new RegExp(TITLE) }).click();
    await expect(page).toHaveURL(/\/conversations\/fraga\?card=fakturor$/);
    await expect(page.getByRole('complementary', { name: TITLE }).getByRole('link', { name: TITLE })).toBeVisible();
    await expectNoAxeViolations(page);
  });
  for (const [layout, viewport] of [
    ['a laptop', { width: 1024, height: 768 }],
    ['320 px', narrow],
  ] as const)
    test(`at ${layout} the thing is one link away in the header, and nothing scrolls sideways`, async ({
      page,
      api: _,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, '/conversations/new?card=fakturor');
      await expect(page.getByRole('complementary', { name: TITLE })).toHaveCount(0);
      await expect(page.getByRole('link', { name: TITLE })).toHaveAttribute('href', /^\/items\/fakturor\?from=/);
      expect(await reflowProblems(page)).toEqual([]);
      await expectNoAxeViolations(page);
    });
});

/**
 * The assistant drafts, the person decides (D112 item 8), on the conversation's page since the panel with a box of its
 * own left the pages (D126 rules 2 and 5): the item stands beside the transcript, and the draft in the transcript opens
 * the item's own action dialog at its last and its first step. The mock answers "Boka det …" with a draft of "Boka
 * samtalet" on the rehab item (`data.ts`).
 */
test.describe('the assistant drafts, the person decides (D112 item 8)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const ask = async (page: Page, text: string) => {
    const box = composer(page);
    await box.fill(text);
    await box.press('Enter');
  };

  test('a draft shows its values with Utkast; Granska och boka opens the dialog at its last step and Ändra at its first; once sent the draft says so', async ({
    page,
    api,
  }) => {
    await open(page, '/conversations/new?card=omtanke');
    await ask(page, 'Boka det på fredag och skriv något vänligt');
    const log = page.getByRole('log');
    const draft = log.getByRole('region', { name: 'Utkast: Boka samtalet' });
    await expect(draft.getByText('Utkast', { exact: true })).toBeVisible();
    await expect(draft.getByText('Rum 12')).toBeVisible();
    await expect(draft.getByText('Hej! Ses vi på fredag?')).toBeVisible();
    await expectNoAxeViolations(page);
    // "Granska och boka": the dialog at "Det här händer", read for exactly the drafted values; nothing is sent.
    await draft.getByRole('button', { name: 'Granska och boka' }).click();
    const dialog = page.getByRole('dialog', { name: 'Boka samtalet' });
    await expect(dialog.getByRole('heading', { name: 'När du trycker Boka samtalet' })).toBeVisible();
    await expect.poll(() => api.effectReads.length).toBeGreaterThan(0);
    expect(api.effectReads.at(-1)!.body).toMatchObject({
      values: { when: '2026-11-06T08:00:00.000Z', place: 'Rum 12', message: 'Hej! Ses vi på fredag?' },
    });
    expect(api.acted).toEqual([]);
    await dialog.getByRole('button', { name: 'Avbryt' }).click();
    await expect(dialog).toBeHidden();
    // "Ändra": the same dialog at its first step, with the drafted time chosen.
    await draft.getByRole('button', { name: 'Ändra' }).click();
    await expect(dialog.getByRole('radiogroup', { name: /^När/ })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /^Fredag 6 november/ })).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Plats' })).toHaveValue('Rum 12');
    await dialog.getByRole('button', { name: 'Nästa' }).click();
    await dialog.getByRole('button', { name: 'Boka samtalet' }).click();
    await expect(dialog).toBeHidden();
    expect(api.acted.at(-1)).toMatchObject({
      threadId: 'omtanke',
      body: { actionId: 'book', values: { when: '2026-11-06T08:00:00.000Z', place: 'Rum 12' } },
    });
    // The draft reads the item back: sent, with the source's headline, and no buttons any more.
    await expect(draft.getByText('Samtalet är registrerat i personalsystemet.')).toBeVisible();
    await expect(draft.getByRole('button', { name: 'Granska och boka' })).toHaveCount(0);
  });

  test('a newer draft of the same action marks the older one as replaced', async ({ page, api: _ }) => {
    await open(page, '/conversations/new?card=omtanke');
    const log = page.getByRole('log');
    await ask(page, 'Boka det på fredag');
    await expect(log.getByRole('region', { name: 'Utkast: Boka samtalet' })).toHaveCount(1);
    await ask(page, 'Boka det på fredag i stället');
    const drafts = log.getByRole('region', { name: 'Utkast: Boka samtalet' });
    await expect(drafts).toHaveCount(2);
    await expect(drafts.first().getByText('Ersatt av ett nyare utkast').first()).toBeVisible();
    // The dot beside the word is decoration, so the state is heard once.
    await expect(drafts.first().getByRole('img', { name: 'Ersatt av ett nyare utkast' })).toHaveCount(0);
    await expect(drafts.first().getByRole('button', { name: 'Granska och boka' })).toHaveCount(0);
    await expect(drafts.last().getByRole('button', { name: 'Granska och boka' })).toBeVisible();
  });
});
