import type { Page } from '@playwright/test';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  narrow,
  open,
  reference,
  reflowProblems,
  test,
} from './support';
import { appraisals, appraisalsWithoutKey } from './protocol-preview-data';
import { manifest as hrManifest } from '../../connectors/hr/connector.mjs';

/**
 * The manifest reference (D60, item 5): integrator documentation inside the web app, public, English, drawn from the
 * instance's own schema. Astryx's documentation-technical template: the article with an Outline at its start, a Selector in
 * its place on a phone. A heading per field, so the outline and the search in the browser both find every field.
 */
const page_ = '/protocol/manifest';

test.describe('the manifest reference', () => {
  test('on a desktop: the title, an outline to every field, one heading per field, and no axe violations', async ({
    page,
    api,
  }) => {
    void api; // The mock installs with the fixture; the page reads the reference through it.
    await page.setViewportSize(desktop);
    await open(page, page_);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clew manifest reference');
    await expect(page).toHaveTitle('Clew manifest reference · Startsidan');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    const outline = page.getByRole('navigation', { name: 'On this page' });
    await expect(outline).toBeVisible();
    await expect(outline.getByRole('link')).toHaveCount(
      reference.fields.length + reference.sections.length + reference.recipes.length + 3,
    );
    // The recipes and sections draw at level 4 too (D71: under a level 3 section), with the outline's aria-level 3.
    await expect(page.locator('h4:not([aria-level])')).toHaveCount(reference.fields.length);
    // A field's heading is its full path; the outline names it by its last part, indented, so nothing is cut off.
    await expect(
      page.getByRole('heading', { level: 4, name: 'capabilities[].view.input.filter.options[].label' }),
    ).toBeVisible();
    await expect(outline.getByRole('link', { name: 'label', exact: true })).toHaveCount(
      reference.fields.filter(f => f.path.endsWith('.label')).length,
    );
    // The filter narrows the outline to what holds the text, named by path; clearing it brings everything back.
    const filter = page.getByRole('searchbox', { name: 'Filter the outline' });
    await filter.fill('menu');
    const matches =
      reference.fields.filter(f => f.path.toLowerCase().includes('menu')).length +
      reference.recipes.filter(r => r.title.toLowerCase().includes('menu')).length;
    await expect(outline.getByRole('link')).toHaveCount(matches);
    await expect(outline.getByRole('link', { name: 'capabilities[].menu.icon' })).toBeVisible();
    // The field has a status region of its own; the count is the one that says so.
    await expect(
      page
        .getByRole('complementary', { name: 'On this page' })
        .getByRole('status')
        .filter({ hasText: /headings? of/ }),
    ).toHaveText(
      `${matches} headings of ${reference.fields.length + reference.sections.length + reference.recipes.length + 3}`,
    );
    await filter.fill('');
    await expect(outline.getByRole('link')).toHaveCount(
      reference.fields.length + reference.sections.length + reference.recipes.length + 3,
    );
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

  test('on a phone: the outline becomes a choice, nothing is cut off at 320 px, and no axe violations', async ({
    page,
    api,
  }) => {
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

/**
 * The manifest preview (D60, D97, artboard J): a manifest pasted or chosen as a file, posted to the dry run the server
 * runs (the mock runs the real `previewManifest`), and what Clew would do with it drawn beside the problems it would
 * refuse it for. Public, English, nothing fetched or stored.
 */
const preview = '/protocol/preview';
const field = (page: Page) => page.getByRole('textbox', { name: 'Manifest', exact: true });
const runButton = (page: Page) => page.getByRole('button', { name: 'Run the dry run' });

test.describe('the manifest preview', () => {
  test('on a desktop: from the field to what Clew would do by keyboard, who would see it, the drawn places, no axe violations', async ({
    page,
    api,
  }) => {
    void api;
    await page.setViewportSize(desktop);
    await open(page, preview);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manifest preview');
    await expect(page).toHaveTitle('Clew manifest preview · Startsidan');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    await expect(page.getByRole('link', { name: 'the manifest reference' })).toHaveAttribute(
      'href',
      '/protocol/manifest',
    );
    // The keyboard path: the field, the file, the button, then into the result.
    await field(page).focus();
    await field(page).fill(JSON.stringify(appraisals, null, 2));
    for (let i = 0; i < 4 && !(await runButton(page).evaluate(el => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(runButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const status = 'Clew would load it: 3 capabilities, 2 about a person or a unit.';
    await expect(page.getByRole('status').filter({ hasText: status })).toBeVisible();
    expect(await announcements(page)).toContain(status);
    // What Clew would do with it: each capability, what it is about, where it shows.
    const table = page.getByRole('region', { name: 'What Clew would do with it' }).getByRole('table');
    await expect(table.getByRole('row', { name: /^appraisals\.person / })).toContainText('Lens, row mark, section');
    await expect(table.getByRole('row', { name: /^appraisals\.commitments / })).toContainText(
      'opened from the section of appraisals.person',
    );
    await expect(table.getByRole('row', { name: /^appraisals\.book / })).toContainText('Menu, after a human decision');
    const who = page.getByRole('region', { name: 'Who would see it' });
    await expect(who).toContainText('Lens and row mark');
    await expect(who).toContainText('A person who has a list of people: a manager on Personal');
    await expect(who).toContainText('No. A read about a person is never offered to the model.');
    // The places drawn with the product's components and sample values: the mark, the section, the menu.
    await expect(page.getByText('Samtal saknas', { exact: true })).toBeVisible();
    await expect(heading(page, 3, 'Utvecklingssamtal')).toBeVisible();
    await page.getByRole('combobox', { name: 'Sample row' }).click();
    await page.getByRole('option', { name: /^2: Bokat/ }).click();
    await expect(page.getByText('Samtal saknas', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No mark: nothing in this sample row needs the reader.')).toBeVisible();
    await page.getByRole('button', { name: 'Åtgärder för Exempel Person' }).click();
    await page.getByRole('menuitem', { name: 'Boka samtal' }).click();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringMatching(/^Boka samtal: in Clew this starts a card/));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(desktop.width);
    await expectNoAxeViolations(page);
  });

  test('every write, both halves (D112 item 11): where it starts, what the person passes through, and its input as they meet it', async ({
    page,
    api,
  }) => {
    void api;
    await page.setViewportSize(desktop);
    await open(page, preview);
    // The HR fixture as it is registered: "Boka samtalet" asks for a time, a place and a message, and says what it writes.
    await field(page).fill(JSON.stringify(hrManifest, null, 2));
    await runButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: /^Clew would load it/ })).toBeVisible();
    const write = page.getByRole('region', { name: 'hr.bookTalk · execute' });
    await expect(write).toBeVisible();
    await expect(heading(page, 2, 'Every write, both halves')).toBeVisible();
    // Where it starts: the person, what the manifest declares, what Clew draws, and this capability's state.
    const starts = write.getByRole('table', { name: 'Where hr.bookTalk starts' });
    await expect(starts.getByRole('row', { name: /^On a work item / })).toContainText('scan: true');
    await expect(starts.getByRole('row', { name: /^On a work item / })).toContainText('Declared');
    await expect(starts.getByRole('row', { name: /^On a person or a unit / })).toContainText('Not declared');
    await expect(starts.getByRole('row', { name: /^In a conversation / })).toContainText('Never for an execute');
    // What the person passes through: the dialog's two steps declared, the receipt always.
    const steps = write.getByRole('table', { name: 'What the person passes through for hr.bookTalk' });
    await expect(steps.getByRole('row', { name: /^Fill in / })).toContainText('Declared');
    await expect(steps.getByRole('row', { name: /^See what happens / })).toContainText('Declared');
    await expect(steps.getByRole('row', { name: /^Ask first / })).toContainText("On the work item's action");
    await expect(steps.getByRole('row', { name: /^Receipt and undo / })).toContainText('Always');
    // The input, as the person will meet it: the rows from the item, the rest from the person in the dialog.
    const input = write.getByRole('table', { name: 'The input of hr.bookTalk' });
    await expect(input.getByRole('row', { name: /^refs / })).toContainText('The selected rows of the work item');
    await expect(input.getByRole('row', { name: /^when / })).toContainText('string, date-time, optional');
    await expect(input.getByRole('row', { name: /^when / })).toContainText(
      "“När”: three free 45-minute times from the person's own calendar, “Annan tid” and the day",
    );
    await expect(input.getByRole('row', { name: /^message / })).toContainText(
      '“Meddelande till medarbetaren”, optional: a text area',
    );
    // A propose about a person starts on its page; its effect step is never an execute's.
    const prepare = page.getByRole('region', { name: 'hr.prepareAbsence · propose' });
    await expect(
      prepare.getByRole('table', { name: 'Where hr.prepareAbsence starts' }).getByRole('row', {
        name: /^On a person or a unit /,
      }),
    ).toContainText('Declared');
    await expect(
      prepare
        .getByRole('table', { name: 'What the person passes through for hr.prepareAbsence' })
        .getByRole('row', { name: /^See what happens / }),
    ).toContainText('Never for a propose');
    // A read has no path, and the board's actions on a view's rows are not drawn.
    await expect(page.getByRole('region', { name: /^hr\.whoIsOn · / })).toHaveCount(0);
    await expect(page.getByText('Proposed', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(desktop.width);
    await expectNoAxeViolations(page);
  });

  test('a refused manifest: the summary of problems takes focus and is said, each problem placed and linked to its rule', async ({
    page,
    api,
  }) => {
    void api;
    await page.setViewportSize(desktop);
    await open(page, preview);
    await field(page).fill(JSON.stringify(appraisalsWithoutKey, null, 2));
    await runButton(page).click();
    const summary = heading(page, 2, '1 problem, the manifest would be refused');
    await expect(summary).toBeFocused();
    expect(await announcements(page)).toContain('Clew would refuse it: 1 problem.');
    const problems = page.getByRole('region', { name: '1 problem, the manifest would be refused' });
    await expect(problems).toContainText('capabilities[0].output.properties.rows.items');
    await expect(problems).toContainText('answers each row with the key it was asked with');
    await expect(page.getByRole('region', { name: 'What Clew would do with it' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    const link = problems.getByRole('link', { name: 'Manifest reference: Each row carries the key it was asked with' });
    await expect(link).toHaveAttribute('href', '/protocol/manifest#rule-about-read-rows');
    await link.click();
    await expect(page).toHaveURL(/\/protocol\/manifest#rule-about-read-rows$/);
    await expect(page.locator('#rule-about-read-rows')).toBeFocused();
    await expect(page.locator('#rule-about-read-rows')).toBeInViewport();
    // And back: the reference links to the preview.
    await page.getByRole('link', { name: 'the manifest preview' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manifest preview');
  });

  test('a document that is not JSON and an empty field are states of the page, said where the person is', async ({
    page,
    api,
  }) => {
    void api;
    await page.setViewportSize(desktop);
    await open(page, preview);
    await runButton(page).click();
    await expect(field(page)).toBeFocused();
    // The field says what is missing, and Astryx mirrors the field's status into its live region.
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Paste a manifest or choose its file.').first()).toBeVisible();
    await field(page).fill('{ "protocol": 2, "id": ');
    await runButton(page).click();
    await expect(heading(page, 2, 'The document is not JSON')).toBeFocused();
    expect(await announcements(page)).toContain('The document is not JSON.');
    await expectNoAxeViolations(page);
  });

  test('on a phone: the table becomes a list, nothing is cut off at 320 px, and no axe violations', async ({
    page,
    api,
  }) => {
    void api;
    await page.setViewportSize(narrow);
    await open(page, preview);
    await field(page).fill(JSON.stringify(appraisals, null, 2));
    await runButton(page).click();
    const capabilities = page.getByRole('list', { name: 'Capabilities' });
    await expect(capabilities.getByRole('listitem')).toHaveCount(3);
    await expect(heading(page, 3, 'Utvecklingssamtal')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(narrow.width);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
    await field(page).fill(JSON.stringify(appraisalsWithoutKey, null, 2));
    await runButton(page).click();
    await expect(heading(page, 2, '1 problem, the manifest would be refused')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(narrow.width);
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
