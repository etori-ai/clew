import type { Page } from '@playwright/test';
import {
  desktop,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
  type MockApi,
} from './support';
import { menuRows } from './phonebook';
import { ENTITY_UNIT, PRESENCE_LENS, TALK_LENS, newsOutput, talkSource } from './data';
import { ANNA, BoardingMock, PLAN } from './boarding';
import { competenceTypes, largeMatrix, searchHolders, withSkills } from './competence';
import { People } from './person-data';
import { SICK_UNIT, Units } from './unit-data';

/**
 * The assistant beside every page (D130; canvas boards AskRegister, AskArende-empty and AskArende-more), on the first
 * page that has it, a register: the phone book's directory, a table, as a tool. The frame draws "Fråga assistenten" at the
 * end of the title's line; it opens the assistant's pane beside the page, in the address (`ask=1`), with the focus in its
 * box. The pane says what it is about and what asking here does, sends every question with the list's chip, as what
 * stands open and with the page's subject, and finds the conversation again after a reload. Back, Esc, ✕ and the button
 * close it. "Öppna som samtal" leads to the conversation's page, which marks it opened, and only then does the rail list
 * it. Below 1340 px the pane is a drawer, and on a phone the button leads to a conversation.
 */
const directory = '/tools/phonebook.directory';
const WIDE = { width: 1440, height: 900 };
/** The conversation the mock makes for the first question beside the directory: one per thing asked in place. */
const ASKED = 'om-capability-phonebook-directory';
const rail = (page: Page) => page.getByRole('navigation', { name: 'Sidonavigering' });
const button = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' });
const pane = (page: Page) => page.getByRole('complementary', { name: 'Assistenten' });
const box = (page: Page) => page.getByRole('textbox', { name: 'Fråga om telefonbok' });
const ask = async (page: Page, question: string) => {
  await box(page).fill(question);
  await box(page).press('Enter');
};

test.describe('the assistant’s pane beside a register', () => {
  test.use({ viewport: WIDE });
  test.beforeEach(({ api }) => {
    api.menu = menuRows;
  });

  test('Fråga assistenten ends the title’s line and opens the pane beside the list, with the focus in its box, ask in the address and what asking here does in words', async ({
    page,
  }) => {
    await open(page, directory);
    const title = page.getByRole('heading', { level: 1, name: 'Telefonbok' });
    const ownBadge = page.getByRole('main').getByText('Telefonboken', { exact: true }).first();
    const toggle = button(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // At the end of the title's line: on the title's line, after the system's badge.
    const [t, b, s] = await Promise.all([title.boundingBox(), toggle.boundingBox(), ownBadge.boundingBox()]);
    expect(b!.y).toBeLessThan(t!.y + t!.height);
    expect(b!.y + b!.height).toBeGreaterThan(t!.y);
    expect(b!.x).toBeGreaterThan(s!.x + s!.width);
    await expect(page.getByRole('table')).toHaveCount(1);
    await toggle.click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    await expect(pane(page)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(box(page)).toBeFocused();
    // Its heading and what it is about; "Öppna som samtal" and ✕ at the end of its line.
    await expect(pane(page).getByRole('heading', { level: 2, name: 'Assistenten' })).toBeVisible();
    await expect(pane(page).getByText('Om Telefonbok', { exact: true })).toBeVisible();
    await expect(pane(page).getByRole('link', { name: 'Öppna som samtal' })).toHaveCount(1);
    await expect(pane(page).getByRole('button', { name: 'Stäng' })).toBeVisible();
    // Before anything is asked: what asking here does and what opening it as a conversation adds (rule 10).
    await expect(pane(page).getByText('Fråga om telefonbok', { exact: true }).first()).toBeVisible();
    await expect(
      pane(page).getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toBeVisible();
    await expect(pane(page).getByText(/^Öppnar du frågan som ett samtal får den hela sidan/)).toBeVisible();
    // The page stays, and draws its narrow layout while the pane takes its room: the table is its list (rule 11).
    await expect(title).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Telefonboken' }).getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a question goes with the list’s chip, as what stands open and with the page’s subject; the answer is drawn in the pane, and a reload keeps the pane and finds the conversation again', async ({
    page,
    api,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Vad väntar de på från mig?');
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([{ ref: 'capability:phonebook.directory', kind: 'capability', label: 'Telefonbok' }]);
    expect(asked.beside).toBe('capability:phonebook.directory');
    expect(asked.own).toBe(true);
    expect(asked.page).toEqual({ subject: 'view:phonebook.directory', label: 'Om Telefonbok' });
    expect(asked.conversationId).toBeUndefined();
    // The introduction gives way to the conversation.
    await expect(
      pane(page).getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);
    // A reload opens the pane again with the conversation in it, and moves no focus.
    await page.reload();
    await expect(pane(page).getByText('Vad väntar de på från mig?', { exact: true })).toBeVisible();
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(box(page)).not.toBeFocused();
    // The next question goes on in the same conversation.
    await ask(page, 'Och i morgon?');
    await expect(pane(page).getByText('Och i morgon?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!.conversationId).toBe(ASKED);
  });

  test('the pane’s width is the person’s own: its grip takes the arrow keys, the pane follows, and the width is kept over a reload and on another page', async ({
    page,
  }) => {
    await open(page, directory);
    await button(page).click();
    // Astryx's resize handle between the page and the pane: a separator that says the width and takes the keyboard.
    const grip = page.getByRole('separator', { name: 'Ändra assistentens bredd' });
    await expect(grip).toHaveAttribute('aria-valuenow', '400');
    await grip.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(grip).not.toHaveAttribute('aria-valuenow', '400');
    const wider = Number(await grip.getAttribute('aria-valuenow'));
    expect(wider).toBeGreaterThan(400);
    expect(Math.round((await pane(page).boundingBox())!.width)).toBe(wider);
    // The page gives the room and never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
      0,
    );
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Ändra assistentens bredd' })).toHaveAttribute(
      'aria-valuenow',
      String(wider),
    );
    // One width for every page: Nyheter's pane opens as wide.
    await open(page, '/tools/clew.news?ask=1');
    await expect(page.getByRole('separator', { name: 'Ändra assistentens bredd' })).toHaveAttribute(
      'aria-valuenow',
      String(wider),
    );
  });

  test('Back closes the pane and Forward opens it again without moving the focus; Esc, ✕ and the button again close it and give the focus back to the button', async ({
    page,
  }) => {
    await open(page, directory);
    const toggle = button(page);
    await toggle.click();
    await expect(pane(page)).toBeVisible();
    await page.goBack();
    await expect(pane(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${directory.replace(/\./g, '\\.')}$`));
    await page.goForward();
    await expect(pane(page)).toBeVisible();
    await expect(box(page)).not.toBeFocused();
    // Esc in the box.
    await box(page).focus();
    await page.keyboard.press('Escape');
    await expect(pane(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // ✕.
    await toggle.click();
    await expect(box(page)).toBeFocused();
    await pane(page).getByRole('button', { name: 'Stäng' }).click();
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle).toBeFocused();
    // The button again.
    await page.keyboard.press('Enter');
    await expect(pane(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await toggle.click();
    await expect(pane(page)).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test('Öppna som samtal leads to the conversation’s page, which marks it opened, and only then is it among the rail’s latest', async ({
    page,
    api,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Vad väntar de på från mig?');
    await expect(pane(page).getByText('Tio personer är på plats i dag.')).toBeVisible();
    // The rail's latest, by the conversation's address: the mock gives its conversations one title.
    const inRail = rail(page)
      .getByRole('group', { name: 'Fråga assistenten' })
      .locator(`a[href="/conversations/${ASKED}"]`);
    await expect(inRail).toHaveCount(0);
    expect(api.opened).toEqual([]);
    await pane(page).getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}$`));
    await expect(page.getByRole('main').getByText('Vad väntar de på från mig?', { exact: true }).first()).toBeVisible();
    await expect.poll(() => api.opened).toEqual([ASKED]);
    await expect(inRail).toHaveAttribute('aria-current', 'page');
    // Back on the list the conversation stays in the rail.
    await page.goBack();
    await expect(pane(page)).toBeVisible();
    await expect(inRail).toBeVisible();
  });

  test('an answer that needs room is one row in the pane, "Visa i samtalet", that leads to the conversation (rule 7)', async ({
    page,
  }) => {
    await open(page, directory);
    await button(page).click();
    await ask(page, 'Sök lärare i telefonboken');
    await expect(pane(page).getByText('Sök i telefonboken: 2 rader.')).toBeVisible();
    const row = pane(page).getByRole('link', { name: 'Visa i samtalet' });
    await expect(row).toHaveCount(1);
    await expect(pane(page).getByRole('table')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${ASKED}`));
  });
});

test.describe('the assistant’s pane on smaller screens', () => {
  test.beforeEach(({ api }) => {
    api.menu = menuRows;
  });

  test('below 1340 px the pane is a drawer over the page; Esc closes it and the focus goes back to the button', async ({
    page,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, directory);
    await button(page).click();
    const drawer = page.getByRole('dialog', { name: 'Assistenten' });
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/ask=1/);
    await expect(pane(page)).toHaveCount(0);
    await expect(drawer.getByRole('heading', { level: 2, name: 'Assistenten' })).toBeVisible();
    await expect(drawer.getByText('Om Telefonbok', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: 'Fråga om telefonbok' })).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/ask=1/);
    await expect(button(page)).toBeFocused();
  });

  test('on a phone the button leads to a conversation about the list, and there is no pane', async ({ page }) => {
    await page.setViewportSize(phone);
    await open(page, directory);
    const toggle = button(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveAttribute('aria-expanded');
    await toggle.click();
    await expect(page).toHaveURL(/\/conversations\/new$/);
    await expect(page.getByRole('complementary', { name: 'Assistenten' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Assistenten' })).toHaveCount(0);
  });

  test('at 320 px the register with its button reflows with nothing cut', async ({ page }) => {
    await page.setViewportSize(narrow);
    await open(page, directory);
    await expect(button(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
  });

  test('without a model there is no button, and an address with the pane opens nothing', async ({ page, api }) => {
    api.modelChoices = 0;
    await page.setViewportSize(WIDE);
    await open(page, `${directory}?ask=1`);
    await expect(page.getByRole('heading', { level: 1, name: 'Telefonbok' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expect(pane(page)).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(1);
  });
});

/**
 * Stage 2 (D130 rules 1, 4 and 11): the registers, Läget and Att göra's queue say what they show, and the frame draws
 * "Fråga assistenten" and the pane. On every one the button ends the title's line, the pane opens beside the page with
 * what it is about in words and its box, the page stays and never scrolls sideways while its column is 400 px narrower
 * (a table scrolls inside itself or becomes its list), and nothing breaks axe. Where the assistant cannot read what a
 * page shows, the pane says so under its heading before anything is asked; where it can, the question goes with the
 * read's chip, as what stands open and with the page's subject.
 */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main, [role="main"]');
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main ? main.scrollWidth - main.clientWidth : 0,
    );
  });
/** The frame's button: the pane's toggle, the one "Fråga assistenten" that says whether it is open. */
const frameButton = (page: Page) =>
  page.getByRole('main').locator('button[aria-expanded]').filter({ hasText: 'Fråga assistenten' });
const offer = (api: MockApi, capability: string, title: string) => {
  api.views = [...api.views.filter(v => v.capability !== capability), { capability, title, assistant: true }];
};
const registrar = (api: MockApi) => {
  api.competenceTypes = withSkills();
  api.relations = ['registrar'];
  api.employee = true;
  api.competenceSearch = searchHolders(false);
};
const units = async (page: Page, setup?: (u: Units) => void) => {
  const u = new Units();
  u.withBelow = true;
  setup?.(u);
  await u.route(page);
};
const REGISTERS: Array<{
  name: string;
  path: string;
  about: string;
  box: string;
  /** What the pane says it cannot read, or null where it can read all the page shows; unchecked when absent. */
  closed?: string | null;
  setup?: (api: MockApi, page: Page) => void | Promise<void>;
}> = [
  {
    name: 'Nyheter',
    path: '/tools/clew.news',
    about: 'Om Nyheter',
    box: 'Fråga om nyheter',
    closed: null,
    setup: api => {
      api.news = newsOutput();
    },
  },
  {
    name: 'Alla verktyg',
    path: '/tools',
    about: 'Om Alla verktyg',
    box: 'Fråga om alla verktyg',
    setup: api => {
      api.menu = menuRows;
    },
  },
  { name: 'Alla samtal', path: '/conversations', about: 'Om Alla samtal', box: 'Fråga om alla samtal' },
  { name: 'Medarbetare', path: '/staff', about: 'Om Medarbetare', box: 'Fråga om medarbetare' },
  {
    name: 'a lens of Personal',
    path: `/staff?show=${TALK_LENS}`,
    about: 'Om Utvecklingssamtal',
    box: 'Fråga om utvecklingssamtal',
  },
  {
    name: 'Medarbetarnas kompetens, twenty columns',
    path: '/competence/matrix',
    about: 'Om Medarbetarnas kompetens',
    box: 'Fråga om medarbetarnas kompetens',
    // What is required and what is held are offered; the units' coverage is not among the person's reads.
    closed: 'Assistenten kan inte läsa kompetenstäckning här.',
    setup: api => {
      api.competenceTypes = competenceTypes();
      api.competenceMatrix = largeMatrix();
    },
  },
  {
    name: 'Kompetenssökning',
    path: '/competence/search',
    about: 'Om Kompetenssökning',
    box: 'Fråga om kompetenser',
    setup: registrar,
  },
  {
    name: 'Introduktion och avslut',
    path: '/boarding',
    about: 'Om Introduktion och avslut',
    box: 'Fråga om introduktion och avslut',
    setup: api => {
      api.boarding = new BoardingMock();
    },
  },
  { name: 'Läget', path: '/units', about: 'Om Läget', box: 'Fråga om läget', setup: (_, page) => units(page) },
  { name: 'Att göra', path: '/todo', about: 'Om Att göra · Behöver dig', box: 'Fråga om ärendena' },
];

test.describe('the assistant’s pane beside every register, Läget and Att göra (D130 stage 2)', () => {
  test.use({ viewport: WIDE });

  for (const r of REGISTERS)
    test(`${r.name}: the frame’s button opens the pane beside the page, which says what it is about, and the page never scrolls sideways`, async ({
      page,
      api,
    }) => {
      await r.setup?.(api, page);
      await open(page, r.path);
      const toggle = frameButton(page);
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveAccessibleName('Fråga assistenten');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // One way to ask on the page: the frame's (a page that draws its own is a defect against D130).
      await expect(page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(1);
      await toggle.click();
      await expect(page).toHaveURL(/[?&]ask=1(&|$)/);
      await expect(pane(page)).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(pane(page).getByText(r.about, { exact: true })).toBeVisible();
      if (r.closed === null) await expect(pane(page).getByText(/^Assistenten (kan inte|läser aldrig)/)).toHaveCount(0);
      else if (r.closed) await expect(pane(page).getByText(r.closed, { exact: true })).toBeVisible();
      await expect(pane(page).getByRole('textbox', { name: r.box })).toBeFocused();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await sideways(page)).toBe(0);
      await expectNoAxeViolations(page);
    });

  test('at 1340 px, the narrowest window the pane stands beside, no register scrolls the page sideways', async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 1340, height: 900 });
    for (const r of REGISTERS) {
      await r.setup?.(api, page);
      await open(page, `${r.path}${r.path.includes('?') ? '&' : '?'}ask=1`);
      await expect(pane(page).getByText(r.about, { exact: true })).toBeVisible();
      expect(await sideways(page), r.name).toBe(0);
    }
  });

  test('the competence matrix keeps its grid beside the pane and scrolls it inside its own region, never the page', async ({
    page,
    api,
  }) => {
    api.competenceTypes = competenceTypes();
    api.competenceMatrix = largeMatrix();
    await open(page, '/competence/matrix?ask=1');
    await expect(pane(page)).toBeVisible();
    const grid = page.getByRole('grid');
    await expect(grid).toHaveAttribute('aria-colcount', '21');
    const region = await grid.evaluate(el => {
      let n: HTMLElement | null = el.parentElement;
      while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowX)) n = n.parentElement;
      const column = document.querySelector('main, [role="main"]')!.getBoundingClientRect();
      return n
        ? { scrolls: n.scrollWidth > n.clientWidth, right: n.getBoundingClientRect().right, column: column.right }
        : null;
    });
    expect(region?.scrolls).toBe(true);
    // The grid ends inside the column, which ends where the pane begins.
    const paneBox = (await pane(page).boundingBox())!;
    expect(region!.right).toBeLessThanOrEqual(paneBox.x + 1);
    expect(await sideways(page)).toBe(0);
  });

  test('the competence search says before anything is asked that the assistant reads none of it, and a question goes with no read', async ({
    page,
    api,
  }) => {
    registrar(api);
    await open(page, '/competence/search');
    await frameButton(page).click();
    await expect(
      pane(page).getByText(
        'Assistenten läser aldrig din sökning eller det den hittar: sökningen görs bara av dig, här på sidan. Du kan ändå fråga om annat som du har tillgång till.',
        { exact: true },
      ),
    ).toBeVisible();
    const field = pane(page).getByRole('textbox', { name: 'Fråga om kompetenser' });
    await field.fill('Vilka kurser finns?');
    await field.press('Enter');
    await expect(pane(page).getByText('Vilka kurser finns?', { exact: true })).toBeVisible();
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([]);
    expect(asked.beside).toBeUndefined();
    expect(asked.page).toEqual({ subject: 'competence:search', label: 'Om Kompetenssökning' });
  });

  test('a lens of another system that the assistant cannot read says so by the system’s name, and opens as a conversation with the lens beside it', async ({
    page,
    api,
  }) => {
    // The system's reads are kept from the assistant, as an administrator's switch keeps them: while the assistant may
    // make any read of the system the pane does not call it closed.
    const system = PRESENCE_LENS.slice(0, PRESENCE_LENS.indexOf('.') + 1);
    api.views = api.views.map(({ assistant, ...view }) =>
      view.capability.startsWith(system) || !assistant ? view : { ...view, assistant },
    );
    await open(page, `/staff?show=${PRESENCE_LENS}`);
    await frameButton(page).click();
    await expect(pane(page).getByText('Om Frånvaro', { exact: true })).toBeVisible();
    await expect(
      pane(page).getByText(
        'Assistenten kan inte läsa det som Personalsystemet visar här. Du kan ändå fråga om annat som du har tillgång till.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(pane(page).getByRole('link', { name: 'Öppna som samtal' })).toHaveAttribute(
      'href',
      `/conversations/new?lens=${encodeURIComponent(PRESENCE_LENS)}`,
    );
    await expectNoAxeViolations(page);
  });

  test('a lens read through an overview the assistant may make goes with that read’s chip, and the pane says nothing is closed', async ({
    page,
    api,
  }) => {
    api.entityList = {
      ...api.entityList,
      lenses: api.entityList.lenses.map(l =>
        l.capability === TALK_LENS ? { ...talkSource, overviews: ['talks.talks'] } : l,
      ),
    };
    offer(api, 'talks.talks', 'Utvecklingssamtal');
    await open(page, `/staff?show=${TALK_LENS}`);
    await frameButton(page).click();
    await expect(pane(page).getByText(/^Assistenten kan inte läsa/)).toHaveCount(0);
    const field = pane(page).getByRole('textbox', { name: 'Fråga om utvecklingssamtal' });
    await field.fill('Vem har inte bokat?');
    await field.press('Enter');
    await expect(pane(page).getByText('Vem har inte bokat?', { exact: true })).toBeVisible();
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([{ ref: 'capability:talks.talks', kind: 'capability', label: 'Utvecklingssamtal' }]);
    expect(asked.beside).toBe('capability:talks.talks');
    expect(asked.page).toEqual({ subject: `lens:${TALK_LENS}`, label: 'Om Utvecklingssamtal' });
  });

  test('Läget goes with the columns the assistant may read and names the one it may not', async ({ page, api }) => {
    await units(page, u => {
      u.overviews = { [SICK_UNIT]: ['qlik.units'] };
    });
    offer(api, 'qlik.units', 'Sjukfrånvaro per enhet');
    await open(page, '/units');
    await frameButton(page).click();
    await expect(
      pane(page).getByText('Assistenten kan inte läsa utvecklingssamtal här.', { exact: true }),
    ).toBeVisible();
    const field = pane(page).getByRole('textbox', { name: 'Fråga om läget' });
    await field.fill('Var är sjukfrånvaron högst?');
    await field.press('Enter');
    await expect(pane(page).getByText('Var är sjukfrånvaron högst?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!.chips).toEqual([
      { ref: 'capability:qlik.units', kind: 'capability', label: 'Sjukfrånvaro' },
    ]);
    // The units' table scrolls inside itself beside the pane, the names pinned; the page does not.
    expect(await sideways(page)).toBe(0);
    await expectNoAxeViolations(page);
  });

  test('Att göra: the frame’s button with no item; an item opened takes the end slot and the address lets go of the pane, and closing it leaves the queue as it was', async ({
    page,
    api,
  }) => {
    offer(api, 'clew.work', 'Att göra');
    await open(page, '/todo');
    const toggle = frameButton(page);
    await toggle.click();
    await expect(page).toHaveURL(/\/todo\?ask=1$/);
    await expect(pane(page).getByText('Om Att göra · Behöver dig', { exact: true })).toBeVisible();
    // The queue holds beside the pane: its rows are links, its columns all there.
    const table = page.getByRole('table', { name: 'Behöver dig' });
    await expect(table.getByRole('columnheader')).toHaveText(['Ärende', 'Från', 'Status']);
    expect(await sideways(page)).toBe(0);
    const field = pane(page).getByRole('textbox', { name: 'Fråga om ärendena' });
    await field.fill('Vad är mest bråttom?');
    await field.press('Enter');
    await expect(pane(page).getByText('Vad är mest bråttom?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!).toMatchObject({
      chips: [{ ref: 'capability:clew.work', kind: 'capability', label: 'Att göra' }],
      beside: 'capability:clew.work',
      page: { subject: 'todo:needs-you', label: 'Om Att göra · Behöver dig' },
    });
    // An item opened: the reading pane has the end slot, the address names the item and not the pane, and no button
    // asks the assistant: the box stands under the item (rule 5).
    const first = table.getByRole('row').nth(1).getByRole('link').first();
    await first.click();
    const reading = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(reading).toBeVisible();
    await expect(page).toHaveURL(/\/todo\?item=[^&]+$/);
    await expect(pane(page)).toHaveCount(0);
    await expect(frameButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expect(reading.getByRole('textbox', { name: 'Fråga om ärendet' })).toBeVisible();
    await expectNoAxeViolations(page);
    // Closed, the queue is as it was before the pane was opened, with the frame's button back.
    await reading
      .getByRole('button', { name: /^Stäng/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/todo$/);
    await expect(pane(page)).toHaveCount(0);
    await expect(frameButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Att göra, an item in the reading pane (rule 5): its name has the focus, the box stands at the pane’s foot under the read, a question goes with the item as what stands open and is answered there, and a reload finds the conversation again', async ({
    page,
    api,
  }) => {
    await open(page, '/todo');
    const table = page.getByRole('table', { name: 'Behöver dig' });
    await table.getByRole('row').nth(1).getByRole('link').first().click();
    const reading = page.getByRole('complementary', { name: 'Valt ärende' });
    const id = new URL(page.url()).searchParams.get('item')!;
    // Opening the item gives the focus to its name, never to the box.
    await expect(reading.getByRole('heading', { level: 2 }).first()).toBeFocused();
    const field = reading.getByRole('textbox', { name: 'Fråga om ärendet' });
    await expect(field).toBeVisible();
    await expect(field).not.toBeFocused();
    // Two parts: the read scrolls in the upper one, the conversation and its box are the lower one, at the pane's foot.
    const read = reading.locator('[aria-label="Ärendet"]');
    const readBox = (await read.boundingBox())!;
    const fieldBox = (await field.boundingBox())!;
    const paneBox = (await reading.boundingBox())!;
    expect(fieldBox.y).toBeGreaterThan(readBox.y + readBox.height);
    // Under the field stand only the box's own row with Skicka and the pane's inset.
    expect(paneBox.y + paneBox.height - (fieldBox.y + fieldBox.height)).toBeLessThan(120);
    // Before anything is asked the part says what asking here does (rule 10).
    await expect(
      reading.getByText('Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await field.fill('Vad händer om jag godkänner?');
    await field.press('Enter');
    await expect(reading.getByText('Vad händer om jag godkänner?', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/todo\\?item=${id}$`));
    const asked = api.asked.at(-1)!;
    expect(asked.chips).toEqual([expect.objectContaining({ ref: `thread:${id}`, kind: 'thread' })]);
    expect(asked.beside).toBe(`thread:${id}`);
    expect(asked.page).toMatchObject({ subject: `thread:${id}` });
    expect(asked.thing).toBeUndefined();
    // The item is still at its facts: the read did not move while the answer came.
    expect(await read.evaluate(el => el.scrollTop)).toBe(0);
    await expectNoAxeViolations(page);
    // A reload shows the item with the conversation under it, and moves no focus into the box.
    await page.reload();
    await expect(reading.getByText('Vad händer om jag godkänner?', { exact: true })).toBeVisible();
    await expect(reading.getByRole('textbox', { name: 'Fråga om ärendet' })).not.toBeFocused();
    await expect(reading.getByRole('link', { name: 'Öppna som samtal' })).toHaveAttribute(
      'href',
      new RegExp(`^/conversations/[^?]+\\?card=${id}$`),
    );
  });

  test('Att göra, an item in the reading pane: the height of the conversation is the person’s own, by Astryx’s grip and the arrow keys, and is kept over a reload', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    await page.getByRole('table', { name: 'Behöver dig' }).getByRole('row').nth(1).getByRole('link').first().click();
    const reading = page.getByRole('complementary', { name: 'Valt ärende' });
    const grip = reading.getByRole('separator', { name: 'Ändra samtalets höjd' });
    await expect(grip).toHaveAttribute('aria-valuenow', '260');
    const read = reading.locator('[aria-label="Ärendet"]');
    const before = (await read.boundingBox())!.height;
    await grip.focus();
    await page.keyboard.press('ArrowUp');
    await expect(grip).not.toHaveAttribute('aria-valuenow', '260');
    const higher = Number(await grip.getAttribute('aria-valuenow'));
    expect(higher).toBeGreaterThan(260);
    // The read gives the room, and never all of it: the conversation takes at most its share of the pane.
    const after = (await read.boundingBox())!.height;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(40);
    expect(Number(await grip.getAttribute('aria-valuemax'))).toBeLessThan((await reading.boundingBox())!.height / 2);
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(reading.getByRole('separator', { name: 'Ändra samtalets höjd' })).toHaveAttribute(
      'aria-valuenow',
      String(higher),
    );
  });

  test('Att göra, an item in the reading pane with no model to ask: no box and no grip, the item as it was', async ({
    page,
    api,
  }) => {
    api.modelChoices = 0;
    await open(page, '/todo');
    await page.getByRole('table', { name: 'Behöver dig' }).getByRole('row').nth(1).getByRole('link').first().click();
    const reading = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(reading.getByRole('heading', { level: 2 }).first()).toBeFocused();
    await expect(reading.getByRole('textbox')).toHaveCount(0);
    await expect(reading.getByRole('separator', { name: 'Ändra samtalets höjd' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Att göra: an address with an item and the pane shows the item, and lets go of the pane in its place', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=omtanke&ask=1');
    await expect(page.getByRole('complementary', { name: 'Valt ärende' })).toBeVisible();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(pane(page)).toHaveCount(0);
    await expect(frameButton(page)).toHaveCount(0);
  });
});

/**
 * Stage 3 (D131): a thing's page asks through the frame too. A work item, its review, a record, a person, a unit and a
 * plan each say what stands open; the frame's button is the only "Fråga assistenten" on the page (the thing's own among
 * its actions is gone, item 9); the pane opens about the thing in its words, with the facts above the read (the review's
 * "Hittills" after its step, as where the window is narrow), and the page never scrolls sideways. A question carries the
 * thing that stands open (`thing`: a person or a unit by Clew's id, a record by its read and input), and for a work item
 * its chip as what stands open, with no `thing`.
 */
const record = (ref: string) =>
  `/tools/phonebook.person?input=${encodeURIComponent(JSON.stringify({ ref }))}&title=Kontaktkort`;
const ANNA_CARD = record('person:p1003');
const HILLEVI_CARD = record('person:p1001');
const REVIEW = '/items/fakturor/review?from=%2Fitems%2Ffakturor';
/** The invoice card as a connector that asks for a review one row at a time declares it (D70, `review.spec.ts`). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
};
const THINGS: Array<{
  name: string;
  path: string;
  about: string;
  box: string;
  /** Text of the facts and text of the read after them, in the column while the pane is open; none without facts. */
  order?: [string, string];
  setup?: (api: MockApi, page: Page) => void | Promise<void>;
}> = [
  {
    name: 'a work item',
    path: '/items/ledighet',
    about: 'Om ärendet Ledighetsansökan från Johan Byström',
    box: 'Fråga om ärendet',
    order: ['Uppgifter', 'Varför ser jag detta?'],
  },
  {
    name: 'the review of a work item',
    path: REVIEW,
    about: 'Om ärendet Attestera 3 fakturor, 48 200 kr',
    box: 'Fråga om ärendet',
    // "Hittills" follows the step, as it does where the window is narrow.
    order: ['Underlag från Ekonomisystemet', 'Hittills'],
    setup: reviewed,
  },
  { name: 'a record', path: ANNA_CARD, about: 'Om Anna Lindqvist', box: 'Fråga om Anna Lindqvist' },
  {
    name: 'a person',
    path: '/people/johan?from=%2Fstaff',
    about: 'Om Johan Byström',
    box: 'Fråga om Johan Byström',
    order: ['Anställning', 'Behöver dig'],
    setup: (_, page) => new People().route(page),
  },
  {
    name: 'a unit',
    path: `/units/${ENTITY_UNIT.id}`,
    about: `Om ${ENTITY_UNIT.label}`,
    box: `Fråga om ${ENTITY_UNIT.label}`,
    order: ['Detaljer', 'Läget'],
    setup: (_, page) => new Units().route(page),
  },
  {
    name: 'a plan',
    path: `/boarding/${ANNA}?from=%2Fstaff`,
    about: 'Om Introduktion för Anna Lindqvist',
    box: 'Fråga om introduktion för Anna Lindqvist',
    order: ['Detaljer', 'Före första dagen'],
    setup: api => {
      api.boarding = new BoardingMock();
    },
  },
];
/** Where a text stands on the page: the first of it in the main column, never in the assistant's pane. */
const top = async (page: Page, text: string) =>
  (await page
    .getByRole('main')
    .getByText(text, { exact: true })
    .and(page.locator(':not([role="complementary"] *)'))
    .first()
    .boundingBox())!.y;
const ask3 = async (page: Page, box: string, question: string) => {
  const field = pane(page).getByRole('textbox', { name: box });
  await field.fill(question);
  await field.press('Enter');
  await expect(pane(page).getByText(question, { exact: true })).toBeVisible();
};

test.describe('the assistant’s pane beside a thing’s page (D130 stage 3, D131)', () => {
  test.use({ viewport: WIDE });

  for (const t of THINGS)
    test(`${t.name}: the frame’s button is the only one on the page, the pane says what stands open, the facts stand above the read, and nothing scrolls sideways`, async ({
      page,
      api,
    }) => {
      await t.setup?.(api, page);
      await open(page, t.path);
      const toggle = frameButton(page);
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // The thing's own "Fråga assistenten" among its actions is gone (D131 item 9).
      await expect(page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' })).toHaveCount(1);
      await toggle.click();
      await expect(page).toHaveURL(/[?&]ask=1(&|$)/);
      await expect(pane(page)).toBeVisible();
      await expect(pane(page).getByText(t.about, { exact: true })).toBeVisible();
      await expect(pane(page).getByRole('textbox', { name: t.box })).toBeFocused();
      // The pane has the end slot: no other panel stands beside the column, and the facts stand in it, above the read.
      await expect(page.getByRole('complementary')).toHaveCount(1);
      if (t.order) {
        const [facts, read] = t.order;
        expect(await top(page, facts)).toBeLessThan(await top(page, read));
      }
      expect(await sideways(page)).toBe(0);
      await expectNoAxeViolations(page);
    });

  test('at 1366 px, beside the page, and at 1728 px no thing’s page scrolls sideways', async ({ page, api }) => {
    for (const width of [1366, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      for (const t of THINGS) {
        await t.setup?.(api, page);
        await open(page, `${t.path}${t.path.includes('?') ? '&' : '?'}ask=1`);
        await expect(pane(page).getByText(t.about, { exact: true })).toBeVisible();
        expect(await sideways(page), `${t.name} at ${width}`).toBe(0);
      }
    }
  });

  test('a person’s page sends the person by Clew’s id with every question, and no chip about them', async ({
    page,
    api,
  }) => {
    await new People().route(page);
    await open(page, `/people/johan?section=${PRESENCE_LENS}&from=%2Fstaff`);
    await frameButton(page).click();
    // What Clew's own talks and the other systems show about him stays closed (D131 item 7), said before anything is asked.
    await expect(pane(page).getByText(/^Assistenten kan inte läsa/)).toBeVisible();
    await expect(pane(page).getByText(/^Assistenten får inte veta vem sidan gäller/)).toHaveCount(0);
    await ask3(page, 'Fråga om Johan Byström', 'Hur går det för honom?');
    expect(api.asked.at(-1)).toMatchObject({
      chips: [],
      own: true,
      page: { subject: 'person:johan', label: 'Om Johan Byström' },
      thing: { kind: 'person', id: 'johan' },
    });
    expect(api.asked.at(-1)!.beside).toBeUndefined();
    // Another tab is the same conversation.
    await open(page, `/people/johan?section=${TALK_LENS}&from=%2Fstaff&ask=1`);
    await expect(pane(page).getByText('Hur går det för honom?', { exact: true })).toBeVisible();
  });

  test('the page of someone the reader does not manage says the assistant is not told who it is, and still sends the person', async ({
    page,
    api,
  }) => {
    const people = new People();
    people.colleague = true;
    await people.route(page);
    await open(page, '/people/johan');
    await frameButton(page).click();
    await expect(
      pane(page).getByText(/^Assistenten får inte veta vem sidan gäller, eftersom du inte är chef för personen\./),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await ask3(page, 'Fråga om Johan Byström', 'Vad gör han?');
    expect(api.asked.at(-1)!.thing).toEqual({ kind: 'person', id: 'johan' });
  });

  test('Öppna som samtal from a person’s page leads to the conversation with the person beside it, and a question there carries the person', async ({
    page,
    api,
  }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await frameButton(page).click();
    await ask3(page, 'Fråga om Johan Byström', 'Hur går det för honom?');
    await pane(page).getByRole('link', { name: 'Öppna som samtal' }).click();
    await expect(page).toHaveURL(/\/conversations\/om-person-johan\?person=johan$/);
    await expect(page.getByRole('complementary', { name: 'Johan Byström' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Hur går det för honom?', { exact: true }).first()).toBeVisible();
    const box = page.getByRole('combobox', { name: 'Svara i samtalet' });
    await box.fill('Och hans frånvaro?');
    await box.press('Enter');
    await expect(page.getByRole('log').getByText('Och hans frånvaro?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)).toMatchObject({
      text: 'Och hans frånvaro?',
      conversationId: 'om-person-johan',
      thing: { kind: 'person', id: 'johan' },
    });
  });

  test('a unit’s page sends the unit by Clew’s id', async ({ page, api }) => {
    await new Units().route(page);
    await open(page, `/units/${ENTITY_UNIT.id}`);
    await frameButton(page).click();
    await ask3(page, `Fråga om ${ENTITY_UNIT.label}`, 'Hur ser det ut?');
    expect(api.asked.at(-1)).toMatchObject({
      chips: [],
      page: { subject: `unit:${ENTITY_UNIT.id}`, label: `Om ${ENTITY_UNIT.label}` },
      thing: { kind: 'unit', id: ENTITY_UNIT.id },
    });
  });

  test('a record’s page sends the record with its input and its read’s chip where the assistant may make it; two records of one read are two conversations', async ({
    page,
    api,
  }) => {
    offer(api, 'phonebook.person', 'Kontaktkort');
    await open(page, ANNA_CARD);
    await frameButton(page).click();
    await expect(pane(page).getByText(/^Assistenten kan inte läsa/)).toHaveCount(0);
    await ask3(page, 'Fråga om Anna Lindqvist', 'Vem är hennes chef?');
    const anna = api.asked.at(-1)!;
    expect(anna).toMatchObject({
      chips: [{ ref: 'capability:phonebook.person', kind: 'capability', label: 'Kontaktkort' }],
      beside: 'capability:phonebook.person',
      page: { subject: 'view:phonebook.person:{"ref":"person:p1003"}', label: 'Om Anna Lindqvist' },
      thing: { kind: 'record', capability: 'phonebook.person', input: { ref: 'person:p1003' } },
    });
    expect(anna.conversationId).toBeUndefined();
    // Another record of the same read: a conversation of its own, not Anna's.
    await open(page, `${HILLEVI_CARD}&ask=1`);
    await expect(pane(page).getByText('Om Hillevi Berg', { exact: true })).toBeVisible();
    await expect(pane(page).getByText('Vem är hennes chef?', { exact: true })).toHaveCount(0);
    await ask3(page, 'Fråga om Hillevi Berg', 'Vem är hennes chef?');
    const hillevi = api.asked.at(-1)!;
    expect(hillevi.conversationId).toBeUndefined();
    expect(hillevi.thing).toEqual({ kind: 'record', capability: 'phonebook.person', input: { ref: 'person:p1001' } });
    // Back on Anna's card her conversation is there again, and goes on.
    await open(page, `${ANNA_CARD}&ask=1`);
    await expect(pane(page).getByText('Vem är hennes chef?', { exact: true })).toBeVisible();
    await ask3(page, 'Fråga om Anna Lindqvist', 'Och hennes rum?');
    expect(api.asked.at(-1)!.conversationId).toBe('om-record-phonebook-person-ref-person-p1003');
  });

  test('a record the assistant may not read says so by its system, and the record still goes', async ({
    page,
    api,
  }) => {
    await open(page, ANNA_CARD);
    await frameButton(page).click();
    await expect(
      pane(page).getByText(
        'Assistenten kan inte läsa det som Telefonboken visar här. Du kan ändå fråga om annat som du har tillgång till.',
        { exact: true },
      ),
    ).toBeVisible();
    await ask3(page, 'Fråga om Anna Lindqvist', 'Vem är hon?');
    expect(api.asked.at(-1)).toMatchObject({
      chips: [],
      thing: { kind: 'record', capability: 'phonebook.person', input: { ref: 'person:p1003' } },
    });
  });

  test('a plan is a record of boarding.plan by its id', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    await open(page, `/boarding/${ANNA}?from=%2Fstaff`);
    await frameButton(page).click();
    await ask3(page, 'Fråga om introduktion för Anna Lindqvist', 'Vad är försenat?');
    expect(api.asked.at(-1)).toMatchObject({
      page: { subject: `view:boarding.plan:{"plan":"${PLAN}"}`, label: 'Om Introduktion för Anna Lindqvist' },
      thing: { kind: 'record', capability: 'boarding.plan', input: { plan: PLAN } },
    });
  });

  test('a work item’s page and its review go with the item’s chip as what stands open, no thing, and are one conversation', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/items/fakturor');
    await frameButton(page).click();
    await ask3(page, 'Fråga om ärendet', 'Vilken är störst?');
    expect(api.asked.at(-1)).toMatchObject({
      chips: [{ ref: 'thread:fakturor', kind: 'thread', label: 'Attestera 3 fakturor, 48 200 kr' }],
      beside: 'thread:fakturor',
      page: { subject: 'thread:fakturor', label: 'Om ärendet Attestera 3 fakturor, 48 200 kr' },
    });
    expect(api.asked.at(-1)!.thing).toBeUndefined();
    // The review is about the same item: the same conversation.
    await open(page, `${REVIEW}&ask=1`);
    await expect(pane(page).getByText('Vilken är störst?', { exact: true })).toBeVisible();
  });
});

test.describe('a thing’s page on a phone (D130 rule 11, D131 item 1)', () => {
  test.use({ viewport: phone });

  test('the button leads to the conversation with the thing beside its address, and a question there carries the thing', async ({
    page,
    api,
  }) => {
    for (const [path, address] of [
      ['/items/ledighet', '/conversations/new?card=ledighet'],
      [`/units/${ENTITY_UNIT.id}`, `/conversations/new?unit=${ENTITY_UNIT.id}`],
      [
        ANNA_CARD,
        `/conversations/new?open=phonebook.person&open-title=Kontaktkort&open-input=${encodeURIComponent('{"ref":"person:p1003"}')}`,
      ],
    ] as const) {
      if (path.startsWith('/units')) await new Units().route(page);
      await open(page, path);
      await page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' }).click();
      await expect(page).toHaveURL(address);
    }
    // The record stands beside the conversation by its address: a question there carries it.
    const box = page.getByRole('combobox', { name: 'Svara i samtalet' });
    await box.fill('Vem är hon?');
    await box.press('Enter');
    await expect(page.getByRole('log').getByText('Vem är hon?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)!.thing).toEqual({
      kind: 'record',
      capability: 'phonebook.person',
      input: { ref: 'person:p1003' },
    });
  });

  test('a person’s button leads to the conversation about them, which carries the person', async ({ page, api }) => {
    await new People().route(page);
    await open(page, '/people/johan?from=%2Fstaff');
    await page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' }).click();
    await expect(page).toHaveURL('/conversations/new?person=johan');
    const box = page.getByRole('combobox', { name: 'Svara i samtalet' });
    await box.fill('Hur går det?');
    await box.press('Enter');
    await expect(page.getByRole('log').getByText('Hur går det?', { exact: true })).toBeVisible();
    expect(api.asked.at(-1)).toMatchObject({ chips: [], thing: { kind: 'person', id: 'johan' } });
  });

  test('the review on a phone has the frame’s button under its title', async ({ page, api }) => {
    reviewed(api);
    await open(page, REVIEW);
    const button = page.getByRole('main').getByRole('button', { name: 'Fråga assistenten' });
    await expect(button).toHaveCount(1);
    const [t, b] = await Promise.all([
      page.getByRole('heading', { level: 1, name: 'Granska 3 rader' }).boundingBox(),
      button.boundingBox(),
    ]);
    expect(b!.y).toBeGreaterThan(t!.y + t!.height);
    await button.click();
    await expect(page).toHaveURL('/conversations/new?card=fakturor');
  });
});
