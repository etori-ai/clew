import { Type, type Static } from '@sinclair/typebox';
import { ReceiptRowSchema, ViewRefSchema } from '@clew/contracts';
import { ErrandRefSchema, type ErrandProvider, type ErrandSummary } from '@clew/errands';
import { CapabilityError, type Actor, type ExecuteResult, type Module, type ThreadDraft } from '@clew/modules';

const area = 'arenden';
const Empty = Type.Object({}, { additionalProperties: false });
const RefInput = Type.Object({ ref: ErrandRefSchema }, { additionalProperties: false });
const AcknowledgeInput = Type.Object({
  ref: ErrandRefSchema, eventIds: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 50, uniqueItems: true }),
}, { additionalProperties: false });
const RowSchema = Type.Object({
  ref: ErrandRefSchema, label: Type.String(), status: Type.String(), phase: Type.Union([Type.String(), Type.Null()]),
  relationship: Type.String(), waitingOn: Type.Union([Type.String(), Type.Null()]),
  nextDeadline: Type.Union([Type.String(), Type.Null()]), unreadCount: Type.Integer(), view: ViewRefSchema,
}, { additionalProperties: false });
const ListSchema = Type.Object({ source: Type.String(), rows: Type.Array(RowSchema) });
const DetailSchema = Type.Object({
  source: Type.String(), errandNumber: Type.String(), title: Type.String(), description: Type.String(),
  category: Type.String(), type: Type.String(), status: Type.String(), phase: Type.Union([Type.String(), Type.Null()]),
  relationship: Type.String(), waitingOn: Type.Union([Type.String(), Type.Null()]), suspendedUntil: Type.Union([Type.String(), Type.Null()]),
  deadlines: Type.Array(Type.Object({ label: Type.String(), dueAt: Type.String() })),
  lastCommunication: Type.Union([Type.Object({ channel: Type.String(), direction: Type.String(), body: Type.String(), at: Type.String() }), Type.Null()]),
  unreadCount: Type.Integer(),
}, { additionalProperties: false });
const nextDeadline = (e: ErrandSummary) => e.deadlines.map(d => d.dueAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
const relationship = (e: ErrandSummary) => e.relationships.map(r => r === 'handler' ? 'Du handlägger' : 'Du har anmält').join(' · ');
const label = (e: ErrandSummary) => `${e.errandNumber} · ${e.category} · ${e.type}`;
const row = (e: ErrandSummary, source: string): Static<typeof RowSchema> => ({
  ref: e.ref, label: label(e), status: e.status.label, phase: e.phase, relationship: relationship(e),
  waitingOn: e.waitingOn, nextDeadline: nextDeadline(e), unreadCount: e.unreadEvents.length,
  view: { capability: 'errand.view', input: { ref: e.ref }, title: e.errandNumber, source },
});

/** First D18 slice. Source-shaped mock records stay behind the provider; generic Clew cards own presentation. */
export function errandModule(provider: ErrandProvider): Module {
  const source = provider.source;
  const scope = (actor: Actor) => provider.available(actor);
  const list = async (items: Promise<ErrandSummary[]>) => ({ source, rows: (await items).map(e => row(e, source)) });
  async function scan(actor: Actor): Promise<ThreadDraft[]> {
    if (!scope(actor)) return [];
    const summaries = new Map((await provider.mine(actor)).map(e => [e.ref, e]));
    for (const e of await provider.reported(actor)) summaries.set(e.ref, e);
    const drafts: ThreadDraft[] = [];
    for (const e of summaries.values()) {
      const unread = e.unreadEvents.length > 0;
      const waiting = !unread && e.relationships.includes('reporter') && !e.status.closed;
      if (!unread && !waiting) continue;
      const access = await provider.access(actor, e.ref);
      if (!access.read) continue;
      const eventIds = e.unreadEvents.map(event => event.id).sort();
      const title = waiting ? `${e.errandNumber} väntar på återkoppling` : `${e.errandNumber} har ${eventIds.length === 1 ? 'en ny händelse' : `${eventIds.length} nya händelser`}`;
      drafts.push({
        // A later source event gets a new topic; reading today's event cannot suppress tomorrow's.
        topic: `${e.ref}:${waiting ? 'waiting' : eventIds.join(':')}`, area, title,
        summary: `${e.category} · ${e.type}. ${e.status.label}. ${waiting ? 'Du har anmält ärendet.' : 'Läs detaljerna innan du markerar händelsen som läst.'}`,
        reason: waiting ? 'Du har ett öppet anmält ärende' : e.unreadEvents.map(event => event.label).join(' · '),
        waitingOn: waiting ? e.waitingOn ?? 'handläggaren' : null, deadline: waiting ? null : nextDeadline(e),
        items: [{ ref: e.ref, label: label(e), detail: e.status.label, selectable: false, selected: true }],
        actions: [
          ...(unread && access.acknowledge ? [{
            id: 'acknowledge', label: 'Markera som läst', capability: 'errand.acknowledge', kind: 'execute' as const,
            role: 'primary' as const, input: { ref: e.ref, eventIds },
          }] : []),
          { id: 'view', label: 'Visa ärendet', capability: 'errand.view', kind: 'read', role: 'secondary', target: 'panel', input: { ref: e.ref } },
        ],
      });
    }
    return drafts;
  }
  return {
    id: 'errand', kind: 'passthrough', source,
    areas: [{ id: area, title: 'Ärenden', roles: ['manager', 'employee'], standing: ['errand.mine', 'errand.reported'], schedules: [] }],
    scan,
    capabilities: [
      { name: 'errand.mine', kind: 'read', title: 'Ärenden jag handlägger', model: true,
        description: `Mina tilldelade ärenden, med status och tidsgränser. Källa: ${source}.`,
        input: Empty, output: ListSchema, scope, run: actor => list(provider.mine(actor)) },
      { name: 'errand.reported', kind: 'read', title: 'Ärenden jag har anmält', model: true,
        description: `Mina anmälda frågor, med status och nya svar. Källa: ${source}.`,
        input: Empty, output: ListSchema, scope, run: actor => list(provider.reported(actor)) },
      { name: 'errand.view', kind: 'read', title: 'Visa ärendet', model: false,
        description: `Läs ärendetext och senaste meddelandet i detaljvyn. Källa: ${source}. Fritext lämnas inte till modellen.`,
        input: RefInput, output: DetailSchema, scope,
        run: async (actor, input: Static<typeof RefInput>): Promise<Static<typeof DetailSchema>> => {
          if (!(await provider.access(actor, input.ref)).read) throw new CapabilityError('Du saknar behörighet till ärendet.');
          const e = await provider.get(actor, input.ref);
          return {
            source, errandNumber: e.errandNumber, title: e.title, description: e.description, category: e.category, type: e.type,
            status: e.status.label, phase: e.phase, relationship: relationship(e), waitingOn: e.waitingOn, suspendedUntil: e.suspendedUntil,
            deadlines: e.deadlines.map(d => ({ label: d.label, dueAt: d.dueAt })), lastCommunication: e.lastCommunication,
            unreadCount: e.unreadEvents.length,
          };
        } },
      { name: 'errand.acknowledge', kind: 'execute', title: 'Markera som läst', model: false,
        description: `Kvittera de visade händelserna i ${source}. Ärendets status ändras inte.`,
        input: AcknowledgeInput, output: Type.Object({ headline: Type.String(), rows: Type.Array(ReceiptRowSchema) }), scope,
        run: async (actor, input: Static<typeof AcknowledgeInput>): Promise<ExecuteResult> => {
          if (!(await provider.access(actor, input.ref)).acknowledge) throw new CapabilityError('Du får inte kvittera den här händelsen.');
          await provider.acknowledge(actor, input.ref, input.eventIds);
          let outcome: 'done' | 'unknown' = 'unknown';
          try {
            const current = await provider.get(actor, input.ref);
            if (input.eventIds.every(id => !current.unreadEvents.some(e => e.id === id))) outcome = 'done';
          } catch { /* A write without a successful read-back cannot be reported as confirmed. */ }
          return {
            headline: outcome === 'done' ? 'Händelsen är markerad som läst. Ärendet har samma status.' : 'Läsmarkeringen kunde inte kontrolleras. Läs om ärendet.',
            rows: [{ ref: input.ref, label: 'Ärendehändelse', outcome, detail: outcome === 'done' ? `Läst tillbaka från ${source}. Ärendet är inte avslutat av Startsidan.` : 'Resultatet är obekräftat.' }],
          };
        } },
    ],
  };
}
