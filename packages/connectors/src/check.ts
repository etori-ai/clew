import type {
  Area,
  AuthenticatedContext,
  CheckFinding,
  CheckGroup,
  CheckItem,
  CheckLevel,
  CheckReport,
  EntityKind,
  Role,
} from '@clew/contracts';
import { Registry, openGovernance, type Actor } from './index';
import { fetchManifest, remoteConnector, type FetchLike } from './remote';
import type { AboutPlace, ConnectorManifest } from './protocol';
import { menuRowOf, placesOf, rowsKey, viewRows, viewOutputProblem } from './views';

/**
 * The conformance check of a connector service (D21, D23): what `scripts/connector-check.ts` prints and what the admin
 * page runs as "Testa anslutning". It does what Clew's loader does and then exercises the connector as a manager and
 * as an employee. Signing is handed in (`assert` from Clew's authority, `assertForeign` for an invalid assertion)
 * so this package stays free of JWT libraries. The separate `key` is transport authentication only.
 *
 * Two readers, two results (D44-the-connector-check-reads-as-a-result-not-a-log): `findings` is the English log the CLI prints, answers included, for the person who
 * builds the connector. `items` is the Swedish account the administrator reads, one row per fact, with no answer in it:
 * an administrator sees structure, never people's data (D23).
 */
export interface CheckOptions {
  url: string;
  key?: string;
  id?: string;
  assert: (actor: Actor) => Promise<string>;
  assertForeign: (actor: Actor) => Promise<string>;
  fetch?: FetchLike;
  /** Validates `{}` against a capability's input schema with a real validator. Absent, a schema that lists `required` properties is taken to need input. */
  acceptsEmptyInput?: (schema: object) => boolean;
  /**
   * For the reads about an entity (D97): `keys` are asked in one batch, signed as `as`, a person who may see them
   * (the check's manager when absent, for whom every real key is out of scope). Without keys the rows are not checked;
   * an unknown key and the keys asked from another unit are checked anyway. `as` is handed to the registry as given:
   * the CLI passes the person's whole context, as the server does.
   */
  about?: { keys?: string[]; as?: Actor };
}
/** How long a read about an entity may take before Clew shows its section as not answering (D97 item 7, D75). */
export const ABOUT_BUDGET_MS = 1500;
/** A key no installation gives a person or a unit: an unknown key must be no row and no error. */
export const UNKNOWN_KEY = 'clew-check-unknown-key';
/** A read that needs input is not called by the check: its refusal of `{}` is the right answer, not a fault. This is the rule without a validator library. */
const listsNothingRequired = (schema: object) =>
  !((schema as { required?: unknown }).required as unknown[] | undefined)?.length;
export const CHECK_MANAGER: Actor = {
  id: 'check-manager',
  name: 'Kontroll Chef',
  unitId: 'unit-check',
  unitLabel: 'Kontrollenheten',
  role: 'manager',
  userName: 'check-manager',
};
export const CHECK_EMPLOYEE: Actor = {
  id: 'check-employee',
  name: 'Kontroll Medarbetare',
  unitId: 'unit-check',
  unitLabel: 'Kontrollenheten',
  role: 'employee',
  userName: 'check-employee',
};
/**
 * One of the check's people as the server hands a person to the registry: the whole authenticated context, provisioned
 * groups and session fields included, as the refresh, a connector's callback and every request do. So the connector is
 * reached exactly as in production, where only the published actor leaves the process; a check with a bare actor would
 * pass a connector that then refuses every scan.
 */
export const asInProduction = (actor: Actor): AuthenticatedContext => ({
  ...actor,
  organisationId: 'check',
  principal: { id: 'person:' + actor.id, kind: 'person' },
  capabilities: [],
  groups: ['check-group'],
  authorizationVersion: 'check',
  sessionBinding: 'operator:connector-check',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'check' }),
});
const UNAVAILABLE = /svarar inte just nu/;
const ROLE: Record<Role, string> = { manager: 'chef', employee: 'medarbetare' };
const VIEW: Record<NonNullable<ConnectorManifest['capabilities'][number]['view']>['kind'], string> = {
  table: 'tabell',
  list: 'lista',
  detail: 'detaljvy',
  text: 'text',
  document: 'dokument',
  record: 'post med underlag',
  metrics: 'nyckeltal',
  series: 'diagram och tabell',
  activity: 'historik',
};
/** An entity kind as the administrator reads it (D97): about "en person", out of scope "En person utanför…". */
const ENTITY: Record<EntityKind, { one: string; plural: string }> = {
  person: { one: 'person', plural: 'personer' },
  unit: { one: 'enhet', plural: 'enheter' },
};
/** Where a capability about an entity would show (D97 item 2), in the administrator's words. */
const PLACE: Record<AboutPlace, (entity: EntityKind) => string> = {
  menu: e => `i menyn för en ${ENTITY[e].one}`,
  section: e => `som avsnitt när en ${ENTITY[e].one} öppnas`,
  lens: () => 'som lins över listan',
  mark: () => 'som markering på raden',
};
const worst = (a: CheckLevel, b: CheckLevel): CheckLevel =>
  a === 'fail' || b === 'fail' ? 'fail' : a === 'warn' || b === 'warn' ? 'warn' : 'ok';
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const who = (roles: Role[]) => roles.map(r => ROLE[r]).join(' och ');
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export async function checkConnector(
  options: CheckOptions,
): Promise<CheckReport & { findings: CheckFinding[]; manifest?: ConnectorManifest }> {
  const findings: CheckFinding[] = [];
  const items: CheckItem[] = [];
  const ok = (text: string) => findings.push({ level: 'ok', text });
  const warn = (text: string) => findings.push({ level: 'warn', text });
  const fail = (text: string) => findings.push({ level: 'fail', text });
  const item = (level: CheckLevel, group: CheckGroup, label: string, description?: string, capability?: string) =>
    items.push({ level, group, label, ...(description ? { description } : {}), ...(capability ? { capability } : {}) });
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url.replace(/\/+$/, '');
  let manifest: ConnectorManifest;
  try {
    manifest = await fetchManifest(url, options.id, fetchImpl);
  } catch (error) {
    fail('manifest: ' + (error as Error).message);
    item('fail', 'connection', 'Systemets beskrivning kunde inte hämtas', (error as Error).message);
    return { ok: false, items, findings };
  }
  ok(
    `manifest valid: ${manifest.capabilities.length} capabilities, ${manifest.areas.length} areas, scan ${manifest.scan}`,
  );
  item(
    'ok',
    'connection',
    'Systemets beskrivning är giltig',
    `${count(manifest.capabilities.length, 'funktion', 'funktioner')}, ${count(manifest.areas.length, 'område', 'områden')}. ${manifest.scan ? 'Skickar ärenden.' : 'Skickar inga ärenden.'}`,
  );
  if (manifest.delegation) {
    warn(
      `delegation: acts as the person for audience "${manifest.delegation.audience}"; not verified by this check (it has no session), so a "denied" answer below is the expected one`,
    );
    item(
      'warn',
      'connection',
      'Agerar som personen',
      `Använder personens egen behörighet mot ${manifest.delegation.audience}. Kontrollen har ingen inloggning och kan inte pröva det, så nekade svar är väntade.`,
    );
  }
  const registry = new Registry({
    onRefused: (_id, topic, problem) => {
      if (topic.startsWith('figure:')) {
        fail(`${topic}: ${problem}`);
        item('fail', 'surfaces', 'Nyckeltal', `Nyckeltalet för ${topic.slice(7)} kan inte vara en länk: ${problem}`);
        return;
      }
      fail(`draft ${topic} refused: ${problem}`);
      item('fail', 'surfaces', 'Ärenden', `Ärendet ${topic} avvisades: ${problem}`);
    },
  }).register(remoteConnector(manifest, { url, key: options.key, assert: options.assert, fetch: fetchImpl }));
  registry.govern(manifest.id, openGovernance());
  // The check's two people as the server hands a person to the registry; only the published actor leaves the process.
  const manager = asInProduction(CHECK_MANAGER),
    employee = asInProduction(CHECK_EMPLOYEE),
    people = [manager, employee];
  const accepts = options.acceptsEmptyInput ?? listsNothingRequired;
  /** What one capability came to, for the row the administrator reads: every finding about it folds into one sentence each. */
  type Row = {
    level: CheckLevel;
    answered: Role[];
    refused: Role[];
    notes: string[];
    note(level: CheckLevel, text: string): void;
  };
  const newRow = (): Row => ({
    level: 'ok',
    answered: [],
    refused: [],
    notes: [],
    note(level, text) {
      this.level = worst(this.level, level);
      if (!this.notes.includes(text)) this.notes.push(text);
    },
  });
  const rowText = (row: Row) => {
    const answered = row.answered.length
      ? `Svarar för ${who(row.answered)}${row.refused.length ? `, ${who(row.refused)} nekas som väntat` : ''}.`
      : row.refused.length
        ? `${sentence(who(row.refused))} nekas som väntat.`
        : '';
    return [answered, ...row.notes].filter(Boolean).join(' ');
  };
  /** A declared view (D38) against a real answer: the rows are where the view says, and no field is missing from every row. */
  const checkView = (c: ConnectorManifest['capabilities'][number], output: unknown, row: Row) => {
    const view = c.view;
    if (!view) return;
    if (
      view.kind === 'document' ||
      view.kind === 'record' ||
      view.kind === 'metrics' ||
      view.kind === 'series' ||
      view.kind === 'activity'
    ) {
      const problem = viewOutputProblem(view, output);
      if (problem) {
        fail(`${c.name}: invalid ${view.kind} payload`);
        row.note('fail', problem);
      } else {
        ok(`${c.name}: validated ${view.kind} view`);
        row.note('ok', `Visas som ${VIEW[view.kind]}.`);
      }
      return;
    }
    if (view.kind === 'text') {
      if (typeof (output as Record<string, unknown> | null)?.[view.body] === 'string') {
        ok(`${c.name}: view text drawn from "${view.body}"`);
        row.note('ok', 'Visas som text.');
      } else {
        fail(`${c.name}: view text expects a string at "${view.body}"`);
        row.note('fail', `Vyn väntar sig text i fältet "${view.body}".`);
      }
      return;
    }
    if (view.kind === 'detail') {
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        ok(`${c.name}: view detail, ${view.fields.length} fields`);
        row.note('ok', `Visas som ${VIEW.detail} med ${view.fields.length} fält.`);
      } else {
        fail(`${c.name}: view detail expects one record`);
        row.note('fail', 'Vyn väntar sig en post.');
      }
      return;
    }
    const rows = viewRows(view, output);
    if (!rows) {
      fail(`${c.name}: view ${view.kind} expects an array of records at "${rowsKey(view)}"`);
      row.note('fail', `Vyn väntar sig en lista med poster i fältet "${rowsKey(view)}".`);
      return;
    }
    ok(`${c.name}: view ${view.kind} drawn from "${rowsKey(view)}", ${view.fields.length} fields`);
    row.note('ok', `Visas som ${VIEW[view.kind]} med ${view.fields.length} fält.`);
    const unseen = rows.length ? view.fields.filter(f => rows.every(r => r[f.key] === undefined)).map(f => f.key) : [];
    if (unseen.includes(view.title)) {
      fail(`${c.name}: no row has the view's title field "${view.title}"`);
      row.note('fail', `Ingen rad har vyns titelfält "${view.title}".`);
    } else if (unseen.length) {
      warn(`${c.name}: no row has ${unseen.map(k => `"${k}"`).join(', ')}; the column is drawn empty`);
      row.note('warn', `Ingen rad har ${unseen.map(k => `"${k}"`).join(', ')}, så kolumnen blir tom.`);
    }
  };
  type Declared = ConnectorManifest['capabilities'][number];
  const inRoles = (c: Declared) => people.filter(a => !c.scope.roles || c.scope.roles.includes(a.role));
  const rowsOf = (c: Declared, output: unknown) => (c.view ? (viewRows(c.view, output) ?? []) : []);
  /** A call that should answer with no row: whether it did, refused, or answered rows. */
  const noRow = async (c: Declared, actor: Actor, keys: string[]) => {
    try {
      const rows = rowsOf(c, await registry.run(actor, c.name, { keys }));
      return rows.length ? { rows: rows.length } : { ok: true as const };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  /**
   * A read about an entity (D97 item 7), asked as Clew asks it: a batch of keys answered one row per key, each row
   * carrying a key it was asked with, within the budget; an unknown key and keys asked from another unit are no row and
   * no error. The rows are checked only with the keys an operator gives, signed as a person who may see them.
   */
  const probeAboutRead = async (c: Declared, row: Row) => {
    const entity = c.about!.entity;
    const head = `${c.name} about ${entity}`;
    const actors = inRoles(c);
    const keys = [...new Set(options.about?.keys ?? [])];
    const as = options.about?.as ?? actors[0] ?? manager;
    if (!keys.length) {
      warn(`${head}, batch: no keys given; pass --keys (and --as a person who may see them) to check the rows`);
      row.note('warn', 'Inga nycklar gavs, så raderna är inte prövade.');
    } else {
      const started = Date.now();
      try {
        const output = await registry.run(as, c.name, { keys });
        const ms = Date.now() - started;
        const rows = rowsOf(c, output);
        const asked = new Set(keys.map(k => k.toLowerCase()));
        const keyOf = (r: Record<string, unknown>) => (typeof r.key === 'string' ? r.key.toLowerCase() : undefined);
        if (!row.answered.includes(as.role)) row.answered.push(as.role);
        if (rows.length) {
          ok(`${head}, batch: ${keys.length} keys asked, ${rows.length} rows, ${ms} ms (budget ${ABOUT_BUDGET_MS} ms)`);
          row.note('ok', `${count(keys.length, 'nyckel', 'nycklar')} gav ${count(rows.length, 'rad', 'rader')}.`);
        } else {
          warn(
            `${head}, batch: ${keys.length} keys asked, no row, ${ms} ms; sign --as a person who may see them to check the rows`,
          );
          row.note('warn', `${count(keys.length, 'nyckel', 'nycklar')} gav ingen rad, så raderna är inte prövade.`);
        }
        const strangers = rows.filter(r => !asked.has(keyOf(r) ?? ''));
        if (strangers.length) {
          fail(
            `${head}, key: ${strangers.length} rows carry a key that was not asked (${strangers.map(r => JSON.stringify(r.key)).join(', ')})`,
          );
          row.note('fail', 'En rad bär en nyckel som inte efterfrågades.');
        } else if (rows.length) ok(`${head}, key: every row carries a key it was asked with`);
        const seen = new Set<string>();
        const twice = rows.map(keyOf).filter(k => k !== undefined && (seen.has(k) || !seen.add(k)));
        if (twice.length) {
          fail(`${head}, one row per key: ${twice.length} keys answered more than once`);
          row.note('fail', 'Samma nyckel besvaras med flera rader.');
        } else if (rows.length) ok(`${head}, one row per key`);
        if (ms > ABOUT_BUDGET_MS) {
          warn(
            `${head}, budget: answered in ${ms} ms, over ${ABOUT_BUDGET_MS} ms; Clew shows the section as not answering`,
          );
          row.note('warn', `Svaret tog ${ms} ms, mer än ${ABOUT_BUDGET_MS} ms. Då visar Clew att källan inte svarade.`);
        }
        if (rows.length) checkView(c, output, row);
      } catch (error) {
        fail(`${head}, batch as ${as.userName ?? as.id}: ${(error as Error).message}`);
        row.note('fail', `Frågan med nycklarna gav fel: ${(error as Error).message}`);
      }
    }
    // An unknown key, asked by the same person: no row and no error.
    const unknown = await noRow(c, as, [UNKNOWN_KEY]);
    if ('ok' in unknown) {
      ok(`${head}, unknown key: no row, no error`);
      row.note('ok', 'En okänd nyckel ger ingen rad.');
    } else if ('error' in unknown) {
      fail(`${head}, unknown key: refused (${unknown.error}); answer an unknown key as no row`);
      row.note('fail', `En okänd nyckel ger fel i stället för ingen rad: ${unknown.error}`);
    } else {
      fail(`${head}, unknown key: answered ${unknown.rows} rows`);
      row.note('fail', 'En okänd nyckel ger en rad.');
    }
    // The same keys from a unit no installation has: every real key is out of scope for the check's own people.
    const outside = keys.length ? keys : [UNKNOWN_KEY];
    for (const actor of actors) {
      const result = await noRow(c, actor, outside);
      const who = `the check's ${actor.role} on ${actor.unitId}`;
      if ('ok' in result) {
        ok(
          `${head}, out of scope: ${keys.length ? `the ${keys.length} keys asked by ${who}` : `asked by ${who} (no keys given, so the key is synthetic)`}: no row, no error`,
        );
        if (!row.answered.includes(actor.role)) row.answered.push(actor.role);
      } else if ('error' in result) {
        fail(`${head}, out of scope: refused for ${who} (${result.error}); answer a key out of scope as no row`);
        row.note('fail', `En ${ENTITY[entity].one} utanför behörigheten ger fel i stället för ingen rad.`);
      } else {
        fail(`${head}, out of scope: ${who} was answered ${result.rows} rows`);
        row.note('fail', `En ${ENTITY[entity].one} utanför behörigheten besvaras med en rad.`);
      }
    }
    if (keys.length && !row.notes.some(n => n.includes('utanför behörigheten')))
      row.note('ok', `En ${ENTITY[entity].one} utanför behörigheten ger ingen rad.`);
  };
  /** An action about an entity (D97): the input takes the key in `param`, and a person decides, not the model. */
  const probeAboutAction = (c: Declared, row: Row) => {
    const { entity, param } = c.about!;
    const head = `${c.name} about ${entity}, ${c.kind}`;
    const input = (c.input as { properties?: Record<string, { type?: unknown }> }).properties;
    if (param && input?.[param]?.type === 'string') {
      ok(`${head}, input: takes ${param}`);
      row.note('ok', `Tar emot en ${ENTITY[entity].one} i "${param}".`);
    } else {
      fail(`${head}, input: param "${param ?? ''}" is not a string property of the input`);
      row.note('fail', `Fältet "${param ?? ''}" finns inte i indata.`);
    }
    const offered = people.some(a => registry.tools(a).some(t => t.name === c.name));
    if (offered) {
      warn(`${head}, model tool: offered to the model; an action in an entity's menu is a person's decision`);
      row.note('warn', 'Erbjuds till modellen som verktyg.');
    } else {
      ok(`${head}, model tool: not offered to the model`);
      row.note('ok', 'Erbjuds inte till modellen.');
    }
  };
  for (const c of manifest.capabilities) {
    if (c.about) {
      const row = newRow();
      // The role scope still holds: a role outside it is refused before anything is asked.
      for (const actor of people.filter(a => !inRoles(c).includes(a)))
        try {
          await registry.run(actor, c.name, c.kind === 'read' ? { keys: [UNKNOWN_KEY] } : {});
          fail(`${c.name}: ${actor.role} is out of scope but the registry let the call through`);
          row.note('fail', `Anropet släpptes igenom för ${ROLE[actor.role]}, som inte ska få det.`);
        } catch {
          ok(`${c.name}: ${actor.role} refused by scope`);
          row.refused.push(actor.role);
        }
      if (c.kind === 'read') await probeAboutRead(c, row);
      else {
        if (c.kind === 'execute') ok(`${c.name}: execute, not a tool, not called by the check`);
        probeAboutAction(c, row);
      }
      item(row.level, 'capabilities', c.title, rowText(row), c.name);
      continue;
    }
    if (c.kind === 'execute') {
      ok(`${c.name}: execute, not a tool, not called by the check`);
      item(
        'ok',
        'capabilities',
        c.title,
        'Åtgärd som bara körs efter ett mänskligt beslut. Kontrollen anropar den inte.',
        c.name,
      );
      continue;
    }
    const row = newRow();
    for (const actor of people) {
      const allowed = !c.scope.roles || c.scope.roles.includes(actor.role);
      if (!allowed) {
        try {
          await registry.run(actor, c.name, {});
          fail(`${c.name}: ${actor.role} is out of scope but the registry let the call through`);
          row.note('fail', `Anropet släpptes igenom för ${ROLE[actor.role]}, som inte ska få det.`);
        } catch {
          ok(`${c.name}: ${actor.role} refused by scope`);
          row.refused.push(actor.role);
        }
        continue;
      }
      if (!accepts(c.input as object)) {
        ok(
          `${c.name}: needs input (${JSON.stringify(c.input)}), not called by the check${c.view ? `; view ${c.view.kind} declared, not exercised` : ''}`,
        );
        row.note(
          'ok',
          `Behöver indata, så kontrollen anropar den inte${c.view ? `. Vyn (${VIEW[c.view.kind]}) är inte prövad` : ''}.`,
        );
        break;
      }
      try {
        const output = await registry.run(actor, c.name, {});
        ok(`${c.name} as ${actor.role}: ${JSON.stringify(output).slice(0, 100)}`);
        row.answered.push(actor.role);
        if (actor === manager || c.scope.roles?.length === 1) checkView(c, output, row);
      } catch (error) {
        const m = (error as Error).message;
        if (manifest.delegation && /styrkas|behörighet/.test(m)) {
          ok(`${c.name} as ${actor.role}: refused without the person's token, as a delegating connector should (${m})`);
          row.note('ok', 'Nekas utan personens egen inloggning, som väntat.');
        } else if (UNAVAILABLE.test(m)) {
          warn(
            `${c.name} as ${actor.role}: ${m} (a capability that calls back into Clew needs CLEW_URL and a running Clew)`,
          );
          row.note(
            'warn',
            `Svarar inte för ${ROLE[actor.role]}. En förmåga som anropar Clew behöver att Clew är igång.`,
          );
        } else {
          fail(`${c.name} as ${actor.role}: ${m}`);
          row.note('fail', `Fel för ${ROLE[actor.role]}: ${m}`);
        }
      }
    }
    item(row.level, 'capabilities', c.title, rowText(row), c.name);
  }
  // Where the capabilities about an entity would show (D97 item 2), one row per entity kind; an administrator still
  // chooses the lenses and columns.
  for (const entity of ['person', 'unit'] as const) {
    const about = manifest.capabilities.filter(c => c.about?.entity === entity);
    if (!about.length) continue;
    ok(`about ${entity}: ${about.map(c => `${c.name} (${placesOf(c).join(', ')})`).join('; ')}`);
    item(
      'ok',
      'surfaces',
      `Om ${ENTITY[entity].plural}`,
      about
        .map(
          c =>
            `${c.title} kan visas ${placesOf(c)
              .map(p => PLACE[p](entity))
              .join(', ')}.`,
        )
        .join(' '),
    );
  }
  const tools = manifest.capabilities.map(c => ({ name: c.name, row: menuRowOf(c) })).filter(t => t.row);
  if (tools.length) {
    ok(
      `menu: ${tools.length} ${tools.length === 1 ? 'view' : 'views'} can be a tool in the menu when an administrator chooses it: ${tools.map(t => `"${t.row!.label}" (${t.name})`).join(', ')}`,
    );
    item(
      'ok',
      'surfaces',
      'Verktyg i menyn',
      `${tools.map(t => t.row!.label).join(', ')} kan väljas till menyn av en administratör.`,
    );
  }
  // A foreign/invalid signature must be refused by the connector itself, not only by Clew.
  const first = manifest.capabilities[0];
  if (first) {
    try {
      const r = await fetchImpl(url + '/clew/capabilities/' + first.name, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + (await options.assertForeign(CHECK_MANAGER)),
          ...(options.key ? { 'x-clew-connector-key': options.key } : {}),
        },
        body: JSON.stringify({ actor: CHECK_MANAGER, input: {} }),
      });
      if (r.status === 401) {
        ok('a call signed with another secret is refused (401)');
        item('ok', 'connection', 'Fel nyckel nekas', 'Ett anrop signerat med en annan nyckel avvisades av tjänsten.');
      } else {
        fail(`a call signed with another secret answered ${r.status}, expected 401`);
        item(
          'fail',
          'connection',
          'Fel nyckel släpps igenom',
          `Ett anrop signerat med en annan nyckel fick svaret ${r.status}. Tjänsten ska svara 401.`,
        );
      }
    } catch (error) {
      fail('wrong-secret probe: ' + (error as Error).message);
      item('fail', 'connection', 'Fel nyckel kunde inte prövas', (error as Error).message);
    }
  }
  if (manifest.scan) {
    const counts: string[] = [];
    let same = true;
    for (const actor of people) {
      try {
        const drafts = await registry.scan(actor),
          twice = await registry.scan(actor);
        ok(
          `scan as ${actor.role}: ${drafts.length} drafts${drafts.length ? ' (' + drafts.map(d => d.topic).join(', ') + ')' : ''}`,
        );
        counts.push(`${drafts.length} för ${ROLE[actor.role]}`);
        if (JSON.stringify(drafts.map(d => d.topic)) !== JSON.stringify(twice.map(d => d.topic))) {
          fail('scan is not idempotent: topics differ between two runs');
          same = false;
        }
        for (const d of drafts)
          if (!manifest.areas.some(a => a.id === d.area)) {
            fail(`draft ${d.topic} names unknown area ${d.area}`);
            item(
              'fail',
              'surfaces',
              'Ärenden',
              `Ärendet ${d.topic} pekar på området ${d.area}, som inte finns i manifestet.`,
            );
          }
      } catch (error) {
        fail(`scan as ${actor.role}: ${(error as Error).message}`);
        item(
          'fail',
          'surfaces',
          'Ärenden',
          `Genomgången misslyckades för ${ROLE[actor.role]}: ${(error as Error).message}`,
        );
      }
    }
    if (counts.length)
      item(
        same ? 'ok' : 'fail',
        'surfaces',
        'Ärenden',
        `Genomgången föreslår ${counts.join(' och ')}. ${same ? 'Två genomgångar gav samma ärenden.' : 'Två genomgångar gav olika ärenden.'}`,
      );
  }
  // The shared header (D88): asked as both roles; the answer must be in the protocol's shape. Its words stay out of the
  // report (D23, D44): the check counts the places and says whether a logo came along, never what they are.
  if (manifest.header) {
    // The check's registry makes the connector the holder for the probe; in an installation an administrator chooses one.
    registry.govern(manifest.id, { ...registry.governance(manifest.id), header: true });
    for (const actor of people) {
      const answer = await registry.header(actor);
      if (answer) {
        const n = answer.output.items.length;
        ok(`header as ${actor.role}: ${n} places${answer.output.logo ? ', a logo' : ''}`);
        item(
          'ok',
          'surfaces',
          'Sidhuvud',
          `Kan ge sidhuvudet: för ${ROLE[actor.role]} ${count(n, 'plats', 'platser')}${answer.output.logo ? ' och en logotyp' : ''}.`,
        );
      } else {
        fail(`header as ${actor.role}: no answer in the protocol's shape`);
        item(
          'fail',
          'surfaces',
          'Sidhuvud',
          `Kan inte ge sidhuvudet: svaret för ${ROLE[actor.role]} är inte i protokollets form.`,
        );
      }
    }
  }
  // One row per area: the roles that see the same thing share a sentence. The figure's value is an answer and stays out
  // (D23, D44): the check says which parts of the richer shape (D54) came back, never what they say.
  const areas = new Map<string, { title: string; byRole: Map<string, Role[]> }>();
  const shapeOf = (f: NonNullable<Area['figure']>) =>
    (['value', 'comparison', 'progress', 'opens'] as const).filter(k => f[k] !== undefined);
  const shapeWords = { value: 'värde', comparison: 'jämförelse', progress: 'mål', opens: 'länk till en vy' } as const;
  for (const actor of people)
    for (const a of await registry.areas(actor)) {
      const shape = a.figure && !a.figure.unavailable ? shapeOf(a.figure) : [];
      ok(
        `area ${a.id} as ${actor.role}: figure ${a.figure ? (a.figure.unavailable ? 'did not answer' : `tone ${a.figure.tone}${shape.length ? ' with ' + shape.join(', ') : ', a sentence'}`) : 'none'}, ${a.standing.length} standing`,
      );
      if (a.figure?.unavailable) {
        fail(`figure ${a.id} as ${actor.role}: no answer in the protocol's shape`);
        item('fail', 'surfaces', 'Nyckeltal', `Nyckeltalet för ${a.title} svarade inte i protokollets form.`);
      }
      const figure = !a.figure
        ? 'inget nyckeltal'
        : a.figure.unavailable
          ? 'nyckeltalet svarade inte'
          : shape.length
            ? `nyckeltal med ${shape.map(k => shapeWords[k]).join(', ')}`
            : 'nyckeltal som en mening';
      const text = `${count(a.standing.length, 'stående handling', 'stående handlingar')}, ${figure}`;
      const area = areas.get(a.id) ?? { title: a.title, byRole: new Map<string, Role[]>() };
      area.byRole.set(text, [...(area.byRole.get(text) ?? []), actor.role]);
      areas.set(a.id, area);
    }
  for (const { title, byRole } of areas.values())
    item(
      'ok',
      'surfaces',
      `Området ${title}`,
      [...byRole].map(([text, roles]) => `${sentence(who(roles))}: ${text}.`).join(' '),
    );
  return { ok: !findings.some(f => f.level === 'fail'), items, findings, manifest };
}
