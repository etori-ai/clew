import type {
  AddConnectorInput,
  AuthenticatedContext,
  CheckFinding,
  CheckReport,
  ConnectorDetail,
  ConnectorHealth,
  ConnectorPatchInput,
  ConnectorPreview,
  ConnectorSummary,
  EntityKind,
  ManifestDiff,
  PreviewQuery,
  RefreshManifestInput,
  Role,
  RotateSecretInput,
  View,
} from '@clew/contracts';
import { ENTITY_COLUMNS_MAX } from '@clew/contracts';
import { menuRowOf, type Actor, type Connector, type Governance, type Registry } from '@clew/connectors';
import { healthOf, type ConnectorManifest } from '@clew/connectors/protocol';
import { ForbiddenError, InputError } from '../../context';
import { describeBundled } from '../describe';
import type {
  ConnectorRecord,
  ConnectorStore,
  ConnectorTx,
  LiveRegistration,
  Secrets,
  Transport,
  Units,
  Groups,
} from '../model';

/**
 * Connector administration (D23): one function per thing an administrator does on "Anslutna system". Every mutation
 * needs the grant capability `admin.connectors` and the same step-up an `execute` needs, writes its audit row in the
 * transaction that changes the row, and then applies the change to the live registry, so nothing is restarted.
 * Secrets are sealed by the composition root's `Secrets` and never returned; the service is reached only through
 * `Transport`. Built over ports (D25): the tests run it on the memory store with a fake transport.
 */
export const ADMIN_CAPABILITY = 'admin.connectors';
export interface AdminDeps {
  /** Core capability providers are not connected systems (D62). */
  internal?: readonly string[];
  store: ConnectorStore;
  registry: Pick<Registry, 'connector' | 'list' | 'govern' | 'governance' | 'visible' | 'areas' | 'tools' | 'menu'>;
  secrets: Secrets;
  transport: Transport;
  live: LiveRegistration;
  units: Units;
  groups: Groups;
  clock: () => Date;
}
export const governanceOf = (
  r: Pick<ConnectorRecord, 'state' | 'audience' | 'scanEnabled' | 'toolsEnabled' | 'capabilities'> &
    Partial<Pick<ConnectorRecord, 'ordinal' | 'areas' | 'header'>>,
): Governance => ({
  state: r.state,
  audience: r.audience,
  scanEnabled: r.scanEnabled,
  toolsEnabled: r.toolsEnabled,
  capabilities: r.capabilities,
  ...(r.areas && Object.keys(r.areas).length ? { areas: r.areas } : {}),
  ...(r.ordinal ? { ordinal: r.ordinal } : {}),
  ...(r.header ? { header: true } : {}),
});
const isManifest = (value: unknown): value is ConnectorManifest =>
  !!value && typeof value === 'object' && Array.isArray((value as ConnectorManifest).capabilities);
/** A name that cannot be a person: the structural preview's actor. */
const previewActor = (role: Role, unitId: string | null): Actor => ({
  id: 'preview',
  name: 'Förhandsgranskning',
  unitId: unitId ?? 'preview',
  unitLabel: '',
  role,
});

export function connectorUsecases(deps: AdminDeps) {
  const { store, registry, secrets, transport, live, units, groups, clock } = deps;
  const internal = new Set(deps.internal);
  const requireConnector = (id: string) => {
    if (internal.has(id)) throw new InputError('Funktionen ingår i Clew och är inte ett anslutet system.');
  };
  const requireAdmin = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(ADMIN_CAPABILITY)) throw new ForbiddenError();
  };
  const mutating = async (persona: AuthenticatedContext) => {
    requireAdmin(persona);
    await persona.authorize();
    return { by: persona.principal.id, at: clock().toISOString() };
  };
  const must = async (id: string) => {
    requireConnector(id);
    const row = await store.read(id);
    if (!row) throw new InputError('Anslutningen finns inte.');
    return row;
  };
  const remote = (row: ConnectorRecord) => {
    if (row.bundled) throw new InputError('En inbyggd anslutning har ingen adress och ingen nyckel.');
    return { url: row.url!, secret: secrets.open(row.secret!, row.id) };
  };
  const manifestOf = (row: ConnectorRecord): ConnectorManifest | undefined => {
    if (isManifest(row.manifest)) return row.manifest;
    const live = registry.connector(row.id);
    return live && row.bundled ? describeBundled(live) : undefined;
  };
  const healthFrom = (
    report: { findings: CheckFinding[]; manifest?: ConnectorManifest },
    at: string,
  ): ConnectorHealth => {
    if (!report.manifest) {
      const text = report.findings[0]?.text ?? '';
      return { status: /Invalid connector manifest/.test(text) ? 'manifest-invalid' : 'unreachable', at, detail: text };
    }
    const failed = report.findings.filter(f => f.level === 'fail');
    if (!failed.length) return healthOf(report.manifest, at);
    // A service that refuses our assertion says so in the protocol's words ('Ogiltigt behörighetsbevis.'), or by not refusing a foreign one.
    return {
      status: failed.some(f => /behörighetsbevis|secret|401/i.test(f.text)) ? 'secret-rejected' : 'manifest-invalid',
      at,
      detail: failed[0]!.text,
    };
  };
  /** Put a remote row's connector in the live registry from its stored manifest and apply its governance. */
  const applyLive = (row: ConnectorRecord, manifest?: ConnectorManifest) => {
    if (!row.bundled) {
      const m = manifest ?? manifestOf(row);
      if (row.state === 'draft') {
        live.unregister(row.id);
        return;
      }
      if (m) live.register({ id: row.id, url: row.url!, secret: secrets.open(row.secret!, row.id), manifest: m }, m);
    }
    if (registry.connector(row.id)) registry.govern(row.id, governanceOf(row));
  };
  /**
   * The row a capability's view would be in the menu (D40), or undefined when it cannot be a tool. Asked of the live
   * capability first: a bundled connector's input schema is code and its described manifest carries `{}` for it.
   */
  const menuRow = (row: ConnectorRecord, name: string, m = manifestOf(row)) => {
    const live = registry.connector(row.id)?.capabilities.find(c => c.name === name);
    if (live) return menuRowOf(live);
    const described = m?.capabilities.find(c => c.name === name);
    return described ? menuRowOf(described) : undefined;
  };
  /**
   * What an administrator may place of a read about an entity (D97 items 3 and 4): its kind and the fields of its table
   * or list; undefined when the capability is not such a read. Asked of the live capability first, as the menu row is.
   */
  const aboutRead = (row: ConnectorRecord, name: string, m = manifestOf(row)) => {
    const c: { kind: string; about?: { entity: EntityKind }; view?: View } | undefined =
      registry.connector(row.id)?.capabilities.find(x => x.name === name) ?? m?.capabilities.find(x => x.name === name);
    const view = c?.view;
    if (c?.kind !== 'read' || !c.about || (view?.kind !== 'table' && view?.kind !== 'list')) return undefined;
    return { entity: c.about.entity, fields: view.fields };
  };
  /** The column a row shows for one capability (D97 item 4): the stored field while it is still in the view. */
  const columnOf = (row: ConnectorRecord, name: string, capabilities = row.capabilities, m = manifestOf(row)) => {
    const key = capabilities[name]?.column;
    const about = key ? aboutRead(row, name, m) : undefined;
    const field = about?.fields.find(f => f.key === key);
    return about && field ? { entity: about.entity, field } : undefined;
  };
  /** How many columns each entity kind has on "Alla" across the installation, with this row's capabilities as given. */
  const columnCounts = async (id: string, capabilities: ConnectorRecord['capabilities']) => {
    const counts = new Map<EntityKind, number>();
    for (const r of await store.list()) {
      const own = r.id === id ? capabilities : r.capabilities,
        m = manifestOf(r);
      for (const name of Object.keys(own)) {
        const column = columnOf(r, name, own, m);
        if (column) counts.set(column.entity, (counts.get(column.entity) ?? 0) + 1);
      }
    }
    return counts;
  };
  function summary(row: ConnectorRecord): ConnectorSummary {
    const m = manifestOf(row),
      live: Connector | undefined = registry.connector(row.id);
    const caps = m?.capabilities ?? [];
    const tools = caps.filter(
      c =>
        c.model &&
        row.toolsEnabled &&
        row.capabilities[c.name]?.model !== false &&
        row.capabilities[c.name]?.enabled !== false,
    ).length;
    return {
      id: row.id,
      bundled: row.bundled,
      source: m?.source ?? live?.source ?? row.id,
      kind: live?.kind ?? m?.kind ?? null,
      ordinal: row.bundled || (live?.kind ?? m?.kind) === 'core' ? null : row.ordinal,
      url: row.url,
      state: row.state,
      health: row.health,
      audience: row.audience,
      scanEnabled: row.scanEnabled,
      toolsEnabled: row.toolsEnabled,
      header: row.header,
      registered: !!live,
      counts: { capabilities: caps.length, execute: caps.filter(c => c.kind === 'execute').length, tools },
      manifestAt: row.manifestAt,
      secretChangedAt: row.bundled ? null : row.secretChangedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  async function detail(row: ConnectorRecord): Promise<ConnectorDetail> {
    const m = manifestOf(row);
    return {
      ...summary(row),
      protocol: m?.protocol ?? null,
      scan: m?.scan ?? false,
      headerCapability: m?.header?.capability ?? registry.connector(row.id)?.header ?? null,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      capabilities: (m?.capabilities ?? []).map(c => ({
        name: c.name,
        kind: c.kind,
        title: c.title,
        description: c.description,
        model: c.model,
        roles: c.scope.roles ? [...c.scope.roles] : null,
        enabled: row.capabilities[c.name]?.enabled !== false,
        tool:
          c.model &&
          row.toolsEnabled &&
          row.capabilities[c.name]?.model !== false &&
          row.capabilities[c.name]?.enabled !== false,
        menu: (r => (r ? { ...r, on: row.capabilities[c.name]?.menu === true } : null))(menuRow(row, c.name, m)),
        ...(c.about ? { about: c.about.entity } : {}),
        ...(about =>
          about
            ? {
                lens: { on: row.capabilities[c.name]?.lens === true },
                column: {
                  fields: about.fields.map(f => ({ key: f.key, label: f.label })),
                  on: columnOf(row, c.name, row.capabilities, m)?.field.key ?? null,
                },
              }
            : {})(aboutRead(row, c.name, m)),
      })),
      areas: (m?.areas ?? []).map(a => ({
        id: a.id,
        title: a.title,
        roles: [...a.roles],
        standing: [...a.standing],
        figure: !!a.figure,
        figureShown: !!a.figure && row.areas[a.id]?.figure !== false,
        ...(a.icon ? { icon: a.icon } : {}),
      })),
      history: await store.history(row.id),
    };
  }

  /** Managed connectors only; internal user capabilities are not connected systems (D62). */
  async function list(persona: AuthenticatedContext): Promise<ConnectorSummary[]> {
    requireAdmin(persona);
    return (await store.list()).filter(row => !internal.has(row.id)).map(summary);
  }
  async function read(persona: AuthenticatedContext, id: string) {
    requireAdmin(persona);
    return detail(await must(id));
  }
  /** Register a remote connector as a draft: fetch and check it, store the sealed secret, nothing goes live yet. */
  async function add(
    persona: AuthenticatedContext,
    input: AddConnectorInput,
  ): Promise<{ connector: ConnectorDetail; report: CheckReport }> {
    const { by, at } = await mutating(persona);
    requireConnector(input.id);
    if (await store.read(input.id)) throw new InputError('Anslutningen finns redan.');
    if (registry.connector(input.id)) throw new InputError('Namnet används av en inbyggd anslutning.');
    const url = input.url.replace(/\/+$/, '');
    const report = await transport.check({ url, id: input.id, secret: input.secret });
    const health = healthFrom(report, at);
    await store.transaction(async tx => {
      await tx.insert({
        id: input.id,
        bundled: false,
        url,
        secret: secrets.seal(input.secret, input.id),
        state: 'draft',
        manifest: report.manifest ?? null,
        health,
        createdBy: by,
        at,
      });
      await tx.writeAudit({
        actor: by,
        action: 'connector.added',
        subject: 'connector:' + input.id,
        at,
        details: {
          url,
          source: report.manifest?.source ?? null,
          capabilities: report.manifest?.capabilities.length ?? 0,
          health: health.status,
        },
      });
    });
    return { connector: await detail((await store.read(input.id))!), report: { ok: report.ok, items: report.items } };
  }
  /** Switches, audience, state and address. Narrowing only; a changed field is one audit row. */
  async function update(
    persona: AuthenticatedContext,
    id: string,
    patch: ConnectorPatchInput,
  ): Promise<ConnectorDetail> {
    const { by, at } = await mutating(persona);
    const row = await must(id);
    const m = manifestOf(row);
    if (patch.url !== undefined && row.bundled) throw new InputError('En inbyggd anslutning har ingen adress.');
    if (patch.menu)
      for (const [name, on] of Object.entries(patch.menu)) {
        if (!m?.capabilities.some(c => c.name === name)) throw new InputError('Okänd förmåga: ' + name);
        if (on && !menuRow(row, name, m))
          throw new InputError(
            'Förmågan kan inte ligga i menyn: det kan bara en läsning med en vy som öppnas utan indata.',
          );
      }
    if (patch.capabilities)
      for (const name of Object.keys(patch.capabilities))
        if (!m?.capabilities.some(c => c.name === name)) throw new InputError('Okänd förmåga: ' + name);
    if (patch.lens)
      for (const [name, on] of Object.entries(patch.lens)) {
        if (!m?.capabilities.some(c => c.name === name)) throw new InputError('Okänd förmåga: ' + name);
        if (on && !aboutRead(row, name, m))
          throw new InputError(
            'Förmågan kan inte erbjudas under Visa: det kan bara en läsning om en person eller en enhet som visas som tabell eller lista.',
          );
      }
    if (patch.column)
      for (const [name, key] of Object.entries(patch.column)) {
        if (!m?.capabilities.some(c => c.name === name)) throw new InputError('Okänd förmåga: ' + name);
        if (key === null) continue;
        const about = aboutRead(row, name, m);
        if (!about)
          throw new InputError(
            'Förmågan kan inte ge en kolumn under Alla: det kan bara en läsning om en person eller en enhet.',
          );
        if (!about.fields.some(f => f.key === key)) throw new InputError('Fältet finns inte i förmågans vy: ' + key);
      }
    if (patch.figures)
      for (const area of Object.keys(patch.figures))
        if (!m?.areas.some(a => a.id === area && a.figure))
          throw new InputError('Området har inget nyckeltal: ' + area);
    if (patch.state === 'enabled' && !row.bundled && !m) {
      // A draft that never answered: try once more now, so enabling fails loudly instead of registering nothing.
      try {
        const fetched = await transport.fetchManifest(row.url!, row.id);
        await store.recordHealth(id, { status: 'ok', at }, fetched, at);
      } catch (error) {
        throw new InputError('Anslutningen svarar inte, så den kan inte slås på: ' + (error as Error).message);
      }
    }
    const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
    const next: Partial<ConnectorRecord> = {};
    if (patch.state !== undefined && patch.state !== row.state) {
      next.state = patch.state;
      changes.push({ action: 'connector.' + patch.state, details: { from: row.state } });
    }
    if (patch.audience !== undefined && JSON.stringify(patch.audience) !== JSON.stringify(row.audience)) {
      next.audience = patch.audience;
      changes.push({ action: 'connector.audience', details: { from: row.audience, to: patch.audience } });
    }
    if (patch.scanEnabled !== undefined && patch.scanEnabled !== row.scanEnabled) {
      next.scanEnabled = patch.scanEnabled;
      changes.push({ action: 'connector.scan', details: { to: patch.scanEnabled } });
    }
    if (patch.toolsEnabled !== undefined && patch.toolsEnabled !== row.toolsEnabled) {
      next.toolsEnabled = patch.toolsEnabled;
      changes.push({ action: 'connector.tools', details: { to: patch.toolsEnabled } });
    }
    // The shared header (D88) is exclusive: turning it on here takes it from the connector that held it, in the same transaction.
    let previousHolder: ConnectorRecord | undefined;
    if (patch.header !== undefined && patch.header !== row.header) {
      if (patch.header && !(m?.header?.capability ?? registry.connector(row.id)?.header))
        throw new InputError(
          'Anslutningen kan inte ge sidhuvudet: dess beskrivning pekar inte ut någon förmåga för det.',
        );
      next.header = patch.header;
      if (patch.header) previousHolder = (await store.list()).find(r => r.header && r.id !== id);
      changes.push({
        action: 'connector.header',
        details: { to: patch.header, ...(previousHolder ? { from: previousHolder.id } : {}) },
      });
    }
    if (patch.capabilities !== undefined) {
      const merged = { ...row.capabilities };
      // The two switches are replaced as sent; whether the view is in the menu, offered as a lens or shown as a column
      // (D40, D97) are their own questions (below) and stay.
      for (const [name, override] of Object.entries(patch.capabilities)) {
        const kept = row.capabilities[name];
        const clean = {
          ...(override.enabled === false ? { enabled: false as const } : {}),
          ...(override.model === false ? { model: false as const } : {}),
          ...(kept?.menu ? { menu: true as const } : {}),
          ...(kept?.lens ? { lens: true as const } : {}),
          ...(kept?.column ? { column: kept.column } : {}),
        };
        if (Object.keys(clean).length) merged[name] = clean;
        else delete merged[name];
      }
      if (JSON.stringify(merged) !== JSON.stringify(row.capabilities)) {
        next.capabilities = merged;
        changes.push({ action: 'connector.capability', details: { to: patch.capabilities } });
      }
    }
    if (patch.menu !== undefined) {
      // A view in or out of the menu (D40): one audit row per view that changed, with the row as the person will see it.
      const merged = { ...(next.capabilities ?? row.capabilities) };
      for (const [name, on] of Object.entries(patch.menu)) {
        if ((merged[name]?.menu === true) === on) continue;
        const { menu: _menu, ...rest } = merged[name] ?? {};
        const clean = { ...rest, ...(on ? { menu: true as const } : {}) };
        if (Object.keys(clean).length) merged[name] = clean;
        else delete merged[name];
        changes.push({
          action: 'connector.menu',
          details: {
            capability: name,
            to: on,
            ...(menuRow(row, name, m) ? { label: menuRow(row, name, m)!.label } : {}),
          },
        });
      }
      if (JSON.stringify(merged) !== JSON.stringify(next.capabilities ?? row.capabilities)) next.capabilities = merged;
    }
    if (patch.lens !== undefined) {
      // A read offered under Visa on its entity's list or not (D97 item 3): one audit row per read that changed.
      const merged = { ...(next.capabilities ?? row.capabilities) };
      for (const [name, on] of Object.entries(patch.lens)) {
        if ((merged[name]?.lens === true) === on) continue;
        const { lens: _lens, ...rest } = merged[name] ?? {};
        const clean = { ...rest, ...(on ? { lens: true as const } : {}) };
        if (Object.keys(clean).length) merged[name] = clean;
        else delete merged[name];
        changes.push({
          action: 'connector.lens',
          details: { capability: name, to: on, title: m?.capabilities.find(c => c.name === name)?.title ?? name },
        });
      }
      if (JSON.stringify(merged) !== JSON.stringify(next.capabilities ?? row.capabilities)) next.capabilities = merged;
    }
    if (patch.column !== undefined) {
      // A field of a read as a column on "Alla" or none (D97 item 4): one audit row per read that changed. At most
      // ENTITY_COLUMNS_MAX columns for one entity kind across every connector, counted as the header holder is found
      // (D88): over the stored rows, with this one as it will be.
      const merged = { ...(next.capabilities ?? row.capabilities) };
      const gained = new Set<EntityKind>();
      for (const [name, key] of Object.entries(patch.column)) {
        const from = merged[name]?.column ?? null;
        if (from === key) continue;
        const { column: _column, ...rest } = merged[name] ?? {};
        const clean = { ...rest, ...(key !== null ? { column: key } : {}) };
        if (Object.keys(clean).length) merged[name] = clean;
        else delete merged[name];
        const about = aboutRead(row, name, m);
        if (key !== null && about) gained.add(about.entity);
        const label = key === null ? undefined : about?.fields.find(f => f.key === key)?.label;
        changes.push({
          action: 'connector.column',
          details: { capability: name, to: key, from, ...(label ? { label } : {}) },
        });
      }
      if (gained.size) {
        const counts = await columnCounts(id, merged);
        for (const kind of gained)
          if ((counts.get(kind) ?? 0) > ENTITY_COLUMNS_MAX)
            throw new InputError(
              `Högst ${ENTITY_COLUMNS_MAX} kolumner kan visas under Alla för ${kind === 'person' ? 'personer' : 'enheter'}. Ta bort en annan kolumn först.`,
            );
      }
      if (JSON.stringify(merged) !== JSON.stringify(next.capabilities ?? row.capabilities)) next.capabilities = merged;
    }
    if (patch.figures !== undefined) {
      // An area's figure on Hem or not (D54): one audit row per area that changed, with the area's title as the administrator read it.
      const merged = { ...row.areas };
      for (const [area, on] of Object.entries(patch.figures)) {
        if ((merged[area]?.figure !== false) === on) continue;
        if (on) delete merged[area];
        else merged[area] = { figure: false };
        changes.push({
          action: 'connector.figure',
          details: { area, to: on, title: m?.areas.find(a => a.id === area)?.title ?? area },
        });
      }
      if (JSON.stringify(merged) !== JSON.stringify(row.areas)) next.areas = merged;
    }
    if (patch.url !== undefined) {
      const url = patch.url.replace(/\/+$/, '');
      if (url !== row.url) {
        next.url = url;
        changes.push({ action: 'connector.url', details: { from: row.url, to: url } });
      }
    }
    if (!changes.length) return detail(row);
    await store.transaction(async tx => {
      await tx.update(id, next, by, at);
      for (const c of changes)
        await tx.writeAudit({ actor: by, action: c.action, subject: 'connector:' + id, at, details: c.details });
      if (previousHolder) {
        await tx.update(previousHolder.id, { header: false }, by, at);
        await tx.writeAudit({
          actor: by,
          action: 'connector.header',
          subject: 'connector:' + previousHolder.id,
          at,
          details: { to: false, takenBy: id },
        });
      }
    });
    if (previousHolder) applyLive((await store.read(previousHolder.id))!);
    const updated = (await store.read(id))!;
    applyLive(updated);
    return detail(updated);
  }
  /** A new shared secret: sealed, dated, and the live signer swapped. The old one stops working at once. */
  async function rotateSecret(
    persona: AuthenticatedContext,
    id: string,
    input: RotateSecretInput,
  ): Promise<ConnectorDetail> {
    const { by, at } = await mutating(persona);
    const row = await must(id);
    remote(row);
    await store.transaction(async tx => {
      await tx.update(id, { secret: secrets.seal(input.secret, id), secretChangedAt: at }, by, at);
      await tx.writeAudit({ actor: by, action: 'connector.secret', subject: 'connector:' + id, at });
    });
    const updated = (await store.read(id))!;
    applyLive(updated);
    return detail(updated);
  }
  /** "Testa anslutning": the conformance check against the service, health recorded, nothing else changed. */
  async function test(persona: AuthenticatedContext, id: string): Promise<CheckReport & { health: ConnectorHealth }> {
    requireAdmin(persona);
    const row = await must(id),
      at = clock().toISOString();
    if (row.bundled)
      return {
        ok: true,
        items: [
          { level: 'ok', group: 'connection', label: 'Inbyggd anslutning', description: 'Körs i Clews egen process.' },
        ],
        health: { status: 'ok', at },
      };
    const report = await transport.check({ ...remote(row), id });
    const health = healthFrom(report, at);
    await store.recordHealth(id, health, report.manifest, at);
    return { ok: report.ok, items: report.items, health };
  }
  /** "Hämta manifest igen": what changed since the stored one; with `apply` the new manifest is stored and goes live. */
  async function refreshManifest(
    persona: AuthenticatedContext,
    id: string,
    input: RefreshManifestInput,
  ): Promise<{ diff: ManifestDiff; connector: ConnectorDetail }> {
    const row = await must(id);
    const { url } = remote(row);
    const fetched = await transport.fetchManifest(url, id);
    const stored = manifestOf(row);
    const names = (m?: ConnectorManifest) => new Set((m?.capabilities ?? []).map(c => c.name));
    const areas = (m?: ConnectorManifest) => new Set((m?.areas ?? []).map(a => a.id));
    const before = names(stored),
      after = names(fetched),
      areasBefore = areas(stored),
      areasAfter = areas(fetched);
    const changed = [...after].filter(
      n =>
        before.has(n) &&
        JSON.stringify(stored!.capabilities.find(c => c.name === n)) !==
          JSON.stringify(fetched.capabilities.find(c => c.name === n)),
    );
    const diff: ManifestDiff = {
      added: [...after].filter(n => !before.has(n)),
      removed: [...before].filter(n => !after.has(n)),
      changed,
      areasAdded: [...areasAfter].filter(a => !areasBefore.has(a)),
      areasRemoved: [...areasBefore].filter(a => !areasAfter.has(a)),
      same: JSON.stringify(stored) === JSON.stringify(fetched),
    };
    if (!input.apply) {
      requireAdmin(persona);
      return { diff, connector: await detail(row) };
    }
    const { by, at } = await mutating(persona);
    await store.transaction(async tx => {
      await tx.update(id, { manifest: fetched, manifestAt: at, health: { status: 'ok', at } }, by, at);
      await tx.writeAudit({
        actor: by,
        action: 'connector.manifest',
        subject: 'connector:' + id,
        at,
        details: { added: diff.added, removed: diff.removed, changed: diff.changed },
      });
    });
    const updated = (await store.read(id))!;
    applyLive(updated, fetched);
    return { diff, connector: await detail(updated) };
  }
  /** Remove a remote connector: its open cards close with the reason, the row goes, the registry forgets it. Receipts stay. */
  async function remove(persona: AuthenticatedContext, id: string): Promise<{ closedCards: number }> {
    const { by, at } = await mutating(persona);
    const row = await must(id);
    if (row.bundled) throw new InputError('En inbyggd anslutning kan inte tas bort, bara stängas av.');
    const closedCards = await store.transaction(async (tx: ConnectorTx) => {
      const closed = await tx.dismissOpenThreadsOf(id, at);
      await tx.remove(id);
      await tx.writeAudit({
        actor: by,
        action: 'connector.removed',
        subject: 'connector:' + id,
        at,
        details: { closedCards: closed },
      });
      return closed;
    });
    live.unregister(id);
    return { closedCards };
  }
  /** What a person with this role and unit would get from the connector: structure only, no data, no call to the service. */
  async function preview(persona: AuthenticatedContext, id: string, query: PreviewQuery): Promise<ConnectorPreview> {
    requireAdmin(persona);
    await must(id);
    const actor = previewActor(query.role, query.unitId ?? null);
    const visible = registry.visible(actor, id);
    const areas = visible ? await registry.areas(actor, { figures: false, connector: id }) : [];
    return {
      role: query.role,
      unitId: query.unitId ?? null,
      visible,
      areas: areas.map(a => ({ id: a.id, title: a.title, standing: a.standing.map(s => s.label) })),
      tools: visible
        ? registry
            .tools(actor)
            .filter(t => t.name.startsWith(id + '.'))
            .map(t => t.name)
        : [],
      menu: registry
        .menu(actor)
        .filter(e => e.connector === id)
        .map(e => e.label),
    };
  }
  /** For the audience editor: the units a grant can name. */
  async function listUnits(persona: AuthenticatedContext) {
    requireAdmin(persona);
    return units.list();
  }
  /** For the audience editor: the provisioned groups an audience can name (D23, D68). */
  async function listGroups(persona: AuthenticatedContext) {
    requireAdmin(persona);
    return groups.list();
  }
  return { list, read, add, update, rotateSecret, test, refreshManifest, remove, preview, listUnits, listGroups };
}
export type ConnectorUsecases = ReturnType<typeof connectorUsecases>;
