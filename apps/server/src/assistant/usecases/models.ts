import type {
  AddModelInput,
  AddProviderInput,
  AssistantStatus,
  AuthenticatedContext,
  CheckFinding,
  ModelChoice,
  ModelDetail,
  ModelPatchInput,
  ModelSummary,
  ProviderDetail,
  ProviderHealth,
  ProviderKeyInput,
  ProviderPatchInput,
  ProviderSummary,
  ProviderTestReport,
} from '@clew/contracts';
import { actorOf } from '@clew/connectors';
import { ForbiddenError, InputError } from '../../context';
import { choicesFor, pickModel, slugFor } from '../domain';
import {
  WireError,
  type Endpoint,
  type KeySealer,
  type ModelHealth,
  type ModelRecord,
  type ModelStore,
  type ModelWire,
  type ProviderRecord,
  type ResolvedModel,
} from '../ports';

/**
 * Model administration and the person's model (D24): one function per thing an administrator does under
 * Administration › Modeller, plus what the composer needs (the person's choices, their pick, the model a turn uses).
 * Every administrative mutation needs the administration grant and the step-up, and writes its audit row in the
 * transaction that changes the row. Keys are sealed by `KeySealer` and never returned. Nothing is cached: the rows are
 * read on every turn, so a change on any instance is live on the next question without a watcher or a restart.
 */
/** The administration grant (D23) covers the models too: one surface, one grant, until a reason to split them appears. */
export const MODEL_ADMIN_CAPABILITY = 'admin.connectors';
export interface ModelDeps {
  store: ModelStore;
  sealer: KeySealer;
  wire: ModelWire;
  health: ModelHealth;
  clock: () => Date;
}
const healthOf = (error: unknown, at: string): ProviderHealth => {
  if (error instanceof WireError)
    return error.kind === 'unsupported'
      ? { status: 'untested', at, detail: error.message }
      : { status: error.kind, at, detail: error.message };
  return { status: 'unreachable', at, detail: error instanceof Error ? error.message : String(error) };
};
const choiceOf = (m: ModelRecord): ModelChoice => ({
  id: m.id,
  title: m.title,
  description: m.description,
  isDefault: m.isDefault,
});

export function modelUsecases(deps: ModelDeps) {
  const { store, sealer, wire, health, clock } = deps;
  const requireAdmin = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(MODEL_ADMIN_CAPABILITY)) throw new ForbiddenError();
  };
  const mutating = async (persona: AuthenticatedContext) => {
    requireAdmin(persona);
    await persona.authorize();
    return { by: persona.principal.id, at: clock().toISOString() };
  };
  const mustProvider = async (id: string) => {
    const row = await store.readProvider(id);
    if (!row) throw new InputError('Leverantören finns inte.');
    return row;
  };
  const mustModel = async (id: string) => {
    const row = await store.readModel(id);
    if (!row) throw new InputError('Modellen finns inte.');
    return row;
  };
  const endpointOf = (p: ProviderRecord): Endpoint => ({
    baseUrl: p.baseUrl,
    ...(p.apiKey ? { apiKey: sealer.open(p.apiKey, p.id) } : {}),
  });
  /** A test's result lands in the row (no audit, no version) and in this process's view of the endpoint. */
  const record = async (providerId: string, h: ProviderHealth) => {
    await store.recordHealth(providerId, h);
    if (h.status !== 'untested') health.mark(providerId, h.status === 'ok', h.at);
  };

  function providerSummary(p: ProviderRecord, models: ModelRecord[]): ProviderSummary {
    const mine = models.filter(m => m.providerId === p.id);
    return {
      id: p.id,
      title: p.title,
      baseUrl: p.baseUrl,
      hasKey: !!p.apiKey,
      keyChangedAt: p.keyChangedAt,
      health: p.health,
      models: mine.length,
      enabledModels: mine.filter(m => m.state === 'enabled').length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
  function modelSummary(m: ModelRecord, providers: ProviderRecord[]): ModelSummary {
    const p = providers.find(x => x.id === m.providerId);
    return {
      id: m.id,
      providerId: m.providerId,
      providerTitle: p?.title ?? m.providerId,
      model: m.model,
      title: m.title,
      description: m.description,
      state: m.state,
      audience: m.audience,
      isDefault: m.isDefault,
      tools: m.tools,
      health: p?.health ?? { status: 'untested', at: m.createdAt },
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
  const providerDetail = async (p: ProviderRecord): Promise<ProviderDetail> => ({
    ...providerSummary(p, await store.listModels()),
    createdBy: p.createdBy,
    updatedBy: p.updatedBy,
    history: await store.history('provider:' + p.id),
  });
  const modelDetail = async (m: ModelRecord): Promise<ModelDetail> => ({
    ...modelSummary(m, await store.listProviders()),
    createdBy: m.createdBy,
    updatedBy: m.updatedBy,
    history: await store.history('model:' + m.id),
  });

  /** Every provider and every model, as the list shows them. */
  async function list(
    persona: AuthenticatedContext,
  ): Promise<{ providers: ProviderSummary[]; models: ModelSummary[] }> {
    requireAdmin(persona);
    const [providers, models] = await Promise.all([store.listProviders(), store.listModels()]);
    return {
      providers: providers.map(p => providerSummary(p, models)),
      models: models.map(m => modelSummary(m, providers)),
    };
  }
  async function readProvider(persona: AuthenticatedContext, id: string) {
    requireAdmin(persona);
    return providerDetail(await mustProvider(id));
  }
  async function readModel(persona: AuthenticatedContext, id: string) {
    requireAdmin(persona);
    return modelDetail(await mustModel(id));
  }

  /** What the endpoint says about itself: the model ids it lists. A missing list is a warning, not a failure: models can be added by name. */
  async function probeEndpoint(endpoint: Endpoint, at: string): Promise<ProviderTestReport> {
    try {
      const ids = await wire.listModels(endpoint);
      return {
        ok: true,
        models: ids,
        health: { status: 'ok', at },
        findings: [
          {
            level: 'ok',
            text: `Adressen svarar och listar ${ids.length} ${ids.length === 1 ? 'modell' : 'modeller'}.`,
          },
        ],
      };
    } catch (error) {
      const h = healthOf(error, at);
      const text =
        h.status === 'key-rejected'
          ? 'Nyckeln avvisas av adressen.'
          : h.status === 'unreachable'
            ? 'Adressen svarar inte.'
            : 'Adressen listar inga modeller. Lägg till dem med namn och testa var och en.';
      const finding: CheckFinding = {
        level: h.status === 'untested' ? 'warn' : 'fail',
        text: h.detail ? `${text} (${h.detail})` : text,
      };
      return { ok: h.status === 'untested', models: [], health: h, findings: [finding] };
    }
  }
  /** "Lägg till leverantör": the row with its sealed key, and what the endpoint answered, so the dialog can offer its models. */
  async function addProvider(
    persona: AuthenticatedContext,
    input: AddProviderInput,
  ): Promise<{ provider: ProviderDetail; report: ProviderTestReport }> {
    const { by, at } = await mutating(persona);
    if (await store.readProvider(input.id)) throw new InputError('Leverantören finns redan.');
    const baseUrl = input.baseUrl.replace(/\/+$/, '');
    const key = input.apiKey?.trim() || undefined;
    const report = await probeEndpoint({ baseUrl, ...(key ? { apiKey: key } : {}) }, at);
    await store.transaction(async tx => {
      if (
        !(await tx.insertProvider({
          id: input.id,
          title: input.title.trim(),
          baseUrl,
          apiKey: key ? sealer.seal(key, input.id) : null,
          health: report.health,
          createdBy: by,
          at,
        }))
      )
        throw new InputError('Leverantören finns redan.');
      await tx.writeAudit({
        actor: by,
        action: 'provider.added',
        subject: 'provider:' + input.id,
        at,
        details: { baseUrl, key: !!key, health: report.health.status },
      });
    });
    if (report.health.status !== 'untested') health.mark(input.id, report.health.status === 'ok', at);
    return { provider: await providerDetail((await store.readProvider(input.id))!), report };
  }
  /** Name and address; a changed field is one audit row. */
  async function updateProvider(
    persona: AuthenticatedContext,
    id: string,
    patch: ProviderPatchInput,
  ): Promise<ProviderDetail> {
    const { by, at } = await mutating(persona);
    const row = await mustProvider(id);
    const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
    const next: { title?: string; baseUrl?: string } = {};
    if (patch.title !== undefined && patch.title.trim() !== row.title) {
      next.title = patch.title.trim();
      changes.push({ action: 'provider.title', details: { from: row.title, to: next.title } });
    }
    if (patch.baseUrl !== undefined) {
      const url = patch.baseUrl.replace(/\/+$/, '');
      if (url !== row.baseUrl) {
        next.baseUrl = url;
        changes.push({ action: 'provider.url', details: { from: row.baseUrl, to: url } });
      }
    }
    if (!changes.length) return providerDetail(row);
    await store.transaction(async tx => {
      await tx.updateProvider(id, next, by, at);
      for (const c of changes)
        await tx.writeAudit({ actor: by, action: c.action, subject: 'provider:' + id, at, details: c.details });
    });
    return providerDetail((await store.readProvider(id))!);
  }
  /** A new key, or none: sealed, dated, used from the next question on. The old one is gone. */
  async function rotateKey(
    persona: AuthenticatedContext,
    id: string,
    input: ProviderKeyInput,
  ): Promise<ProviderDetail> {
    const { by, at } = await mutating(persona);
    await mustProvider(id);
    const key = input.apiKey.trim();
    await store.transaction(async tx => {
      await tx.updateProvider(id, { apiKey: key ? sealer.seal(key, id) : null, keyChangedAt: at }, by, at);
      await tx.writeAudit({
        actor: by,
        action: 'provider.key',
        subject: 'provider:' + id,
        at,
        details: { key: !!key },
      });
    });
    return providerDetail((await store.readProvider(id))!);
  }
  /** "Testa" on a provider: the model list again, health recorded. */
  async function testProvider(persona: AuthenticatedContext, id: string): Promise<ProviderTestReport> {
    requireAdmin(persona);
    const row = await mustProvider(id);
    const report = await probeEndpoint(endpointOf(row), clock().toISOString());
    await record(id, report.health);
    return report;
  }
  /** A provider goes only once its models are gone, so no person's pick points at nothing. */
  async function removeProvider(persona: AuthenticatedContext, id: string): Promise<{ removed: true }> {
    const { by, at } = await mutating(persona);
    const row = await mustProvider(id);
    if ((await store.listModels()).some(m => m.providerId === id))
      throw new InputError('Ta bort leverantörens modeller först.');
    await store.transaction(async tx => {
      await tx.removeProvider(id);
      await tx.writeAudit({
        actor: by,
        action: 'provider.removed',
        subject: 'provider:' + id,
        at,
        details: { baseUrl: row.baseUrl },
      });
    });
    return { removed: true };
  }

  /** A model under a provider, by the id its endpoint uses. Clew's id is derived from it. It starts switched off. */
  async function addModel(persona: AuthenticatedContext, input: AddModelInput): Promise<ModelDetail> {
    const { by, at } = await mutating(persona);
    await mustProvider(input.providerId);
    const existing = await store.listModels();
    if (existing.some(m => m.providerId === input.providerId && m.model === input.model))
      throw new InputError('Modellen finns redan hos leverantören.');
    const id = slugFor(input.model, new Set(existing.map(m => m.id)));
    await store.transaction(async tx => {
      if (
        !(await tx.insertModel({
          id,
          providerId: input.providerId,
          model: input.model,
          title: (input.title ?? input.model).trim(),
          description: (input.description ?? '').trim(),
          tools: input.tools ?? true,
          createdBy: by,
          at,
        }))
      )
        throw new InputError('Modellen finns redan.');
      await tx.writeAudit({
        actor: by,
        action: 'model.added',
        subject: 'model:' + id,
        at,
        details: { provider: input.providerId, model: input.model },
      });
    });
    return modelDetail((await store.readModel(id))!);
  }
  /**
   * Name, description, the endpoint's id, on or off, the audience, the tools switch and the default. One audit row per
   * changed field. The default is one switched-on model: setting it clears the previous one (its own row says so), and
   * switching the default off clears its flag too.
   */
  async function updateModel(persona: AuthenticatedContext, id: string, patch: ModelPatchInput): Promise<ModelDetail> {
    const { by, at } = await mutating(persona);
    const row = await mustModel(id);
    const state = patch.state ?? row.state;
    if (patch.isDefault === true && state !== 'enabled')
      throw new InputError('Slå på modellen innan den blir standard.');
    const changes: Array<{ action: string; details: Record<string, unknown> }> = [];
    const next: Partial<ModelRecord> = {};
    const text = (key: 'title' | 'description' | 'model', value: string | undefined) => {
      if (value === undefined) return;
      const v = value.trim();
      if (v !== row[key]) {
        next[key] = v;
        changes.push({ action: 'model.' + key, details: { from: row[key], to: v } });
      }
    };
    text('title', patch.title);
    text('description', patch.description);
    text('model', patch.model);
    if (patch.state !== undefined && patch.state !== row.state) {
      next.state = patch.state;
      changes.push({ action: 'model.' + patch.state, details: { from: row.state } });
    }
    if (patch.audience !== undefined && JSON.stringify(patch.audience) !== JSON.stringify(row.audience)) {
      next.audience = patch.audience;
      changes.push({ action: 'model.audience', details: { from: row.audience, to: patch.audience } });
    }
    if (patch.tools !== undefined && patch.tools !== row.tools) {
      next.tools = patch.tools;
      changes.push({ action: 'model.tools', details: { to: patch.tools } });
    }
    const isDefault = patch.isDefault ?? (state === 'disabled' ? false : row.isDefault);
    if (isDefault !== row.isDefault) {
      next.isDefault = isDefault;
      changes.push({ action: 'model.default', details: { to: isDefault } });
    }
    if (
      next.model !== undefined &&
      (await store.listModels()).some(m => m.id !== id && m.providerId === row.providerId && m.model === next.model)
    )
      throw new InputError('Modellen finns redan hos leverantören.');
    if (!changes.length) return modelDetail(row);
    const previous =
      isDefault && !row.isDefault ? (await store.listModels()).find(m => m.isDefault && m.id !== id) : undefined;
    await store.transaction(async tx => {
      // The old default first: the database holds at most one flag at any moment.
      if (previous) {
        await tx.updateModel(previous.id, { isDefault: false }, by, at);
        await tx.writeAudit({
          actor: by,
          action: 'model.default',
          subject: 'model:' + previous.id,
          at,
          details: { to: false, replacedBy: id },
        });
      }
      await tx.updateModel(id, next, by, at);
      for (const c of changes)
        await tx.writeAudit({ actor: by, action: c.action, subject: 'model:' + id, at, details: c.details });
    });
    return modelDetail((await store.readModel(id))!);
  }
  /** "Testa" on a model: one tiny completion with its id and its provider's key. The provider's health follows. */
  async function testModel(persona: AuthenticatedContext, id: string): Promise<ProviderTestReport> {
    requireAdmin(persona);
    const row = await mustModel(id);
    const provider = await mustProvider(row.providerId);
    const at = clock().toISOString();
    let report: ProviderTestReport;
    try {
      await wire.ping(endpointOf(provider), row.model);
      report = {
        ok: true,
        models: [],
        health: { status: 'ok', at },
        findings: [{ level: 'ok', text: `${row.title} svarar.` }],
      };
    } catch (error) {
      const h = healthOf(error, at);
      const text =
        h.status === 'key-rejected'
          ? 'Nyckeln avvisas.'
          : h.status === 'unreachable'
            ? 'Leverantören svarar inte.'
            : 'Leverantören svarar men inte på den här modellen. Kontrollera modellens namn.';
      report = {
        ok: false,
        models: [],
        health: h.status === 'untested' ? { status: 'ok', at, detail: h.detail } : h,
        findings: [{ level: 'fail', text: h.detail ? `${text} (${h.detail})` : text }],
      };
    }
    await record(row.providerId, report.health);
    return report;
  }
  /** The model goes, and every person who had picked it falls back to the default. */
  async function removeModel(persona: AuthenticatedContext, id: string): Promise<{ removed: true }> {
    const { by, at } = await mutating(persona);
    const row = await mustModel(id);
    await store.transaction(async tx => {
      await tx.removeModel(id);
      await tx.writeAudit({
        actor: by,
        action: 'model.removed',
        subject: 'model:' + id,
        at,
        details: { provider: row.providerId, model: row.model, wasDefault: row.isDefault },
      });
    });
    return { removed: true };
  }

  /** The person's choices and the model their next question uses, from the rows as they are now. */
  async function choicesOf(persona: AuthenticatedContext) {
    const [models, providers, saved] = await Promise.all([
      store.listModels(),
      store.listProviders(),
      store.readChoice(persona.id),
    ]);
    const choices = choicesFor(models, new Set(providers.map(p => p.id)), actorOf(persona));
    return { choices, current: pickModel(choices, saved), providers };
  }
  /** What the composer reads (D8, D24): the person's models, the one in use, and whether its endpoint answers. */
  async function statusFor(persona: AuthenticatedContext): Promise<AssistantStatus> {
    const { choices, current } = await choicesOf(persona);
    return {
      configured: !!current,
      available: !!current && health.available(current.providerId),
      model: current?.title ?? null,
      checkedAt: current ? health.checkedAt(current.providerId) : null,
      current: current ? choiceOf(current) : null,
      choices: choices.map(choiceOf),
    };
  }
  /** The person picks a model in the composer, or goes back to the default with null. Only a model they may use. */
  async function choose(persona: AuthenticatedContext, modelId: string | null): Promise<AssistantStatus> {
    const at = clock().toISOString();
    if (modelId !== null && !(await choicesOf(persona)).choices.some(m => m.id === modelId))
      throw new InputError('Modellen finns inte.');
    await store.transaction(async tx => {
      await tx.setChoice(persona.id, modelId, at);
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'model.chosen',
        subject: 'person:' + persona.id,
        at,
        details: { model: modelId },
      });
    });
    return statusFor(persona);
  }
  /** The model one turn uses, with its key opened for this call only. */
  async function resolve(persona: AuthenticatedContext): Promise<ResolvedModel | undefined> {
    const { current, providers } = await choicesOf(persona);
    if (!current) return undefined;
    const provider = providers.find(p => p.id === current.providerId)!;
    return {
      id: current.id,
      title: current.title,
      providerId: provider.id,
      tools: current.tools,
      generate: wire.generator(endpointOf(provider), current.model),
    };
  }
  /** The minute probe (D8): every provider with a switched-on model, asked for its list. An endpoint without a list still answered. */
  async function probe(): Promise<void> {
    const [providers, models] = await Promise.all([store.listProviders(), store.listModels()]);
    for (const p of providers.filter(p => models.some(m => m.providerId === p.id && m.state === 'enabled'))) {
      const at = clock().toISOString();
      let h: ProviderHealth;
      try {
        await wire.listModels(endpointOf(p));
        h = { status: 'ok', at };
      } catch (error) {
        const found = healthOf(error, at);
        h = found.status === 'untested' ? { status: 'ok', at } : found;
      }
      health.mark(p.id, h.status === 'ok', at);
      if (h.status !== p.health.status) await store.recordHealth(p.id, h);
    }
  }
  return {
    list,
    readProvider,
    readModel,
    addProvider,
    updateProvider,
    rotateKey,
    testProvider,
    removeProvider,
    addModel,
    updateModel,
    testModel,
    removeModel,
    statusFor,
    choose,
    resolve,
    probe,
  };
}
export type ModelUsecases = ReturnType<typeof modelUsecases>;
