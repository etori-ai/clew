import type { CheckFinding, CheckReport } from '@clew/contracts';
import { Registry, type Actor } from './index';
import { fetchManifest, remoteConnector, type FetchLike } from './remote';
import type { ConnectorManifest } from './protocol';
import { rowsKey, viewRows } from './views';

/**
 * The conformance check of a connector service (D21, D23): what `scripts/connector-check.ts` prints and what the admin
 * page runs as "Testa anslutning". It does what Clew's loader does and then exercises the connector as a manager and
 * as an employee. Signing is handed in (`assert` with the right secret, `assertForeign` with a wrong one) so this
 * package stays free of JWT libraries and a test can sign however it likes.
 */
export interface CheckOptions {
  url: string;
  id?: string;
  assert: (actor: Actor) => Promise<string>;
  assertForeign: (actor: Actor) => Promise<string>;
  fetch?: FetchLike;
  /** Validates `{}` against a capability's input schema with a real validator. Absent, a schema that lists `required` properties is taken to need input. */
  acceptsEmptyInput?: (schema: object) => boolean;
}
/** A read that needs input is not called by the check: its refusal of `{}` is the right answer, not a fault. This is the rule without a validator library. */
const listsNothingRequired = (schema: object) => !((schema as { required?: unknown }).required as unknown[] | undefined)?.length;
export const CHECK_MANAGER: Actor = { id: 'check-manager', name: 'Kontroll Chef', unitId: 'unit-check', unitLabel: 'Kontrollenheten', role: 'manager' };
export const CHECK_EMPLOYEE: Actor = { id: 'check-employee', name: 'Kontroll Medarbetare', unitId: 'unit-check', unitLabel: 'Kontrollenheten', role: 'employee' };
const UNAVAILABLE = /svarar inte just nu/;

export async function checkConnector(options: CheckOptions): Promise<CheckReport & { manifest?: ConnectorManifest }> {
  const findings: CheckFinding[] = [];
  const ok = (text: string) => findings.push({ level: 'ok', text });
  const warn = (text: string) => findings.push({ level: 'warn', text });
  const fail = (text: string) => findings.push({ level: 'fail', text });
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url.replace(/\/+$/, '');
  let manifest: ConnectorManifest;
  try { manifest = await fetchManifest(url, options.id, fetchImpl); }
  catch (error) { fail('manifest: ' + (error as Error).message); return { ok: false, findings }; }
  ok(`manifest valid: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas, scan ${manifest.scan}`);
  if (manifest.delegation) warn(`delegation: acts as the person for audience "${manifest.delegation.audience}"; not verified by this check (it has no session), so a "denied" answer below is the expected one`);
  const registry = new Registry({ onRefused: (_id, topic, problem) => fail(`draft ${topic} refused: ${problem}`) }).register(remoteConnector(manifest, { url, assert: options.assert, fetch: fetchImpl }));
  const accepts = options.acceptsEmptyInput ?? listsNothingRequired;
  /** A declared view (D38) against a real answer: the rows are where the view says, and no field is missing from every row. */
  const checkView = (c: ConnectorManifest['capabilities'][number], output: unknown) => {
    const view = c.view;
    if (!view) return;
    if (view.kind === 'text') { if (typeof (output as Record<string, unknown> | null)?.[view.body] === 'string') ok(`${c.name}: view text drawn from "${view.body}"`); else fail(`${c.name}: view text expects a string at "${view.body}"`); return; }
    if (view.kind === 'detail') { if (output && typeof output === 'object' && !Array.isArray(output)) ok(`${c.name}: view detail, ${view.fields.length} fields`); else fail(`${c.name}: view detail expects one record`); return; }
    const rows = viewRows(view, output);
    if (!rows) { fail(`${c.name}: view ${view.kind} expects an array of records at "${rowsKey(view)}"`); return; }
    ok(`${c.name}: view ${view.kind} drawn from "${rowsKey(view)}", ${view.fields.length} fields`);
    const unseen = rows.length ? view.fields.filter(f => rows.every(r => r[f.key] === undefined)).map(f => f.key) : [];
    if (unseen.includes(view.title)) fail(`${c.name}: no row has the view's title field "${view.title}"`);
    else if (unseen.length) warn(`${c.name}: no row has ${unseen.map(k => `"${k}"`).join(', ')}; the column is drawn empty`);
  };
  for (const c of manifest.capabilities) {
    if (c.kind === 'execute') { ok(`${c.name}: execute, not a tool, not called by the check`); continue; }
    for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) {
      const allowed = !c.scope.roles || c.scope.roles.includes(actor.role);
      if (!allowed) {
        try { await registry.run(actor, c.name, {}); fail(`${c.name}: ${actor.role} is out of scope but the registry let the call through`); }
        catch { ok(`${c.name}: ${actor.role} refused by scope`); }
        continue;
      }
      if (!accepts(c.input as object)) { ok(`${c.name}: needs input (${JSON.stringify(c.input)}), not called by the check${c.view ? `; view ${c.view.kind} declared, not exercised` : ''}`); break; }
      try { const output = await registry.run(actor, c.name, {}); ok(`${c.name} as ${actor.role}: ${JSON.stringify(output).slice(0, 100)}`); if (actor === CHECK_MANAGER || c.scope.roles?.length === 1) checkView(c, output); }
      catch (error) {
        const m = (error as Error).message;
        if (manifest.delegation && /styrkas|behörighet/.test(m)) ok(`${c.name} as ${actor.role}: refused without the person's token, as a delegating connector should (${m})`);
        else if (UNAVAILABLE.test(m)) warn(`${c.name} as ${actor.role}: ${m} (a capability that calls back into Clew needs CLEW_URL and a running Clew)`);
        else fail(`${c.name} as ${actor.role}: ${m}`);
      }
    }
  }
  if (manifest.menu) ok(`menu: "${manifest.menu.label}" opens ${manifest.menu.capability} (shown when an administrator switches it on)`);
  // Wrong secret must be refused by the connector itself, not only by Clew.
  const first = manifest.capabilities[0];
  if (first) {
    try {
      const r = await fetchImpl(url + '/clew/capabilities/' + first.name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await options.assertForeign(CHECK_MANAGER) }, body: JSON.stringify({ actor: CHECK_MANAGER, input: {} }) });
      if (r.status === 401) ok('a call signed with another secret is refused (401)'); else fail(`a call signed with another secret answered ${r.status}, expected 401`);
    } catch (error) { fail('wrong-secret probe: ' + (error as Error).message); }
  }
  if (manifest.scan) for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) {
    try {
      const drafts = await registry.scan(actor), twice = await registry.scan(actor);
      ok(`scan as ${actor.role}: ${drafts.length} drafts${drafts.length ? ' (' + drafts.map(d => d.topic).join(', ') + ')' : ''}`);
      if (JSON.stringify(drafts.map(d => d.topic)) !== JSON.stringify(twice.map(d => d.topic))) fail('scan is not idempotent: topics differ between two runs');
      for (const d of drafts) if (!manifest.areas.some(a => a.id === d.area)) fail(`draft ${d.topic} names unknown area ${d.area}`);
    } catch (error) { fail(`scan as ${actor.role}: ${(error as Error).message}`); }
  }
  for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) for (const a of await registry.areas(actor)) ok(`area ${a.id} as ${actor.role}: figure ${a.figure ? JSON.stringify(a.figure) : 'none'}, ${a.standing.length} standing`);
  return { ok: !findings.some(f => f.level === 'fail'), findings, manifest };
}
