import type { Page } from '@playwright/test';
import { announcements, expect, expectNoAxeViolations, heading, narrow, open, reflowProblems, test } from './support';
import { ENTITY_UNIT, TALK_LENS, user } from './data';
import { BELOW_UNIT, MEMBER_UNIT, SICK_UNIT, TALK_UNITS, Units, unitAction, unitCard } from './unit-data';

/**
 * The unit as a page (D126 rule 1, the composition of board Person; D97, D117): `/units/:id`, "Läget" in the rail for a
 * manager who follows up one unit. The way back and the unit's place among the units the reader follows up, its name,
 * its actions under the name, its tabs as links with their own address (Översikt, one per source, Ärenden), and its
 * facts in the end panel. Översikt lists every figure of the reader's own unit (Hem shows at most four), the sources'
 * key figures, Behöver dig and each source in short with "Visa allt". `unit-data.ts` answers the unit and its sections
 * over the shared mock.
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const school = `/units/${ENTITY_UNIT.id}`;
const sectionsOf = (page: Page) =>
  page
    .getByRole('main')
    .locator('section[aria-labelledby]')
    .evaluateAll(els =>
      els
        .filter(el => !el.closest('[role="complementary"], [role="dialog"], dialog'))
        .map(el => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''),
    );
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const wayBack = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name, exact: true });
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;
const facts = (page: Page) => page.getByRole('complementary', { name: 'Uppgifter' });

test.describe('the unit as a page', () => {
  test.use({ viewport: wide });

  test('its name, its way back, its tabs, every figure of the unit and each source in short; its facts in the end panel; axe holds', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `${school}?from=%2F`);
    await expect(page).toHaveTitle(`${ENTITY_UNIT.label} · Startsidan`);
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await expect(wayBack(page, 'Hem')).toHaveAttribute('href', '/');
    const strip = page.getByRole('navigation', { name: `Om ${ENTITY_UNIT.label}` });
    await expect(strip.getByRole('link')).toHaveCount(3);
    for (const [i, name] of ['Översikt', 'Sjukfrånvaro', 'Utvecklingssamtal'].entries())
      await expect(strip.getByRole('link').nth(i)).toHaveAccessibleName(name);
    await expect(strip.getByRole('link', { name: 'Översikt' })).toHaveAttribute('aria-current', 'true');
    // Läget: every figure of the reader's own unit, the calm, the empty and the silent ones too.
    expect(await sectionsOf(page)).toEqual(['Läget', 'Sjukfrånvaro', 'Utvecklingssamtal']);
    const lage = region(page, 'Läget').getByRole('table');
    await expect(lage.getByRole('columnheader')).toHaveText(['Mått', 'Värde', 'Status', 'Kommentar']);
    await expect(lage.getByText('Inget nytt sedan i går.', { exact: true })).toBeVisible();
    // Each source in short with the way to its tab.
    await expect(region(page, 'Utvecklingssamtal').getByText('1 av 5 hållna').first()).toBeVisible();
    await expect(region(page, 'Sjukfrånvaro').getByRole('link', { name: 'Visa allt om sjukfrånvaro' })).toHaveAttribute(
      'href',
      `${school}?section=${SICK_UNIT}&from=%2F`,
    );
    // The facts: the directory's, the reader's role, Clew's own count of the people and the way to Personal.
    for (const term of ['Typ', 'Enhet', 'Din roll', 'Chef', 'Personal', '5 medarbetare'])
      await expect(facts(page)).toContainText(term);
    await expect(facts(page).getByRole('link', { name: 'Öppna Personal' })).toHaveAttribute('href', '/staff');
    await expectNoAxeViolations(page);
  });

  test('a source’s tab holds its fuller read and its own way in; Back returns to the overview', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `${school}?from=%2F`);
    await page
      .getByRole('navigation', { name: `Om ${ENTITY_UNIT.label}` })
      .getByRole('link', { name: 'Sjukfrånvaro' })
      .click();
    await expect(page).toHaveURL(`${school}?section=${SICK_UNIT}&from=%2F`);
    await expect(region(page, 'Sjukfrånvaro').getByText('september 2026')).toBeVisible();
    await open(page, `${school}?section=${TALK_UNITS}&from=%2F`);
    await expect(region(page, 'Utvecklingssamtal').getByRole('link', { name: 'Visa i Personal' })).toHaveAttribute(
      'href',
      `/staff?show=${TALK_LENS}`,
    );
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL(`${school}?section=${SICK_UNIT}&from=%2F`);
  });

  test('a source that does not answer says so in its own place, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.silent[SICK_UNIT] = 'unavailable';
    await units.route(page);
    await open(page, `${school}?section=${SICK_UNIT}`);
    const sick = region(page, 'Sjukfrånvaro');
    await expect(sick.getByText('Qlik svarade inte.')).toBeVisible();
    await expect(facts(page)).toContainText('5 medarbetare');
    await expect.poll(() => said(page, 'Qlik svarade inte.')).toBe(1);
    await expectNoAxeViolations(page);
    const before = units.reads.length;
    delete units.silent[SICK_UNIT];
    await sick.getByRole('button', { name: 'Försök igen med Sjukfrånvaro' }).click();
    await expect(sick.getByText('4,2 %').first()).toBeVisible();
    expect(units.reads.slice(before)).toEqual([SICK_UNIT]);
  });

  test('a unit the reader belongs to without managing it has no count, no way to Personal and says the reader’s role', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `/units/${MEMBER_UNIT.id}`);
    await expect(heading(page, 1, MEMBER_UNIT.label)).toBeVisible();
    await expect(facts(page)).toContainText('Medarbetare');
    await expect(facts(page)).not.toContainText('Chef');
    await expect(page.getByRole('link', { name: 'Öppna Personal' })).toHaveCount(0);
    await expect(heading(page, 2, `Inget mer att visa om ${MEMBER_UNIT.label}`)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the units below in the reader’s reporting line are links in the facts, and the trail is a menu of the units followed up (D117)', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.withBelow = true;
    await units.route(page);
    await open(page, school);
    const link = facts(page).getByRole('link', { name: BELOW_UNIT.label, exact: true });
    await expect(link).toHaveAttribute('href', `/units/${BELOW_UNIT.id}?from=${encodeURIComponent(school)}`);
    await link.click();
    await expect(heading(page, 1, BELOW_UNIT.label)).toBeVisible();
    await expect(facts(page)).toContainText('Enhetens chef rapporterar till dig');
    const trail = page.getByRole('navigation', { name: 'Enheter', exact: true });
    await expect(trail.getByRole('link', { name: 'Läget', exact: true })).toHaveAttribute('href', '/units');
    const switcher = trail.getByRole('button', { name: BELOW_UNIT.label });
    await switcher.press('Enter');
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Hagaskolan' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(switcher).toBeFocused();
  });

  test('a unit the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, '/units/okand?from=%2F');
    await expect(heading(page, 1, 'Enheten finns inte')).toBeVisible();
    await expect(page).toHaveTitle('Enheten finns inte · Startsidan');
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('a work item under Behöver dig is a link to its own page with the unit as the way back', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.cards = [unitCard];
    await units.route(page);
    await open(page, `${school}?from=%2F`);
    const needs = region(page, 'Behöver dig');
    await expect(needs.getByRole('link', { name: unitCard.title })).toHaveAttribute(
      'href',
      `/items/${unitCard.threadId}?from=${encodeURIComponent(school)}`,
    );
    await expect(
      page.getByRole('navigation', { name: `Om ${ENTITY_UNIT.label}` }).getByRole('link', { name: /^Ärenden/ }),
    ).toHaveAttribute('href', `${school}?section=needs-you&from=%2F`);
  });

  test('a propose on the unit opens its dialog under the name, and nothing is started before its last button (D126 rule 4)', async ({
    page,
    api,
  }) => {
    const units = new Units();
    units.actions = [unitAction];
    await units.route(page, api);
    await open(page, `${school}?from=%2F`);
    // The unit's actions are the one menu "Åtgärder" (D126 rule 1 as amended 2026-11-21), also when there is one.
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: unitAction.title, exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: `Åtgärder för ${ENTITY_UNIT.label}`, exact: true }).click();
    await page.getByRole('menuitem', { name: unitAction.title }).click();
    const dialog = page.getByRole('dialog', { name: unitAction.title });
    await expect(dialog).toBeVisible();
    expect(api.entityStarts).toEqual([]);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: unitAction.title }).click();
    await expect(dialog).toBeHidden();
    expect(api.entityStarts).toEqual([{ key: ENTITY_UNIT.id, capability: unitAction.capability, values: {} }]);
    await expect(page).toHaveURL(new RegExp(`/items/entity-calendar-bookWorkplaceMeeting-${ENTITY_UNIT.id}\\?from=`));
  });

  test('Läget on Hem leads to the unit’s page, and the way back leads to Hem', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, `/units/${user.unitId}?from=%2F`);
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await wayBack(page, 'Hem').click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the unit where the window is narrow and on a phone', () => {
  test('at 1024 px the facts stand above the read', async ({ page, api: _ }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await new Units().route(page);
    await open(page, school);
    await expect(facts(page)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('region', { name: 'Uppgifter' })).toContainText('5 medarbetare');
    await expect(page.getByRole('button', { name: 'Visa detaljer' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('on a phone the actions are under Åtgärder and the figures are a list; axe holds', async ({ page, api: _ }) => {
    await page.setViewportSize(phoneSize);
    const units = new Units();
    units.actions = [unitAction];
    await units.route(page);
    await open(page, school);
    await expect(region(page, 'Läget').getByRole('list', { name: 'Läget' })).toBeVisible();
    await page
      .getByRole('main')
      .getByRole('button', { name: `Åtgärder för ${ENTITY_UNIT.label}` })
      .click();
    await expect(page.getByRole('menuitem', { name: unitAction.title })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the unit page reflows at 320 px, with a source that does not answer and without', async ({ page, api: _ }) => {
    const units = new Units();
    await units.route(page);
    await open(page, school);
    await expect(region(page, 'Utvecklingssamtal').getByText('1 av 5 hållna').first()).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, `${school}?section=${SICK_UNIT}`);
    await expect(region(page, 'Sjukfrånvaro').getByText('september 2026')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    units.silent[TALK_UNITS] = 'timeout';
    await open(page, `${school}?section=${TALK_UNITS}&from=%2F`);
    await expect(region(page, 'Utvecklingssamtal').getByText('Utvecklingssamtal svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
});
