import { asc, eq } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { ModelRecord, ModelStore, ModelTx, ProviderRecord } from '../ports';

/** The model store the server runs (D24, D25): the port over Drizzle and Postgres. Held to the memory adapter by `tests/model-store-contract.ts`. */
const { modelProviders, models, modelChoices, audit } = schema;
const iso = (d: Date | null) => d ? d.toISOString() : null;
const providerOf = (row: typeof modelProviders.$inferSelect): ProviderRecord => ({
  id: row.id, title: row.title, baseUrl: row.baseUrl, apiKey: row.apiKey, keyChangedAt: iso(row.keyChangedAt), health: row.health,
  createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
});
const modelOf = (row: typeof models.$inferSelect): ModelRecord => ({
  id: row.id, providerId: row.providerId, model: row.model, title: row.title, description: row.description, state: row.state, audience: row.audience, isDefault: row.isDefault, tools: row.tools,
  createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
});
const txOf = (tx: Transaction): ModelTx => ({
  async insertProvider(r) {
    const inserted = await tx.insert(modelProviders).values({ id: r.id, title: r.title, baseUrl: r.baseUrl, apiKey: r.apiKey, keyChangedAt: r.apiKey ? new Date(r.at) : null, health: r.health,
      createdBy: r.createdBy, updatedBy: r.createdBy, createdAt: new Date(r.at), updatedAt: new Date(r.at) }).onConflictDoNothing().returning({ id: modelProviders.id });
    return inserted.length > 0;
  },
  async updateProvider(id, patch, by, at) {
    const [row] = await tx.select({ version: modelProviders.version }).from(modelProviders).where(eq(modelProviders.id, id));
    if (!row) return false;
    const { keyChangedAt, ...rest } = patch;
    await tx.update(modelProviders).set({ ...rest, ...(keyChangedAt !== undefined ? { keyChangedAt: keyChangedAt ? new Date(keyChangedAt) : null } : {}), updatedBy: by, updatedAt: new Date(at), version: row.version + 1 }).where(eq(modelProviders.id, id));
    return true;
  },
  async removeProvider(id) { await tx.delete(modelProviders).where(eq(modelProviders.id, id)); },
  async insertModel(r) {
    const inserted = await tx.insert(models).values({ id: r.id, providerId: r.providerId, model: r.model, title: r.title, description: r.description, tools: r.tools,
      createdBy: r.createdBy, updatedBy: r.createdBy, createdAt: new Date(r.at), updatedAt: new Date(r.at) }).onConflictDoNothing().returning({ id: models.id });
    return inserted.length > 0;
  },
  async updateModel(id, patch, by, at) {
    const [row] = await tx.select({ version: models.version }).from(models).where(eq(models.id, id));
    if (!row) return false;
    await tx.update(models).set({ ...patch, updatedBy: by, updatedAt: new Date(at), version: row.version + 1 }).where(eq(models.id, id));
    return true;
  },
  // The picks go with the model through the foreign key's ON DELETE CASCADE.
  async removeModel(id) { await tx.delete(models).where(eq(models.id, id)); },
  async setChoice(personId, modelId, at) {
    if (modelId === null) { await tx.delete(modelChoices).where(eq(modelChoices.personId, personId)); return; }
    await tx.insert(modelChoices).values({ personId, modelId, updatedAt: new Date(at) }).onConflictDoUpdate({ target: modelChoices.personId, set: { modelId, updatedAt: new Date(at) } });
  },
  async writeAudit(entry) { await tx.insert(audit).values({ actor: entry.actor, action: entry.action, subject: entry.subject, details: entry.details ?? {}, createdAt: new Date(entry.at) }); },
});
export function postgresModelStore(): ModelStore {
  return {
    async listProviders() { return (await database().select().from(modelProviders).orderBy(asc(modelProviders.id))).map(providerOf); },
    async readProvider(id) { const [row] = await database().select().from(modelProviders).where(eq(modelProviders.id, id)); return row ? providerOf(row) : undefined; },
    async listModels() { return (await database().select().from(models).orderBy(asc(models.createdAt), asc(models.id))).map(modelOf); },
    async readModel(id) { const [row] = await database().select().from(models).where(eq(models.id, id)); return row ? modelOf(row) : undefined; },
    async readChoice(personId) { const [row] = await database().select({ modelId: modelChoices.modelId }).from(modelChoices).where(eq(modelChoices.personId, personId)); return row?.modelId; },
    async recordHealth(providerId, health) { await database().update(modelProviders).set({ health }).where(eq(modelProviders.id, providerId)); },
    async history(subject) {
      const rows = await database().select().from(audit).where(eq(audit.subject, subject)).orderBy(asc(audit.id));
      return rows.map(r => ({ at: r.createdAt.toISOString(), actor: r.actor, action: r.action, details: r.details }));
    },
    transaction: fn => database().transaction(tx => fn(txOf(tx))),
  };
}
