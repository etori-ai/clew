import type {
  AddConnectorInput,
  AuthenticatedContext,
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
import { ENTITY_COLUMNS_MAX, aboutEntity, type EntityAbout, type RecordAbout } from '@clew/contracts';
import {
  deniedGovernance,
  menuRowOf,
  type Actor,
  type Connector,
  type Governance,
  type Registry,
} from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';
import { parseManifest } from '@clew/connectors/remote';
import { ForbiddenError, InputError } from '../../context';
import { diffDetails, isManifest, manifestDiff, pendingOffer } from '../manifests';
import { describeBundled } from '../describe';
import type {
  ConnectorPatch,
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
/** A change made on a connector that has been saved since (DE-M5): the page reads it again and the administrator looks. */
export const CHANGED_SINCE = 'Anslutningen har ändrats sedan du öppnade den. Se över den och gör ändringen igen.';
/** A check whose connector got another address or secret while the service answered: its result is about neither. */
export const CHANGED_WHILE_CHECKED =
  'Anslutningens adress eller nyckel ändrades medan den testades. Resultatet sparades inte; testa den igen.';
/** "Läs in igen" on a connector that moved while the service answered: what the old address served is not offered. */
export const MOVED_WHILE_READ =
  'Anslutningens adress ändrades medan systemet lästes in. Inget sparades; läs in det igen från den nya adressen.';
/**
 * What `update` takes: the page's patch, whose `version` the route requires. A script of Clew's own acting on the row as
 * it stands leaves it out; the write still compares the version the change was made on.
 */
export type ConnectorChange = Omit<ConnectorPatchInput, 'version'> & { version?: number };
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
  const healthFrom = (report: Awaited<ReturnType<Transport['check']>>, at: string): ConnectorHealth => {
    // No manifest to check: the transport says whether the service did not answer or served one Clew does not load.
    if (!report.manifest)
      return { status: report.failure ?? 'unreachable', at, detail: report.findings[0]?.text ?? '' };
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
      if (row.state === 'draft') {
        live.unregister(row.id);
        return;
      }
      let m = manifest;
      if (!m && row.manifest !== undefined && row.manifest !== null) {
        // A stored manifest goes live only as the loader reads it: one it refuses, on a number this Clew does not load or
        // for any other reason, is not registered, and what is live of it is governed shut, as the reconciler does.
        try {
          m = parseManifest(row.manifest, row.id);
        } catch {
          if (registry.connector(row.id)) registry.govern(row.id, deniedGovernance());
          return;
        }
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
    const c: { kind: string; about?: EntityAbout | RecordAbout; view?: View } | undefined =
      registry.connector(row.id)?.capabilities.find(x => x.name === name) ?? m?.capabilities.find(x => x.name === name);
    const view = c?.view;
    const about = aboutEntity(c?.about);
    if (c?.kind !== 'read' || !about || (view?.kind !== 'table' && view?.kind !== 'list')) return undefined;
    return { entity: about.entity, fields: view.fields };
  };
  /** The column a row shows for one capability (D97 item 4): the stored field while it is still in the view. */
  const columnOf = (row: ConnectorRecord, name: string, capabilities = row.capabilities, m = manifestOf(row)) => {
    const key = capabilities[name]?.column;
    const about = key ? aboutRead(row, name, m) : undefined;
    const field = about?.fields.find(f => f.key === key);
    return about && field ? { entity: about.entity, field } : undefined;
  };
  /** How many columns each entity kind has on "Alla" across `rows`, with this row's capabilities as given. */
  const columnCounts = (rows: ConnectorRecord[], id: string, capabilities: ConnectorRecord['capabilities']) => {
    const counts = new Map<EntityKind, number>();
    for (const r of rows) {
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
      version: row.version,
    };
  }
  async function detail(row: ConnectorRecord): Promise<ConnectorDetail> {
    const m = manifestOf(row);
    const offer = pendingOffer(row);
    return {
      ...summary(row),
      protocol: m?.protocol ?? null,
      scan: m?.scan ?? false,
      uses: [...(m?.uses ?? [])],
      delegation: m?.delegation?.audience ?? null,
      offered: offer ? { at: offer.at, diff: manifestDiff(m, offer.manifest) } : null,
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
        // The entity it is about (D97); an action about a record (D137) is placed on the record's page, not here.
        ...(aboutEntity(c.about) ? { about: aboutEntity(c.about)!.entity } : {}),
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
      // Another administrator's add of the same id that landed since the check above: nothing of this one is stored.
      if (
        !(await tx.insert({
          id: input.id,
          bundled: false,
          url,
          secret: secrets.seal(input.secret, input.id),
          state: 'draft',
          manifest: report.manifest ?? null,
          health,
          createdBy: by,
          at,
        }))
      )
        throw new InputError('Anslutningen finns redan.');
      await tx.writeAudit({
        actor: by,
        action: 'connector.added',
        subject: 'connector:' + input.id,
        at,
        details: {
          url,
          source: report.manifest?.source ?? null,
          capabilities: report.manifest?.capabilities.length ?? 0,
          // What the administrator approves by adding it (D144): what it reads back as the person and whose token it gets.
          uses: report.manifest?.uses ?? [],
          delegation: report.manifest?.delegation?.audience ?? null,
          health: health.status,
        },
      });
    });
    return { connector: await detail((await store.read(input.id))!), report: { ok: report.ok, items: report.items } };
  }
  /**
   * Switches, audience, state and address. Narrowing only; a changed field is one audit row. The change is made on the
   * row as it was read, and written only while it is still that row (DE-M5): its version is compared in the write, and
   * with the version the page showed when one is sent, so a change saved since by another administrator is refused,
   * never merged unseen. What spans rows, the shared header and the column count, is decided on rows read in the same
   * transaction under the store's lock.
   */
  async function update(persona: AuthenticatedContext, id: string, patch: ConnectorChange): Promise<ConnectorDetail> {
    const { by, at } = await mutating(persona);
    const row = await must(id);
    if (patch.version !== undefined && patch.version !== row.version) throw new InputError(CHANGED_SINCE);
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
    if (patch.state === 'enabled' && !row.bundled && !m)
      // A draft that never answered has no approved manifest, and enabling approves none (D144): the administrator
      // reads it in and approves what it declares first.
      throw new InputError(
        'Anslutningen har ingen godkänd beskrivning. Läs in den från systemet och godkänn den innan du slår på anslutningen.',
      );
    const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
    const next: ConnectorPatch = {};
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
    // The shared header (D88) is exclusive: turning it on here takes it from the connector that held it, found and
    // released in the same transaction (below).
    const headerChange = { action: 'connector.header', details: {} as Record<string, unknown> };
    if (patch.header !== undefined && patch.header !== row.header) {
      if (patch.header && !(m?.header?.capability ?? registry.connector(row.id)?.header))
        throw new InputError(
          'Anslutningen kan inte ge sidhuvudet: dess beskrivning pekar inte ut någon förmåga för det.',
        );
      next.header = patch.header;
      headerChange.details.to = patch.header;
      changes.push(headerChange);
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
    // A field of a read as a column on "Alla" or none (D97 item 4): one audit row per read that changed. At most
    // ENTITY_COLUMNS_MAX columns for one entity kind across every connector, counted as the header holder is found
    // (D88): in the transaction, over the rows read under the store's lock, with this one as it will be.
    const gained = new Set<EntityKind>();
    if (patch.column !== undefined) {
      const merged = { ...(next.capabilities ?? row.capabilities) };
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
        // An offer is what the old address served (D144): what is approved after the move is what the new one serves.
        // Dropped whatever the row read held, since a check records an offer without raising the version: one recorded
        // between this read and the write is from the old address too.
        next.offered = null;
        next.offeredAt = null;
        changes.push({ action: 'connector.url', details: { from: row.url, to: url } });
      }
    }
    if (!changes.length) return detail(row);
    const takesHeader = next.header === true;
    const released = await store.transaction(async tx => {
      let holders: string[] = [];
      if (takesHeader || gained.size) {
        const rows = await tx.lockedRows();
        if (gained.size) {
          const counts = columnCounts(rows, id, next.capabilities ?? row.capabilities);
          for (const kind of gained)
            if ((counts.get(kind) ?? 0) > ENTITY_COLUMNS_MAX)
              throw new InputError(
                `Högst ${ENTITY_COLUMNS_MAX} kolumner kan visas under Alla för ${kind === 'person' ? 'personer' : 'enheter'}. Ta bort en annan kolumn först.`,
              );
        }
        if (takesHeader) holders = rows.filter(r => r.header && r.id !== id).map(r => r.id);
      }
      // The holder gives the header up first: the store holds at most one row to it.
      for (const holder of holders) await tx.update(holder, { header: false }, by, at);
      if (holders.length) headerChange.details.from = holders[0];
      if (!(await tx.update(id, next, by, at, row.version))) throw new InputError(CHANGED_SINCE);
      for (const c of changes)
        await tx.writeAudit({ actor: by, action: c.action, subject: 'connector:' + id, at, details: c.details });
      for (const holder of holders)
        await tx.writeAudit({
          actor: by,
          action: 'connector.header',
          subject: 'connector:' + holder,
          at,
          details: { to: false, takenBy: id },
        });
      return holders;
    });
    for (const holder of released) {
      const was = await store.read(holder);
      if (was) applyLive(was);
    }
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
  /**
   * "Testa anslutning": the conformance check against the service. The health is recorded, and a manifest that differs
   * from the approved one is recorded as offered; nothing live changes (D144). `offered` says whether a change waits
   * for the administrator now, so the page can say so. The result is recorded only on the connector as it was checked:
   * one that another administrator moved or rekeyed while the service answered keeps nothing of it, and the
   * administrator is asked to test it again, since the report is about an address or a secret it no longer has.
   */
  async function test(
    persona: AuthenticatedContext,
    id: string,
  ): Promise<CheckReport & { health: ConnectorHealth; offered: boolean }> {
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
        offered: false,
      };
    const report = await transport.check({ ...remote(row), id });
    const health = healthFrom(report, at);
    const recorded = await store.recordCheck(id, {
      url: row.url!,
      secret: row.secret!,
      health,
      ...(report.manifest ? { served: report.manifest } : {}),
      at,
    });
    if (!recorded) throw new InputError(CHANGED_WHILE_CHECKED);
    const after = await store.read(id);
    return { ok: report.ok, items: report.items, health, offered: !!after && !!pendingOffer(after) };
  }
  /**
   * "Läs in igen från systemet" (D144). Without `apply`: the service's manifest is fetched, recorded as offered when it
   * differs from the approved one, and the difference returned; nothing live changes, the health included, since a
   * manifest is not a check. With `apply`: the offer the administrator reviewed, named by when it was first seen,
   * becomes the approved manifest with its audit row, in one write that holds only while it is still the stored offer.
   * The stored offer is applied, never a new fetch, so what goes live is what was shown.
   */
  async function refreshManifest(
    persona: AuthenticatedContext,
    id: string,
    input: RefreshManifestInput,
  ): Promise<{ diff: ManifestDiff; connector: ConnectorDetail }> {
    // Both paths require an administrator before the first lookup; applying also rechecks the session (`mutating`).
    requireAdmin(persona);
    if (!input.apply) {
      const row = await must(id);
      const { url } = remote(row);
      const fetched = await transport.fetchManifest(url, id);
      // An offer only on the row still at the address it was read from: one moved meanwhile is read in again there.
      if (!(await store.recordCheck(id, { url, served: fetched, at: clock().toISOString() })))
        throw new InputError(MOVED_WHILE_READ);
      const seen = (await store.read(id))!;
      return { diff: manifestDiff(manifestOf(seen), fetched), connector: await detail(seen) };
    }
    const { by, at } = await mutating(persona);
    const row = await must(id);
    remote(row);
    const offer = pendingOffer(row);
    if (!offer) throw new InputError('Systemet erbjuder ingen ändring att godkänna. Läs in det igen.');
    const changedAgain = 'Systemet har ändrats igen sedan du granskade det. Läs in det igen och granska ändringen.';
    if (input.offered !== offer.at) throw new InputError(changedAgain);
    // The offer is loaded as the loader would load it, so a manifest this Clew cannot register is never approved.
    let offered: ConnectorManifest;
    try {
      offered = parseManifest(offer.manifest, id);
    } catch (error) {
      throw new InputError('Beskrivningen från systemet kan inte användas: ' + (error as Error).message);
    }
    const diff = manifestDiff(manifestOf(row), offered);
    const approved = await store.transaction(async tx => {
      // Only while it is still the stored offer: a check that recorded another in between makes this false.
      if (!(await tx.approveOffer(id, { at: offer.at, manifest: row.offered }, offered, by, at))) return false;
      await tx.writeAudit({
        actor: by,
        action: 'connector.manifest',
        subject: 'connector:' + id,
        at,
        details: { offeredAt: offer.at, ...diffDetails(diff) },
      });
      return true;
    });
    if (!approved) throw new InputError(changedAgain);
    const updated = (await store.read(id))!;
    applyLive(updated, offered);
    return { diff, connector: await detail(updated) };
  }
  /**
   * Remove a remote connector: its open cards close with the reason, the row goes with what the competence register
   * copied from it, the registry forgets it. Receipts stay.
   */
  async function remove(persona: AuthenticatedContext, id: string): Promise<{ closedCards: number }> {
    const { by, at } = await mutating(persona);
    const row = await must(id);
    if (row.bundled) throw new InputError('En inbyggd anslutning kan inte tas bort, bara stängas av.');
    const closedCards = await store.transaction(async (tx: ConnectorTx) => {
      const closed = await tx.dismissOpenThreadsOf(id, at);
      const copied = await tx.remove(id);
      await tx.writeAudit({
        actor: by,
        action: 'connector.removed',
        subject: 'connector:' + id,
        at,
        details: { closedCards: closed },
      });
      // What the competence register copied from it went with it (D108 item 9): the row the operator's way of
      // forgetting a source writes, with its counts (DE-L4).
      if (copied.source || copied.holdings || copied.mappings)
        await tx.writeAudit({
          actor: by,
          action: 'competence.source_forgotten',
          subject: 'connector:' + id,
          at,
          details: { holdings: copied.holdings, mappings: copied.mappings },
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
