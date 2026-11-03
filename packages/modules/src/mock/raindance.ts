import { Type } from '@sinclair/typebox';
import type { Actor, Capability, ExecuteResult, Module, ThreadDraft } from '../index';
import type { StateStore } from '../memory-state';
import { budgets, costCentreOf, invoices, managerOf, money, shortDate, UNIT } from './data';

/** Mock Raindance (economy). Pass-through: invoices and budget live here, Clew keeps refs and audit. */
const MODULE = 'raindance';
const isManagerOf = (actor: Actor) => actor.role === 'manager' && managerOf[UNIT] === actor.id;
const Empty = Type.Object({}, { additionalProperties: false });
const Refs = Type.Object({ refs: Type.Array(Type.String()) }, { additionalProperties: false });

export function raindanceModule(state: StateStore): Module {
  const approved = () => state.get<Record<string, string>>(MODULE, 'approved', {});
  const pending = async () => { const done = await approved(); return invoices.filter(i => i.costCentre === costCentreOf[UNIT] && !done[i.ref]); };
  const capabilities: Capability<any, any>[] = [
    {
      name: 'raindance.invoices', kind: 'read', title: 'Fakturor att attestera', model: true, description: 'Fakturor som väntar på attest för chefens kostnadsställe.',
      input: Empty, output: Type.Object({ rows: Type.Array(Type.Object({ ref: Type.String(), supplier: Type.String(), amount: Type.Number(), due: Type.String(), order: Type.String(), account: Type.String() })) }),
      scope: isManagerOf, run: async () => ({ rows: (await pending()).map(i => ({ ref: i.ref, supplier: i.supplier, amount: i.amount, due: i.due, order: i.order, account: i.account })) }),
    },
    {
      name: 'raindance.budget', kind: 'read', title: 'Budget mot prognos', model: true, description: 'Budgetavvikelse och prognos för kostnadsstället, med den största drivaren.',
      input: Empty, output: Type.Object({ deviationPct: Type.Number(), driver: Type.String(), budget: Type.Number(), forecast: Type.Number() }),
      scope: isManagerOf, run: async () => { const b = budgets.find(b => b.costCentre === costCentreOf[UNIT])!; return { deviationPct: Math.round(1000 * (b.budget - b.forecast) / b.budget) / 10, driver: b.driver, budget: b.budget, forecast: b.forecast }; },
    },
    {
      name: 'raindance.approve', kind: 'execute', title: 'Attestera', model: false, description: 'Attesterar valda fakturor i Raindance.',
      input: Refs, output: Type.Any(), scope: isManagerOf,
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const done = await approved(); const at = new Date().toISOString();
        const rows = input.refs.map(ref => {
          const inv = invoices.find(i => i.ref === ref);
          if (!inv) return { ref, label: 'Faktura', outcome: 'failed' as const, detail: 'finns inte i Raindance' };
          // One invoice answers slowly in the mock so the "unknown" state is exercised end to end.
          if (ref.endsWith('55140')) return { ref, label: `${inv.supplier} ${money(inv.amount)}`, outcome: 'unknown' as const, detail: 'Raindance svarade inte, kontrolleras igen om 15 min' };
          done[ref] = at; return { ref, label: `${inv.supplier} ${money(inv.amount)}`, outcome: 'done' as const, detail: 'attesterad i Raindance' };
        });
        await state.set(MODULE, 'approved', done);
        const ok = rows.filter(r => r.outcome === 'done').length, unknown = rows.filter(r => r.outcome === 'unknown').length;
        return { headline: `${ok} ${ok === 1 ? 'faktura attesterad' : 'fakturor attesterade'}${unknown ? `, ${unknown} väntar på svar` : ''}.`, rows, undoCapability: 'raindance.unapprove', undoMinutes: 10 };
      },
    },
    {
      name: 'raindance.unapprove', kind: 'execute', title: 'Ångra attest', model: false, description: 'Tar tillbaka en attest inom ångerfönstret.',
      input: Refs, output: Type.Any(), scope: isManagerOf,
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const done = await approved(); for (const r of input.refs) delete done[r]; await state.set(MODULE, 'approved', done);
        return { headline: 'Attesten är återtagen.', rows: input.refs.map(ref => ({ ref, label: 'Faktura', outcome: 'done' as const, detail: 'väntar igen i Raindance' })) };
      },
    },
    {
      name: 'raindance.open', kind: 'read', title: 'Öppna i Raindance', model: false, description: 'Länk till fakturan i Raindance.',
      input: Type.Object({ ref: Type.String() }, { additionalProperties: false }), output: Type.Object({ url: Type.String() }),
      scope: isManagerOf, run: async (_a, input: { ref: string }) => ({ url: `https://raindance.example.invalid/faktura/${encodeURIComponent(input.ref)}` }),
    },
  ];
  async function scan(actor: Actor): Promise<ThreadDraft[]> {
    if (!isManagerOf(actor)) return [];
    const rows = await pending();
    if (!rows.length) return [];
    const due = rows.map(r => r.due).sort()[0]!;
    const total = rows.reduce((n, r) => n + r.amount, 0);
    return [{ topic: 'raindance:invoices', area: 'budget', title: `Attestera ${rows.length} fakturor, ${money(total)}`,
      summary: rows.every(r => r.order) ? `Alla matchar sina beställningar och ryms i budgeten.` : `${rows.filter(r => r.order).length} matchar en beställning, ${rows.filter(r => !r.order).length} saknar beställning.`,
      reason: `Den första förfaller ${shortDate(due)}`, deadline: due,
      items: rows.map(r => ({ ref: r.ref, label: `${r.supplier} · ${money(r.amount)}`, detail: `${r.account} · förfaller ${shortDate(r.due)}${r.order ? ' · beställning ' + r.order : ' · ingen beställning'}`, selectable: true, selected: !!r.order })),
      actions: [
        { id: 'approve', label: 'Attestera valda', capability: 'raindance.approve', kind: 'execute', role: 'primary', usesItems: true },
        { id: 'open', label: 'Öppna i Raindance', capability: 'raindance.open', kind: 'read', role: 'secondary', target: 'link', input: { ref: rows[0]!.ref } },
      ] }];
  }
  return {
    id: MODULE, kind: 'passthrough', source: 'Raindance',
    areas: [{ id: 'budget', title: 'Budget', roles: ['manager'], standing: ['raindance.invoices', 'raindance.budget'],
      schedules: [{ label: 'Fakturor som förfaller inom en vecka', when: 'Varje vardag 06:00' }, { label: 'Prognosavvikelse', when: 'Månadens första måndag' }],
      figure: async () => { const b = budgets.find(b => b.costCentre === costCentreOf[UNIT])!; const pct = Math.round(1000 * (b.budget - b.forecast) / b.budget) / 10; return { label: `${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')} % · ${b.driver}`, tone: pct < -1.5 ? 'alert' : pct < 0 ? 'warn' : 'ok' }; } }],
    capabilities, scan,
  };
}
