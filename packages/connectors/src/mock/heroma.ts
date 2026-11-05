import { Type } from '@sinclair/typebox';
import type { ThreadAction } from '@clew/contracts';
import type { Actor, Capability, ExecuteResult, Connector, ThreadDraft } from '../index';
import type { StateStore } from '../memory-state';
import { absences, daysBetween, delegations, employees, leaveRequests, managerOf, shifts, shortDate, UNIT } from './data';

/**
 * Mock Heroma (HR and scheduling). A pass-through connector: Clew stores refs and audit rows, the records live here.
 * The contract is Clew's (D1): absences, leave, delegations, shifts, and the actions a manager or employee may take.
 */
const CONNECTOR = 'heroma';
const isManagerOf = (actor: Actor, unitId: string) => actor.role === 'manager' && managerOf[unitId] === actor.id;
const own = (actor: Actor) => employees.find(e => e.personId === actor.id);
const nameOf = (ref: string) => employees.find(e => e.ref === ref)?.name ?? 'Medarbetare';
const todayIso = () => new Date().toISOString().slice(0, 10);
const Empty = Type.Object({}, { additionalProperties: false });
const Refs = Type.Object({ refs: Type.Array(Type.String()) }, { additionalProperties: false });

/** Rehab rule 4.2 (synthetic): three or more short absences in 180 days triggers a talk within two weeks. */
export function rehabCandidates(unitId: string, today = todayIso()) {
  const since = new Date(Date.parse(today) - 180 * 86400000).toISOString().slice(0, 10);
  return employees.filter(e => e.unitId === unitId).map(e => {
    const periods = absences.filter(a => a.employee === e.ref && a.kind === 'short' && a.from >= since);
    return { employee: e, periods, latest: periods.map(p => p.from).sort().at(-1) ?? null };
  }).filter(c => c.periods.length >= 3);
}
export function absentToday(unitId: string, today = todayIso()) {
  return absences.filter(a => a.from <= today && a.to >= today && employees.find(e => e.ref === a.employee)?.unitId === unitId);
}

export function heromaConnector(state: StateStore): Connector {
  const decided = () => state.get<Record<string, { decision: 'approve' | 'reject'; at: string; comment?: string }>>(CONNECTOR, 'leave-decisions', {});
  const booked = () => state.get<Record<string, { at: string; when: string }>>(CONNECTOR, 'talks', {});
  const renewed = () => state.get<Record<string, string>>(CONNECTOR, 'delegations-renewed', {});

  const capabilities: Capability<any, any>[] = [
    {
      name: 'heroma.whoIsOn', kind: 'read', title: 'Vem är på plats i dag?', model: true,
      description: 'Vilka i enheten som arbetar i dag enligt schemat, och vilka som är frånvarande.',
      input: Empty, output: Type.Object({ date: Type.String(), onDuty: Type.Array(Type.String()), absent: Type.Array(Type.Object({ name: Type.String(), kind: Type.String() })) }),
      scope: actor => isManagerOf(actor, UNIT) || !!own(actor),
      run: async (actor) => {
        const date = todayIso(), unitId = own(actor)?.unitId ?? UNIT;
        const absent = absentToday(unitId, date);
        const onDuty = shifts.filter(s => s.date === date).map(s => employees.find(e => e.ref === s.employee)).filter((e): e is NonNullable<typeof e> => !!e && e.unitId === unitId);
        return { date, onDuty: onDuty.map(e => `${e.name} ${shifts.find(s => s.employee === e.ref && s.date === date)!.start}–${shifts.find(s => s.employee === e.ref && s.date === date)!.end}`),
          absent: absent.map(a => ({ name: isManagerOf(actor, unitId) ? nameOf(a.employee) : 'En kollega', kind: a.kind === 'vab' ? 'vab' : a.kind === 'long' ? 'sjukskriven' : 'sjuk' })) };
      },
    },
    {
      name: 'heroma.absenceOverview', kind: 'read', title: 'Frånvaro per person', model: true,
      description: 'Frånvarodagar per medarbetare de senaste sex månaderna, uppdelat på typ. Bara för medarbetarens chef.',
      input: Empty, output: Type.Object({ rows: Type.Array(Type.Object({ ref: Type.String(), name: Type.String(), short: Type.Integer(), vab: Type.Integer(), long: Type.Integer(), periods: Type.Integer() })) }),
      scope: actor => isManagerOf(actor, UNIT),
      run: async () => {
        const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
        return { rows: employees.filter(e => e.unitId === UNIT).map(e => {
          const mine = absences.filter(a => a.employee === e.ref && a.to >= since);
          const days = (k: 'short' | 'vab' | 'long') => mine.filter(a => a.kind === k).reduce((n, a) => n + daysBetween(a.from, a.to) + 1, 0);
          return { ref: e.ref, name: e.name, short: days('short'), vab: days('vab'), long: days('long'), periods: mine.filter(a => a.kind === 'short').length };
        }).sort((a, b) => b.periods - a.periods) };
      },
    },
    {
      name: 'heroma.absencePattern', kind: 'read', title: 'Se mönstret i Heroma', model: false,
      description: 'Frånvaromönster för en medarbetare, för chefen.',
      input: Type.Object({ ref: Type.String() }, { additionalProperties: false }), output: Type.Object({ name: Type.String(), periods: Type.Array(Type.Object({ from: Type.String(), to: Type.String(), kind: Type.String() })), rule: Type.String() }),
      scope: actor => isManagerOf(actor, UNIT),
      run: async (_actor, input: { ref: string }) => ({ name: nameOf(input.ref), periods: absences.filter(a => a.employee === input.ref).map(a => ({ from: a.from, to: a.to, kind: a.kind })), rule: 'Rutin 4.2: samtal inom två veckor efter tredje korta frånvaron på sex månader.' }),
    },
    {
      name: 'heroma.bookTalk', kind: 'execute', title: 'Boka samtalet', model: false,
      description: 'Registrerar ett omtankesamtal i Heroma.',
      input: Type.Object({ refs: Type.Array(Type.String()), when: Type.Optional(Type.String()) }, { additionalProperties: false }), output: Type.Any(),
      scope: actor => isManagerOf(actor, UNIT),
      run: async (_actor, input: { refs: string[]; when?: string }): Promise<ExecuteResult> => {
        const talks = await booked(); const at = new Date().toISOString();
        const rows = input.refs.map(ref => { talks[ref] = { at, when: input.when ?? 'nästa lediga tid' }; return { ref, label: 'Omtankesamtal', outcome: 'done' as const, detail: `registrerat i Heroma ${input.when ? shortDate(input.when) : ''}`.trim() }; });
        await state.set(CONNECTOR, 'talks', talks);
        return { headline: `${rows.length === 1 ? 'Samtalet är' : rows.length + ' samtal är'} registrerat i Heroma.`, rows, undoCapability: 'heroma.unbookTalk', undoMinutes: 10 };
      },
    },
    {
      name: 'heroma.unbookTalk', kind: 'execute', title: 'Ångra bokningen', model: false, description: 'Tar bort ett registrerat samtal inom ångerfönstret.',
      input: Refs, output: Type.Any(), scope: actor => isManagerOf(actor, UNIT),
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const talks = await booked(); for (const r of input.refs) delete talks[r]; await state.set(CONNECTOR, 'talks', talks);
        return { headline: 'Bokningen är borttagen.', rows: input.refs.map(ref => ({ ref, label: 'Omtankesamtal', outcome: 'done' as const, detail: 'borttaget i Heroma' })) };
      },
    },
    {
      name: 'heroma.leaveRequests', kind: 'read', title: 'Ledighetsansökningar', model: true,
      description: 'Öppna ledighetsansökningar som väntar på chefens beslut.',
      input: Empty, output: Type.Object({ rows: Type.Array(Type.Object({ ref: Type.String(), name: Type.String(), from: Type.String(), to: Type.String(), days: Type.Integer(), type: Type.String(), clash: Type.Boolean() })) }),
      scope: actor => isManagerOf(actor, UNIT),
      run: async () => {
        const done = await decided();
        return { rows: leaveRequests.filter(r => !done[r.ref]).map(r => ({ ref: r.ref, name: nameOf(r.employee), from: r.from, to: r.to, days: r.days, type: r.type,
          clash: leaveRequests.some(o => o.ref !== r.ref && !done[o.ref] && o.from <= r.to && o.to >= r.from) })) };
      },
    },
    {
      name: 'heroma.decideLeave', kind: 'execute', title: 'Godkänn', model: false,
      description: 'Beslutar en ledighetsansökan i Heroma.',
      input: Type.Object({ refs: Type.Array(Type.String()), decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]), comment: Type.Optional(Type.String({ maxLength: 400 })) }, { additionalProperties: false }), output: Type.Any(),
      scope: actor => isManagerOf(actor, UNIT),
      run: async (_actor, input: { refs: string[]; decision: 'approve' | 'reject'; comment?: string }): Promise<ExecuteResult> => {
        const done = await decided(); const at = new Date().toISOString();
        const rows = input.refs.map(ref => {
          const request = leaveRequests.find(r => r.ref === ref);
          if (!request) return { ref, label: 'Ansökan', outcome: 'failed' as const, detail: 'finns inte i Heroma' };
          done[ref] = { decision: input.decision, at, comment: input.comment };
          return { ref, label: `Ansökan ${shortDate(request.from)}–${shortDate(request.to)}`, outcome: 'done' as const, detail: input.decision === 'approve' ? 'godkänd i Heroma, medarbetaren meddelad' : 'avslagen i Heroma, medarbetaren meddelad' };
        });
        await state.set(CONNECTOR, 'leave-decisions', done);
        return { headline: input.decision === 'approve' ? 'Ansökan är godkänd.' : 'Ansökan är avslagen.', rows, undoCapability: 'heroma.undecideLeave', undoMinutes: 10 };
      },
    },
    {
      name: 'heroma.undecideLeave', kind: 'execute', title: 'Ångra beslutet', model: false, description: 'Återställer en ledighetsansökan till väntande inom ångerfönstret.',
      input: Refs, output: Type.Any(), scope: actor => isManagerOf(actor, UNIT),
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const done = await decided(); for (const r of input.refs) delete done[r]; await state.set(CONNECTOR, 'leave-decisions', done);
        return { headline: 'Beslutet är återtaget; ansökan väntar igen.', rows: input.refs.map(ref => ({ ref, label: 'Ansökan', outcome: 'done' as const, detail: 'väntar igen i Heroma' })) };
      },
    },
    {
      name: 'heroma.myShift', kind: 'read', title: 'Mitt pass', model: true,
      description: 'Dagens och morgondagens pass för den inloggade, och vilka kollegor som jobbar.',
      input: Empty, output: Type.Object({ today: Type.Union([Type.Object({ start: Type.String(), end: Type.String(), ward: Type.String(), colleagues: Type.Array(Type.String()) }), Type.Null()]) }),
      scope: actor => !!own(actor),
      run: async (actor) => {
        const me = own(actor)!, date = todayIso();
        const mine = shifts.find(s => s.employee === me.ref && s.date === date);
        if (!mine) return { today: null };
        const colleagues = shifts.filter(s => s.date === date && s.employee !== me.ref && s.ward === mine.ward).map(s => `${nameOf(s.employee)} ${s.start}–${s.end}`);
        return { today: { start: mine.start, end: mine.end, ward: mine.ward, colleagues } };
      },
    },
    {
      name: 'heroma.myBalance', kind: 'read', title: 'Mitt saldo', model: true, description: 'Semesterdagar kvar att ta ut i år.',
      input: Empty, output: Type.Object({ vacationDaysLeft: Type.Integer(), mustUseBy: Type.String() }),
      scope: actor => !!own(actor), run: async () => ({ vacationDaysLeft: 6, mustUseBy: '2026-12-31' }),
    },
    {
      name: 'heroma.renewDelegation', kind: 'execute', title: 'Boka förnyelse', model: false, description: 'Bokar förnyelse av en delegering med den som utfärdar den.',
      input: Type.Object({ refs: Type.Array(Type.String()), when: Type.Optional(Type.String()) }, { additionalProperties: false }), output: Type.Any(),
      scope: actor => !!own(actor),
      run: async (actor, input: { refs: string[]; when?: string }): Promise<ExecuteResult> => {
        const me = own(actor)!; const done = await renewed(); const at = new Date().toISOString();
        const rows = input.refs.map(ref => {
          const d = delegations.find(x => x.ref === ref && x.employee === me.ref);
          if (!d) return { ref, label: 'Delegering', outcome: 'failed' as const, detail: 'inte din delegering' };
          done[ref] = at; return { ref, label: d.title, outcome: 'done' as const, detail: `förnyelse bokad med ${d.renewer}${input.when ? ' ' + input.when : ''}` };
        });
        await state.set(CONNECTOR, 'delegations-renewed', done);
        return { headline: 'Förnyelsen är bokad.', rows };
      },
    },
  ];

  async function scan(actor: Actor): Promise<ThreadDraft[]> {
    const drafts: ThreadDraft[] = [];
    const today = todayIso();
    if (isManagerOf(actor, UNIT)) {
      const talks = await booked(), done = await decided();
      for (const c of rehabCandidates(UNIT, today)) {
        if (talks[c.employee.ref]) continue;
        const dueBy = new Date(Date.parse(c.latest!) + 14 * 86400000).toISOString().slice(0, 10);
        drafts.push({ topic: `heroma:rehab:${c.employee.ref}`, area: 'medarbetare', title: 'Boka ett omtankesamtal med en medarbetare',
          summary: `Tredje korta sjukfrånvaron på sex månader. Kommunens rehabrutin 4.2 säger samtal inom två veckor. Namnet visas i Heroma, inte här.`,
          reason: `Rutinens tvåveckorsgräns går ut ${shortDate(dueBy)}`, deadline: dueBy,
          items: [{ ref: c.employee.ref, label: 'Medarbetare', detail: `${c.periods.length} korta perioder sedan ${shortDate(c.periods[0]!.from)}`, selectable: false, selected: true }],
          actions: [
            { id: 'book', label: 'Boka samtalet', capability: 'heroma.bookTalk', kind: 'execute', role: 'primary', usesItems: true },
            { id: 'pattern', label: 'Se mönstret i Heroma', capability: 'heroma.absencePattern', kind: 'read', role: 'secondary', target: 'panel', input: { ref: c.employee.ref } },
          ] });
      }
      for (const r of leaveRequests.filter(r => !done[r.ref] && employees.find(e => e.ref === r.employee)?.unitId === UNIT)) {
        const clash = leaveRequests.some(o => o.ref !== r.ref && !done[o.ref] && o.from <= r.to && o.to >= r.from);
        drafts.push({ topic: `heroma:leave:${r.ref}`, area: 'medarbetare', title: `Godkänn en ledighetsansökan, ${shortDate(r.from)} till ${shortDate(r.to)}`,
          summary: `${r.days} dagar ${r.type}. ${clash ? 'En kollega har sökt samma period.' : 'Ingen annan i arbetslaget är ledig då'} och saldot räcker.`,
          reason: `Ansökan kom ${new Date(r.submittedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}`, deadline: null,
          // Names stay inside the source system: the card says what and when, "Se i Heroma" says who.
          items: [{ ref: r.ref, label: 'Ansökan', detail: `${shortDate(r.from)}–${shortDate(r.to)} · ${r.days} dagar ${r.type}`, selectable: false, selected: true }],
          actions: [
            { id: 'approve', label: 'Godkänn', capability: 'heroma.decideLeave', kind: 'execute', role: 'primary', usesItems: true, input: { decision: 'approve' } },
            { id: 'open', label: 'Se i Heroma', capability: 'heroma.leaveRequests', kind: 'read', role: 'secondary', target: 'panel' },
            { id: 'reject', label: 'Avslå', capability: 'heroma.decideLeave', kind: 'execute', role: 'secondary', usesItems: true, input: { decision: 'reject' }, confirm: 'Avslå ansökan? Medarbetaren meddelas direkt.' },
          ] });
      }
    }
    const me = own(actor);
    if (me) {
      const renewedMap = await renewed();
      for (const d of delegations.filter(d => d.employee === me.ref && !renewedMap[d.ref] && daysBetween(today, d.expires) <= 30)) {
        drafts.push({ topic: `heroma:delegation:${d.ref}`, area: 'mitt-pass', title: `Din ${d.title.toLowerCase()} går ut ${shortDate(d.expires)}`,
          summary: `${d.renewer} förnyar den. Tar 20 minuter.`, reason: `Går ut om ${daysBetween(today, d.expires)} dagar`, deadline: d.expires,
          items: [{ ref: d.ref, label: d.title, detail: `giltig till ${shortDate(d.expires)}`, selectable: false, selected: true }],
          actions: [{ id: 'renew', label: 'Boka förnyelse', capability: 'heroma.renewDelegation', kind: 'execute', role: 'primary', usesItems: true }] });
      }
      const mine = leaveRequests.find(r => r.employee === me.ref);
      const decidedMap = await decided();
      if (mine && !decidedMap[mine.ref]) drafts.push({ topic: `heroma:leave-waiting:${mine.ref}`, area: 'mitt-pass', title: `Semesteransökan ${shortDate(mine.from)}–${shortDate(mine.to)}`,
        summary: 'Ligger hos din chef.', reason: 'Du skickade den i morse', waitingOn: 'din chef', actions: [] });
    }
    return drafts;
  }

  return {
    id: CONNECTOR, kind: 'passthrough', source: 'Heroma',
    areas: [
      { id: 'medarbetare', title: 'Medarbetare', icon: 'people', roles: ['manager'], standing: ['heroma.whoIsOn', 'heroma.absenceOverview', 'heroma.leaveRequests'],
        schedules: [{ label: 'Frånvaro och mönster enligt rehabrutinen', when: 'Varje vardag 06:00' }, { label: 'Ledighetsansökningar', when: 'När en ansökan kommer' }],
        figure: async () => { const a = absentToday(UNIT); const n = employees.filter(e => e.unitId === UNIT).length; const pct = (100 * a.length / n); return { label: `Frånvaro ${pct.toFixed(0)} % · ${n - a.length} av ${n} på plats`, tone: pct > 15 ? 'alert' : pct > 8 ? 'warn' : 'ok' }; } },
      { id: 'mitt-pass', title: 'Mitt pass', icon: 'clock', roles: ['employee'], standing: ['heroma.myShift', 'heroma.whoIsOn', 'heroma.myBalance'],
        schedules: [{ label: 'Delegeringar och utbildningar som går ut', when: 'Månadens första måndag' }],
        figure: async (actor) => { const me = own(actor); const s = me && shifts.find(x => x.employee === me.ref && x.date === todayIso()); return s ? { label: `${s.start}–${s.end} på ${s.ward}`, tone: 'ok' } : { label: 'Ledig i dag', tone: 'none' }; } },
    ],
    capabilities, scan,
  };
}
const _unused: ThreadAction | undefined = undefined; void _unused;
