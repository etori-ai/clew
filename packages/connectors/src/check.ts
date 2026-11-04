import type { CheckFinding, CheckReport } from '@clew/contracts';
import { Registry, type Actor } from './index';
import { fetchManifest, remoteConnector, type FetchLike } from './remote';
import type { ConnectorManifest } from './protocol';

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
  /** Validates `{}` against a capability's input schema; absent means "call every read with an empty input". */
  acceptsEmptyInput?: (schema: object) => boolean;
}
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
  const registry = new Registry().register(remoteConnector(manifest, { url, assert: options.assert, fetch: fetchImpl }));
  const accepts = options.acceptsEmptyInput ?? (() => true);
  for (const c of manifest.capabilities) {
    if (c.kind === 'execute') { ok(`${c.name}: execute, not a tool, not called by the check`); continue; }
    for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) {
      const allowed = !c.scope.roles || c.scope.roles.includes(actor.role);
      if (!allowed) {
        try { await registry.run(actor, c.name, {}); fail(`${c.name}: ${actor.role} is out of scope but the registry let the call through`); }
        catch { ok(`${c.name}: ${actor.role} refused by scope`); }
        continue;
      }
      if (!accepts(c.input as object)) { ok(`${c.name}: needs input (${JSON.stringify(c.input)}), not called by the check`); break; }
      try { const output = await registry.run(actor, c.name, {}); ok(`${c.name} as ${actor.role}: ${JSON.stringify(output).slice(0, 100)}`); }
      catch (error) {
        const m = (error as Error).message;
        if (UNAVAILABLE.test(m)) warn(`${c.name} as ${actor.role}: ${m} (a capability that calls back into Clew needs CLEW_URL and a running Clew)`);
        else fail(`${c.name} as ${actor.role}: ${m}`);
      }
    }
  }
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
