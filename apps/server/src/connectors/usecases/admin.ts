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
  ManifestDiff,
  PreviewQuery,
  RefreshManifestInput,
  Role,
  RotateSecretInput,
} from '@clew/contracts';
import { menuRowOf, type Actor, type Connector, type Governance, type Registry } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
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
  clock: () => Date;
}
export const governanceOf = (
  r: Pick<ConnectorRecord, 'state' | 'audience' | 'scanEnabled' | 'toolsEnabled' | 'capabilities'> &
    Partial<Pick<ConnectorRecord, 'ordinal'>>,
): Governance => ({
  state: r.state,
  audience: r.audience,
  scanEnabled: r.scanEnabled,
  toolsEnabled: r.toolsEnabled,
  capabilities: r.capabilities,
  ...(r.ordinal ? { ordinal: r.ordinal } : {}),
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
  const { store, registry, secrets, transport, live, units, clock } = deps;
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
    if (!failed.length) return { status: 'ok', at };
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
      })),
      areas: (m?.areas ?? []).map(a => ({
        id: a.id,
        title: a.title,
        roles: [...a.roles],
        standing: [...a.standing],
        figure: !!a.figure,
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
    if (patch.capabilities !== undefined) {
      const merged = { ...row.capabilities };
      // The two switches are replaced as sent; whether the view is in the menu is its own question (below) and stays.
      for (const [name, override] of Object.entries(patch.capabilities)) {
        const clean = {
          ...(override.enabled === false ? { enabled: false as const } : {}),
          ...(override.model === false ? { model: false as const } : {}),
          ...(row.capabilities[name]?.menu ? { menu: true as const } : {}),
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
    });
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
  return { list, read, add, update, rotateSecret, test, refreshManifest, remove, preview, listUnits };
}
export type ConnectorUsecases = ReturnType<typeof connectorUsecases>;
