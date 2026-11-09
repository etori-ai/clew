import type { ModelReasoning } from '@clew/contracts';
import type { ModelGenerate } from '../model';
import type {
  AuditEntry,
  Endpoint,
  ModelHealth,
  ModelRecord,
  ModelStore,
  ModelTx,
  ModelWire,
  ProviderRecord,
} from '../ports';
import { WireError } from '../ports';

/**
 * The model ports in memory (D24, D25): the unit tests' adapters. `memoryModelStore` keeps the same contract as Postgres,
 * held to it by `tests/model-store-contract.ts`; a transaction is a snapshot and a throw rolls every write back, the
 * audit row included. `memoryModelWire` is an endpoint the test plays; `memoryModelHealth` is the in-process view.
 */
export interface MemoryModelStore extends ModelStore {
  audit: AuditEntry[];
  choices: Map<string, string>;
}
export function memoryModelStore(): MemoryModelStore {
  let providers = new Map<string, ProviderRecord>();
  let models = new Map<string, ModelRecord>();
  let choices = new Map<string, string>();
  const self: MemoryModelStore = {
    audit: [],
    choices,
    async listProviders() {
      return [...providers.values()].sort((a, b) => a.id.localeCompare(b.id)).map(r => structuredClone(r));
    },
    async readProvider(id) {
      const r = providers.get(id);
      return r ? structuredClone(r) : undefined;
    },
    async listModels() {
      return [...models.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(r => structuredClone(r));
    },
    async readModel(id) {
      const r = models.get(id);
      return r ? structuredClone(r) : undefined;
    },
    async readChoice(personId) {
      return choices.get(personId);
    },
    async recordHealth(providerId, health) {
      const r = providers.get(providerId);
      if (r) r.health = structuredClone(health);
    },
    async history(subject) {
      return self.audit
        .filter(a => a.subject === subject)
        .map(a => ({ at: a.at, actor: a.actor, action: a.action, details: a.details ?? {} }));
    },
    async transaction(fn) {
      const snapshot = {
        providers: structuredClone(providers),
        models: structuredClone(models),
        choices: new Map(choices),
        audit: [...self.audit],
      };
      const tx: ModelTx = {
        async insertProvider(r) {
          if (providers.has(r.id)) return false;
          providers.set(r.id, {
            id: r.id,
            title: r.title,
            baseUrl: r.baseUrl,
            apiKey: r.apiKey,
            keyChangedAt: r.apiKey ? r.at : null,
            health: structuredClone(r.health),
            createdBy: r.createdBy,
            updatedBy: r.createdBy,
            createdAt: r.at,
            updatedAt: r.at,
            version: 1,
          });
          return true;
        },
        async updateProvider(id, patch, by, at) {
          const r = providers.get(id);
          if (!r) return false;
          Object.assign(r, structuredClone(patch), { updatedBy: by, updatedAt: at, version: r.version + 1 });
          return true;
        },
        async removeProvider(id) {
          if ([...models.values()].some(m => m.providerId === id))
            throw new Error('model_provider_id_model_provider_id_fk');
          providers.delete(id);
        },
        async insertModel(r) {
          if (models.has(r.id)) return false;
          if (!providers.has(r.providerId)) throw new Error('model_provider_id_model_provider_id_fk');
          models.set(r.id, {
            id: r.id,
            providerId: r.providerId,
            model: r.model,
            title: r.title,
            description: r.description,
            state: 'disabled',
            audience: { mode: 'all' },
            isDefault: false,
            tools: r.tools,
            reasoning: 'provider-default',
            createdBy: r.createdBy,
            updatedBy: r.createdBy,
            createdAt: r.at,
            updatedAt: r.at,
            version: 1,
          });
          return true;
        },
        async updateModel(id, patch, by, at) {
          const r = models.get(id);
          if (!r) return false;
          // The partial unique index: at most one default at any moment.
          if (patch.isDefault && [...models.values()].some(m => m.id !== id && m.isDefault))
            throw new Error('model_one_default');
          Object.assign(r, structuredClone(patch), { updatedBy: by, updatedAt: at, version: r.version + 1 });
          return true;
        },
        async removeModel(id) {
          models.delete(id);
          for (const [person, model] of choices) if (model === id) choices.delete(person);
        },
        async setChoice(personId, modelId) {
          if (modelId === null) {
            choices.delete(personId);
            return;
          }
          if (!models.has(modelId)) throw new Error('model_choice_model_id_model_id_fk');
          choices.set(personId, modelId);
        },
        async writeAudit(entry) {
          self.audit.push(structuredClone(entry));
        },
      };
      try {
        return await fn(tx);
      } catch (error) {
        providers = snapshot.providers;
        models = snapshot.models;
        choices.clear();
        for (const [k, v] of snapshot.choices) choices.set(k, v);
        self.audit.length = 0;
        self.audit.push(...snapshot.audit);
        throw error;
      }
    },
  };
  return self;
}
/** Which endpoints answer, in memory: unknown counts as worth trying. The live adapter is the same object. */
export function memoryModelHealth(): ModelHealth & { state: Map<string, { ok: boolean; at: string }> } {
  const state = new Map<string, { ok: boolean; at: string }>();
  return {
    state,
    available: providerId => state.get(providerId)?.ok ?? true,
    checkedAt: providerId => state.get(providerId)?.at ?? null,
    mark(providerId, ok, at) {
      state.set(providerId, { ok, at });
    },
  };
}
interface WireCall {
  kind: 'list' | 'ping' | 'generate';
  baseUrl: string;
  apiKey?: string;
  model?: string;
  reasoning?: ModelReasoning;
}
/**
 * An OpenAI-compatible endpoint the test plays. `endpoints` maps a base URL to what it lists and which key it wants;
 * `generate` answers every turn. Calls are recorded with the key and the reasoning they carried, so a test can see a key
 * was opened. `refusesReasoningTools` plays a model that takes tools only when told not to reason (D84).
 */
export function memoryModelWire(
  options: {
    endpoints?: Record<
      string,
      { models?: string[]; key?: string; down?: boolean; noList?: boolean; refusesReasoningTools?: boolean }
    >;
    generate?: ModelGenerate;
  } = {},
): ModelWire & { calls: WireCall[] } {
  const calls: WireCall[] = [];
  const endpoints = options.endpoints ?? {};
  const answer = (e: Endpoint) => {
    const found = endpoints[e.baseUrl];
    if (!found || found.down) throw new WireError('unreachable', 'ECONNREFUSED');
    if (found.key && found.key !== e.apiKey) throw new WireError('key-rejected', '401');
    return found;
  };
  return {
    calls,
    async listModels(e) {
      calls.push({ kind: 'list', baseUrl: e.baseUrl, ...(e.apiKey ? { apiKey: e.apiKey } : {}) });
      const found = answer(e);
      if (found.noList) throw new WireError('unsupported', '404');
      return [...(found.models ?? [])];
    },
    async ping(e, model, { tools, reasoning }) {
      calls.push({ kind: 'ping', baseUrl: e.baseUrl, model, reasoning, ...(e.apiKey ? { apiKey: e.apiKey } : {}) });
      const found = answer(e);
      if (found.models && !found.models.includes(model)) throw new WireError('unsupported', 'model not found');
      if (found.refusesReasoningTools && tools && reasoning !== 'none')
        throw new WireError('unsupported', 'tools with reasoning are not supported');
    },
    generator(e, model, reasoning) {
      return async request => {
        calls.push({
          kind: 'generate',
          baseUrl: e.baseUrl,
          model,
          reasoning,
          ...(e.apiKey ? { apiKey: e.apiKey } : {}),
        });
        answer(e);
        if (!options.generate) throw new WireError('unsupported', 'no generate in this test');
        return options.generate(request);
      };
    },
  };
}
