/**
 * Conformance check for a Clew connector service (D21). Runs on the host or in the devcontainer, needs no Clew
 * database: it does what Clew's loader does and then exercises the connector as a manager and an employee.
 *
 *   bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <shared secret> [--id hello]
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SignJWT } from 'jose';
import { Registry, type Actor } from '../packages/connectors/src/index';
import { fetchManifest, remoteConnector } from '../packages/connectors/src/remote';

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'))?.replace(/\/+$/, '');
const option = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const secret = option('secret') ?? process.env.CLEW_CONNECTOR_SECRET;
if (!url || !secret) { console.error('Usage: bun scripts/connector-check.ts <url> --secret <shared secret> [--id <connector id>]'); process.exit(2); }

const manager: Actor = { id: 'check-manager', name: 'Kontroll Chef', unitId: 'unit-check', unitLabel: 'Kontrollenheten', role: 'manager' };
const employee: Actor = { id: 'check-employee', name: 'Kontroll Medarbetare', unitId: 'unit-check', unitLabel: 'Kontrollenheten', role: 'employee' };
let failures = 0;
const ok = (line: string) => console.log('  ok   ' + line);
const bad = (line: string) => { failures++; console.log('  FAIL ' + line); };
const warn = (line: string) => console.log('  warn ' + line);

const manifest = await fetchManifest(url, option('id')).catch(error => { console.log('FAIL manifest: ' + (error as Error).message); process.exit(1); });
console.log(`Connector "${manifest.id}" (${manifest.source}), protocol ${manifest.protocol}`);
ok(`manifest valid: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas, scan ${manifest.scan}`);
const key = new TextEncoder().encode(secret);
const assert = (actor: Actor) => new SignJWT({ actor }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('clew').setAudience(manifest.id).setSubject(actor.id).setIssuedAt().setExpirationTime('2m').sign(key);
const registry = new Registry().register(remoteConnector(manifest, { url, assert }));
const ajv = addFormats(new Ajv({ strict: false }));

for (const c of manifest.capabilities) {
  const validate = ajv.compile(c.input as object);
  if (c.kind === 'execute') { ok(`${c.name}: execute, not a tool, not called by the check`); continue; }
  for (const actor of [manager, employee]) {
    const allowed = !c.scope.roles || c.scope.roles.includes(actor.role);
    if (!allowed) { try { await registry.run(actor, c.name, {}); bad(`${c.name}: ${actor.role} is out of scope but the registry let the call through`); } catch { ok(`${c.name}: ${actor.role} refused by scope`); } continue; }
    if (!validate({})) { ok(`${c.name}: needs input (${JSON.stringify(c.input)}), not called by the check`); break; }
    try { const output = await registry.run(actor, c.name, {}); ok(`${c.name} as ${actor.role}: ${JSON.stringify(output).slice(0, 100)}`); }
    catch (error) { const m = (error as Error).message; if (/svarar inte just nu/.test(m)) warn(`${c.name} as ${actor.role}: ${m} (a capability that calls back into Clew needs CLEW_URL and a running Clew)`); else bad(`${c.name} as ${actor.role}: ${m}`); }
  }
}
// Wrong secret must be refused by the connector itself, not only by Clew.
try {
  const r = await fetch(url + '/clew/capabilities/' + manifest.capabilities[0]!.name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await new SignJWT({ actor: manager }).setProtectedHeader({ alg: 'HS256' }).setIssuer('clew').setAudience(manifest.id).setSubject(manager.id).setExpirationTime('2m').sign(new TextEncoder().encode('wrong-secret-wrong-secret')) }, body: JSON.stringify({ actor: manager, input: {} }) });
  r.status === 401 ? ok('a call signed with another secret is refused (401)') : bad(`a call signed with another secret answered ${r.status}, expected 401`);
} catch (error) { bad('wrong-secret probe: ' + (error as Error).message); }
if (manifest.scan) for (const actor of [manager, employee]) {
  try { const drafts = await registry.scan(actor); const twice = await registry.scan(actor); ok(`scan as ${actor.role}: ${drafts.length} drafts${drafts.length ? ' (' + drafts.map(d => d.topic).join(', ') + ')' : ''}`); if (JSON.stringify(drafts.map(d => d.topic)) !== JSON.stringify(twice.map(d => d.topic))) bad('scan is not idempotent: topics differ between two runs'); for (const d of drafts) if (!manifest.areas.some(a => a.id === d.area)) bad(`draft ${d.topic} names unknown area ${d.area}`); }
  catch (error) { bad(`scan as ${actor.role}: ${(error as Error).message}`); }
}
for (const actor of [manager, employee]) { const areas = await registry.areas(actor); for (const a of areas) ok(`area ${a.id} as ${actor.role}: figure ${a.figure ? JSON.stringify(a.figure) : 'none'}, ${a.standing.length} standing`); }
console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
