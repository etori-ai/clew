import { expect, heading, open, test } from './support';

/**
 * D33: one query cache per session. A read survives a client-side route change, every card on a page shares one read,
 * and a card view's POST runs once. The clock is frozen, so nothing becomes stale inside a test and a second request
 * can only mean a second read.
 */
test.describe('D33 the browser cache', () => {
  test('the stream and the areas are read once across the start page and the calendar', async ({ page, api: _ }) => {
    const calls: string[] = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(`${r.method()} ${u.pathname}`); });
    const count = (path: string) => calls.filter(c => c === `GET ${path}`).length;
    await open(page, '/overview');
    expect(count('/api/threads')).toBe(1);
    expect(count('/api/areas')).toBe(1);
    // Every card's picker shows the same times from one read (D29).
    expect(count('/api/snooze/presets')).toBe(1);
    await page.getByRole('link', { name: 'Kalender', exact: true }).click();
    await expect(heading(page, 1, 'Vecka')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(count('/api/threads')).toBe(1);
    expect(count('/api/areas')).toBe(1);
    await page.goBack();
    await expect(heading(page, 2, 'Nu')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(count('/api/threads')).toBe(1);
  });
  test('a card view posts its action once and opens the panel', async ({ page, api: _ }) => {
    const posts: string[] = [];
    page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/act')) posts.push(r.url()); });
    await open(page, '/views/card/omtanke/pattern');
    await expect(page.getByRole('dialog', { name: 'Se mönstret' })).toBeVisible();
    expect(posts).toHaveLength(1);
  });
});
