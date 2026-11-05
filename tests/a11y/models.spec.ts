import { announcements, composer, desktop, expect, expectNoAxeViolations, focused, hiddenFocusStops, narrow, open, phone, reflowProblems, test } from './support';
import { modelProviders, providerDetail, providerReport } from './data';

/**
 * Modeller (D24): the providers and models an administrator governs, the add-provider dialog, one model's tabs and one
 * provider's page, and the person's model menu in the box with the answer that names its model. Keyboard, structure,
 * announcements, axe and reflow, at desktop, phone and 320 px.
 */
async function pickSection(page: import('@playwright/test').Page, name: string) {
  const tab = page.getByRole('tab', { name });
  if (await tab.count()) { await tab.click(); return page.getByRole('tabpanel', { name }); }
  await page.getByRole('button', { name: /^Visa: / }).click();
  await page.getByRole('menuitem', { name }).click();
  return page.getByRole('region', { name });
}
const routes = [['the models list', '/admin/models'], ['a model', '/admin/models/gpt-oss-120b'], ['a provider that is down', '/admin/models/providers/pilot']] as const;

test.describe('model administration', () => {
  for (const [layout, viewport] of [['desktop', desktop], ['phone', phone]] as const) test.describe(layout, () => {
    test.use({ viewport });
    for (const [name, path] of routes) test(`${name} has no axe violations`, async ({ page, api }) => {
      api.admin = true;
      await open(page, path);
      await expectNoAxeViolations(page);
    });
    test('every tab of a model has no axe violations', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models/gpt-oss-20b');
      for (const tab of ['Vem kan välja den', 'Historik', 'Översikt']) {
        await expect(await pickSection(page, tab)).toBeVisible();
        await expectNoAxeViolations(page);
      }
    });
  });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('the list groups the models by provider, with the health, the default and the audience in words', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models');
      await expect(page).toHaveTitle('Modeller · Startsidan');
      await expect(page.getByRole('link', { name: 'Modeller', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText('Den som inte valt själv får Kapabel (standard).')).toBeVisible();
      const tables = page.getByRole('table');
      await expect(tables).toHaveCount(2);
      await expect(tables.first().getByRole('link', { name: 'Kapabel' })).toBeVisible();
      await expect(tables.first().getByText('Standard', { exact: true })).toBeVisible();
      await expect(tables.first().getByText('Chefer', { exact: true })).toBeVisible();
      await expect(page.getByText(/Svarar inte · http:\/\/pilot\.test\/v1/)).toBeVisible();
      await expect(tables.nth(1).getByText('Avstängd', { exact: true })).toBeVisible();
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });
    test('the switch turns a model off, keeps focus and says so', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models');
      const toggle = page.getByRole('switch', { name: 'Snabb (lokal) på' });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).not.toBeChecked();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Snabb (lokal) är avstängd'));
      expect((await focused(page)).tag).toBe('input');
    });
    test('adding a provider runs by keyboard: errors named, the step heading takes focus, the listed models are ticked and added', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models');
      await page.getByRole('button', { name: 'Lägg till leverantör' }).click();
      const dialog = page.getByRole('dialog', { name: 'Lägg till leverantör' });
      await expect(dialog.getByRole('heading', { level: 3, name: 'Adress och nyckel' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Testa och spara' }).click();
      await expect(dialog.getByText('Ge leverantören ett namn.', { exact: true })).toBeVisible();
      await expect(dialog.getByText(/^En adress som börjar med http/)).toBeVisible();
      await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Egen server');
      await expect(dialog.getByRole('textbox', { name: /^Id/ })).toHaveValue('egen-server');
      await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://egen.test/v1');
      await dialog.getByLabel(/^Nyckel/).fill('en-nyckel');
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Testa och spara' }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Modeller' })).toBeFocused();
      await expect(dialog.getByRole('list', { name: 'Kontrollens resultat' })).toContainText('listar 3 modeller');
      const listed = dialog.getByRole('group', { name: 'Modeller att lägga till' });
      await expect(listed.getByRole('checkbox')).toHaveCount(3);
      await listed.getByRole('checkbox', { name: 'llama3.3:70b' }).check();
      await dialog.getByRole('switch', { name: 'Slå på dem direkt' }).check();
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Lägg till 1 modell' }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('1 modell tillagd och påslagen'));
      await expect(page.getByRole('link', { name: 'Egen server' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'llama3.3:70b' })).toBeVisible();
    });
    test('a model page: the tabs follow the tabs pattern, the default is set with a spoken result, the audience is saved', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models/gpt-oss-20b');
      await expect(page).toHaveTitle('Snabb (lokal) · Startsidan');
      await page.getByRole('button', { name: 'Gör till standard' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Snabb (lokal) är standard'));
      await expect(page.getByRole('button', { name: 'Ta bort som standard' })).toBeVisible();
      await page.getByRole('tablist').getByRole('tab', { name: 'Översikt' }).focus();
      await page.keyboard.press('ArrowRight');
      expect((await focused(page)).text).toContain('Vem kan välja den');
      await page.keyboard.press('Enter');
      const panel = page.getByRole('tabpanel', { name: 'Vem kan välja den' });
      await expect(panel.getByRole('radiogroup', { name: 'Vem kan välja modellen' })).toBeVisible();
      await panel.getByRole('radio', { name: 'Alla som är inloggade' }).check();
      await panel.getByRole('button', { name: 'Spara' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Sparat: Alla'));
    });
    test('a provider page: the health is a sentence, removal waits for the models, the key is replaced or cleared, a test offers what it lists', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models/providers/pilot');
      await expect(page.getByText('Pilotleverantör svarar inte.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ta bort', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Byt nyckel' }).click();
      const dialog = page.getByRole('dialog', { name: 'Byt nyckel' });
      await expect(dialog.getByRole('button', { name: 'Ta bort nyckeln' })).toBeVisible();
      await dialog.getByLabel(/^Ny nyckel/).fill('ny-nyckel');
      await dialog.getByRole('button', { name: 'Byt nyckel' }).click();
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Nyckeln är bytt'));
      await page.getByRole('button', { name: 'Testa', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Testets resultat' })).toContainText('listar 3 modeller');
      await expect(page.getByText('3 modeller som leverantören listar är inte tillagda.')).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Välj modeller att lägga till' }).click();
      await expect(page.getByRole('dialog', { name: 'Lägg till modell' }).getByRole('group', { name: 'Modeller att lägga till' }).getByRole('checkbox')).toHaveCount(3);
    });
    test('"Lägg till modell" asks the endpoint for its list and offers only what is not added yet, or an id by hand', async ({ page, api }) => {
      api.admin = true;
      await open(page, '/admin/models');
      await page.getByRole('button', { name: 'Lägg till modell' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Lägg till modell' });
      const listed = dialog.getByRole('group', { name: 'Modeller att lägga till' });
      await expect(listed.getByRole('checkbox')).toHaveCount(1);
      await expect(listed.getByRole('checkbox', { name: 'llama3.3:70b' })).toBeVisible();
      await expect(dialog.getByText('Leverantören listar 3, varav 2 redan är tillagda.', { exact: false })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Lägg till', exact: true })).toBeDisabled();
      await dialog.getByRole('textbox', { name: /^Eller en modell som inte finns i listan/ }).fill('gpt-oss:20b');
      // The field's own status; the dialog's live region repeats the same sentence for a screen reader.
      await expect(dialog.getByText('Modellen är redan tillagd.').first()).toBeVisible();
      await dialog.getByRole('textbox', { name: /^Eller en modell som inte finns i listan/ }).fill('');
      await listed.getByRole('checkbox', { name: 'llama3.3:70b' }).check();
      // The button fades from disabled to enabled: axe measures a colour, so it waits for the one the fade ends on.
      const add = dialog.getByRole('button', { name: 'Lägg till 1 modell' });
      await expect(add).toBeEnabled();
      await add.evaluate(button => Promise.all(button.getAnimations().map(animation => animation.finished)));
      await expectNoAxeViolations(page);
      await add.click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('1 modell tillagd, avstängd tills du slår på den'));
      await expect(page.getByRole('link', { name: 'llama3.3:70b' })).toBeVisible();
    });
    test('with a long model list on a short screen the list scrolls inside the dialog and its actions stay on screen', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize({ width: 1280, height: 600 });
      const many = Array.from({ length: 14 }, (_, i) => `modell-${String(i + 1).padStart(2, '0')}`);
      const manga = { ...modelProviders()[0]!, id: 'manga', title: 'Många', models: 0, enabledModels: 0 };
      // The endpoint lists fourteen models: this route answers the save before the shared fake does, and the fake knows the provider for the add.
      await page.route('**/api/admin/providers', route => { api.providers = [...api.providers, manga]; return route.fulfill({ status: 201, json: { provider: providerDetail(manga), report: { ...providerReport, models: many } } }); });
      await open(page, '/admin/models');
      await page.getByRole('button', { name: 'Lägg till leverantör' }).click();
      const dialog = page.getByRole('dialog', { name: 'Lägg till leverantör' });
      await dialog.getByRole('textbox', { name: /^Namn/ }).fill('Många');
      await dialog.getByRole('textbox', { name: /^Adress/ }).fill('http://manga.test/v1');
      await dialog.getByRole('button', { name: 'Testa och spara' }).click();
      await expect(dialog.getByRole('group', { name: 'Modeller att lägga till' }).getByRole('checkbox')).toHaveCount(14);
      await expect(dialog.getByRole('button', { name: 'Klar' })).toBeInViewport();
      await dialog.getByRole('checkbox', { name: 'modell-14' }).check();
      const add = dialog.getByRole('button', { name: 'Lägg till 1 modell' });
      await expect(add).toBeInViewport();
      await add.click();
      await expect(dialog).toHaveCount(0);
    });
  });

  test.describe('1.4.10 reflow', () => {
    test('the list, a model, a provider and the add dialog reflow at 320 px', async ({ page, api }) => {
      api.admin = true;
      await page.setViewportSize(narrow);
      for (const path of ['/admin/models', '/admin/models/gpt-oss-120b', '/admin/models/providers/kommunen']) {
        await open(page, path);
        expect(await reflowProblems(page)).toEqual([]);
      }
      await open(page, '/admin/models');
      await expect(page.getByRole('list', { name: 'Modeller hos Kommunens modeller' })).toBeVisible();
      await page.getByRole('button', { name: 'Lägg till leverantör' }).click();
      await expect(page.getByRole('dialog', { name: 'Lägg till leverantör' })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
    });
  });
});

test.describe('the person\'s model in the box', () => {
  test.use({ viewport: desktop });
  test('with one model the menu is there and names it, so the box always says which model answers (D36)', async ({ page, api: _ }) => {
    await open(page, '/');
    await expect(composer(page)).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Modell: Kapabel' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole('group', { name: 'Modell' }).getByRole('menuitemradio')).toHaveCount(1);
  });
  test('with two the menu names the current one, lists each with what it is good for, and a choice is spoken and kept', async ({ page, api }) => {
    api.modelChoices = 2;
    await open(page, '/');
    const trigger = page.getByRole('button', { name: 'Modell: Kapabel' });
    await trigger.click();
    const group = page.getByRole('group', { name: 'Modell' });
    await expect(group.getByRole('menuitemradio', { name: /Kapabel \(standard\)/ })).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('menuitemradio', { name: /Snabb \(lokal\)/ })).toContainText('Korta frågor om dagen.');
    await expectNoAxeViolations(page);
    // By keyboard from the trigger: Enter opens the menu on the current model, the arrow moves, Enter chooses and closes.
    if (await group.isVisible()) await page.keyboard.press('Escape');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(group.getByRole('menuitemradio', { name: /Kapabel/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Nästa fråga besvaras av Snabb (lokal)'));
    await expect(page.getByRole('button', { name: 'Modell: Snabb (lokal)' })).toBeVisible();
    expect(api.currentModel).toBe('gpt-oss-20b');
  });
  test('an answer a model wrote names the model under it', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Hur många semesterdagar har jag?');
    await input.press('Enter');
    await expect(page.getByRole('paragraph').filter({ hasText: 'Du har 18 semesterdagar kvar i år.' })).toBeVisible();
    await expect(page.getByText('Personalsystemet · Svar från Kapabel')).toBeVisible();
  });
});
