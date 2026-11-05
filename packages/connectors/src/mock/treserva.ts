import { completeSnapshot } from '../scan';
import { Type } from '@sinclair/typebox';
import type { Actor, Capability, ExecuteResult, Connector, ThreadDraft } from '../index';
import type { StateStore } from '../memory-state';
import { deviations, employees, managerOf, shortDate, UNIT } from './data';

/** Mock Treserva (deviations and incidents). Pass-through: reports are filed here, Clew keeps the thread. */
const CONNECTOR = 'treserva';
const isManagerOf = (actor: Actor) => actor.role === 'manager' && managerOf[UNIT] === actor.id;
const own = (actor: Actor) => employees.find(e => e.personId === actor.id);
const Empty = Type.Object({}, { additionalProperties: false });
interface Report { ref: string; by: string; unitId: string; title: string; text: string; at: string; }

export function treservaConnector(state: StateStore): Connector {
  const reports = () => state.get<Report[]>(CONNECTOR, 'reports', []);
  const capabilities: Capability<any, any>[] = [
    {
      name: 'treserva.deviations', kind: 'read', title: 'Avvikelser och tillbud', model: true, description: 'Öppna avvikelser och tillbud i enheten, med vad de väntar på.',
      input: Empty, output: Type.Object({ rows: Type.Array(Type.Object({ ref: Type.String(), title: Type.String(), state: Type.String(), waitingOn: Type.Optional(Type.String()), dueBy: Type.Optional(Type.String()) })) }),
      scope: actor => isManagerOf(actor) || !!own(actor),
      run: async (actor) => {
        const filed = await reports();
        const rows = deviations.filter(d => d.unitId === UNIT && d.state !== 'closed' && (isManagerOf(actor) || d.reportedBy === own(actor)?.ref))
          .map(d => ({ ref: d.ref, title: d.title, state: d.state, waitingOn: d.waitingOn, dueBy: d.dueBy }));
        for (const r of filed.filter(r => isManagerOf(actor) || r.by === own(actor)?.ref)) rows.push({ ref: r.ref, title: r.title, state: 'open', waitingOn: 'chefens bedömning', dueBy: undefined });
        return { rows };
      },
    },
    {
      name: 'treserva.report', kind: 'execute', title: 'Rapportera avvikelse', model: false, description: 'Skapar en avvikelserapport i Treserva.',
      input: Type.Object({ title: Type.String({ minLength: 3, maxLength: 120 }), text: Type.String({ minLength: 3, maxLength: 2000 }) }, { additionalProperties: false }), output: Type.Any(),
      scope: actor => !!own(actor) || isManagerOf(actor),
      run: async (actor, input: { title: string; text: string }): Promise<ExecuteResult> => {
        const filed = await reports(); const ref = `treserva:dev:${new Date().getFullYear()}-${1200 + filed.length}`;
        filed.push({ ref, by: own(actor)?.ref ?? actor.id, unitId: UNIT, title: input.title, text: input.text, at: new Date().toISOString() });
        await state.set(CONNECTOR, 'reports', filed);
        return { headline: 'Avvikelsen är skickad till Treserva. Din chef får den i sitt flöde.', rows: [{ ref, label: input.title, outcome: 'done', detail: 'registrerad i Treserva' }], undoCapability: 'treserva.withdraw', undoMinutes: 10 };
      },
    },
    {
      name: 'treserva.withdraw', kind: 'execute', title: 'Ta tillbaka', model: false, description: 'Tar tillbaka en avvikelserapport inom ångerfönstret.',
      input: Type.Object({ refs: Type.Array(Type.String()) }, { additionalProperties: false }), output: Type.Any(),
      scope: actor => !!own(actor) || isManagerOf(actor),
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const filed = (await reports()).filter(r => !input.refs.includes(r.ref)); await state.set(CONNECTOR, 'reports', filed);
        return { headline: 'Rapporten är borttagen.', rows: input.refs.map(ref => ({ ref, label: 'Avvikelse', outcome: 'done' as const, detail: 'borttagen i Treserva' })) };
      },
    },
  ];
  async function scan(actor: Actor): Promise<ThreadDraft[]> {
    const drafts: ThreadDraft[] = [];
    if (isManagerOf(actor)) {
      for (const d of deviations.filter(d => d.unitId === UNIT && d.state === 'waiting-safety-rep')) drafts.push({
        topic: `treserva:dev:${d.ref}`, area: 'arbetsmiljo', title: d.title, summary: `Väntar på ${d.waitingOn}.`, reason: `Rapporterat ${shortDate(d.reportedAt.slice(0, 10))}`,
        waitingOn: d.waitingOn ?? null, deadline: d.dueBy ?? null, actions: [] });
      for (const r of await reports()) drafts.push({ topic: `treserva:report:${r.ref}`, area: 'arbetsmiljo', title: `Ny avvikelse: ${r.title}`, summary: r.text.slice(0, 160), reason: `Rapporterad ${new Date(r.at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}`,
        items: [{ ref: r.ref, label: r.title, detail: 'väntar på din bedömning', selectable: false, selected: true }], actions: [] });
    }
    const me = own(actor);
    if (me) for (const d of deviations.filter(d => d.reportedBy === me.ref && d.state !== 'closed')) drafts.push({
      topic: `treserva:mine:${d.ref}`, area: 'mitt-pass', title: d.title, summary: `Väntar på ${d.waitingOn}.`, reason: `Du rapporterade ${shortDate(d.reportedAt.slice(0, 10))}`, waitingOn: d.waitingOn ?? null, actions: [] });
    return drafts;
  }
  return {
    id: CONNECTOR, kind: 'passthrough', source: 'Treserva',
    areas: [{ id: 'arbetsmiljo', title: 'Arbetsmiljö', icon: 'document', roles: ['manager'], standing: ['treserva.deviations', 'treserva.report'],
      schedules: [{ label: 'Avvikelser som väntat mer än fem dagar', when: 'Varje vardag 06:00' }],
      figure: async () => { const open = deviations.filter(d => d.unitId === UNIT && d.state !== 'closed').length; return { label: open ? `${open} öppen${open > 1 ? 'na' : ''} avvikelse${open > 1 ? 'r' : ''}` : 'Inga öppna avvikelser', tone: open ? 'warn' : 'ok' }; } }],
    capabilities, scan: async actor => completeSnapshot(actor, await scan(actor)),
  };
}
