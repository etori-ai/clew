import { Registry, type Actor } from '../../packages/modules/src/index';
import { memoryState } from '../../packages/modules/src/memory-state';
import { mockSupportManagement } from '../../packages/errands/src/mock-support-management';
import { errandModule } from '../../apps/server/src/errand-module';
import { desktop, expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';

const actor: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };

test('errand list opens a detail view by keyboard and moves focus with the view', async ({ page, api }) => {
  const provider = mockSupportManagement(memoryState());
  const registry = new Registry().register(errandModule(provider));
  const [errand] = await provider.mine(actor);
  api.output = await registry.run(actor, 'errand.mine', {});
  await page.route('**/api/cap/errand.view**', async route => route.fulfill({ json: { output: await registry.run(actor, 'errand.view', { ref: errand!.ref }) } }));
  await page.setViewportSize(desktop);
  await open(page, '/vy/errand.mine?titel=Ärenden');
  const row = page.getByRole('dialog').getByRole('button', { name: /KC-26110001/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('KC-26110001 · Startsidan');
  await expect(page.getByRole('group', { name: 'KC-26110001', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog').getByText('Kontrollera ventilationen i arbetsrummet', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Support Management · exempeldata', { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.setViewportSize(narrow);
  expect(await reflowProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a waiting errand keeps its read action available on the card', async ({ page, api }) => {
  const provider = mockSupportManagement(memoryState());
  const registry = new Registry().register(errandModule(provider));
  const waiting = (await registry.scan(actor)).find(d => !!d.waitingOn)!;
  const ref = waiting.items![0]!.ref;
  api.threads = [{ ...api.threads[0]!, ...waiting, id: 'waiting-errand', trigger: { reason: waiting.reason, source: 'Support Management · exempeldata', at: '2026-11-04T08:00:00.000Z' } }];
  api.output = await registry.run(actor, 'errand.view', { ref });
  await page.setViewportSize(narrow);
  await open(page, '/');
  await page.getByRole('button', { name: /Pågår utan dig/ }).click();
  await page.getByRole('button', { name: 'Visa ärendet', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Beställning av extra bildskärm', { exact: true })).toBeVisible();
  expect(await reflowProblems(page)).toEqual([]);
});
