import type { Area, ErrandsResult } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, heading, narrow, open, reflowProblems, test } from './support';
import { errandsOutput, errandsSpec } from './errands';

/**
 * Mina ärenden on Hem (D90): the combined errand list in the page's own column, after the day's work, for a person
 * with a case system. The mocked API answers with the view the core connector really declares.
 */
const errandArea: Area = {
  id: 'arenden',
  title: 'Ärenden',
  connector: 'clew',
  source: 'Startsidan',
  icon: 'document',
  figure: null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [{ capability: 'clew.errands', label: 'Mina ärenden', kind: 'read' }],
  schedules: [],
};
const permit = (n: number): ErrandsResult['rows'][number] => ({
  ref: `errand:permits:2026-00040${n}`,
  label: `BYGG 2026-00040${n} · Bygglov, Ansökan`,
  state: 'active',
  status: 'Pågående',
  since: `2026-10-2${n}T09:00:00.000Z`,
  area: 'Bygglov',
  connector: 'permits',
  system: 'Bygglovssystemet',
  view: {
    capability: 'permits.errand',
    input: { ref: `errand:permits:2026-00040${n}` },
    title: 'Ärende',
    source: 'Bygglovssystemet',
  },
});
/** Seven errands: two more than Hem shows before it is asked for the rest. */
const seven: ErrandsResult = {
  ...errandsOutput,
  rows: [...errandsOutput.rows, permit(1), permit(2), permit(3), permit(4)],
};

test.describe('Mina ärenden on Hem', () => {
  test.use({ viewport: desktop });

  test('lists the errands from every system after the day’s work, the first five and then all, with the missing system named', async ({
    page,
    api,
  }) => {
    api.areas.push(errandArea);
    await page.route('**/api/cap/clew.errands**', route =>
      route.fulfill({ json: { output: seven, source: 'Startsidan', view: errandsSpec } }),
    );
    await open(page, '/');
    const section = page.getByRole('region', { name: 'Mina ärenden' });
    // The section's heading is one of the start page's h2s, at the level of "Att agera på" and Läget (D115 item 4).
    await expect(section.getByRole('heading', { name: 'Mina ärenden' })).toBeVisible();
    expect((await section.boundingBox())!.y).toBeGreaterThan(
      (await heading(page, 2, 'Att agera på · ').boundingBox())!.y,
    );
    await expect(section.getByRole('listitem')).toHaveCount(5);
    await expect(section.getByText('5 av 7 rader')).toBeVisible();
    // What waits on the person is the first row, and each row says which system it is in.
    const first = section.getByRole('listitem').first();
    await expect(first).toContainText('IK-26110007 · Behörighet, Beställning');
    await expect(first).toContainText('Dig');
    await expect(first).toContainText('Ärendesystemet');
    await expect(section.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    await expectNoAxeViolations(page);

    // The rest is one press away, and the focus stays in the section when the button is gone.
    const more = section.getByRole('button', { name: 'Visa alla 7 ärenden' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(section.getByRole('listitem')).toHaveCount(7);
    await expect(more).toHaveCount(0);
    await expect(section.getByRole('heading', { name: 'Mina ärenden' })).toBeFocused();

    // A row opens the errand beside the page, in the system it came from.
    const link = section.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' });
    await expect(link).toHaveAttribute('href', /open=sm\.errand/);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Ny medarbetare behöver konto i elevregistret')).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(7);
    await expectNoAxeViolations(page);
  });

  test('a person without a case system has no errand section', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(page.getByRole('heading', { name: /^Att agera på · / })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mina ärenden' })).toHaveCount(0);
  });

  test('when no case system answers the section says so and can be tried again, never "no errands"', async ({
    page,
    api,
  }) => {
    api.areas.push(errandArea);
    let down = true;
    await page.route('**/api/cap/clew.errands**', route =>
      down
        ? route.fulfill({ status: 400, json: { error: 'Inget av ärendesystemen svarar just nu.' } })
        : route.fulfill({ json: { output: errandsOutput, source: 'Startsidan', view: errandsSpec } }),
    );
    await open(page, '/');
    const section = page.getByRole('region', { name: 'Mina ärenden' });
    await expect(section.getByRole('alert')).toHaveText('Inget av ärendesystemen svarar just nu.');
    await expect(section.getByRole('listitem')).toHaveCount(0);
    await expectNoAxeViolations(page);
    down = false;
    await section.getByRole('button', { name: 'Försök igen' }).click();
    await expect(section.getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('1.4.10: Mina ärenden at 320 px', () => {
  test('the section reflows', async ({ page, api }) => {
    api.areas.push(errandArea);
    await page.setViewportSize(narrow);
    await open(page, '/');
    const section = page.getByRole('region', { name: 'Mina ärenden' });
    await expect(section.getByRole('link', { name: 'IK-26110007 · Behörighet, Beställning' })).toBeVisible();
    await expect(section.getByText('Verksamhetssystemet svarade inte.')).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
