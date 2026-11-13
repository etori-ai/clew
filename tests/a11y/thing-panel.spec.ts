import type { Locator, Page } from '@playwright/test';
import {
  announcements,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  short,
  test,
} from './support';
import { ENTITY_UNIT } from './data';
import { menuRows } from './phonebook';
import { People } from './person-data';
import { Units } from './unit-data';

/**
 * One panel, always about a thing (D112 item 7, boards Calendar and Assistant): on top the thing, under it the
 * conversation about it, at the foot the box, while a model is configured (D8: without one the panel is the thing alone).
 * Asking starts or continues one conversation whose subject is the thing, drawn in the panel with the Chat family; while
 * it runs the thing's facts fold under "Visa allt" and its buttons stay. "Fråga Clew" in a page's header makes the page
 * the thing. The assistant's draft of an action (item 8) opens the action's own dialog at its last and its first step.
 * The mock answers every question with "Tio personer är på plats i dag." unless the text asks for something else
 * (`data.ts`), and "Boka det …" with a draft of "Boka samtalet" on the rehab item.
 */
const WIDE = { width: 1440, height: 900 };
const ANSWER = 'Tio personer är på plats i dag.';
const item = (page: Page) => page.getByRole('complementary', { name: 'Ärende' });
/** The thing's box asks about the thing only: no `@` and no list to pick from, so it is a plain text field. */
const box = (scope: Locator | Page) => scope.getByRole('textbox', { name: 'Fråga Clew' });
const ask = async (scope: Locator, text: string) => {
  await box(scope).fill(text);
  await box(scope).press('Enter');
};
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });

test.describe('without a model the panel is the thing alone (D8)', () => {
  test.use({ viewport: WIDE });

  test('a work item beside a page has no box and no conversation, and no page offers Fråga Clew', async ({
    page,
    api,
  }) => {
    api.modelChoices = 0;
    api.menu = menuRows;
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await expect(panel.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(box(page)).toHaveCount(0);
    await expect(panel.getByRole('log')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await new People().route(page);
    await new Units().route(page);
    for (const path of [
      '/items/omtanke',
      '/people/johan',
      `/units/${ENTITY_UNIT.id}`,
      '/tools/phonebook.directory',
      '/todo',
      '/todo?item=omtanke',
    ]) {
      await open(page, path);
      await expect(page.getByRole('link', { name: 'Fråga Clew' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Fråga Clew' })).toHaveCount(0);
      await expect(box(page)).toHaveCount(0);
    }
    await open(page, '/calendar');
    await expect(page.getByRole('link', { name: 'Fråga om veckan' })).toHaveCount(0);
  });
});

test.describe('the box beside a thing (D112 item 7)', () => {
  test.use({ viewport: WIDE });

  test('with a model the box stands at the foot of the panel; opening the thing sends nothing and leaves the box alone', async ({
    page,
    api,
  }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await expect(box(panel)).toBeVisible();
    await expect(box(panel)).not.toBeFocused();
    await expect.poll(() => panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    expect(api.asked).toEqual([]);
    // Nothing points the box at another thing: "Lägg till i samtalet" is a conversation page's control only.
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('asking draws the answer under the thing, keeps the focus in the box, says the answer, and folds the facts with Visa allt while the buttons stay', async ({
    page,
    api,
  }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await ask(panel, 'Vem är på plats i dag?');
    await expect(panel.getByRole('log').getByText(ANSWER)).toBeVisible();
    // The question went with the item as its subject, as a new conversation, and the page stayed where it was.
    expect(api.asked.at(-1)).toMatchObject({ text: 'Vem är på plats i dag?', chips: [{ ref: 'thread:omtanke' }] });
    expect(api.asked.at(-1)!.conversationId).toBeUndefined();
    await expect(page).toHaveURL('/staff?card=omtanke');
    await expect(box(panel)).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(ANSWER));
    // The facts fold to the header and the buttons; "Visa allt" unfolds them.
    await expect(panel.getByRole('heading', { name: 'Varför ser jag detta?' })).toBeHidden();
    await expect(panel.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    const all = panel.getByRole('button', { name: 'Visa allt' });
    await expect(all).toHaveAttribute('aria-expanded', 'false');
    await all.click();
    await expect(panel.getByRole('heading', { name: 'Varför ser jag detta?' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Visa mindre' })).toHaveAttribute('aria-expanded', 'true');
    // The second question continues the same conversation.
    await ask(panel, 'Och vem saknas?');
    await expect.poll(() => api.asked.length).toBe(2);
    expect(api.asked.at(-1)).toMatchObject({ conversationId: 'konversation', chips: [{ ref: 'thread:omtanke' }] });
    // The conversation is kept under Samtal in the rail (beside an earlier one with the same question).
    await expect(
      rail(page)
        .getByRole('link', { name: 'Vem är på plats i dag?' })
        .and(page.locator('[href="/conversations/konversation"]')),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a long exchange scrolls under the thing: its title and its buttons stay in view above the transcript', async ({
    page,
    api,
  }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    // Three turns, one of them with a work item drawn in it and one with steps and sources: more than the panel holds.
    for (const [question, answered] of [
      ['Vem är på plats i dag?', ANSWER],
      ['Vilka fakturor ska jag attestera?', 'Två matchar sina beställningar'],
      ['Vad gör jag om någon har ramlat?', 'Skriv avvikelse i avvikelsesystemet'],
    ] as const) {
      await ask(panel, question);
      await expect(panel.getByRole('log').getByText(answered).first()).toBeVisible();
    }
    expect(api.asked).toHaveLength(3);
    // The transcript has scrolled: its first question is out of sight, the newest answer is above the box.
    await expect(panel.getByRole('log').getByText('Vem är på plats i dag?').first()).not.toBeInViewport();
    await expect(panel.getByRole('log').getByText('Skriv avvikelse i avvikelsesystemet')).toBeInViewport();
    // The thing's title and its buttons did not go with it.
    await expect(panel.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: 'Boka samtalet' })).toBeInViewport({ ratio: 1 });
    await expect(box(panel)).toBeInViewport({ ratio: 1 });
    await expectNoAxeViolations(page);
  });

  test('from the panel’s heading the keyboard reaches the box without leaving the panel', async ({ page, api: _ }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' }).focus();
    for (let i = 0; i < 40; i++) {
      if (await box(panel).evaluate(el => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
      expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await expect(box(panel)).toBeFocused();
  });

  test('another item in the reading pane starts with an empty transcript; the earlier exchange stays under Samtal', async ({
    page,
    api,
  }) => {
    await open(page, '/todo?item=omtanke');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    await ask(pane, 'Vem är på plats i dag?');
    await expect(pane.getByText(ANSWER)).toBeVisible();
    await page.locator('#work-fakturor a[href]').click();
    await expect(page).toHaveURL(/item=fakturor/);
    await expect(pane.locator('#card-fakturor')).toBeVisible();
    await expect(pane.getByText(ANSWER)).toHaveCount(0);
    await expect(pane.getByRole('button', { name: 'Visa allt' })).toHaveCount(0);
    await expect(
      rail(page)
        .getByRole('link', { name: 'Vem är på plats i dag?' })
        .and(page.locator('[href="/conversations/konversation"]')),
    ).toBeVisible();
    // Asking about the new item is a new conversation about it.
    await ask(pane, 'Vad gäller det?');
    await expect.poll(() => api.asked.length).toBe(2);
    expect(api.asked.at(-1)).toMatchObject({ chips: [{ ref: 'thread:fakturor' }] });
    expect(api.asked.at(-1)!.conversationId).toBeUndefined();
    // "Fråga Clew" with an item in the pane is the pane's own box.
    await page.getByRole('main').getByRole('button', { name: 'Fråga Clew' }).click();
    await expect(box(pane)).toBeFocused();
  });

  test('a long exchange continues in the conversation view with the item as its artifact, and back is the panel as it was', async ({
    page,
    api: _,
  }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await expect(panel.getByRole('link', { name: 'Fortsätt som samtal' })).toHaveCount(0);
    await ask(panel, 'Vem är på plats i dag?');
    await expect(panel.getByText(ANSWER)).toBeVisible();
    await panel.getByRole('link', { name: 'Fortsätt som samtal' }).click();
    await expect(page).toHaveURL('/conversations/konversation?card=omtanke');
    await expect(page.getByRole('heading', { level: 1, name: 'Vem är på plats i dag?' })).toBeVisible();
    const beside = item(page);
    await expect(beside.getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    // The conversation's own box is the one to ask in: the thing beside it has none of its own.
    await expect(box(beside)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Svara i samtalet' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/staff?card=omtanke');
    await expect(item(page).getByText(ANSWER)).toBeVisible();
  });
});

test.describe('Fråga Clew in a page’s header makes the page the thing', () => {
  test.use({ viewport: WIDE });

  const pages = [
    ['a work item’s page', '/items/omtanke', 'Omtankesamtal med Anna Lindqvist', 'Ärendet på sidan'],
    ['a person’s page', '/people/johan', 'Johan Byström', 'Personen på sidan'],
    ['a unit’s page', `/units/${ENTITY_UNIT.id}`, ENTITY_UNIT.label, 'Enheten på sidan'],
    ['a tool’s page', '/tools/phonebook.directory', 'Telefonbok', 'Verktyget på sidan'],
    ['Att göra', '/todo', 'Att göra', 'Behöver dig'],
  ] as const;
  for (const [what, path, name, words] of pages)
    test(`on ${what} the panel opens with the page as its thing, the focus on its heading, and the box under it`, async ({
      page,
      api,
    }) => {
      api.menu = menuRows;
      await new People().route(page);
      await new Units().route(page);
      await open(page, path);
      const button = page.getByRole('main').getByRole('link', { name: 'Fråga Clew' });
      await button.click();
      await expect(page).toHaveURL(/[?&]ask=1/);
      const panel = page.getByRole('complementary', { name });
      await expect(panel.getByText(words, { exact: true })).toBeVisible();
      await expect(panel.getByRole('heading', { level: 2, name, exact: true })).toBeFocused();
      await expect(box(panel)).toBeVisible();
      await expectNoAxeViolations(page);
      await ask(panel, 'Vem är på plats i dag?');
      await expect(panel.getByText(ANSWER)).toBeVisible();
      expect(api.asked.at(-1)!.conversationId).toBeUndefined();
      // Closing gives the focus back to the button that opened it.
      await panel.getByRole('button', { name: 'Stäng panelen' }).click();
      await expect(page).not.toHaveURL(/[?&]ask=1/);
      await expect(button).toBeFocused();
    });

  test('the subject goes with the question: the item on its page, a tool by its view, a person never (D97 item 7)', async ({
    page,
    api,
  }) => {
    api.menu = menuRows;
    await new People().route(page);
    await open(page, '/items/omtanke?ask=1');
    await ask(page.getByRole('complementary', { name: 'Omtankesamtal med Anna Lindqvist' }), 'Vem är på plats i dag?');
    await expect.poll(() => api.asked.length).toBe(1);
    expect(api.asked.at(-1)!.chips).toEqual([
      { ref: 'thread:omtanke', kind: 'thread', label: 'Omtankesamtal med Anna Lindqvist' },
    ]);
    await open(page, '/tools/phonebook.directory?ask=1');
    await ask(page.getByRole('complementary', { name: 'Telefonbok' }), 'Vem är på plats i dag?');
    await expect.poll(() => api.asked.length).toBe(2);
    expect(api.asked.at(-1)!.chips).toEqual([
      { ref: 'capability:phonebook.directory', kind: 'capability', label: 'Telefonbok' },
    ]);
    await open(page, '/people/johan?ask=1');
    await ask(page.getByRole('complementary', { name: 'Johan Byström' }), 'Vem är på plats i dag?');
    await expect.poll(() => api.asked.length).toBe(3);
    expect(api.asked.at(-1)!.chips ?? []).toEqual([]);
  });

  test('Kalender asks about the range on screen: Fråga om veckan, with what is booked and what waits in it', async ({
    page,
    api,
  }) => {
    await open(page, '/calendar');
    await page.getByRole('link', { name: 'Fråga om veckan' }).click();
    const panel = page.getByRole('complementary', { name: 'Vecka 45' });
    await expect(panel.getByText('Bokat', { exact: true })).toBeVisible();
    await expect(panel.getByText(/tillfällen?$/)).toBeVisible();
    await expect(box(panel)).toBeVisible();
    await expectNoAxeViolations(page);
    await ask(panel, 'När har jag två timmar i sträck?');
    await expect(panel.getByText(ANSWER)).toBeVisible();
    expect(api.asked.at(-1)!.chips).toEqual([
      { ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 45' },
    ]);
  });
});

test.describe('the assistant drafts, the person decides (D112 item 8)', () => {
  test.use({ viewport: WIDE });

  test('a draft shows its values with Utkast; Granska och boka opens the dialog at its last step and Ändra at its first; once sent the draft says so', async ({
    page,
    api,
  }) => {
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await ask(panel, 'Boka det på fredag och skriv något vänligt');
    const draft = panel.getByRole('region', { name: 'Utkast: Boka samtalet' });
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
    await open(page, '/staff?card=omtanke');
    const panel = item(page);
    await ask(panel, 'Boka det på fredag');
    await expect(panel.getByRole('region', { name: 'Utkast: Boka samtalet' })).toHaveCount(1);
    await ask(panel, 'Boka det på fredag i stället');
    const drafts = panel.getByRole('region', { name: 'Utkast: Boka samtalet' });
    await expect(drafts).toHaveCount(2);
    await expect(drafts.first().getByText('Ersatt av ett nyare utkast').first()).toBeVisible();
    // The dot beside the word is decoration, so the state is heard once.
    await expect(drafts.first().getByRole('img', { name: 'Ersatt av ett nyare utkast' })).toHaveCount(0);
    await expect(drafts.first().getByRole('button', { name: 'Granska och boka' })).toHaveCount(0);
    await expect(drafts.last().getByRole('button', { name: 'Granska och boka' })).toBeVisible();
  });
});

test.describe('the panel over the page', () => {
  test('below the beside width it is the drawer, with the box at its foot and the answer in it', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await open(page, '/staff?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(box(drawer)).toBeVisible();
    await ask(drawer, 'Vem är på plats i dag?');
    await expect(drawer.getByText(ANSWER)).toBeVisible();
    await expect(box(drawer)).toBeFocused();
    await expectNoAxeViolations(page);
  });

  for (const [what, viewport] of [
    ['on a phone', phone],
    ['at 320 px', narrow],
  ] as const)
    test(`${what} the drawer reflows with the thing, the answer and the box`, async ({ page, api: _ }) => {
      await page.setViewportSize(viewport);
      await open(page, '/staff?card=omtanke');
      const drawer = page.getByRole('dialog', { name: 'Ärende' });
      await ask(drawer, 'Vem är på plats i dag?');
      await expect(drawer.getByText(ANSWER)).toBeVisible();
      expect(await reflowProblems(page, drawer)).toEqual([]);
      await expectNoAxeViolations(page);
    });

  test('on a short screen nothing is docked: the thing, the answer and the box scroll as one', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(short);
    await open(page, '/staff?card=omtanke');
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await box(drawer).scrollIntoViewIfNeeded();
    await ask(drawer, 'Vem är på plats i dag?');
    await expect(drawer.getByText(ANSWER)).toBeAttached();
    expect(await reflowProblems(page, drawer)).toEqual([]);
  });
});
