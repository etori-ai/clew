import type { AuthenticatedContext, Thread } from '@clew/contracts';
import type { AuditEntry, CalendarBinder, ProposalRecord } from '../model';
import { InputError } from '../../../context';
import { nextCheck, nextReminderAt, returnAt, waitingOnInvitee } from './obligation';

export interface FollowupPolicy {
  threadId: string; personId: string; unitId: string; authorizationVersion: string; executionId: string; proposalIds: string[];
  maxReminders: number; afterWorkdays: number; expiresAt: string; state: 'active' | 'blocked' | 'cancelled' | 'finished'; reason: string | null;
}
export interface FollowupSnapshot { policy?: FollowupPolicy; thread: Thread; proposals: ProposalRecord[]; timer?: { generation: number; dueAt: string; state: string } }
export interface FollowupTx {
  load(threadId: string): Promise<FollowupSnapshot | undefined>;
  save(policy: FollowupPolicy): Promise<void>;
  schedule(policy: FollowupPolicy, dueAt: string, at: string): Promise<void>;
  stop(threadId: string, at: string, reason: string): Promise<void>;
  deliver(personId: string, proposal: ProposalRecord, ordinal: number, sender: string, at: string): Promise<void>;
  recordReminder(proposal: ProposalRecord, at: string): Promise<void>;
  returnThread(threadId: string, at: string, reason: string): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}
export interface FollowupStore { read(threadId: string): Promise<FollowupSnapshot | undefined>; transaction<T>(fn: (tx: FollowupTx) => Promise<T>): Promise<T> }
export function followupUsecases(deps: { store: FollowupStore; current(id: string): Promise<AuthenticatedContext | undefined>; bind: CalendarBinder; readReplies(id: string): Promise<unknown>; clock: () => Date }) {
  const { store, clock } = deps;
  async function fire(threadId: string, generation: number) {
    const start = await store.read(threadId), policy = start?.policy, at = clock().toISOString();
    if (!policy || policy.state !== 'active' || start?.timer?.generation !== generation || start.timer.state !== 'active' || start.timer.dueAt > at) return;
    const persona = await deps.current(policy.personId);
    let allowed = !!persona && persona.unitId === policy.unitId && persona.authorizationVersion === policy.authorizationVersion;
    if (allowed) {
      try { await persona!.authorize(); } catch { allowed = false; }
      if (allowed) { await deps.readReplies(threadId); try { await persona!.authorize(); } catch { allowed = false; } }
    }
    const members = allowed ? deps.bind(persona!).members : [];
    await store.transaction(async tx => {
      const current = await tx.load(threadId);
      if (!current?.policy || current.policy.state !== 'active' || current.timer?.generation !== generation || current.timer.state !== 'active') return;
      if (!allowed) {
        await tx.save({ ...current.policy, state: 'blocked', reason: 'authority-revoked' }); await tx.stop(threadId, at, 'authority-revoked');
        await tx.returnThread(threadId, at, 'authority-revoked');
        await tx.audit({ actor: 'assistant:obligation', action: 'obligation.blocked', subject: `thread:${threadId}`, at, details: { generation, reason: 'authority-revoked' } }); return;
      }
      if (current.policy.expiresAt <= at) {
        await tx.save({ ...current.policy, state: 'finished', reason: 'expired' }); await tx.stop(threadId, at, 'expired');
        await tx.returnThread(threadId, at, 'expired');
        await tx.audit({ actor: 'assistant:obligation', action: 'obligation.returned', subject: `thread:${threadId}`, at, details: { generation, reason: 'expired' } }); return;
      }
      // Do not infer success or send follow-ups while source effects or compensation remain uncertain.
      if (current.thread.execution && ['pending', 'running', 'unknown'].includes(current.thread.execution.state)) {
        await tx.schedule(current.policy, nextCheck(at), at);
        await tx.audit({ actor: 'assistant:obligation', action: 'obligation.waiting_for_evidence', subject: `thread:${threadId}`, at, details: { generation } }); return;
      }
      const waiting = current.proposals.filter(p => current.policy!.proposalIds.includes(p.id) && waitingOnInvitee(p));
      if (!waiting.length || returnAt(waiting, at) <= at) {
        await tx.save({ ...current.policy, state: 'finished' }); await tx.stop(threadId, at, 'finished');
        await tx.returnThread(threadId, at, waiting.length ? 'deadline' : 'answered');
        await tx.audit({ actor: 'assistant:obligation', action: 'obligation.returned', subject: `thread:${threadId}`, at, details: { generation, waiting: waiting.length } }); return;
      }
      const delivered: string[] = [];
      for (const p of waiting) {
        const due = nextReminderAt(p, at), member = members.find(m => m.email.toLowerCase() === p.participant.email.toLowerCase());
        if (!member || p.reminders >= current.policy.maxReminders || !due || due > at) continue;
        await tx.deliver(member.personId, p, p.reminders + 1, persona!.name, at);
        await tx.recordReminder(p, at); delivered.push(p.id);
      }
      await tx.schedule(current.policy, nextCheck(at), at);
      await tx.audit({ actor: 'assistant:obligation', action: 'obligation.checked', subject: `thread:${threadId}`, at, details: { generation, delivered, maxReminders: policy.maxReminders } });
    });
  }
  async function remindNow(persona: AuthenticatedContext, threadId: string) {
    await persona.authorize();
    const at = clock().toISOString(), members = deps.bind(persona).members;
    await store.transaction(async tx => {
      const current = await tx.load(threadId);
      if (!current || current.policy?.personId !== persona.id) throw new InputError('Kortet saknar en godkänd uppföljningsplan.');
      if (current.thread.execution && ['pending', 'running', 'unknown'].includes(current.thread.execution.state)) throw new InputError('Invänta kalenderns besked först.');
      const waiting = current.proposals.filter(p => current.policy!.proposalIds.includes(p.id) && waitingOnInvitee(p));
      const eligible = waiting.filter(p => p.reminders < current.policy!.maxReminders);
      if (!eligible.length) throw new InputError('Den godkända gränsen för påminnelser är nådd.');
      const legacy = current.policy.state === 'blocked' && current.policy.reason === 'legacy-unverified';
      if (current.policy.expiresAt <= at || current.policy.state === 'cancelled' || current.policy.state === 'finished' || !legacy && (current.policy.unitId !== persona.unitId || current.policy.authorizationVersion !== persona.authorizationVersion)) throw new InputError('Uppföljningsplanen gäller inte längre.');
      const delivered: string[] = [];
      for (const p of eligible) {
        const member = members.find(m => m.email.toLowerCase() === p.participant.email.toLowerCase());
        if (!member) continue;
        await tx.deliver(member.personId, p, p.reminders + 1, persona.name, at); await tx.recordReminder(p, at);
        delivered.push(p.id);
      }
      if (!delivered.length) throw new InputError('Ingen mottagare hör längre till din enhet.');
      await tx.audit({ actor: persona.principal.id, action: 'obligation.reminded', subject: `thread:${threadId}`, at, details: { proposals: delivered, maxReminders: current.policy.maxReminders, legacy, automaticPolicyResumed: false } });
    });
    return (await store.read(threadId))!.thread;
  }
  return { fire, remindNow, hasPolicy: async (threadId: string) => !!(await store.read(threadId))?.policy };
}
