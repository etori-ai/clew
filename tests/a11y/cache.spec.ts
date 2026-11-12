import { expect, heading, open, test } from './support';

/**
 * D33: one query cache per session. A read survives a client-side route change, every card on a page shares one read,
 * and a card view's POST runs once. The clock is frozen, so nothing becomes stale inside a test and a second request
 * can only mean a second read.
 */
test.describe('D33 the browser cache', () => {
  test('the stream and the areas are read once across the start page and the calendar', async ({ page, api: _ }) => {
    const calls: string[] = [];
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) calls.push(`${r.method()} ${u.pathname}`);
    });
    const count = (path: string) => calls.filter(c => c === `GET ${path}`).length;
    await open(page, '/');
    expect(count('/api/threads')).toBe(1);
    expect(count('/api/areas')).toBe(1);
    // Hem draws no card since D112, so no picker reads its times there (D29).
    expect(count('/api/snooze/presets')).toBe(0);
    await page
      .getByRole('navigation', { name: 'Sidonavigering' })
      .getByRole('link', { name: 'Kalender', exact: true })
      .click();
    await expect(heading(page, 1, 'Vecka')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(count('/api/threads')).toBe(1);
    expect(count('/api/areas')).toBe(1);
    await page.goBack();
    await expect(heading(page, 2, 'Behöver dig')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(count('/api/threads')).toBe(1);
  });
  test('a card’s read posts its action once, for the card that unfolds it and the panel that would draw a table', async ({
    page,
    api: _,
  }) => {
    const posts: string[] = [];
    page.on('request', r => {
      if (r.method() === 'POST' && r.url().includes('/act')) posts.push(r.url());
    });
    await open(page, '/todo?item=omtanke&open-card=omtanke&open-action=pattern');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(card.locator('#read-card-omtanke').getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(posts).toHaveLength(1);
  });
  test('an address that names a card’s decision asks for nothing: only the card’s button decides', async ({
    page,
    api,
  }) => {
    const posts: string[] = [];
    page.on('request', r => {
      if (r.method() === 'POST' && r.url().includes('/act')) posts.push(r.url());
    });
    // "Boka samtalet" is an execute. Opened by address it must not run, in Att göra or beside Personal.
    for (const path of [
      '/todo?item=omtanke&open-card=omtanke&open-action=book',
      '/staff?card=omtanke&open-card=omtanke&open-action=book',
    ]) {
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(posts).toEqual([]);
      expect(api.threads.find(t => t.id === 'omtanke')?.state).toBe('open');
    }
  });
});
