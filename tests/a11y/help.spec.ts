import type { PanelViewSpec, Thread } from '@clew/contracts';
import type { Page } from '@playwright/test';
import { desktop, expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';
import { helpCapabilities, HELP_CAPABILITY, HELP_TITLE } from '../../apps/server/src/modules/help/capabilities';
import { helpText } from '../../apps/server/src/modules/help/domain';

/**
 * The introduction and the help (D97): the card a new person gets once, whose step opens the help beside Hem, and the
 * row in the person's dialog that opens the same help from anywhere. The mocked API answers with the view the core
 * connector really declares and the text the help's own function writes.
 */
const declared = helpCapabilities({ read: async () => ({ body: '' }), overview: async () => overview })
  .capabilities[0]!;
const helpSpec = {
  ...declared.view!,
  capability: HELP_CAPABILITY,
  connector: 'clew',
  source: 'Startsidan',
  chip: false,
} as PanelViewSpec;
const overview = {
  areas: [
    {
      title: 'Budget',
      source: 'Ekonomisystemet',
      schedules: [{ label: 'Fakturor som förfaller inom en vecka', when: 'Varje vardag 06:00' }],
      standing: ['Fakturor att attestera', 'Budget mot prognos'],
    },
    { title: 'Medarbetare', source: 'Personalsystemet', schedules: [], standing: ['Vem är på plats i dag?'] },
  ],
  tools: ['Telefonbok'],
};
const output = { body: helpText(overview) };
const NOW = '2026-11-04T08:00:00.000Z';
const introduction: Thread = {
  id: 'introduction:testa',
  kind: 'pushed',
  topic: 'introduction',
  title: HELP_TITLE,
  state: 'open',
  trigger: { reason: 'Du är ny på Startsidan. Kortet visas en gång', source: 'Startsidan', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'clew',
  area: 'fragor',
  summary: 'Här samlas det som behöver dig från systemen du arbetar i. Se hur sidan fungerar och vad du har här.',
  items: [],
  actions: [
    { id: 'show', label: 'Kom igång', capability: HELP_CAPABILITY, kind: 'read', role: 'primary', target: 'panel' },
  ],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
};
/**
 * The help as the server answers it, as a view of its own and as the card's step. The step is the card's answer (D97):
 * the first read closes the card and answers it closed, and the stream no longer has it open.
 */
async function serveHelp(page: Page, card?: Thread) {
  await page.route('**/api/cap/clew.help**', route =>
    route.fulfill({ json: { output, source: 'Startsidan', view: helpSpec } }),
  );
  await page.route(/\/api\/threads\/introduction[^/]*\/act$/, route => {
    const closes = card?.state === 'open';
    if (card && closes) Object.assign(card, { state: 'handled', handledAt: NOW, updatedAt: NOW });
    return route.fulfill({ json: { kind: 'read', output, view: helpSpec, ...(closes ? { thread: card } : {}) } });
  });
}
const sections = [
  'Det här är Startsidan',
  'Fråga eller sök i rutan',
  'Korten under Behöver dig',
  'Det här har du',
  'Hitta tillbaka hit',
];
const person = (page: Page) => page.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true });

test.describe('the introduction and the help', () => {
  test.use({ viewport: desktop });

  test('the card stands under Senare; its step opens the help beside Hem, and the card is done when the help is closed', async ({
    page,
    api,
  }) => {
    const card = { ...introduction };
    api.threads.push(card);
    await serveHelp(page, card);
    await open(page, '/');
    const later = page.getByRole('region', { name: 'Senare' });
    const row = later.getByRole('listitem').filter({ hasText: HELP_TITLE });
    await expect(row).toContainText('Du är ny på Startsidan. Kortet visas en gång');
    const step = row.getByRole('button', { name: 'Kom igång' });
    await step.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/open-card=introduction(%3A|:)testa&open-action=show/);
    const panel = page.getByRole('dialog', { name: 'Kom igång' });
    for (const name of sections) await expect(panel.getByRole('heading', { name })).toBeVisible();
    // The person's own systems are in the text, each area with what it pushes and what can be done at any time.
    await expect(panel).toContainText('Startsidan läser ur två system åt dig: Ekonomisystemet och Personalsystemet.');
    await expect(panel.getByRole('listitem').filter({ hasText: 'Kommer hit' }).last()).toContainText(
      'Kommer hit: Fakturor som förfaller inom en vecka (varje vardag 06:00)',
    );
    await expect(panel).toContainText('Gör själv: Fakturor att attestera · Budget mot prognos');
    await expectNoAxeViolations(page);
    // While the help is read the row keeps its place, so closing the help has somewhere to give the focus back to.
    await expect(row).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    // Then the card is done: its row leaves, a toast says where it went and where the help is, and the focus goes on
    // to what is next on the page, never to nothing (2.4.3).
    await expect(row).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Aviseringar' })
        .getByText(`${HELP_TITLE} ligger nu under Klart. Hjälpen finns alltid under ditt namn högst upp.`),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    // Here that is the row after it in Hem's list.
    expect(await page.evaluate(() => document.activeElement?.closest('[id^="thread-"]')?.id)).toMatch(/^thread-/);
    await expectNoAxeViolations(page);
  });

  test('the step has an address that outlives the card: a reload shows the help again, and back closes it', async ({
    page,
    api,
  }) => {
    const card = { ...introduction };
    api.threads.push(card);
    await serveHelp(page, card);
    await open(page, '/');
    await page.getByRole('region', { name: 'Senare' }).getByRole('button', { name: 'Kom igång' }).click();
    const panel = page.getByRole('dialog', { name: 'Kom igång' });
    await expect(panel.getByRole('heading', { name: sections[3]! })).toBeVisible();
    // The read closed the card, so after a reload the stream no longer has it; the address still answers the help (D50).
    await page.reload();
    await expect(panel.getByRole('heading', { name: sections[3]! })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Du är ny på Startsidan' })).toHaveCount(0);
    await page.goBack();
    await expect(panel).toHaveCount(0);
  });

  test('Hjälp in the person’s dialog opens the help beside Hem by keyboard, and keeps what the address held', async ({
    page,
    api: _,
  }) => {
    await serveHelp(page);
    await open(page, '/?tab=waiting');
    await person(page).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Testa Testsson' });
    const help = dialog.getByRole('link', { name: 'Hjälp' });
    await expect(help).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    await expectNoAxeViolations(page);
    await help.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/tab=waiting/);
    await expect(page).toHaveURL(/open=clew\.help/);
    const panel = page.getByRole('dialog', { name: HELP_TITLE });
    // The text's sections are one level under the panel's own heading, so the outline has no gap.
    await expect(panel.getByRole('heading', { name: sections[0]! })).toBeVisible();
    await expectNoAxeViolations(page);
    // Esc closes the help and leaves the page where it was.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/tab=waiting/);
    await expect(page).not.toHaveURL(/open=/);
  });

  test('from a page without a panel the help opens over Hem', async ({ page, api: _ }) => {
    await serveHelp(page);
    await open(page, '/calendar');
    await person(page).click();
    await page.getByRole('dialog', { name: 'Testa Testsson' }).getByRole('link', { name: 'Hjälp' }).click();
    await expect(page).toHaveURL(/\/\?open=clew\.help/);
    await expect(
      page.getByRole('dialog', { name: HELP_TITLE }).getByRole('heading', { name: sections[3]! }),
    ).toBeVisible();
  });
});

test.describe('the help at 320 px', () => {
  test.use({ viewport: narrow });

  test('reflows without a sideways scroll and has no axe violations', async ({ page, api: _ }) => {
    await serveHelp(page);
    await open(page, `/?open=clew.help&open-title=${encodeURIComponent(HELP_TITLE)}`);
    const panel = page.getByRole('dialog', { name: HELP_TITLE });
    for (const name of sections) await expect(panel.getByRole('heading', { name })).toBeVisible();
    expect(await reflowProblems(page, panel)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
