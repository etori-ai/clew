import Ajv from 'ajv';
import type { AuthenticatedContext, McpRegistration, McpResult, McpService } from '@clew/contracts';
import { ForbiddenError, InputError } from '../context';
import type { McpDeps, McpSession } from './ports';
import { appUri, atPointer, watchEvidence } from './domain';

export function mcpUsecases(deps: McpDeps) {
  const { store } = deps;
  const allowed = async (p: AuthenticatedContext) => deps.enabled && (await deps.configured(p));
  async function registration(p: AuthenticatedContext, id: string) {
    if (!(await allowed(p))) throw new ForbiddenError('Tjänster i samtalet kräver en aktiverad AI-modell.');
    await p.authorize();
    const row = (await store.registrations(p.id)).find(r => r.id === id && r.enabled);
    if (!row) throw new ForbiddenError('Tjänsten är inte tillgänglig.');
    return row;
  }
  const service = (r: McpRegistration, s: McpSession): McpService => ({
    id: r.id,
    title: s.title,
    intervalSeconds: r.watch.intervalSeconds,
    tools: s.tools.filter(t => r.readTools.includes(t.name) || r.writeTools.includes(t.name)),
  });
  function validate(s: McpSession, name: string, args: Record<string, unknown>) {
    const tool = s.tools.find(t => t.name === name);
    if (!tool || !new Ajv({ strict: false }).compile(tool.inputSchema)(args))
      throw new InputError('Åtgärden eller uppgifterna är inte giltiga.');
    return tool;
  }
  async function withSession<T>(
    p: AuthenticatedContext,
    id: string,
    run: (r: McpRegistration, s: McpSession) => Promise<T>,
  ) {
    const r = await registration(p, id);
    const s = await deps.connect(r.url);
    try {
      return await run(r, s);
    } finally {
      await s.close();
    }
  }
  async function resolveAttention(p: AuthenticatedContext, r: McpRegistration, result: McpResult) {
    const evidence = watchEvidence(r.watch, result);
    if (!evidence || evidence.eligible) return;
    await registration(p, r.id);
    const deliveryId = deps.digest([r.id, deps.digest(evidence.identity)]);
    await store.transaction(async tx => {
      if (await tx.resolve(p.id, r.id, deliveryId, deps.clock().toISOString()))
        await tx.audit(p.principal.id, 'mcp.resolved', deliveryId);
    });
  }
  async function refreshAttention(p: AuthenticatedContext, r: McpRegistration, s: McpSession) {
    // Completion is defined by the operator's existing read rule, never by a tool name or the write receipt.
    // A refresh failure must not turn a successful source write into an ambiguous outcome.
    try {
      await registration(p, r.id);
      if (!r.readTools.includes(r.watch.tool)) return;
      validate(s, r.watch.tool, r.watch.arguments);
      await resolveAttention(p, r, await s.call(r.watch.tool, r.watch.arguments));
    } catch {
      // Leave attention intact; the durable watch will check again without repeating the mutation.
    }
  }
  async function inbox(p: AuthenticatedContext) {
    if (!(await allowed(p))) return { services: [], deliveries: [] };
    await p.authorize();
    const rows = (await store.registrations(p.id)).filter(r => r.enabled);
    const services = await Promise.all(
      rows.map(async r => {
        try {
          return await withSession(p, r.id, async (row, s) => service(row, s));
        } catch {
          return { id: r.id, title: 'Tjänsten kan inte nås', tools: [], intervalSeconds: r.watch.intervalSeconds };
        }
      }),
    );
    await p.authorize();
    if (!(await allowed(p))) return { services: [], deliveries: [] };
    return {
      services,
      deliveries: await store.deliveries(
        p.id,
        rows.map(r => r.id),
      ),
    };
  }
  async function view(p: AuthenticatedContext, id: string, deliveryId?: string) {
    return withSession(p, id, async (r, s) => {
      const delivery = deliveryId ? await store.delivery(p.id, id, deliveryId) : undefined;
      if (deliveryId && !delivery) throw new InputError('Kortet finns inte längre.');
      if (!r.readTools.includes(r.watch.tool)) throw new ForbiddenError();
      const tool = validate(s, r.watch.tool, r.watch.arguments);
      const result = await s.call(tool.name, r.watch.arguments);
      await resolveAttention(p, r, result);
      if (delivery) {
        const values = r.watch.identity.map(pointer => atPointer(result.structuredContent, pointer));
        if (
          result.isError ||
          values.some(v => v === undefined) ||
          deps.digest([id, deps.digest(values)]) !== delivery.id
        ) {
          await registration(p, id);
          return {
            service: service(r, s),
            result: { content: [{ type: 'text', text: delivery.text }] },
            isCurrent: false,
          };
        }
      }
      const uri = appUri(tool);
      const html = uri && !result.isError ? await s.resource(uri) : undefined;
      await registration(p, id);
      return { service: service(r, s), result, isCurrent: true, ...(html ? { html } : {}) };
    });
  }
  /** Only the human endpoint calls this. An uncertain result is never automatically dispatched again. */
  async function decide(
    p: AuthenticatedContext,
    id: string,
    decisionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpResult> {
    return withSession(p, id, async (r, s) => {
      if (!r.writeTools.includes(name)) throw new ForbiddenError();
      validate(s, name, args);
      const digest = deps.fingerprint({ id, name, args });
      const prior = await store.decision(p.id, decisionId);
      if (prior) {
        if (prior.digest !== digest || prior.connectionId !== id)
          throw new InputError('Bekräftelsen gäller en annan åtgärd.');
        if (prior.result) {
          if (!prior.result.isError) await refreshAttention(p, r, s);
          await registration(p, id);
          return prior.result;
        }
        throw new InputError('Svaret från tjänsten är osäkert. Kontrollera hos tjänsten innan du försöker igen.');
      }
      await registration(p, id);
      const decision = {
        id: decisionId,
        personId: p.id,
        connectionId: id,
        digest,
        state: 'unknown' as const,
        result: null,
      };
      const claimed = await store.transaction(async tx => {
        if (!(await tx.claim(decision))) return false;
        await tx.audit(p.principal.id, 'mcp.approved', decisionId);
        return true;
      });
      if (!claimed) throw new InputError('Åtgärden har redan bekräftats.');
      // No retry: MCP annotations are not an idempotency contract.
      let result: McpResult;
      try {
        result = await s.call(name, args);
      } catch {
        throw new InputError('Svaret från tjänsten är osäkert. Kontrollera hos tjänsten innan du försöker igen.');
      }
      await store.transaction(async tx => {
        await tx.finish({ ...decision, result, state: result.isError ? 'failed' : 'succeeded' });
        await tx.audit(p.principal.id, result.isError ? 'mcp.failed' : 'mcp.succeeded', decisionId);
      });
      if (!result.isError) await refreshAttention(p, r, s);
      await registration(p, id);
      return result;
    });
  }
  /** Temporal carries only the registration id; every read rechecks the person's current model and access. */
  async function observe(id: string): Promise<number | null> {
    if (!deps.enabled) return null;
    const row = (await store.registrations()).find(r => r.id === id && r.enabled);
    if (!row) return null;
    const p = await deps.current(row.personId);
    const interval = Math.max(30, row.watch.intervalSeconds);
    if (!p || !(await allowed(p))) return interval;
    await withSession(p, id, async (r, s) => {
      if (!r.readTools.includes(r.watch.tool)) throw new ForbiddenError();
      validate(s, r.watch.tool, r.watch.arguments);
      const result = await s.call(r.watch.tool, r.watch.arguments);
      const evidence = watchEvidence(r.watch, result);
      if (!evidence) throw new InputError('Tjänstens svar saknar uppgifter för att kontrollera kortet.');
      const key = deps.digest(evidence.identity);
      const deliveryId = deps.digest([id, key]);
      const { eligible } = evidence;
      await registration(p, id);
      await store.transaction(async tx => {
        // The source identity may stay the same when its eligibility changes (for example, an answer).
        if (!eligible && (await tx.resolve(p.id, id, deliveryId, deps.clock().toISOString())))
          await tx.audit(p.principal.id, 'mcp.resolved', deliveryId);
        if (r.lastKey === key) return;
        await tx.observe(id, key);
        await tx.audit(p.principal.id, 'mcp.observed', id);
        if (!eligible || (!r.lastKey && !r.watch.deliverInitial)) return;
        const inserted = await tx.deliver(p.id, {
          id: deliveryId,
          connectionId: id,
          title: s.title,
          text: result.content
            .filter(c => c.type === 'text')
            .map(c => c.text ?? '')
            .join('\n')
            .slice(0, 2000),
          createdAt: deps.clock().toISOString(),
        });
        if (inserted) await tx.audit(p.principal.id, 'mcp.delivered', id);
      });
    });
    return interval;
  }
  return { inbox, view, decide, observe };
}
