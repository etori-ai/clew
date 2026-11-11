import type { Page } from '@playwright/test';
import { announcements, expect, expectNoAxeViolations, heading, narrow, open, reflowProblems, test } from './support';
import { ENTITY_UNIT, TALK_LENS, user } from './data';
import { MEMBER_UNIT, SICK_UNIT, TALK_UNITS, Units, unitAction, unitCard } from './unit-data';

/**
 * The unit as an entity (D97, artboard E): a page of its own at `/units/:id`, its name with what Clew knows of it, then
 * a section per source in a grid that is one column on a narrow window: Clew's own Personal for a unit the reader
 * manages, then each source about a unit. `unit-data.ts` answers the unit and its sections over the shared mock, which
 * answers the list of people the count comes from. Reached from Läget on Hem; no rail entry leads here.
 */
const wide = { width: 1440, height: 900 };
const phoneSize = { width: 390, height: 844 };
const school = `/units/${ENTITY_UNIT.id}`;
/** The page's outline as a screen reader lists it: each heading in the main region with its level. */
const outline = (page: Page) =>
  page
    .getByRole('main')
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll(els =>
      els.map(el => `${el.getAttribute('aria-level') ?? el.tagName.slice(1)} ${el.textContent?.trim() ?? ''}`),
    );
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const said = async (page: Page, text: string) => (await announcements(page)).filter(t => t.includes(text)).length;

test.describe('the unit as a page', () => {
  test.use({ viewport: wide });

  test('its name, what Clew knows of it, and a section per source, in the order of the outline; axe holds', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `${school}?from=%2F`);
    await expect(page).toHaveTitle(`${ENTITY_UNIT.label} · Startsidan`);
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await expect(page.getByText('Enhet · du är chef', { exact: true })).toBeVisible();
    // The trail names where the unit was opened from.
    const trail = page.getByRole('navigation', { name: 'Du är här' });
    await expect(trail.getByRole('link', { name: 'Hem' })).toHaveAttribute('href', '/');
    // h1, then each section an h2 and a named region with its source beside its name.
    await expect(region(page, 'Utvecklingssamtal').getByText('1 av 5 hållna')).toBeVisible();
    expect(await outline(page)).toEqual([
      `1 ${ENTITY_UNIT.label}`,
      '2 Personal',
      '2 Sjukfrånvaro',
      '2 Utvecklingssamtal',
    ]);
    // Personal: Clew's own count of the people on the unit, and the way to the list.
    const staff = region(page, 'Personal');
    await expect(staff.getByText('Clew', { exact: true })).toBeVisible();
    await expect(staff.getByText('5 medarbetare')).toBeVisible();
    await expect(staff.getByRole('link', { name: 'Öppna Personal' })).toHaveAttribute('href', '/staff');
    // A source's row as its view declares it, its fuller read under it, its source named beside its name.
    const sick = region(page, 'Sjukfrånvaro');
    await expect(sick.getByText('Qlik', { exact: true }).first()).toBeVisible();
    await expect(sick.getByText('4,2 %').first()).toBeVisible();
    await expect(sick.getByText('Bevaka')).toBeVisible();
    await expect(sick.getByText('september 2026')).toBeVisible();
    // Clew's own talks: the counts, the one that needs the reader as a badge, and the way into Personal's lens.
    const talks = region(page, 'Utvecklingssamtal');
    await expect(talks.getByText('Clew', { exact: true })).toBeVisible();
    await expect(talks.getByText('1 saknas')).toBeVisible();
    await expect(talks.getByRole('link', { name: 'Visa i Personal' })).toHaveAttribute(
      'href',
      `/staff?show=${TALK_LENS}`,
    );
    // Two sections across at this width.
    const [a, b] = await Promise.all([staff.boundingBox(), sick.boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
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
    await expect(region(page, 'Personal').getByText('5 medarbetare')).toBeVisible();
    await expect.poll(() => said(page, 'Qlik svarade inte.')).toBe(1);
    await expectNoAxeViolations(page);
    const before = units.reads.length;
    delete units.silent[SICK_UNIT];
    await sick.getByRole('button', { name: 'Försök igen med Sjukfrånvaro' }).click();
    await expect(sick.getByText('4,2 %').first()).toBeVisible();
    expect(units.reads.slice(before)).toEqual([SICK_UNIT]);
    expect(await said(page, 'Qlik svarade inte.')).toBe(1);
  });

  test('a unit the reader belongs to without managing it has no Personal and no "du är chef"', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, `/units/${MEMBER_UNIT.id}`);
    await expect(heading(page, 1, MEMBER_UNIT.label)).toBeVisible();
    await expect(page.getByText('Enhet', { exact: true })).toBeVisible();
    await expect(page.getByText(/du är chef/)).toHaveCount(0);
    await expect(region(page, 'Personal')).toHaveCount(0);
    // The one source about a unit has no row for this one, so there is nothing more to show; no trail without an origin.
    await expect(heading(page, 2, `Inget mer att visa om ${MEMBER_UNIT.label}`)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Du är här' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a unit the reader may not ask about is the page’s own “finns inte”', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, '/units/okand?from=%2F');
    await expect(heading(page, 1, 'Enheten finns inte')).toBeVisible();
    await expect(page).toHaveTitle('Enheten finns inte · Startsidan');
    await expect(page.getByRole('navigation', { name: 'Du är här' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('Läget on Hem names the session’s unit as a link to its page, and the trail leads back to Hem', async ({
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
    await page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Hem' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page, 2, `Läget på ${user.unitLabel}`)).toBeVisible();
  });

  test('a card under Behöver dig opens beside the page with its way back kept; Esc gives the focus back to its title', async ({
    page,
    api: _,
  }) => {
    const units = new Units();
    units.cards = [unitCard];
    await units.route(page);
    await open(page, `${school}?from=%2F`);
    const needs = region(page, 'Behöver dig');
    const title = needs.getByRole('link', { name: unitCard.title });
    await expect(title).toHaveAttribute('href', `${school}?from=%2F&card=${unitCard.threadId}`);
    await title.focus();
    await page.keyboard.press('Enter');
    // The unit's page stays: its address with the card added, its heading and its trail (D107 rules 2 and 3).
    await expect(page).toHaveURL(`${school}?from=%2F&card=${unitCard.threadId}`);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(panel.getByRole('article', { name: 'Kort: Tillbud 2026-1182, halkolycka i duschen' })).toBeVisible();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Du är här' }).getByRole('link', { name: 'Hem' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`${school}?from=%2F`);
    await expect(panel).toHaveCount(0);
    await expect(title).toBeFocused();
  });

  test('the unit’s actions are at the end of its name, and one started there opens its card beside the page', async ({
    page,
    api,
  }) => {
    const units = new Units();
    units.actions = [unitAction];
    await units.route(page, api);
    await open(page, `${school}?from=%2F`);
    const button = page.getByRole('main').getByRole('button', { name: unitAction.title, exact: true });
    await expect(button).toBeVisible();
    await expectNoAxeViolations(page);
    await button.click();
    await expect(page).toHaveURL(`${school}?from=%2F&card=entity-calendar-bookWorkplaceMeeting-${ENTITY_UNIT.id}`);
    expect(api.entityStarts).toEqual([{ key: ENTITY_UNIT.id, capability: unitAction.capability }]);
    expect(api.asked).toEqual([]);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.getByText(`${unitAction.title}: ${ENTITY_UNIT.label}`).first()).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
    // The unit's page has no question box, so the card offers no way into one (D107 rule 6).
    await expect(panel.getByRole('button', { name: 'Inte nu', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(`${school}?from=%2F`);
    await expect(button).toBeFocused();
  });
});

test.describe('the unit on a phone', () => {
  test.use({ viewport: phoneSize });

  test('the sections are one column, each whole, and axe holds', async ({ page, api: _ }) => {
    await new Units().route(page);
    await open(page, school);
    const staff = region(page, 'Personal'),
      sick = region(page, 'Sjukfrånvaro'),
      talks = region(page, 'Utvecklingssamtal');
    await expect(talks.getByText('1 av 5 hållna')).toBeVisible();
    const [a, b, c] = await Promise.all([staff.boundingBox(), sick.boundingBox(), talks.boundingBox()]);
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(2);
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
    expect(c!.y).toBeGreaterThanOrEqual(b!.y + b!.height);
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
  test('the unit’s actions and a card opened over the page reflow at 320 px', async ({ page, api: _ }) => {
    const units = new Units();
    units.actions = [unitAction];
    units.cards = [unitCard];
    await units.route(page);
    await open(page, school);
    await expect(page.getByRole('button', { name: `Åtgärder för ${ENTITY_UNIT.label}` })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await open(page, `${school}?card=${unitCard.threadId}`);
    const drawer = page.getByRole('dialog', { name: 'Kort' });
    await expect(drawer.getByRole('article', { name: 'Kort: Tillbud 2026-1182, halkolycka i duschen' })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
    expect(await reflowProblems(page, drawer)).toEqual([]);
  });
});
