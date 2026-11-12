import type { Page } from '@playwright/test';
import { announcements, expect, expectNoAxeViolations, heading, narrow, open, reflowProblems, test } from './support';
import { ENTITY_UNIT, TALK_LENS, user } from './data';
import { MEMBER_UNIT, SICK_UNIT, TALK_UNITS, Units, unitAction, unitCard } from './unit-data';

/**
 * The unit as an entity (D111 item 5, the shape of board Person; D97): a page of its own at `/units/:id`, in the work
 * item's page shape: the way back, its name and its actions with "Fråga Clew" in the header, "Behöver dig" and every
 * source about a unit one under the other in the main column, each with its source's badge, and the unit's facts in the
 * details rail (Clew's own count of the people on a unit the reader manages, with the way to Personal as a link).
 * `unit-data.ts` answers the unit and its sections over the shared mock, which answers the list of people the count
 * comes from. Reached from Läget on Hem; no rail entry leads here.
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const school = `/units/${ENTITY_UNIT.id}`;
/**
 * The main column's sections in the order a screen reader meets them, each by its heading; a work item open in the
 * panel beside the page (inside the main landmark too) or in a dialog over it has sections of its own, left out here.
 */
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

test.describe('the unit as a page', () => {
  test.use({ viewport: wide });

  test('its name, its way back, every source one under the other with its badge, and its facts in the rail; axe holds', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `${school}?from=%2F`);
    await expect(page).toHaveTitle(`${ENTITY_UNIT.label} · Startsidan`);
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await expect(wayBack(page, 'Hem')).toHaveAttribute('href', '/');
    // The sections one under the other, each a named region whose heading is the outline's second level.
    expect(await sectionsOf(page)).toEqual(['Sjukfrånvaro', 'Utvecklingssamtal']);
    await expect(page.getByRole('tablist')).toHaveCount(0);
    const sick = region(page, 'Sjukfrånvaro');
    const talks = region(page, 'Utvecklingssamtal');
    await expect(talks.getByText('1 av 5 hållna')).toBeVisible();
    const [a, b] = await Promise.all([sick.boundingBox(), talks.boundingBox()]);
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
    // A source's row as its view declares it, its fuller read under it, its source's badge on its heading's line.
    await expect(sick.getByText('Qlik', { exact: true }).first()).toBeVisible();
    await expect(sick.getByText('4,2 %').first()).toBeVisible();
    await expect(sick.getByText('Bevaka')).toBeVisible();
    await expect(sick.getByText('september 2026')).toBeVisible();
    // Clew's own talks: the counts, the one that needs the reader as a badge, and the way into Personal's lens, a link.
    await expect(talks.getByText('Clew', { exact: true }).first()).toBeVisible();
    await expect(talks.getByText('1 saknas')).toBeVisible();
    await expect(talks.getByRole('link', { name: 'Visa i Personal' })).toHaveAttribute(
      'href',
      `/staff?show=${TALK_LENS}`,
    );
    // The rail: the directory's facts, the reader's role, Clew's own count of the people and the way to Personal.
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details.locator('[aria-level="2"]').filter({ hasText: /^Detaljer$/ })).toBeVisible();
    await expect(details.getByText('Katalogen', { exact: true })).toBeVisible();
    for (const term of ['Typ', 'Enhet', 'Din roll', 'Chef', 'Personal', '5 medarbetare'])
      await expect(details).toContainText(term);
    await expect(details.getByRole('link', { name: 'Öppna Personal' })).toHaveAttribute('href', '/staff');
    await expectNoAxeViolations(page);
  });

  test('a source that does not answer says so in its own section, once aloud, and Försök igen asks it alone', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.silent[SICK_UNIT] = 'unavailable';
    await units.route(page);
    await open(page, school);
    const sick = region(page, 'Sjukfrånvaro');
    await expect(sick.getByText('Qlik svarade inte.')).toBeVisible();
    // The others stand.
    await expect(region(page, 'Utvecklingssamtal').getByText('1 av 5 hållna')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toContainText('5 medarbetare');
    await expect.poll(() => said(page, 'Qlik svarade inte.')).toBe(1);
    await expectNoAxeViolations(page);
    const before = units.reads.length;
    delete units.silent[SICK_UNIT];
    await sick.getByRole('button', { name: 'Försök igen med Sjukfrånvaro' }).click();
    await expect(sick.getByText('4,2 %').first()).toBeVisible();
    expect(units.reads.slice(before)).toEqual([SICK_UNIT]);
    expect(await said(page, 'Qlik svarade inte.')).toBe(1);
  });

  test('a unit the reader belongs to without managing it has no count, no way to Personal and says the reader’s role', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `/units/${MEMBER_UNIT.id}`);
    await expect(heading(page, 1, MEMBER_UNIT.label)).toBeVisible();
    const details = page.getByRole('complementary', { name: 'Detaljer' });
    await expect(details).toContainText('Medarbetare');
    await expect(details).not.toContainText('Chef');
    await expect(details).not.toContainText('5 medarbetare');
    await expect(page.getByRole('link', { name: 'Öppna Personal' })).toHaveCount(0);
    // The one source about a unit has no row for this one, so there is nothing more to show; no way back without an origin.
    await expect(heading(page, 2, `Inget mer att visa om ${MEMBER_UNIT.label}`)).toBeVisible();
    await expect(wayBack(page, 'Hem')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a unit the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, '/units/okand?from=%2F');
    await expect(heading(page, 1, 'Enheten finns inte')).toBeVisible();
    await expect(page).toHaveTitle('Enheten finns inte · Startsidan');
    await expect(wayBack(page, 'Hem')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('Läget on Hem names the session’s unit as a link to its page, and the way back leads to Hem', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, '/');
    const lage = heading(page, 2, `Läget på ${user.unitLabel}`);
    await expect(lage).toBeVisible();
    const link = lage.getByRole('link', { name: user.unitLabel });
    await expect(link).toHaveAttribute('href', `/units/${user.unitId}?from=%2F`);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/units/${user.unitId}\\?from=%2F$`));
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await wayBack(page, 'Hem').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page, 2, `Läget på ${user.unitLabel}`)).toBeVisible();
  });

  test('a work item under Behöver dig opens beside the page with its way back kept; Esc gives the focus back to its title', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.cards = [unitCard];
    await units.route(page);
    await open(page, `${school}?from=%2F`);
    expect(await sectionsOf(page)).toEqual(['Behöver dig', 'Sjukfrånvaro', 'Utvecklingssamtal']);
    const needs = region(page, 'Behöver dig');
    const title = needs.getByRole('link', { name: unitCard.title });
    await expect(title).toHaveAttribute('href', `${school}?from=%2F&card=${unitCard.threadId}`);
    await title.focus();
    await page.keyboard.press('Enter');
    // The unit's page stays: its address with the item added, its heading and its way back (D110 rules 2 and 3).
    await expect(page).toHaveURL(`${school}?from=%2F&card=${unitCard.threadId}`);
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await expect(panel.getByRole('article', { name: 'Ärende: Tillbud 2026-1182, halkolycka i duschen' })).toBeVisible();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await expect(wayBack(page, 'Hem')).toBeVisible();
    await expect(title).toHaveAttribute('aria-current', 'true');
    // The details step behind Visa detaljer while the panel holds the item.
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Visa detaljer' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`${school}?from=%2F`);
    await expect(panel).toHaveCount(0);
    await expect(title).toBeFocused();
  });

  test('the unit’s actions are on the line of its name, and one started there opens its work item beside the page', async ({
    page,
    api,
  }) => {
    const units = new Units();
    units.actions = [unitAction];
    await units.route(page, api);
    await open(page, `${school}?from=%2F`);
    const button = page.getByRole('main').getByRole('button', { name: unitAction.title, exact: true });
    await expect(button).toBeVisible();
    const [h, b] = await Promise.all([heading(page, 1, ENTITY_UNIT.label).boundingBox(), button.boundingBox()]);
    expect(b!.y).toBeLessThan(h!.y + h!.height);
    await expectNoAxeViolations(page);
    await button.click();
    await expect(page).toHaveURL(`${school}?from=%2F&card=entity-calendar-bookWorkplaceMeeting-${ENTITY_UNIT.id}`);
    expect(api.entityStarts).toEqual([{ key: ENTITY_UNIT.id, capability: unitAction.capability }]);
    expect(api.asked).toEqual([]);
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    await expect(panel.getByText(`${unitAction.title}: ${ENTITY_UNIT.label}`).first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Ärende' })).toBeFocused();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    // The unit's page has no question box of its own, so the work item offers no way into one (D110 rule 6).
    await expect(panel.getByRole('button', { name: 'Inte nu', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`${school}?from=%2F`);
    await expect(button).toBeFocused();
  });

  test('?section= scrolls to that section and gives its heading the focus', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, `${school}?section=${TALK_UNITS}&from=%2F`);
    const talks = page.getByRole('heading', { level: 2, name: 'Utvecklingssamtal' });
    await expect(talks).toBeFocused();
    await expect(talks).toBeInViewport();
  });
});

test.describe('the unit where the rail does not fit and on a phone', () => {
  test('at 1024 px the facts are behind Visa detaljer in a fullscreen dialog, which gives the focus back', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await new Units().route(page);
    await open(page, school);
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    const show = page.getByRole('main').getByRole('button', { name: 'Visa detaljer' });
    await show.click();
    const dialog = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(dialog).toContainText('5 medarbetare');
    await expect(dialog.getByRole('link', { name: 'Öppna Personal' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(show).toBeFocused();
  });

  test('on a phone the sections are one column, each whole, the actions are under Åtgärder, and axe holds', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(phoneSize);
    const units = new Units();
    units.actions = [unitAction];
    await units.route(page);
    await open(page, school);
    const sick = region(page, 'Sjukfrånvaro'),
      talks = region(page, 'Utvecklingssamtal');
    await expect(talks.getByText('1 av 5 hållna')).toBeVisible();
    const [a, b] = await Promise.all([sick.boundingBox(), talks.boundingBox()]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
    await page
      .getByRole('main')
      .getByRole('button', { name: `Åtgärder för ${ENTITY_UNIT.label}` })
      .click();
    await expect(page.getByRole('menuitem', { name: unitAction.title })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Detaljer' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Visa detaljer' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('1.4.10 reflow', () => {
  test.use({ viewport: narrow });
  test('the unit page reflows at 320 px, with a source that does not answer and without', async ({ page, api: _ }) => {
    const units = new Units();
    await units.route(page);
    await open(page, school);
    await expect(region(page, 'Utvecklingssamtal').getByText('1 av 5 hållna')).toBeVisible();
    await expect(region(page, 'Sjukfrånvaro').getByText('september 2026')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    units.silent[TALK_UNITS] = 'timeout';
    await open(page, `${school}?from=%2F`);
    await expect(region(page, 'Utvecklingssamtal').getByText('Utvecklingssamtal svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });
  test('the unit’s actions, its details and a work item opened over the page reflow at 320 px', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.actions = [unitAction];
    units.cards = [unitCard];
    await units.route(page);
    await open(page, school);
    await expect(page.getByRole('button', { name: `Åtgärder för ${ENTITY_UNIT.label}` })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await page.getByRole('main').getByRole('button', { name: 'Visa detaljer' }).click();
    const details = page.getByRole('dialog', { name: 'Detaljer' });
    await expect(details).toContainText('5 medarbetare');
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, details)).toEqual([]);
    await page.keyboard.press('Escape');
    await open(page, `${school}?card=${unitCard.threadId}`);
    const drawer = page.getByRole('dialog', { name: 'Ärende' });
    await expect(
      drawer.getByRole('article', { name: 'Ärende: Tillbud 2026-1182, halkolycka i duschen' }),
    ).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
  });
});
