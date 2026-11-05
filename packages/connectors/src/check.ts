import type { CheckFinding, CheckGroup, CheckItem, CheckLevel, CheckReport, Role } from '@clew/contracts';
import { Registry, type Actor } from './index';
import { fetchManifest, remoteConnector, type FetchLike } from './remote';
import type { ConnectorManifest } from './protocol';
import { menuRowOf, rowsKey, viewRows } from './views';

/**
 * The conformance check of a connector service (D21, D23): what `scripts/connector-check.ts` prints and what the admin
 * page runs as "Testa anslutning". It does what Clew's loader does and then exercises the connector as a manager and
 * as an employee. Signing is handed in (`assert` with the right secret, `assertForeign` with a wrong one) so this
 * package stays free of JWT libraries and a test can sign however it likes.
 *
 * Two readers, two results (D44): `findings` is the English log the CLI prints, answers included, for the person who
 * builds the connector. `items` is the Swedish account the administrator reads, one row per fact, with no answer in it:
 * an administrator sees structure, never people's data (D23).
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
const ROLE: Record<Role, string> = { manager: 'chef', employee: 'medarbetare' };
const VIEW: Record<NonNullable<ConnectorManifest['capabilities'][number]['view']>['kind'], string> = { table: 'tabell', list: 'lista', detail: 'detaljvy', text: 'text' };
const worst = (a: CheckLevel, b: CheckLevel): CheckLevel => a === 'fail' || b === 'fail' ? 'fail' : a === 'warn' || b === 'warn' ? 'warn' : 'ok';
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const who = (roles: Role[]) => roles.map(r => ROLE[r]).join(' och ');
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export async function checkConnector(options: CheckOptions): Promise<CheckReport & { findings: CheckFinding[]; manifest?: ConnectorManifest }> {
  const findings: CheckFinding[] = [];
  const items: CheckItem[] = [];
  const ok = (text: string) => findings.push({ level: 'ok', text });
  const warn = (text: string) => findings.push({ level: 'warn', text });
  const fail = (text: string) => findings.push({ level: 'fail', text });
  const item = (level: CheckLevel, group: CheckGroup, label: string, description?: string, capability?: string) => items.push({ level, group, label, ...(description ? { description } : {}), ...(capability ? { capability } : {}) });
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url.replace(/\/+$/, '');
  let manifest: ConnectorManifest;
  try { manifest = await fetchManifest(url, options.id, fetchImpl); }
  catch (error) { fail('manifest: ' + (error as Error).message); item('fail', 'connection', 'Systemets beskrivning kunde inte hämtas', (error as Error).message); return { ok: false, items, findings }; }
  ok(`manifest valid: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas, scan ${manifest.scan}`);
  item('ok', 'connection', 'Systemets beskrivning är giltig', `${count(manifest.capabilities.length, 'funktion', 'funktioner')}, ${count(manifest.areas.length, 'område', 'områden')}. ${manifest.scan ? 'Skickar kort.' : 'Skickar inga kort.'}`);
  if (manifest.delegation) {
    warn(`delegation: acts as the person for audience "${manifest.delegation.audience}"; not verified by this check (it has no session), so a "denied" answer below is the expected one`);
    item('warn', 'connection', 'Agerar som personen', `Använder personens egen behörighet mot ${manifest.delegation.audience}. Kontrollen har ingen inloggning och kan inte pröva det, så nekade svar är väntade.`);
  }
  const registry = new Registry({ onRefused: (_id, topic, problem) => { fail(`draft ${topic} refused: ${problem}`); item('fail', 'surfaces', 'Kort', `Kortet ${topic} avvisades: ${problem}`); } }).register(remoteConnector(manifest, { url, assert: options.assert, fetch: fetchImpl }));
  const accepts = options.acceptsEmptyInput ?? listsNothingRequired;
  /** What one capability came to, for the row the administrator reads: every finding about it folds into one sentence each. */
  type Row = { level: CheckLevel; answered: Role[]; refused: Role[]; notes: string[]; note(level: CheckLevel, text: string): void };
  const newRow = (): Row => ({ level: 'ok', answered: [], refused: [], notes: [], note(level, text) { this.level = worst(this.level, level); if (!this.notes.includes(text)) this.notes.push(text); } });
  const rowText = (row: Row) => {
    const answered = row.answered.length ? `Svarar för ${who(row.answered)}${row.refused.length ? `, ${who(row.refused)} nekas som väntat` : ''}.` : row.refused.length ? `${sentence(who(row.refused))} nekas som väntat.` : '';
    return [answered, ...row.notes].filter(Boolean).join(' ');
  };
  /** A declared view (D38) against a real answer: the rows are where the view says, and no field is missing from every row. */
  const checkView = (c: ConnectorManifest['capabilities'][number], output: unknown, row: Row) => {
    const view = c.view;
    if (!view) return;
    if (view.kind === 'text') { if (typeof (output as Record<string, unknown> | null)?.[view.body] === 'string') { ok(`${c.name}: view text drawn from "${view.body}"`); row.note('ok', 'Visas som text.'); } else { fail(`${c.name}: view text expects a string at "${view.body}"`); row.note('fail', `Vyn väntar sig text i fältet "${view.body}".`); } return; }
    if (view.kind === 'detail') { if (output && typeof output === 'object' && !Array.isArray(output)) { ok(`${c.name}: view detail, ${view.fields.length} fields`); row.note('ok', `Visas som ${VIEW.detail} med ${view.fields.length} fält.`); } else { fail(`${c.name}: view detail expects one record`); row.note('fail', 'Vyn väntar sig en post.'); } return; }
    const rows = viewRows(view, output);
    if (!rows) { fail(`${c.name}: view ${view.kind} expects an array of records at "${rowsKey(view)}"`); row.note('fail', `Vyn väntar sig en lista med poster i fältet "${rowsKey(view)}".`); return; }
    ok(`${c.name}: view ${view.kind} drawn from "${rowsKey(view)}", ${view.fields.length} fields`);
    row.note('ok', `Visas som ${VIEW[view.kind]} med ${view.fields.length} fält.`);
    const unseen = rows.length ? view.fields.filter(f => rows.every(r => r[f.key] === undefined)).map(f => f.key) : [];
    if (unseen.includes(view.title)) { fail(`${c.name}: no row has the view's title field "${view.title}"`); row.note('fail', `Ingen rad har vyns titelfält "${view.title}".`); }
    else if (unseen.length) { warn(`${c.name}: no row has ${unseen.map(k => `"${k}"`).join(', ')}; the column is drawn empty`); row.note('warn', `Ingen rad har ${unseen.map(k => `"${k}"`).join(', ')}, så kolumnen blir tom.`); }
  };
  for (const c of manifest.capabilities) {
    if (c.kind === 'execute') { ok(`${c.name}: execute, not a tool, not called by the check`); item('ok', 'capabilities', c.title, 'Åtgärd som bara körs efter ett mänskligt beslut. Kontrollen anropar den inte.', c.name); continue; }
    const row = newRow();
    for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) {
      const allowed = !c.scope.roles || c.scope.roles.includes(actor.role);
      if (!allowed) {
        try { await registry.run(actor, c.name, {}); fail(`${c.name}: ${actor.role} is out of scope but the registry let the call through`); row.note('fail', `Anropet släpptes igenom för ${ROLE[actor.role]}, som inte ska få det.`); }
        catch { ok(`${c.name}: ${actor.role} refused by scope`); row.refused.push(actor.role); }
        continue;
      }
      if (!accepts(c.input as object)) { ok(`${c.name}: needs input (${JSON.stringify(c.input)}), not called by the check${c.view ? `; view ${c.view.kind} declared, not exercised` : ''}`); row.note('ok', `Behöver indata, så kontrollen anropar den inte${c.view ? `. Vyn (${VIEW[c.view.kind]}) är inte prövad` : ''}.`); break; }
      try { const output = await registry.run(actor, c.name, {}); ok(`${c.name} as ${actor.role}: ${JSON.stringify(output).slice(0, 100)}`); row.answered.push(actor.role); if (actor === CHECK_MANAGER || c.scope.roles?.length === 1) checkView(c, output, row); }
      catch (error) {
        const m = (error as Error).message;
        if (manifest.delegation && /styrkas|behörighet/.test(m)) { ok(`${c.name} as ${actor.role}: refused without the person's token, as a delegating connector should (${m})`); row.note('ok', 'Nekas utan personens egen inloggning, som väntat.'); }
        else if (UNAVAILABLE.test(m)) { warn(`${c.name} as ${actor.role}: ${m} (a capability that calls back into Clew needs CLEW_URL and a running Clew)`); row.note('warn', `Svarar inte för ${ROLE[actor.role]}. En förmåga som anropar Clew behöver att Clew är igång.`); }
        else { fail(`${c.name} as ${actor.role}: ${m}`); row.note('fail', `Fel för ${ROLE[actor.role]}: ${m}`); }
      }
    }
    item(row.level, 'capabilities', c.title, rowText(row), c.name);
  }
  const tools = manifest.capabilities.map(c => ({ name: c.name, row: menuRowOf(c) })).filter(t => t.row);
  if (tools.length) {
    ok(`menu: ${tools.length} ${tools.length === 1 ? 'view' : 'views'} can be a tool in the menu when an administrator chooses it: ${tools.map(t => `"${t.row!.label}" (${t.name})`).join(', ')}`);
    item('ok', 'surfaces', 'Verktyg i menyn', `${tools.map(t => t.row!.label).join(', ')} kan väljas till menyn av en administratör.`);
  }
  // Wrong secret must be refused by the connector itself, not only by Clew.
  const first = manifest.capabilities[0];
  if (first) {
    try {
      const r = await fetchImpl(url + '/clew/capabilities/' + first.name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await options.assertForeign(CHECK_MANAGER) }, body: JSON.stringify({ actor: CHECK_MANAGER, input: {} }) });
      if (r.status === 401) { ok('a call signed with another secret is refused (401)'); item('ok', 'connection', 'Fel nyckel nekas', 'Ett anrop signerat med en annan nyckel avvisades av tjänsten.'); }
      else { fail(`a call signed with another secret answered ${r.status}, expected 401`); item('fail', 'connection', 'Fel nyckel släpps igenom', `Ett anrop signerat med en annan nyckel fick svaret ${r.status}. Tjänsten ska svara 401.`); }
    } catch (error) { fail('wrong-secret probe: ' + (error as Error).message); item('fail', 'connection', 'Fel nyckel kunde inte prövas', (error as Error).message); }
  }
  if (manifest.scan) {
    const counts: string[] = [];
    let same = true;
    for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) {
      try {
        const drafts = await registry.scan(actor), twice = await registry.scan(actor);
        ok(`scan as ${actor.role}: ${drafts.length} drafts${drafts.length ? ' (' + drafts.map(d => d.topic).join(', ') + ')' : ''}`);
        counts.push(`${drafts.length} för ${ROLE[actor.role]}`);
        if (JSON.stringify(drafts.map(d => d.topic)) !== JSON.stringify(twice.map(d => d.topic))) { fail('scan is not idempotent: topics differ between two runs'); same = false; }
        for (const d of drafts) if (!manifest.areas.some(a => a.id === d.area)) { fail(`draft ${d.topic} names unknown area ${d.area}`); item('fail', 'surfaces', 'Kort', `Kortet ${d.topic} pekar på området ${d.area}, som inte finns i manifestet.`); }
      } catch (error) { fail(`scan as ${actor.role}: ${(error as Error).message}`); item('fail', 'surfaces', 'Kort', `Genomgången misslyckades för ${ROLE[actor.role]}: ${(error as Error).message}`); }
    }
    if (counts.length) item(same ? 'ok' : 'fail', 'surfaces', 'Kort', `Genomgången föreslår ${counts.join(' och ')}. ${same ? 'Två genomgångar gav samma kort.' : 'Två genomgångar gav olika kort.'}`);
  }
  // One row per area: the roles that see the same thing share a sentence. The figure's value is an answer and stays out (D23, D44).
  const areas = new Map<string, { title: string; byRole: Map<string, Role[]> }>();
  for (const actor of [CHECK_MANAGER, CHECK_EMPLOYEE]) for (const a of await registry.areas(actor)) {
    ok(`area ${a.id} as ${actor.role}: figure ${a.figure ? JSON.stringify(a.figure) : 'none'}, ${a.standing.length} standing`);
    const text = `${count(a.standing.length, 'stående handling', 'stående handlingar')}, ${a.figure ? 'med nyckeltal' : 'inget nyckeltal'}`;
    const area = areas.get(a.id) ?? { title: a.title, byRole: new Map<string, Role[]>() };
    area.byRole.set(text, [...(area.byRole.get(text) ?? []), actor.role]);
    areas.set(a.id, area);
  }
  for (const { title, byRole } of areas.values()) item('ok', 'surfaces', `Området ${title}`, [...byRole].map(([text, roles]) => `${sentence(who(roles))}: ${text}.`).join(' '));
  return { ok: !findings.some(f => f.level === 'fail'), items, findings, manifest };
}
