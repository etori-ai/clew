import type { Page, Route } from '@playwright/test';
import type { DialogueUnit, EntityDetail, EntitySource } from '@clew/contracts';
import { ENTITY_UNIT } from './data';
import { SICK_UNIT, Units } from './unit-data';
import {
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
 * One unit's follow-up dialogue (D118) as a focused overlay over the unit's page (D83, D111 rule 5): an end Drawer on a
 * desktop, a tall sheet on a phone, at the page's own address with `dialog=<unitId>`. The way in is the Dialog section's
 * "Öppna dialogen". The areas are tabs; an assessed area has its state per dimension with a form and the history, every
 * area its questions and its activities with a form to add one. `Dialogues` answers `/api/dialogue/**` from memory, as
 * the server would, so a write is read back.
 */
const school = `/units/${ENTITY_UNIT.id}`;
const DIALOGUE_UNIT = 'dialogue.unit';
const dialogueSource: EntitySource = {
  capability: DIALOGUE_UNIT,
  connector: 'dialogue',
  source: 'Dialog',
  title: 'Dialog',
  view: {
    kind: 'list',
    title: 'open',
    noun: { one: 'enhet', other: 'enheter' },
    fields: [
      { key: 'open', label: 'Aktiviteter' },
      {
        key: 'state',
        label: 'Bedömning',
        format: 'status',
        tones: { Bra: 'ok', Bevaka: 'warn', 'Åtgärd krävs': 'alert' },
      },
    ],
  },
  page: { title: 'Öppna dialogen', href: '?dialog={key}' },
  own: true,
};
/** The unit's page with the Dialog section first, as the server orders Clew's own sources. */
class DialogueUnits extends Units {
  override detail(id: string): EntityDetail | undefined {
    const d = super.detail(id);
    return d && id === ENTITY_UNIT.id ? { ...d, sections: [dialogueSource, ...d.sections] } : d;
  }
}
const at = '2026-11-02T09:00:00.000Z';
const fresh = (): DialogueUnit => ({
  unit: { id: ENTITY_UNIT.id, label: ENTITY_UNIT.label, relation: 'below' },
  writable: true,
  areas: [
    {
      key: 'sick-leave',
      title: 'Sjukfrånvaro',
      kind: 'measured',
      measure: SICK_UNIT,
      info: 'Andelen av den planerade arbetstiden.',
      dimensions: [],
      questions: [{ heading: 'Mönster', text: 'Syns ett mönster i frånvaron?' }],
      activities: [],
    },
    {
      key: 'operations',
      title: 'Verksamhet',
      kind: 'assessed',
      tone: 'warn',
      dimensions: [
        {
          key: 'mission',
          title: 'Grunduppdrag',
          history: [
            { tone: 'warn', comment: 'Bemanningen är tunn.', by: 'Testa Testsson', at },
            { tone: 'ok', by: 'Testa Testsson', at: '2026-10-01T09:00:00.000Z' },
          ],
        },
        { key: 'council-goals', title: 'Fullmäktigemål', history: [] },
      ],
      questions: [
        { heading: 'Uppdraget', text: 'Klarar enheten sitt uppdrag?', basedOn: 'Jag vet vad som förväntas av mig.' },
      ],
      activities: [
        {
          id: 'a1',
          text: 'Se över schemat',
          dueOn: '2026-10-20',
          owner: 'Hillevi Berg',
          mine: false,
          createdAt: at,
        },
        {
          id: 'a2',
          text: 'Prata med facket',
          owner: 'Hillevi Berg',
          mine: false,
          doneAt: at,
          doneNote: 'Gjort.',
          createdAt: at,
        },
      ],
    },
  ],
});
/** `/api/dialogue/**` in memory: a write changes what the next read answers, and every write is kept. */
class Dialogues {
  data = fresh();
  refused = false;
  writes: Array<{ method: string; path: string; body: unknown }> = [];
  private n = 0;
  async route(page: Page) {
    await page.route(
      url => url.pathname.startsWith('/api/dialogue/'),
      async (route: Route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace('/api/dialogue', '');
        if (this.refused)
          return route.fulfill({
            status: 403,
            json: { error: 'Enheten finns inte bland dem du följer upp.', code: 'denied' },
          });
        if (request.method() === 'GET') return route.fulfill({ json: this.data });
        const body: unknown = request.postData() ? JSON.parse(request.postData()!) : undefined;
        this.writes.push({ method: request.method(), path, body });
        const b = (body ?? {}) as Record<string, string | undefined>;
        const area = (key: string | undefined) => this.data.areas.find(a => a.key === key)!;
        const activity = (id: string) => this.data.areas.flatMap(a => a.activities).find(a => a.id === id)!;
        const [, kind, id, sub] = path.split('/');
        if (kind === 'units' && sub === 'assessments') {
          const a = area(b.area);
          const dim = a.dimensions.find(d => d.key === (b.dimension ?? ''))!;
          dim.history.unshift({
            tone: b.tone as 'ok' | 'warn' | 'alert',
            ...(b.comment ? { comment: b.comment } : {}),
            by: 'Testa Testsson',
            at,
          });
          return route.fulfill({ status: 201, json: { id: 'as' + ++this.n } });
        }
        if (kind === 'units' && sub === 'activities') {
          const newId = 'new' + ++this.n;
          area(b.area).activities.unshift({
            id: newId,
            text: b.text!,
            ...(b.dueOn ? { dueOn: b.dueOn } : {}),
            owner: 'Hillevi Berg',
            mine: false,
            createdAt: at,
          });
          return route.fulfill({ status: 201, json: { id: newId } });
        }
        const a = activity(id!);
        if (sub === 'done' && request.method() === 'POST') Object.assign(a, { doneAt: at, doneNote: b.note });
        else if (sub === 'done') {
          delete a.doneAt;
          delete a.doneNote;
        } else if (request.method() === 'PATCH') Object.assign(a, { text: b.text });
        else for (const ar of this.data.areas) ar.activities = ar.activities.filter(x => x.id !== id);
        return route.fulfill({ status: 204 });
      },
    );
    // The Dialog section's row on the unit's page.
    await page.route(
      url =>
        url.pathname === `/api/entities/unit/${ENTITY_UNIT.id}/section` &&
        url.searchParams.get('capability') === DIALOGUE_UNIT,
      route =>
        route.fulfill({
          json: {
            capability: DIALOGUE_UNIT,
            status: 'ok',
            row: { key: ENTITY_UNIT.id, open: '1 öppen aktivitet', warn: 'Bevaka: Verksamhet' },
          },
        }),
    );
  }
}
const drawer = (page: Page) =>
  page.getByRole('dialog', { name: `Uppföljningsdialog med ${ENTITY_UNIT.label}`, exact: true });
const notices = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
async function setUp(page: Page) {
  await new DialogueUnits().route(page);
  const d = new Dialogues();
  await d.route(page);
  return d;
}

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['phone', phone],
] as const)
  test.describe(`the dialogue on ${layout}`, () => {
    test.use({ viewport });

    test('it opens over the unit’s page on the area to watch, read as an agenda; axe holds and every focus stop is marked', async ({
      page,
      api: _,
    }) => {
      await setUp(page);
      await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
      const dialog = drawer(page);
      await expect(dialog).toBeVisible();
      await expect(page).toHaveTitle(`Uppföljningsdialog med ${ENTITY_UNIT.label} · Startsidan`);
      const tabs = dialog.getByRole('tablist', { name: 'Områden' });
      await expect(tabs.getByRole('tab')).toHaveCount(2);
      // Each tab says its area's state, and the drawer opens on the area that needs a conversation most.
      await expect(tabs.getByRole('tab').nth(0)).toHaveAccessibleName(/^Sjukfrånvaro/);
      await expect(tabs.getByRole('tab').nth(1)).toHaveAccessibleName(/Verksamhet.*Bevaka/);
      await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
      const panel = dialog.getByRole('tabpanel', { name: 'Verksamhet' });
      await expect(panel).toBeVisible();
      // The agenda: where it stands, what to talk about, then the assessment and the activities, forms behind buttons.
      const order = await panel
        .getByRole('heading', { level: 3 })
        .allTextContents()
        .then(t => t.map(h => h.trim()));
      expect(order).toEqual(['Läget', 'Att prata om', 'Bedömning', 'Aktiviteter']);
      await expect(panel.getByRole('heading', { name: 'Grunduppdrag' })).toBeVisible();
      await expect(panel.getByText('Bemanningen är tunn.')).toBeVisible();
      await expect(panel.getByRole('list', { name: 'Tidigare bedömningar av Grunduppdrag' })).toBeVisible();
      await expect(panel.getByText('Inte bedömd än.')).toBeVisible();
      const questions = panel.getByRole('list', { name: 'Att prata om' });
      await expect(questions).toContainText('Uppdraget');
      await expect(questions).toContainText('Klarar enheten sitt uppdrag?');
      await expect(questions).toContainText('Bygger på: ”Jag vet vad som förväntas av mig.”');
      await expect(panel.getByRole('form')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Ny bedömning av Verksamhet' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Lägg till aktivitet i Verksamhet' })).toBeVisible();
      const openList = panel.getByRole('list', { name: 'Öppna aktiviteter' });
      await expect(openList).toContainText('Se över schemat');
      await expect(openList).toContainText('Hillevi Berg · senast 20 oktober');
      await expect(openList.getByText('Försenad', { exact: true })).toBeVisible();
      await expect(panel.getByRole('list', { name: 'Klara aktiviteter' })).toContainText('Gjort.');
      await expectNoAxeViolations(page);
      const { unmarked, hidden } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
      expect(hidden).toEqual([]);
      // A measured area: its figure as the unit's page draws it, what it measures and where it comes from.
      await tabs.getByRole('tab').nth(0).click();
      const sick = dialog.getByRole('tabpanel', { name: 'Sjukfrånvaro' });
      await expect(sick.getByText('Sjukfrånvaro · Qlik')).toBeVisible();
      await expect(sick.getByRole('list', { name: 'Att prata om' })).toContainText('Syns ett mönster i frånvaron?');
      await expect(sick.getByText('Inga aktiviteter än.')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

test.describe('the dialogue by keyboard', () => {
  test.use({ viewport: desktop });

  test('open from the section, assess, add an activity, mark it done with a note, open it again, remove a done one, close', async ({
    page,
    api: _,
  }) => {
    const d = await setUp(page);
    await open(page, school);
    const way = page.getByRole('main').getByRole('link', { name: 'Öppna dialogen' });
    await expect(way).toHaveAttribute('href', `${school}?dialog=${ENTITY_UNIT.id}`);
    await way.focus();
    await page.keyboard.press('Enter');
    const dialog = drawer(page);
    await expect(dialog).toBeVisible();
    const panel = dialog.getByRole('tabpanel', { name: 'Verksamhet' });
    await expect(panel).toBeVisible();

    // Ny bedömning opens the form with the focus in it: the part, the state, a comment, Spara.
    const assess = panel.getByRole('button', { name: 'Ny bedömning av Verksamhet' });
    await assess.focus();
    await page.keyboard.press('Enter');
    const form = panel.getByRole('form', { name: 'Ny bedömning av Verksamhet' });
    await expect(form.getByRole('radio', { name: 'Grunduppdrag' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(form.getByRole('radio', { name: 'Fullmäktigemål' })).toBeChecked();
    await form.getByRole('radio', { name: 'Bra' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(form.getByRole('radio', { name: 'Bevaka' })).toBeChecked();
    await form.getByRole('textbox', { name: /Kommentar/ }).fill('Målen syns inte i vardagen.');
    await form.getByRole('button', { name: 'Spara bedömning' }).focus();
    await page.keyboard.press('Enter');
    await expect(notices(page).getByText('Bedömningen av Fullmäktigemål är sparad.')).toBeAttached();
    expect(d.writes.at(-1)).toEqual({
      method: 'POST',
      path: `/units/${ENTITY_UNIT.id}/assessments`,
      body: { area: 'operations', dimension: 'council-goals', tone: 'warn', comment: 'Målen syns inte i vardagen.' },
    });
    await expect(panel.getByText('Målen syns inte i vardagen.')).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(assess).toBeFocused();

    // Lägg till aktivitet opens the form with the focus in its text; after adding, the field empties and keeps it.
    const addButton = panel.getByRole('button', { name: 'Lägg till aktivitet i Verksamhet' });
    await addButton.focus();
    await page.keyboard.press('Enter');
    const add = panel.getByRole('form', { name: 'Ny aktivitet' });
    const text = add.getByRole('textbox', { name: /Vad ska göras/ });
    await expect(text).toBeFocused();
    await page.keyboard.type('Ta fram en plan');
    await add.getByRole('button', { name: 'Lägg till' }).focus();
    await page.keyboard.press('Enter');
    await expect(notices(page).getByText('Aktiviteten är tillagd.')).toBeAttached();
    await expect(text).toBeFocused();
    await expect(text).toHaveValue('');
    const openList = panel.getByRole('list', { name: 'Öppna aktiviteter' });
    await expect(openList).toContainText('Ta fram en plan');
    await expect(openList).toContainText('Hillevi Berg · inget slutdatum');
    await add.getByRole('button', { name: 'Stäng' }).focus();
    await page.keyboard.press('Enter');
    await expect(add).toHaveCount(0);
    await expect(addButton).toBeFocused();

    // Klar opens a form with the focus in its note; Markera klar moves the row and Öppna igen takes the focus.
    await openList.getByRole('button', { name: 'Klar: Ta fram en plan' }).focus();
    await page.keyboard.press('Enter');
    const note = panel.getByRole('textbox', { name: /Hur gick det/ });
    await expect(note).toBeFocused();
    await page.keyboard.type('Klart i tid.');
    await panel.getByRole('button', { name: 'Markera klar' }).focus();
    await page.keyboard.press('Enter');
    await expect(notices(page).getByText('Aktiviteten är klar.')).toBeAttached();
    const reopen = panel.getByRole('button', { name: 'Öppna igen: Ta fram en plan' });
    await expect(reopen).toBeFocused();
    expect(d.writes.at(-1)).toMatchObject({ method: 'POST', body: { note: 'Klart i tid.' } });

    // Öppna igen: back among the open ones with Klar focused.
    await page.keyboard.press('Enter');
    await expect(openList.getByRole('button', { name: 'Klar: Ta fram en plan' })).toBeFocused();

    // Removing a done one asks first, and says it cannot be undone.
    await panel.getByRole('button', { name: 'Ta bort: Prata med facket' }).focus();
    await page.keyboard.press('Enter');
    const ask = page.getByRole('alertdialog', { name: 'Ta bort aktiviteten' });
    await expect(ask).toContainText('Det går inte att ångra.');
    await ask.getByRole('button', { name: 'Ta bort' }).click();
    await expect(notices(page).getByText('Aktiviteten är borttagen.')).toBeAttached();
    // The removed row took the control that opened the confirmation with it: the focus is on the section's heading.
    await expect(ask).toBeHidden();
    await expect(panel.getByRole('heading', { name: 'Aktiviteter', exact: true })).toBeFocused();
    await expect(panel.getByRole('list', { name: 'Klara aktiviteter' })).toHaveCount(0);

    // Escape closes the dialogue: the page is as it was, the focus on the way in.
    await dialog.getByRole('tab', { name: /Verksamhet/ }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(school);
    await expect(way).toBeFocused();
  });

  test('closed after arriving by a direct link, the focus goes to the section’s way in, never the page’s body', async ({
    page,
    api: _,
  }) => {
    await setUp(page);
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Öppna dialogen' })).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole('main').getByRole('link', { name: 'Öppna dialogen' })).toBeFocused();
  });

  test('the other areas are hidden until found, and find in page reaching one selects its tab', async ({
    page,
    api: _,
  }) => {
    await setUp(page);
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    const dialog = drawer(page);
    await expect(dialog.getByRole('tabpanel', { name: 'Verksamhet' })).toBeVisible();
    const sick = dialog.locator('[role="tabpanel"][aria-label="Sjukfrånvaro"]');
    await expect(sick).toHaveAttribute('hidden', 'until-found');
    // The browser removes `hidden` and fires `beforematch` when its search reaches a hidden panel.
    await sick.evaluate(el => {
      el.removeAttribute('hidden');
      el.dispatchEvent(new Event('beforematch'));
    });
    await expect(dialog.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('[role="tabpanel"][aria-label="Verksamhet"]')).toHaveAttribute('hidden', 'until-found');
  });

  test('text being written survives a change of tab', async ({ page, api: _ }) => {
    await setUp(page);
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    const dialog = drawer(page);
    const panel = dialog.getByRole('tabpanel', { name: 'Verksamhet' });
    await panel.getByRole('button', { name: 'Lägg till aktivitet i Verksamhet' }).click();
    await panel.getByRole('textbox', { name: /Vad ska göras/ }).fill('Halvskriven');
    await dialog.getByRole('tab').nth(0).click();
    await dialog.getByRole('tab').nth(1).click();
    await expect(panel.getByRole('textbox', { name: /Vad ska göras/ })).toHaveValue('Halvskriven');
  });

  test('blank text is said on the field and nothing is sent', async ({ page, api: _ }) => {
    const d = await setUp(page);
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    const panel = drawer(page).getByRole('tabpanel', { name: 'Verksamhet' });
    await panel.getByRole('button', { name: 'Lägg till aktivitet i Verksamhet' }).click();
    const add = panel.getByRole('form', { name: 'Ny aktivitet' });
    await add.getByRole('button', { name: 'Lägg till' }).click();
    const text = add.getByRole('textbox', { name: /Vad ska göras/ });
    await expect(text).toBeFocused();
    await expect(add.getByText('Skriv vad som ska göras.')).toBeVisible();
    expect(d.writes).toEqual([]);
  });

  test('a unit the reader does not follow up is the dialogue that is not there, with the way back', async ({
    page,
    api: _,
  }) => {
    const d = await setUp(page);
    d.refused = true;
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    const dialog = page.getByRole('dialog', { name: 'Uppföljningsdialogen finns inte' });
    await expect(dialog.getByRole('heading', { name: 'Uppföljningsdialogen finns inte' }).first()).toBeVisible();
    await dialog.getByRole('button', { name: `Tillbaka till ${ENTITY_UNIT.label}` }).click();
    await expect(page).toHaveURL(school);
  });

  test('reflows at 320 px', async ({ page, api: _ }) => {
    await setUp(page);
    await page.setViewportSize(narrow);
    await open(page, `${school}?dialog=${ENTITY_UNIT.id}`);
    const dialog = drawer(page);
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('tabpanel', { name: 'Verksamhet' })
      .getByRole('button', { name: /Ny bedömning/ })
      .click();
    expect(await reflowProblems(page, dialog)).toEqual([]);
  });
});
