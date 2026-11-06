import { desktop, expect, expectNoAxeViolations, narrow, open, reference, reflowProblems, test } from './support';

/**
 * The manifest reference (D60, item 5): integrator documentation inside the web app, public, English, drawn from the
 * instance's own schema. Astryx's documentation-technical template: the article with an Outline at its start, a Selector in
 * its place on a phone. A heading per field, so the outline and the search in the browser both find every field.
 */
const page_ = '/protocol/manifest';

test.describe('the manifest reference', () => {
  test('on a desktop: the title, an outline to every field, one heading per field, and no axe violations', async ({ page, api }) => {
    void api; // The mock installs with the fixture; the page reads the reference through it.
    await page.setViewportSize(desktop);
    await open(page, page_);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clew manifest reference');
    await expect(page).toHaveTitle('Clew manifest reference · Startsidan');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    const outline = page.getByRole('navigation', { name: 'On this page' });
    await expect(outline).toBeVisible();
    await expect(outline.getByRole('link')).toHaveCount(reference.fields.length + reference.sections.length + reference.recipes.length + 3);
    await expect(page.getByRole('heading', { level: 4 })).toHaveCount(reference.fields.length);
    // A field's heading is its full path; the outline names it by its last part, indented, so nothing is cut off.
    await expect(page.getByRole('heading', { level: 4, name: 'capabilities[].view.input.filter.options[].label' })).toBeVisible();
    await expect(outline.getByRole('link', { name: 'label', exact: true })).toHaveCount(reference.fields.filter(f => f.path.endsWith('.label')).length);
    // The filter narrows the outline to what holds the text, named by path; clearing it brings everything back.
    const filter = page.getByRole('searchbox', { name: 'Filter the outline' });
    await filter.fill('menu');
    const matches = reference.fields.filter(f => f.path.toLowerCase().includes('menu')).length + reference.recipes.filter(r => r.title.toLowerCase().includes('menu')).length;
    await expect(outline.getByRole('link')).toHaveCount(matches);
    await expect(outline.getByRole('link', { name: 'capabilities[].menu.icon' })).toBeVisible();
    // The field has a status region of its own; the count is the one that says so.
    await expect(page.getByRole('complementary', { name: 'On this page' }).getByRole('status').filter({ hasText: /headings? of/ })).toHaveText(`${matches} headings of ${reference.fields.length + reference.sections.length + reference.recipes.length + 3}`);
    await filter.fill('');
    await expect(outline.getByRole('link')).toHaveCount(reference.fields.length + reference.sections.length + reference.recipes.length + 3);
    // A recipe with a schema has two tabs; the TypeBox one shows the same manifest authored in TypeScript.
    const tabs = page.getByRole('tablist').first();
    await tabs.getByRole('tab', { name: 'TypeBox' }).click();
    await expect(page.getByRole('tabpanel', { name: 'TypeBox' }).first()).toContainText('Type.Object({');
    await outline.getByRole('link', { name: 'menu', exact: true }).click();
    await expect(page).toHaveURL(/#field-capabilities-menu$/);
    await expect(page.getByRole('heading', { level: 4, name: 'capabilities[].menu', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(desktop.width);
    await expectNoAxeViolations(page);
  });

  test('on a phone: the outline becomes a choice, nothing is cut off at 320 px, and no axe violations', async ({ page, api }) => {
    void api;
    await page.setViewportSize(narrow);
    await open(page, page_);
    await expect(page.getByRole('navigation', { name: 'On this page' })).toHaveCount(0);
    const choice = page.getByRole('combobox', { name: 'On this page' });
    await expect(choice).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Filter the outline' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(narrow.width);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
