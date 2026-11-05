import type { AuthenticatedContext } from '@clew/contracts';
import type { ScanObservation, ThreadDraft } from '@clew/connectors';
import { projectionVersion, type Occurrence, type RefreshDeps, type RefreshRequest } from '../refresh-model';

const assignment = (p: AuthenticatedContext) => p.unitId + ':' + p.role;
/** Reads request work and return immediately; only leased workers wait for a source. */
export function refreshUsecases({ store, clock, ids, key, current, sources, scan }: RefreshDeps) {
  async function request(persona: AuthenticatedContext) {
    await persona.authorize();
    const at = clock().toISOString(), scope = assignment(persona);
    for (const connector of await sources(persona)) await store.request({ id: key([persona.id, connector, scope, persona.authorizationVersion]), personId: persona.id, connector, assignment: scope,
      authorizationVersion: persona.authorizationVersion, state: 'pending', attempt: 0, requestedAt: at, nextAt: at, leaseUntil: null, lastSuccess: null, observedAt: null, error: null });
  }
  async function finish(job: RefreshRequest, baseline: Record<string, string>, result: ScanObservation | undefined, failure?: string) {
    const at = clock().toISOString(), observation = result?.observation;
    await store.transaction(async tx => {
      const row = await tx.lockRequest(job.id);
      if (!row || row.attempt !== job.attempt || row.state !== 'running') return;
      const observedAt = observation?.observedAt ?? at;
      let error = failure ?? (observation?.completeness === 'unavailable' || observation?.completeness === 'authorization-required' ? observation.completeness : null);
      if (observation && (observation.scope !== job.assignment || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.parse(at) + 300_000 || row.observedAt && observedAt < row.observedAt)) error = 'stale-observation';
      if (error || !result) {
        await tx.saveRequest({ ...row, state: error === 'authorization-required' ? 'blocked' : 'failed', error: error ?? 'unavailable', leaseUntil: null, nextAt: new Date(Date.parse(at) + 60_000).toISOString() });
        await tx.writeAudit({ actor: 'system:refresh', action: 'refresh.failed', subject: `refresh:${job.id}`, at, details: { reason: error ?? 'unavailable', connector: job.connector } }); return;
      }
      const existing = await tx.occurrences(job), seen = new Set<string>(), touched = new Set<string>();
      for (const d of result.drafts) {
        const identities = d.occurrences?.length ? d.occurrences : [{ key: d.topic, revision: key([d.title, d.summary, d.items, d.actions, d.deadline, d.waitingOn]), period: 'legacy' }];
        const occurrences = identities.map(o => {
          const id = key([job.personId, job.connector, job.assignment, o.key, o.period]); seen.add(id);
          const old = existing.find(x => x.id === id);
          return { old, value: { id, personId: job.personId, connector: job.connector, assignment: job.assignment, sourceKey: o.key, period: o.period, revision: o.revision, observedAt,
            sourceState: 'open', disposition: old?.disposition ?? 'visible', threadId: old?.threadId ?? null, legacy: !d.occurrences?.length } satisfies Occurrence };
        });
        const oldThreadId = occurrences.find(o => o.old?.threadId)?.old?.threadId;
        const topic = d.occurrences?.length ? `${d.topic}:${key([...new Set(identities.map(o => o.period))].sort())}` : d.topic;
        let thread = oldThreadId ? await tx.lockThread(job.personId, oldThreadId) : await tx.findTopic(job.personId, job.connector, topic);
        if (!thread && topic !== d.topic) {
          const legacy = await tx.findTopic(job.personId, job.connector, d.topic);
          if (legacy && !existing.some(o => o.threadId === legacy.id)) thread = legacy;
        }
        const changed = occurrences.some(o => o.old ? o.old.revision !== o.value.revision : !!oldThreadId);
        // An action accepted during this scan wins. A newer observation may try again on the next refresh.
        if (thread && (baseline[thread.id] !== projectionVersion(thread) || thread.execution && ['pending', 'running', 'unknown'].includes(thread.execution.state))) continue;
        if (thread?.state === 'dismissed' && !changed) {
          for (const o of occurrences) await tx.saveOccurrence({ ...o.value, threadId: thread.id, disposition: 'dismissed' });
          continue;
        }
        if (thread?.receipt) {
          // Retain the historical receipt. Unchanged observations cannot manufacture another action.
          if (!changed) { for (const o of occurrences) await tx.saveOccurrence({ ...o.value, threadId: thread.id }); continue; }
          thread = undefined;
        }
        if (!thread) {
          const id = ids();
          if (!await tx.insertThread({ id, personId: job.personId, kind: 'pushed', topic, connector: job.connector, area: d.area, state: 'open', title: d.title, summary: d.summary,
            week: null, actions: d.actions, items: d.items ?? [], waitingOn: d.waitingOn ?? null, deadline: d.deadline ?? null, trigger: { reason: d.reason, source: job.connector, at }, createdAt: at, updatedAt: at })) continue;
          thread = (await tx.lockThread(job.personId, id))!;
          await tx.addMessage(id, { role: 'assistant', body: d.summary, at });
          if (!d.waitingOn) await tx.admitDelivery({ id: `work:${key(occurrences.map(o => [o.value.id, o.value.revision]))}`, personId: job.personId, threadId: id, kind: 'automatic', at });
          await tx.writeAudit({ actor: 'assistant:scan', action: 'thread.pushed', subject: `thread:${id}`, at, details: { connector: job.connector, occurrences: occurrences.map(o => o.value.id), owner: job.personId } });
        } else {
          const items = (d.items ?? []).map(i => ({ ...i, selected: thread!.items.find(x => x.ref === i.ref)?.selected ?? i.selected }));
          if (!observation || observation.completeness === 'partial') items.push(...thread.items.filter(i => !items.some(x => x.ref === i.ref)));
          if (changed || key([thread.title, thread.summary, thread.items, thread.actions, thread.deadline, thread.waitingOn]) !== key([d.title, d.summary, items, d.actions, d.deadline ?? null, d.waitingOn ?? null])) {
            await tx.updateThread(thread.id, { title: d.title, summary: d.summary, items, actions: d.actions, deadline: d.deadline ?? null, waitingOn: d.waitingOn ?? null, updatedAt: at,
              ...(changed ? { state: 'open', handledAt: null, snoozedUntil: null, trigger: { reason: 'Källan har ändrat uppgiften. ' + d.reason, source: thread.trigger.source, at } } : {}) });
            if (changed) await tx.cancelTimer(`snooze:${thread.id}`, at);
            if (changed && !d.waitingOn) await tx.admitDelivery({ id: `work:${key(occurrences.map(o => [o.value.id, o.value.revision]))}`, personId: job.personId, threadId: thread.id, kind: 'automatic', at });
            await tx.writeAudit({ actor: 'assistant:scan', action: 'thread.refreshed', subject: `thread:${thread.id}`, at, details: { materialChange: changed, connector: job.connector } });
          }
        }
        touched.add(thread.id);
        for (const o of occurrences) await tx.saveOccurrence({ ...o.value, threadId: thread.id, disposition: 'visible' });
      }
      const complete = observation?.completeness === 'complete' && observation.exhausted;
      const tombstones = observation?.completeness === 'delta' ? observation.tombstones ?? [] : [];
      for (const o of existing.filter(o => !seen.has(o.id) && (complete && !o.legacy || tombstones.some(t => t.key === o.sourceKey && t.period === o.period)))) {
        if (o.sourceState === 'resolved') continue;
        const t = o.threadId ? await tx.lockThread(job.personId, o.threadId) : undefined;
        if (t && (!touched.has(t.id) && baseline[t.id] !== projectionVersion(t) || t.execution && ['pending', 'running', 'unknown'].includes(t.execution.state))) continue;
        await tx.saveOccurrence({ ...o, sourceState: 'resolved', observedAt });
        await tx.writeAudit({ actor: 'system:refresh', action: 'work.resolved', subject: `occurrence:${o.id}`, at, details: { connector: job.connector } });
      }
      const after = await tx.occurrences(job);
      for (const threadId of [...new Set(after.filter(o => o.threadId).map(o => o.threadId!))]) {
        if (after.some(o => o.threadId === threadId && o.sourceState === 'open')) continue;
        const t = await tx.lockThread(job.personId, threadId);
        if (t?.state !== 'open' || t.receipt || t.execution && ['pending', 'running', 'unknown'].includes(t.execution.state)) continue;
        await tx.updateThread(threadId, { state: 'handled', handledAt: at, waitingOn: null, updatedAt: at });
        await tx.writeAudit({ actor: 'system:refresh', action: 'thread.source_resolved', subject: `thread:${threadId}`, at });
      }
      await tx.saveRequest({ ...row, state: 'complete', error: null, observedAt, lastSuccess: at, leaseUntil: null, nextAt: new Date(Date.parse(at) + 60_000).toISOString() });
      await tx.writeAudit({ actor: 'system:refresh', action: 'refresh.completed', subject: `refresh:${job.id}`, at, details: { connector: job.connector, complete, count: result.drafts.length } });
    });
  }
  async function tick() {
    const at = clock().toISOString(), job = await store.claim(at, new Date(Date.parse(at) + 30_000).toISOString());
    if (!job) return false;
    const baseline = await store.baseline(job);
    let result: ScanObservation | undefined, error: string | undefined;
    try {
      const persona = await current(job.personId);
      if (!persona || persona.authorizationVersion !== job.authorizationVersion || assignment(persona) !== job.assignment || !(await sources(persona)).includes(job.connector)) error = 'authorization-required';
      else {
        await persona.authorize(); result = await scan(persona, job.connector);
        const latest = await current(job.personId);
        if (!latest || latest.authorizationVersion !== job.authorizationVersion || !(await sources(latest)).includes(job.connector)) error = 'authorization-required';
      }
    } catch { error = 'unavailable'; }
    await finish(job, baseline, result, error); return true;
  }
  async function statuses(persona: AuthenticatedContext) {
    const allowed = await sources(persona);
    return (await store.statuses(persona.id)).filter(r => allowed.includes(r.connector) && r.authorizationVersion === persona.authorizationVersion && r.assignment === assignment(persona))
      .map(r => ({ connector: r.connector, state: r.state, lastSuccess: r.lastSuccess, error: r.error }));
  }
  return { request, tick, finish, statuses };
}
