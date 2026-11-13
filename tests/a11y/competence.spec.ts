import type { Locator, Page } from '@playwright/test';
import {
  competenceTypes,
  expectLevelNames,
  holdingsOutput,
  holdingsWithOwn,
  ownEnglish,
  withSkills,
} from './competence';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  openNav,
  phone,
  reflowProblems,
  test,
  type MockApi,
} from './support';

/**
 * Kompetens › Mina kompetenser (D120 item 8) at `/competence`: a place in the rail for everyone while the competence
 * module is switched on for them, the reader's own holdings drawn from `competence.holdings` by the declared view, a
 * required type they lack as "Saknas", and for a manager the place's pages as tabs that are links, the matrix one of
 * them. The page's own answer with nothing held or required and with the module off. A certificate of the reader's own
 * added in a dialog named in the address (`add=new`, D108 item 7), what waits for the manager's decision in a card of its
 * own with "Ta tillbaka". A skill of the reader's own (D120) added in the same dialog, whose fields change with the kind
 * chosen, then changed in a dialog named in the address (`skill=<holding id>`) and removed after the confirmation, in a
 * card of its own. Keyboard, structure, axe and reflow, at desktop, phone and 320 px.
 */
const OWN = '/competence';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Kompetens', exact: true });
const switchedOn = (api: MockApi) => {
  api.competenceTypes = competenceTypes();
};
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Lägg till intyg' });
const addLink = (page: Page) => page.getByRole('main').getByRole('link', { name: 'Lägg till', exact: true });
/** A dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
/** Presses Tab until `target` has the focus, as a person moving through the page does; fails after `max` stops. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) && (await target.evaluate(el => el === document.activeElement))) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
const skillDialog = (page: Page, name: string) => page.getByRole('dialog', { name });
/** The reader's list with her Engelska, which the page draws in its own card, and a skill required of her she lacks. */
const withEnglish = (api: MockApi) => {
  api.competenceTypes = withSkills();
  api.competenceOwn = { approver: true, pending: [], rejected: [], skills: [ownEnglish()] };
  api.competenceHoldings = {
    rows: [
      ...holdingsOutput.rows,
      {
        ref: 'holding:competence:skill-eng',
        userName: 'anna.lindqvist',
        name: 'Anna Lindqvist',
        competence: 'Engelska',
        area: 'Språk',
        kind: 'skill',
        status: 'valid',
        evidence: 'self',
        level: 'Självständig',
        assessment: 'Egen bedömning',
        interest: 'Vill utveckla',
      },
      {
        ref: 'holding:competence:missing:p-anna:t-journal',
        userName: 'anna.lindqvist',
        name: 'Anna Lindqvist',
        competence: 'Journalsystem',
        area: 'Digital kompetens',
        kind: 'skill',
        status: 'missing',
        required: 'Självständig',
      },
    ],
  };
};
const twoWaiting = (api: MockApi) => {
  api.competenceOwn = {
    approver: true,
    pending: [
      {
        holdingId: 'own-1',
        typeId: 't-heta',
        competence: 'Heta arbeten',
        issuedOn: '2026-10-01',
        expiresOn: '2031-09-30',
      },
      { holdingId: 'own-3', typeId: 't-hlr', competence: 'HLR', issuedOn: '2026-09-15' },
    ],
    rejected: [{ holdingId: 'own-2', typeId: 't-fall', competence: 'Fallskydd', issuedOn: '2026-09-01' }],
    skills: [],
  };
  api.competenceHoldings = holdingsWithOwn;
};

test.describe('Kompetens › Mina kompetenser', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the page has no axe violations and every focus stop is marked', async ({ page, api }) => {
        switchedOn(api);
        await open(page, OWN);
        await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
        await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Fallskydd' })).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('reached from the rail: the own holdings, what is missing said in words, and the tab that leads to the matrix', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, '/');
      const place = rail(page).getByRole('link', { name: 'Kompetens', exact: true });
      await place.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(OWN);
      await expect(page).toHaveTitle('Mina kompetenser · Startsidan');
      await expect(place).toHaveAttribute('aria-current', 'page');
      const main = page.getByRole('main');
      // A required type the reader lacks is a row of its own, its status in words beside the badge's colour.
      await expect(main.getByRole('listitem').filter({ hasText: 'Fallskydd' })).toContainText(/saknas/i);
      await expect(main.getByRole('listitem').filter({ hasText: 'Heta arbeten' })).toContainText(/utgånget/i);
      // The place's pages as tabs that are links, the current one marked; the matrix is one of them for a manager.
      await expect(tabs(page).getByRole('link')).toHaveCount(2);
      await expect(tabs(page).getByRole('link', { name: 'Mina kompetenser' })).toHaveAttribute('aria-current', 'true');
      const matrix = tabs(page).getByRole('link', { name: 'Medarbetare' });
      await expect(matrix).toHaveAttribute('href', '/competence/matrix');
      await matrix.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/competence/matrix');
      await expect(page.getByRole('heading', { level: 1, name: 'Medarbetarnas kompetens' })).toBeVisible();
      // The rail keeps Kompetens as the place on both pages.
      await expect(place).toHaveAttribute('aria-current', 'page');
      await page.goBack();
      await expect(page).toHaveURL(OWN);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
    });

    test('the rail draws Kompetens only while the module is on, and an address from before gets the page’s answer', async ({
      page,
      api,
    }) => {
      await open(page, '/');
      await expect(rail(page).getByRole('link', { name: /^Hem/ })).toBeVisible();
      await expect(rail(page).getByRole('link', { name: 'Kompetens', exact: true })).toHaveCount(0);
      await open(page, OWN);
      await expect(page.getByRole('heading', { level: 2, name: 'Kompetens är inte påslaget för dig' })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
      switchedOn(api);
      await open(page, '/');
      await expect(rail(page).getByRole('link', { name: 'Kompetens', exact: true })).toBeVisible();
    });

    test('on a hard load the place’s tabs and the rail’s Kompetens are drawn with the page and do not move when the reads answer', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.relations = ['registrar'];
      // The rail's systems and the matrix's read answer a second and a half after the page is drawn.
      api.areasDelay = 1500;
      api.matrixDelay = 1500;
      await page.goto(OWN);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
      const place = rail(page).getByRole('link', { name: 'Kompetens', exact: true });
      // Before either has answered: the session says a manager and a registrar, so all three pages are there at once.
      const pages = async () => {
        await expect(tabs(page).getByRole('link')).toHaveCount(3);
        for (const [i, name] of ['Mina kompetenser', 'Medarbetare', 'Kompetenssökning'].entries())
          await expect(tabs(page).getByRole('link').nth(i)).toHaveAccessibleName(name);
      };
      await pages();
      await expect(place).toBeVisible();
      await expect(addLink(page)).toBeVisible();
      const before = { tabs: await tabs(page).boundingBox(), place: await place.boundingBox() };
      expect(api.matrixReads).toEqual([]);
      await page.waitForLoadState('networkidle');
      await expect.poll(() => api.matrixReads.length).toBe(1);
      // The answers change nothing that was drawn: the same tabs in the same place, the rail's row where it was.
      await pages();
      expect(await tabs(page).boundingBox()).toEqual(before.tabs);
      expect(await place.boundingBox()).toEqual(before.place);
    });

    test('someone who manages nobody has the page without tabs, and nothing held or required is said as such', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.employee = true;
      api.competenceHoldings = { rows: [] };
      await open(page, OWN);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { level: 2, name: 'Inget registrerat och inget som krävs' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('desktop: a certificate of the reader’s own (D108 item 7)', () => {
    test.use({ viewport: desktop });
    test('it is added by keyboard: the dialog has its address and says the manager approves it, what is missing is said on the field, and closing gives the focus back to Lägg till', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      await open(page, OWN);
      const add = addLink(page);
      await tabTo(page, add);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${OWN}?add=new`);
      const dialog = addDialog(page);
      await expect(dialog.getByText('Din chef behöver godkänna intyget innan det räknas.')).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      // Sent with nothing chosen: what is missing is said on the field itself, which takes the focus.
      const send = dialog.getByRole('button', { name: 'Skicka för godkännande' });
      await send.focus();
      await page.keyboard.press('Enter');
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await expect(competence).toHaveAttribute('aria-invalid', 'true');
      await expect(competence).toBeFocused();
      expect(api.ownWrites).toEqual([]);
      await page.keyboard.press('Enter');
      await page.getByRole('option', { name: 'HLR' }).click();
      const issued = dialog.getByLabel('Utfärdat', { exact: false }).and(page.locator('input'));
      await issued.focus();
      await page.keyboard.type('2026-10-01');
      await page.keyboard.press('Tab');
      await send.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(OWN);
      expect(api.ownWrites).toEqual([
        { method: 'POST', path: '/competence/own/holdings', body: { typeId: 't-hlr', issuedOn: '2026-10-01' } },
      ]);
      await expect(notices(page).getByText('HLR är skickat till din chef för godkännande.')).toBeAttached();
      await expect(add).toBeFocused();
      // It waits in a card of its own, with the way to take it back.
      const waiting = page.getByRole('list', { name: 'Väntar på godkännande' });
      await expect(waiting.getByRole('listitem').filter({ hasText: 'HLR' })).toContainText('Utfärdat 1 okt. 2026');
      await expect(waiting.getByRole('button', { name: 'Ta tillbaka HLR' })).toBeVisible();
    });

    test('what waits is taken back by keyboard, the focus going to the card’s heading, then to the page’s once the card is gone', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      twoWaiting(api);
      await open(page, OWN);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toBeVisible();
      // What waits is in the card, not twice in the list; what was rejected is in a card of its own, not in the list.
      await expect(main.getByText('Heta arbeten')).toHaveCount(2);
      await expect(
        main.getByRole('list', { name: 'Avvisade av din chef' }).getByRole('listitem').filter({ hasText: 'Fallskydd' }),
      ).toHaveCount(1);
      await expect(main.getByText(/avvisat/i)).toHaveCount(0);
      await expectNoAxeViolations(page);
      const first = main.getByRole('button', { name: 'Ta tillbaka Heta arbeten' });
      await tabTo(page, first);
      await page.keyboard.press('Enter');
      await expect(first).toHaveCount(0);
      expect(api.ownWrites).toEqual([{ method: 'DELETE', path: '/competence/own/holdings/own-1' }]);
      await expect(notices(page).getByText('Heta arbeten är tagen tillbaka.')).toBeAttached();
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toBeFocused();
      await tabTo(page, main.getByRole('button', { name: 'Ta tillbaka HLR' }));
      await page.keyboard.press('Enter');
      await expect(main.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeFocused();
    });

    test('a rejected registration is the person’s to remove, by keyboard, the focus going to the page’s heading once its card is gone', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      twoWaiting(api);
      api.competenceOwn = { ...api.competenceOwn, pending: [] };
      await open(page, OWN);
      const main = page.getByRole('main');
      const remove = main.getByRole('button', { name: 'Ta bort Fallskydd' });
      await tabTo(page, remove);
      await page.keyboard.press('Enter');
      await expect(remove).toHaveCount(0);
      expect(api.ownWrites).toEqual([{ method: 'DELETE', path: '/competence/own/rejected/own-2' }]);
      await expect(notices(page).getByText('Fallskydd är borttagen.')).toBeAttached();
      await expect(main.getByRole('heading', { level: 2, name: 'Avvisade av din chef' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeFocused();
    });

    test('someone who reports to nobody is told it cannot be sent before anything is filled in, and Esc closes to Lägg till', async ({
      page,
      api,
    }) => {
      switchedOn(api);
      api.competenceOwn = { approver: false, pending: [], rejected: [], skills: [] };
      await open(page, `${OWN}?add=new`);
      const dialog = addDialog(page);
      await expect(
        dialog.getByText(/Registreringen kan inte skickas: ingen chef är registrerad för dig\./),
      ).toBeVisible();
      await expect(dialog.getByRole('combobox')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Skicka för godkännande' })).toHaveCount(0);
      await settled(page);
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(OWN);
      await expect(addLink(page)).toBeFocused();
      expect(api.ownWrites).toEqual([]);
    });

    test('the server’s refusal stands beside the buttons and what was chosen stays', async ({ page, api }) => {
      switchedOn(api);
      api.ownFail = 'Du har redan en registrering av den kompetensen som väntar på godkännande.';
      await open(page, `${OWN}?add=new`);
      const dialog = addDialog(page);
      await dialog.getByRole('combobox', { name: /Kompetens/ }).click();
      await page.getByRole('option', { name: 'Fallskydd' }).click();
      const issued = dialog.getByLabel('Utfärdat', { exact: false }).and(page.locator('input'));
      await issued.focus();
      await page.keyboard.type('2026-09-01');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Skicka för godkännande' }).click();
      await expect(
        dialog
          .getByRole('alert')
          .filter({ hasText: 'Du har redan en registrering av den kompetensen som väntar på godkännande.' }),
      ).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: /Kompetens/ })).toContainText('Fallskydd');
      await expect(page).toHaveURL(`${OWN}?add=new`);
    });
  });

  test.describe('desktop: a skill of the reader’s own (D120)', () => {
    test.use({ viewport: desktop });
    test('it is added by keyboard with a level and the interest mark: the fields change with the kind, which is said, and it is listed at once as her own rating', async ({
      page,
      api,
    }) => {
      api.competenceTypes = withSkills();
      await open(page, OWN);
      const add = addLink(page);
      await tabTo(page, add);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${OWN}?add=new`);
      const dialog = addDialog(page);
      // The sentence about the kind chosen is a status region, so its change is said as well as shown.
      await expect(dialog.getByRole('status').filter({ hasText: 'Din chef' })).toHaveText(
        'Din chef behöver godkänna intyget innan det räknas.',
      );
      // The competence chosen by keyboard: a skill takes a level, not dates, and the sentence says what it means.
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await competence.focus();
      // Typing on the closed trigger chooses the option it names, as a native select does.
      await page.keyboard.type('Engelska');
      const skill = skillDialog(page, 'Lägg till färdighet');
      await expect(skill).toBeVisible();
      await expect(skill.getByRole('combobox', { name: /Kompetens/ })).toContainText('Engelska');
      await expect(skill.getByRole('status').filter({ hasText: 'Färdigheten' })).toHaveText(
        'Färdigheten visas direkt som din egen bedömning. Den räknas mot ett krav när din chef har bekräftat nivån.',
      );
      await expect(skill.getByLabel('Utfärdat', { exact: false })).toHaveCount(0);
      const levels = skill.getByRole('radiogroup', { name: /Nivå/ });
      // Each level is named by its word and described by what it means, never by the number behind it.
      await expectLevelNames(levels);
      await settled(page);
      await expectNoAxeViolations(page);
      // Saved with no level: it is said on the group, whose first choice takes the focus.
      const save = skill.getByRole('button', { name: 'Spara', exact: true });
      await save.focus();
      await page.keyboard.press('Enter');
      await expect(levels).toHaveAttribute('aria-invalid', 'true');
      await expect(skill.getByText('Välj en nivå.', { exact: true }).first()).toBeVisible();
      await expect(skill.getByRole('radio', { name: /Grundläggande/ })).toBeFocused();
      expect(api.skillWrites).toEqual([]);
      // The arrow keys choose among the three; the interest mark is a switch.
      await page.keyboard.press('ArrowDown');
      await expect(skill.getByRole('radio', { name: /Självständig/ })).toBeChecked();
      await expect(levels).not.toHaveAttribute('aria-invalid', 'true');
      const interest = skill.getByRole('switch', { name: /Vill utveckla/ });
      await tabTo(page, interest, 6);
      await page.keyboard.press('Space');
      await expect(interest).toBeChecked();
      await tabTo(page, save, 6);
      await page.keyboard.press('Enter');
      await expect(skill).toBeHidden();
      await expect(page).toHaveURL(OWN);
      expect(api.skillWrites).toEqual([
        { method: 'POST', path: '/competence/own/skills', body: { typeId: 't-eng', level: 2, interest: true } },
      ]);
      await expect(notices(page).getByText('Engelska är sparad som din egen bedömning.')).toBeAttached();
      await expect(add).toBeFocused();
      // Listed at once in a card of its own, marked as her own rating; nothing waits for anyone.
      const skills = page.getByRole('list', { name: 'Färdigheter' });
      const english = skills.getByRole('listitem').filter({ hasText: 'Engelska' });
      await expect(english).toContainText('Självständig');
      await expect(english).toContainText('Egen bedömning');
      await expect(english).toContainText('Vill utveckla');
      await expect(page.getByRole('heading', { level: 2, name: 'Väntar på godkännande' })).toHaveCount(0);
    });

    test('its name opens the change, a dialog with its address, and it is removed after the confirmation, by keyboard, the focus coming back each time', async ({
      page,
      api,
    }) => {
      withEnglish(api);
      await open(page, OWN);
      const main = page.getByRole('main');
      // In its own card, not twice; a skill required of her that she lacks stays in the list with the level asked.
      await expect(main.getByRole('listitem').filter({ hasText: 'Engelska' })).toHaveCount(1);
      const lacking = main.getByRole('listitem').filter({ hasText: 'Journalsystem' });
      await expect(lacking).toContainText(/saknas/i);
      await expect(lacking).toContainText('Självständig');
      await expectNoAxeViolations(page);
      // The skill's name is its way in: a link named by the skill, at least 24 px wide and a row's height from the next.
      const name = page.getByRole('list', { name: 'Färdigheter' }).getByRole('link', { name: 'Engelska', exact: true });
      const box = (await name.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(20);
      await tabTo(page, name);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${OWN}?skill=skill-eng`);
      const change = skillDialog(page, 'Ändra nivå');
      await expect(change.getByText('Engelska', { exact: true })).toBeVisible();
      await expectLevelNames(change.getByRole('radiogroup', { name: /Nivå/ }));
      const current = change.getByRole('radio', { name: 'Självständig', exact: true });
      await expect(current).toBeChecked();
      await expect(change.getByRole('switch', { name: /Vill utveckla/ })).toBeChecked();
      await settled(page);
      await expectNoAxeViolations(page);
      await current.focus();
      await page.keyboard.press('ArrowDown');
      await expect(change.getByRole('radio', { name: /Expert/ })).toBeChecked();
      await tabTo(page, change.getByRole('button', { name: 'Spara', exact: true }), 8);
      await page.keyboard.press('Enter');
      await expect(change).toBeHidden();
      await expect(page).toHaveURL(OWN);
      expect(api.skillWrites).toEqual([
        { method: 'PUT', path: '/competence/own/skills/skill-eng', body: { level: 3, interest: true } },
      ]);
      await expect(notices(page).getByText('Engelska är sparad.')).toBeAttached();
      await expect(main.getByRole('listitem').filter({ hasText: 'Engelska' })).toContainText('Expert');
      await expect(name).toBeFocused();
      // Its menu opens the change too, and gives the focus back to itself when it closes.
      const menu = main.getByRole('button', { name: 'Åtgärder: Engelska' });
      await tabTo(page, menu);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Ändra nivå', 'Ta bort']);
      await expect(page.getByRole('menuitem', { name: 'Ändra nivå' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(change).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(change).toBeHidden();
      await expect(menu).toBeFocused();
      // Removed after the confirmation: its card goes with it, so the page's heading takes the focus.
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Ta bort' }).press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Ta bort Engelska?' });
      await expect(confirm).toContainText('Färdigheten tas bort från din lista.');
      await settled(page);
      await expectNoAxeViolations(page);
      await tabTo(page, confirm.getByRole('button', { name: 'Ta bort', exact: true }), 4);
      await page.keyboard.press('Enter');
      await expect(confirm).toBeHidden();
      expect(api.skillWrites.at(-1)).toEqual({ method: 'DELETE', path: '/competence/own/skills/skill-eng' });
      await expect(notices(page).getByText('Engelska är borttagen.')).toBeAttached();
      await expect(main.getByRole('heading', { level: 2, name: 'Färdigheter' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Mina kompetenser' })).toBeFocused();
    });

    test('an address from before opens the change, and Esc closes it to the skill’s name', async ({ page, api }) => {
      withEnglish(api);
      await open(page, `${OWN}?skill=skill-eng`);
      const change = skillDialog(page, 'Ändra nivå');
      await expect(change).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(change).toBeHidden();
      await expect(page).toHaveURL(OWN);
      await expect(page.getByRole('main').getByRole('link', { name: 'Engelska', exact: true })).toBeFocused();
      expect(api.skillWrites).toEqual([]);
    });

    test('an address for a skill she does not hold opens nothing, and the page says why', async ({ page, api }) => {
      withEnglish(api);
      await open(page, `${OWN}?skill=skill-gone`);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText('Du har ingen sådan färdighet att ändra.');
      await expect(page).toHaveURL(OWN);
      await expect(skillDialog(page, 'Ändra nivå')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test('Lägg till does not offer a skill she holds: it is changed from its row', async ({ page, api }) => {
      withEnglish(api);
      await open(page, `${OWN}?add=new`);
      await addDialog(page)
        .getByRole('combobox', { name: /Kompetens/ })
        .click();
      await expect(page.getByRole('option', { name: 'Journalsystem' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Engelska' })).toHaveCount(0);
    });

    test('someone who reports to nobody is offered the skills alone, and the sentence follows the kind chosen', async ({
      page,
      api,
    }) => {
      api.competenceTypes = withSkills();
      api.competenceOwn = { approver: false, pending: [], rejected: [], skills: [] };
      await open(page, `${OWN}?add=new`);
      const dialog = addDialog(page);
      const notice = dialog.getByRole('status').filter({ hasText: 'chef' });
      await expect(notice).toHaveText(
        'Ingen chef är registrerad för dig, så ett intyg kan inte skickas för godkännande. En färdighet kan du lägga till: den visas direkt som din egen bedömning.',
      );
      const competence = dialog.getByRole('combobox', { name: /Kompetens/ });
      await competence.click();
      await expect(page.getByRole('option')).toHaveText(['Engelska', 'Journalsystem']);
      await page.getByRole('option', { name: 'Engelska' }).click();
      // A skill chosen, the sentence says what it is, and no word of a certificate that cannot be sent.
      const skill = skillDialog(page, 'Lägg till färdighet');
      await expect(skill.getByRole('status').filter({ hasText: 'Färdigheten' })).toHaveText(
        'Färdigheten visas direkt som din egen bedömning. Den räknas mot ett krav först när en chef har bekräftat nivån.',
      );
      await expect(skill.getByText(/kan inte skickas/)).toHaveCount(0);
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the place is in the rail’s drawer and the page reads as a list', async ({ page, api }) => {
      switchedOn(api);
      await open(page, '/');
      const nav = await openNav(page);
      await nav.getByRole('link', { name: 'Kompetens', exact: true }).click();
      await expect(page).toHaveURL(OWN);
      await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'HLR' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the page, what waits and the dialog reflow at 320 px', async ({ page, api }) => {
      switchedOn(api);
      twoWaiting(api);
      await page.setViewportSize(narrow);
      await open(page, OWN);
      await expect(tabs(page).getByRole('link', { name: 'Medarbetare' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ta tillbaka HLR' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${OWN}?add=new`);
      await expect(addDialog(page).getByRole('button', { name: 'Skicka för godkännande' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
    test('the skills and the change of one reflow at 320 px', async ({ page, api }) => {
      withEnglish(api);
      await page.setViewportSize(narrow);
      await open(page, OWN);
      await expect(page.getByRole('button', { name: 'Åtgärder: Engelska' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, `${OWN}?skill=skill-eng`);
      await expect(skillDialog(page, 'Ändra nivå').getByRole('radio', { name: /Expert/ })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
