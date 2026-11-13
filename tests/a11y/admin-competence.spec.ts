import type { Locator, Page } from '@playwright/test';
import { competenceCatalogue } from './competence';
import {
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';

/**
 * Administration › Kompetens (D108 items 2, 3 and 8): the catalogue of competence types as its administrator keeps it.
 * The list with an archived type marked; a type added in a dialog, with what is missing said on its field; a change of
 * the validity that says what it does to the holdings before it is saved; archiving asked for twice and an archived type
 * restored; two types merged, with what moves said in numbers before the second press (D108 item 2), and a merged type
 * read only; the list searched and paged at scale (D120 item 7); the server's refusal as an alert that keeps what was
 * typed; and the page's own answer when the module is off or the capability is missing. Keyboard, focus, structure, axe
 * and reflow, at desktop, phone and 320 px.
 */
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/**
 * Whether the focused control is covered where it is drawn (2.4.11): what lies on top across its middle is not the
 * control or inside it.
 */
const obscured = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused) return true;
    const box = focused.getBoundingClientRect();
    // Across its middle (a rounded corner is no part of it to a hit test).
    const y = box.top + box.height / 2;
    const points = [
      [box.left + box.width / 2, y],
      [box.left + box.width / 4, y],
      [box.right - box.width / 4, y],
    ] as const;
    return points.some(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return !top || !(focused === top || focused.contains(top));
    });
  });
const dialogOf = (page: Page, name: string) => page.getByRole('dialog', { name });
/** A type's name in the catalogue, which is its way in: a link to its dialog. */
const typeLink = (page: Page, name: string) =>
  page.getByRole('main').getByRole('link', { name, exact: true }).and(page.locator('[href*="type="]'));
/** Presses Tab until `target` has the focus, as a person moving through the page does; fails after `max` stops. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if ((await target.count()) && (await target.evaluate(el => el === document.activeElement))) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
/** The dialog fades in: contrast is measured once every finite animation has run, not in the instant it opens. */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined)),
    ).then(() => undefined),
  );

test.describe('Administration › Kompetens', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      test('the catalogue has no axe violations and every focus stop is marked', async ({ page, api }) => {
        api.admin = true;
        api.competenceTypes = competenceCatalogue();
        await open(page, '/admin/competence');
        await expect(page.getByRole('heading', { level: 1, name: 'Kompetens' })).toBeVisible();
        await expect(typeLink(page, 'Heta arbeten')).toBeVisible();
        await expectNoAxeViolations(page);
        const { unmarked } = await hiddenFocusStops(page);
        expect(unmarked).toEqual([]);
      });
    });
  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('an administrator reaches it from the rail and reads each type with its area, kind and validity', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/connectors');
      // The row under Administration: the place Kompetens in the rail is the reader's own (D120 item 8), another link.
      const row = page
        .getByRole('navigation', { name: 'Sidonavigering' })
        .getByRole('group', { name: 'Administration', exact: true })
        .getByRole('link', { name: 'Kompetens', exact: true });
      await row.click();
      await expect(page).toHaveURL(/\/admin\/competence$/);
      await expect(page).toHaveTitle('Kompetens · Startsidan');
      await expect(row).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('status').filter({ hasText: 'att registrera' })).toHaveText(
        '3 kompetenser att registrera, 1 arkiverade',
      );
      const table = page.getByRole('table');
      // A type's name opens it, so the row has no button of its own.
      await expect(table.getByRole('columnheader')).toHaveText(['Kompetens', 'Område', 'Typ', 'Giltighet']);
      await expect(table.getByRole('button')).toHaveCount(0);
      const hlr = table.getByRole('row', { name: /HLR/ });
      await expect(hlr.getByRole('link')).toHaveAccessibleName('HLR');
      await expect(hlr.getByRole('link')).toHaveAttribute('href', '/admin/competence?type=t-hlr');
      await expect(hlr).toContainText('Akut omhändertagande');
      await expect(hlr).toContainText('Kurs');
      await expect(hlr).toContainText('24 månader (2 år)');
      await expect(table.getByRole('row', { name: /Heta arbeten/ })).toContainText('Ingen regel');
      await expect(table.getByRole('row', { name: /Äldre brandskydd/ }).getByText('Arkiverad')).toBeVisible();
    });
    test('the rail draws Kompetens only while the module is on and the person holds admin.competence; an old link still gets the page’s answer', async ({
      page,
      api,
    }) => {
      api.admin = true;
      const kompetens = page
        .getByRole('navigation', { name: 'Sidonavigering' })
        .getByRole('group', { name: 'Administration', exact: true })
        .getByRole('link', { name: 'Kompetens', exact: true });
      // Switched off (D108 item 13): no row, and the page itself still says why for an address from before.
      await open(page, '/admin/connectors');
      await expect(
        page.getByRole('navigation', { name: 'Sidonavigering' }).getByRole('link', { name: 'Anslutna system' }),
      ).toBeVisible();
      await expect(kompetens).toHaveCount(0);
      await open(page, '/admin/competence');
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      // Switched on: the row is there for the person who holds the capability.
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/connectors');
      await expect(kompetens).toBeVisible();
      // On, but without admin.competence: no row.
      api.capabilities = ['admin.connectors', 'admin.users', 'admin.appearance'];
      await open(page, '/admin/connectors');
      await expect(kompetens).toHaveCount(0);
    });
    test('a type is added by keyboard: what is missing is said on its field, then it is saved and listed', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      const add = page.getByRole('link', { name: 'Lägg till kompetens' });
      await add.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/competence?type=new');
      const dialog = dialogOf(page, 'Lägg till kompetens');
      await expect(dialog).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);

      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Ange ett namn.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Ange ett område.', { exact: true })).toBeVisible();
      const name = dialog.getByRole('textbox', { name: /Namn/ });
      await expect(name).toBeFocused();
      expect(api.catalogueWrites).toEqual([]);

      await page.keyboard.type('Arbete på väg');
      const area = dialog.getByRole('textbox', { name: /Område/ });
      await area.focus();
      await page.keyboard.type('Säkerhet');
      // The employer's rule is asked for only when it is switched on.
      await expect(dialog.getByRole('spinbutton', { name: /Giltigt i/ })).toHaveCount(0);
      await dialog.getByRole('switch', { name: /Arbetsgivaren bestämmer giltighetstiden/ }).focus();
      await page.keyboard.press('Space');
      const months = dialog.getByRole('spinbutton', { name: /Giltigt i/ });
      await months.focus();
      await page.keyboard.type('36');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([
        {
          method: 'POST',
          path: '/competence/types',
          body: { name: 'Arbete på väg', area: 'Säkerhet', kind: 'certificate', validityMonths: 36 },
        },
      ]);
      await expect(notices(page).getByText('Arbete på väg finns nu i katalogen.')).toBeAttached();
      await expect(page.getByRole('table').getByRole('row', { name: /Arbete på väg/ })).toContainText(
        '36 månader (3 år)',
      );
    });
    test('a type of the kind Färdighet (D120) is added without a validity, which is not asked for, and is listed as never ending', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence?type=new');
      const dialog = dialogOf(page, 'Lägg till kompetens');
      await dialog.getByRole('textbox', { name: /Namn/ }).fill('Engelska');
      await dialog.getByRole('textbox', { name: /Område/ }).fill('Språk');
      // The employer's rule is switched on first, then the kind made a skill: the validity's fields go.
      await dialog.getByRole('switch', { name: /Arbetsgivaren bestämmer giltighetstiden/ }).focus();
      await page.keyboard.press('Space');
      await expect(dialog.getByRole('spinbutton', { name: /Giltigt i/ })).toBeVisible();
      const kind = dialog.getByRole('combobox', { name: /Typ/ });
      await kind.focus();
      // Typing on the closed trigger chooses the kind it names, as a native select does (ASCII: Playwright sends a
      // letter outside it as inserted text, which no trigger reads).
      await page.keyboard.type('F');
      await expect(kind).toContainText('Färdighet');
      await expect(kind).toBeFocused();
      await expect(dialog.getByRole('switch', { name: /Arbetsgivaren bestämmer giltighetstiden/ })).toHaveCount(0);
      await expect(dialog.getByRole('spinbutton', { name: /Giltigt i/ })).toHaveCount(0);
      await expect(dialog.getByText(/En färdighet anges med en nivå/)).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Spara', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([
        {
          method: 'POST',
          path: '/competence/types',
          body: { name: 'Engelska', area: 'Språk', kind: 'skill', validityMonths: null },
        },
      ]);
      await expect(notices(page).getByText('Engelska finns nu i katalogen.')).toBeAttached();
      const listed = page.getByRole('table').getByRole('row', { name: /Engelska/ });
      await expect(listed).toContainText('Färdighet');
      await expect(listed).toContainText('Går inte ut');
    });
    test('a type a source’s type is mapped to does not become a skill: the server’s refusal is said in the dialog', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      api.catalogueFail = 'Kompetensen är kopplad till en källa och kan inte göras om till eller från en färdighet.';
      await open(page, '/admin/competence?type=t-heta');
      const dialog = dialogOf(page, 'Ändra kompetens');
      const kind = dialog.getByRole('combobox', { name: /Typ/ });
      await kind.focus();
      await page.keyboard.type('F');
      await expect(kind).toContainText('Färdighet');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({
          hasText: 'Kompetensen är kopplad till en källa och kan inte göras om till eller från en färdighet.',
        }),
      ).toBeVisible();
      await expect(kind).toContainText('Färdighet');
      expect(api.catalogueWrites).toEqual([]);
      await settled(page);
      await expectNoAxeViolations(page);
    });
    test('a new validity says what it does to the holdings before it is saved, and the second press saves', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      // By keyboard: Tab to the type's name, Enter opens its dialog.
      const hlr = typeLink(page, 'HLR');
      const box = (await hlr.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      await tabTo(page, hlr);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/competence?type=t-hlr');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('HLR');
      const months = dialog.getByRole('spinbutton', { name: /Giltigt i/ });
      await expect(months).toHaveValue('24');
      await months.fill('12');
      await page.keyboard.press('Tab');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog
          .getByRole('status')
          .filter({ hasText: '3 intyg räknas efter regeln. Med ändringen blir 2 av dem utgångna i dag.' }),
      ).toBeVisible();
      expect(api.catalogueWrites).toEqual([]);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Spara ändringen' }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([
        {
          method: 'PATCH',
          path: '/competence/types/t-hlr',
          body: { name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 12 },
        },
      ]);
      await expect(notices(page).getByText('HLR är ändrad.')).toBeAttached();
      await expect(page.getByRole('table').getByRole('row', { name: /HLR/ })).toContainText('12 månader (1 år)');
      // The focus is back on the name that opened it.
      await expect(hlr).toBeFocused();
    });
    test('a change of the name alone is saved at once, and the server’s refusal keeps what was typed', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      api.catalogueFail = 'Det finns redan en kompetens med det namnet.';
      await open(page, '/admin/competence?type=t-fall');
      const dialog = dialogOf(page, 'Ändra kompetens');
      const name = dialog.getByRole('textbox', { name: /Namn/ });
      await name.fill('Heta arbeten');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'Det finns redan en kompetens med det namnet.' }),
      ).toBeVisible();
      await expect(name).toHaveValue('Heta arbeten');
      await name.fill('Fallskydd, grund');
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([
        {
          method: 'PATCH',
          path: '/competence/types/t-fall',
          body: { name: 'Fallskydd, grund', area: 'Säkerhet', kind: 'certificate' },
        },
      ]);
    });
    test('archiving is asked for twice, and Esc closes back to the list without it', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence?type=t-fall');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await dialog.getByRole('button', { name: 'Arkivera', exact: true }).click();
      await expect(
        dialog.getByRole('status').filter({
          hasText: 'En arkiverad kompetens kan inte registreras och krävs inte av någon förrän den återställs',
        }),
      ).toBeVisible();
      expect(api.catalogueWrites).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([]);

      const fall = typeLink(page, 'Fallskydd');
      await fall.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/competence?type=t-fall');
      await dialog.getByRole('button', { name: 'Arkivera', exact: true }).click();
      await dialog.getByRole('button', { name: 'Ja, arkivera' }).click();
      await expect(dialog).toBeHidden();
      expect(api.catalogueWrites).toEqual([{ method: 'POST', path: '/competence/types/t-fall/archive' }]);
      await expect(notices(page).getByText('Fallskydd är arkiverad.')).toBeAttached();
      await expect(
        page
          .getByRole('table')
          .getByRole('row', { name: /Fallskydd/ })
          .getByText('Arkiverad'),
      ).toBeVisible();
      // An archived type can still be read and renamed, but not archived again: it is restored instead.
      await fall.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Kompetensen är arkiverad', { exact: false })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^Arkivera/ })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Återställ' })).toBeVisible();
    });
    test('an archived type is restored from its dialog by keyboard, and is listed as in use again', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence?type=t-old');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await expect(dialog.getByText('Återställ den för att använda den igen.', { exact: false })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Återställ' }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([{ method: 'POST', path: '/competence/types/t-old/restore' }]);
      await expect(notices(page).getByText('Äldre brandskydd är återställd och kan registreras igen.')).toBeAttached();
      await expect(page.getByRole('status').filter({ hasText: 'att registrera' })).toHaveText(
        '4 kompetenser att registrera',
      );
      await expect(
        page
          .getByRole('table')
          .getByRole('row', { name: /Äldre brandskydd/ })
          .getByText('Arkiverad'),
      ).toHaveCount(0);
    });
    test('two types are merged (D108 item 2): the other is found by searching, the numbers are said, the second press merges', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = [
        ...competenceCatalogue(),
        { id: 't-eng', name: 'Engelska', area: 'Språk', kind: 'skill', archived: false },
      ];
      await open(page, '/admin/competence?type=t-fall');
      const dialog = dialogOf(page, 'Ändra kompetens');
      const merge = dialog.getByRole('button', { name: 'Slå ihop med …' });
      await merge.focus();
      await page.keyboard.press('Enter');
      const merging = dialogOf(page, 'Slå ihop kompetens');
      const target = merging.getByRole('combobox', { name: /Slå ihop med/ });
      await expect(target).toBeFocused();
      await expect(merging.getByText('Allt som hör till Fallskydd flyttas', { exact: false })).toBeVisible();
      // Nothing is chosen yet, so nothing can be merged; Avbryt goes back to the form with the focus where it was.
      await expect(merging.getByRole('button', { name: 'Slå ihop', exact: true })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // By keyboard from the open results to the footer: Tab leaves the field, and the button it reaches is not covered
      // by the results (2.4.11).
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Tab');
      const cancel = merging.getByRole('button', { name: 'Avbryt' });
      await expect(cancel).toBeFocused();
      expect(await obscured(page)).toBe(false);
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('Fallskydd');
      await expect(merge).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(target).toBeFocused();
      // A skill and an archived type are not offered: a certificate is merged into a type in use of another kind.
      await page.keyboard.type('Engelska');
      // The list's own row: the dialog's live region says the same words to announce them.
      await expect(merging.getByRole('option', { name: 'Ingen kompetens som används heter så' })).toBeVisible();
      await target.fill('');
      await page.keyboard.type('Heta');
      await expect(page.getByRole('option', { name: /Heta arbeten/ })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const words =
        'Till Heta arbeten flyttas 12 intyg hos 9 personer, 2 krav (1 slås ihop med krav som redan finns, det strängaste behålls) och 1 koppling till källor. Det går inte att ångra. Tryck Slå ihop för att genomföra det.';
      const said = merging.getByRole('status').filter({ hasText: 'Till Heta arbeten flyttas' });
      await expect(said).toHaveText(words);
      // The region was there before the count came, so its words are spoken (4.1.3).
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(words));
      expect(api.catalogueWrites).toEqual([]);
      await settled(page);
      await expectNoAxeViolations(page);
      await merging.getByRole('button', { name: 'Slå ihop', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(merging).toBeHidden();
      await expect(page).toHaveURL('/admin/competence');
      expect(api.catalogueWrites).toEqual([
        { method: 'POST', path: '/competence/types/t-fall/merge', body: { into: 't-heta' } },
      ]);
      await expect(notices(page).getByText('Fallskydd är sammanslagen med Heta arbeten.')).toBeAttached();
      const row = page.getByRole('table').getByRole('row', { name: /Fallskydd/ });
      await expect(row.getByText('Sammanslagen')).toBeVisible();
      await expect(row.getByText('med Heta arbeten')).toBeVisible();
      // A merged type says what it went into and is read only: no change, archive, restore or merge.
      await typeLink(page, 'Fallskydd').focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Kompetensen är sammanslagen med Heta arbeten.', { exact: false })).toBeVisible();
      for (const name of [/^Arkivera/, /^Återställ/, /^Slå ihop/, /^Spara/])
        await expect(dialog.getByRole('button', { name })).toHaveCount(0);
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      await dialog.getByRole('link', { name: 'Öppna Heta arbeten' }).click();
      await expect(page).toHaveURL('/admin/competence?type=t-heta');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('Heta arbeten');
      await settled(page);
      await expectNoAxeViolations(page);
    });
    test('a skill’s merge says what moves as färdigheter, one and many, never as intyg', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = [
        ...competenceCatalogue(),
        ...['Engelska', 'Teckenspråk', 'Lättläst svenska', 'Kalkylprogram'].map((name, i) => ({
          id: `t-skill-${i}`,
          name,
          area: 'Språk',
          kind: 'skill' as const,
          archived: false,
        })),
      ];
      await open(page, '/admin/competence?type=t-skill-0');
      const dialog = dialogOf(page, 'Ändra kompetens');
      const merging = dialogOf(page, 'Slå ihop kompetens');
      // Each target is asked for once: a count already read is not read again.
      const into = async (name: string) => {
        await dialog.getByRole('button', { name: 'Slå ihop med …' }).click();
        await expect(merging.getByRole('combobox', { name: /Slå ihop med/ })).toBeFocused();
        await page.keyboard.type(name.slice(0, 6));
        await page.getByRole('option', { name: new RegExp('^' + name) }).click();
        return merging.getByRole('status').filter({ hasText: /flyttas/ });
      };
      const said = await into('Teckenspråk');
      await expect(
        merging.getByText(
          'Allt som hör till Engelska flyttas till den färdighet du väljer: färdigheter, krav, andelsmål och kopplingar till källor.',
          { exact: false },
        ),
      ).toBeVisible();
      await expect(said).toContainText('Till Teckenspråk flyttas 12 färdigheter hos 9 personer,');
      await expect(said).not.toContainText('intyg');
      await merging.getByRole('button', { name: 'Avbryt' }).click();
      // One of each.
      api.mergePreview = { ...api.mergePreview, holdings: 1, people: 1 };
      await expect(await into('Lättläst svenska')).toContainText(
        'Till Lättläst svenska flyttas 1 färdighet hos 1 person,',
      );
      await merging.getByRole('button', { name: 'Avbryt' }).click();
      // Nothing to move is said in the skill's words too.
      api.mergePreview = {
        ...api.mergePreview,
        holdings: 0,
        people: 0,
        requirements: 0,
        requirementsFolded: 0,
        shareTargets: 0,
        shareTargetsFolded: 0,
        mappings: 0,
      };
      await expect(await into('Kalkylprogram')).toContainText(
        'Inga färdigheter, krav eller kopplingar flyttas till Kalkylprogram.',
      );
    });
    test('a merge waits while own registrations of both wait: it is said without who or how many, and Slå ihop stays disabled', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      // Fewer than five people: the count is said as fewer (D118), and who or how many wait is never said.
      api.mergePreview = { ...api.mergePreview, holdings: 'few', people: 'few', waiting: true };
      await open(page, '/admin/competence?type=t-fall');
      await dialogOf(page, 'Ändra kompetens').getByRole('button', { name: 'Slå ihop med …' }).click();
      const merging = dialogOf(page, 'Slå ihop kompetens');
      await page.keyboard.type('Heta');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(merging.getByRole('status').filter({ hasText: 'Till Heta arbeten flyttas' })).toHaveText(
        'Till Heta arbeten flyttas färre än 5 intyg hos färre än 5 personer, 2 krav (1 slås ihop med krav som redan finns, det strängaste behålls) och 1 koppling till källor. Det finns egna registreringar av båda som väntar på godkännande. Slå ihop dem när registreringarna är granskade.',
      );
      const confirm = merging.getByRole('button', { name: 'Slå ihop', exact: true });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await confirm.click({ force: true });
      expect(api.catalogueWrites).toEqual([]);
    });
    test('the catalogue at scale (D120 item 7) is searched and paged: never all drawn, the search and the page said', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = Array.from({ length: 120 }, (_, i) => ({
        id: `t-${i}`,
        name: `Färdighet ${String(i + 1).padStart(3, '0')}`,
        area: i < 60 ? 'Digitala färdigheter' : 'Ledarskap',
        kind: 'skill' as const,
        archived: false,
        uri: `http://data.europa.eu/esco/skill/${i}`,
      }));
      await open(page, '/admin/competence');
      const table = page.getByRole('table');
      await expect(table.getByRole('row', { name: /Färdighet 001/ })).toBeVisible();
      await expect(table.getByRole('row', { name: /Färdighet 051/ })).toHaveCount(0);
      const pages = page.getByRole('navigation', { name: 'Sidor i katalogen' });
      await pages.getByRole('button', { name: 'Gå till nästa sida' }).click();
      await expect(table.getByRole('row', { name: /Färdighet 051/ })).toBeVisible();
      await expect(table.getByRole('row', { name: /Färdighet 001/ })).toHaveCount(0);
      await expect(page).toHaveURL('/admin/competence?page=2');
      const search = page.getByRole('searchbox', { name: 'Sök kompetens' });
      await search.focus();
      await page.keyboard.type('ledarskap');
      await expect(page.getByRole('status').filter({ hasText: 'matchar sökningen' })).toHaveText(
        '60 av 120 matchar sökningen',
      );
      // A new search starts on its first page, and the words are the address's (as on Användare, D43).
      await expect(page).toHaveURL('/admin/competence?text=ledarskap');
      await expect(table.getByRole('row', { name: /Färdighet 061/ })).toBeVisible();
      await expectNoAxeViolations(page);
      // The page too: a reload keeps the search and the page.
      await pages.getByRole('button', { name: 'Gå till nästa sida' }).click();
      await expect(page).toHaveURL('/admin/competence?text=ledarskap&page=2');
      await page.reload();
      await expect(search).toHaveValue('ledarskap');
      await expect(table.getByRole('row', { name: /Färdighet 111/ })).toBeVisible();
      // A type's dialog keeps the list's place, and its close goes back to it, replacing the dialog's address.
      const t111 = typeLink(page, 'Färdighet 111');
      await t111.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/competence?text=ledarskap&page=2&type=t-110');
      // Escape once the dialog has the focus.
      await expect(dialogOf(page, 'Ändra kompetens').getByRole('textbox', { name: /Namn/ })).toHaveValue(
        'Färdighet 111',
      );
      await expect(dialogOf(page, 'Ändra kompetens')).toContainText('Färdighet 111');
      await expect
        .poll(() => page.evaluate(() => !!document.activeElement?.closest('dialog, [role="dialog"]')))
        .toBe(true);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL('/admin/competence?text=ledarskap&page=2');
      await expect(table.getByRole('row', { name: /Färdighet 111/ })).toBeVisible();
      await expect(t111).toBeFocused();
      // Back steps through the pages, each with the search; the words typed are no steps, and a dialog, closed by
      // replacing its address, is never opened again by Back (D83 rule 8, the review of 2026-11-13).
      await page.goBack();
      await expect(page).toHaveURL('/admin/competence?text=ledarskap&page=2');
      await expect(dialogOf(page, 'Ändra kompetens')).toBeHidden();
      await expect(table.getByRole('row', { name: /Färdighet 111/ })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL('/admin/competence?text=ledarskap');
      await expect(search).toHaveValue('ledarskap');
      await expect(table.getByRole('row', { name: /Färdighet 061/ })).toBeVisible();
      await search.fill('inget sådant');
      await expect(page.getByRole('heading', { name: 'Ingen kompetens matchar' })).toBeVisible();
      await expect(pages).toHaveCount(0);
    });
    test('with the module off the page says so and where to go, and an empty catalogue says what to do', async ({
      page,
      api,
    }) => {
      api.admin = true;
      expect(api.competenceTypes).toBeNull();
      await open(page, '/admin/competence');
      await expect(
        page.getByRole('heading', { level: 2, name: 'Katalogen är inte tillgänglig för dig' }),
      ).toBeVisible();
      await expect(page.getByText(/Kompetens är inte påslaget i den här installationen\./).first()).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till Anslutna system' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Lägg till kompetens' })).toHaveCount(0);
      await expectNoAxeViolations(page);
      api.competenceTypes = [];
      await page.reload();
      // By role: the empty state's words are also spoken (4.1.3), and while they sit in the live region the text matches twice.
      await expect(page.getByRole('heading', { name: 'Katalogen är tom' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Lägg till kompetens' })).toBeVisible();
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('the catalogue is a list whose names open each type, and the dialog fills the screen', async ({
      page,
      api,
    }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await open(page, '/admin/competence');
      const list = page.getByRole('list', { name: 'Katalogen' });
      await expect(list.getByText('Akut omhändertagande · Kurs · 24 månader (2 år)')).toBeVisible();
      await expect(list.getByRole('button')).toHaveCount(0);
      const hlr = list.getByRole('link', { name: 'HLR', exact: true });
      await hlr.focus();
      await page.keyboard.press('Enter');
      const dialog = dialogOf(page, 'Ändra kompetens');
      await expect(dialog.getByRole('textbox', { name: /Namn/ })).toHaveValue('HLR');
      await settled(page);
      await expectNoAxeViolations(page);
    });
  });
  test.describe('1.4.10 reflow', () => {
    test('the catalogue and the dialog reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      api.competenceTypes = competenceCatalogue();
      await page.setViewportSize(narrow);
      await open(page, '/admin/competence');
      await expect(page.getByRole('list', { name: 'Katalogen' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      await open(page, '/admin/competence?type=t-hlr');
      await expect(dialogOf(page, 'Ändra kompetens').getByRole('button', { name: 'Spara', exact: true })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      // The merge in the same dialog, with the numbers said.
      await dialogOf(page, 'Ändra kompetens').getByRole('button', { name: 'Slå ihop med …' }).click();
      await page.keyboard.type('Heta');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(
        dialogOf(page, 'Slå ihop kompetens').getByRole('status').filter({ hasText: 'Till Heta arbeten flyttas' }),
      ).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});
