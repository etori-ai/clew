import { Type } from '@sinclair/typebox';
import type { Actor, Capability, ExecuteResult, Connector, ThreadDraft } from '../index';
import type { StateStore } from '../memory-state';
import { notices } from './data';

/** Mock Kommunikation ("Viktigt nu"). A core-like connector: notices with read receipts, outside the attention budget. */
const CONNECTOR = 'communication';
const Empty = Type.Object({}, { additionalProperties: false });

export function communicationConnector(state: StateStore): Connector {
  const acks = () => state.get<Record<string, Record<string, string>>>(CONNECTOR, 'receipts', {});
  const capabilities: Capability<any, any>[] = [
    {
      name: 'communication.notices',
      kind: 'read',
      title: 'Viktigt nu',
      model: true,
      description: 'Meddelanden från kommunen som kräver läskvitto, och om den inloggade kvitterat.',
      input: Empty,
      output: Type.Object({
        rows: Type.Array(
          Type.Object({
            ref: Type.String(),
            title: Type.String(),
            requiresReceipt: Type.Boolean(),
            acknowledged: Type.Boolean(),
          }),
        ),
      }),
      scope: () => true,
      // The view (D38): the notices as a list that says which still need the person's receipt.
      view: {
        kind: 'list',
        title: 'title',
        ref: 'ref',
        empty: 'Inga meddelanden just nu.',
        fields: [
          { key: 'title', label: 'Titel' },
          { key: 'requiresReceipt', label: 'Kräver läskvitto' },
          { key: 'acknowledged', label: 'Läst' },
        ],
      },
      run: async actor => {
        const a = await acks();
        return {
          rows: notices
            .filter(n => n.audience === 'all' || actor.role === 'manager')
            .map(n => ({
              ref: n.ref,
              title: n.title,
              requiresReceipt: n.requiresReceipt,
              acknowledged: !!a[actor.id]?.[n.ref],
            })),
        };
      },
    },
    {
      name: 'communication.acknowledge',
      kind: 'execute',
      title: 'Jag har läst',
      model: false,
      description: 'Kvitterar ett meddelande.',
      input: Type.Object({ refs: Type.Array(Type.String()) }, { additionalProperties: false }),
      output: Type.Any(),
      scope: () => true,
      run: async (actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const a = await acks();
        a[actor.id] ??= {};
        const at = new Date().toISOString();
        for (const r of input.refs) a[actor.id]![r] = at;
        await state.set(CONNECTOR, 'receipts', a);
        return {
          headline: 'Läskvittot är registrerat.',
          rows: input.refs.map(ref => ({
            ref,
            label: notices.find(n => n.ref === ref)?.title ?? 'Meddelande',
            outcome: 'done' as const,
            detail: `kvitterat ${new Date(at).toLocaleTimeString('sv-SE', { timeStyle: 'short' })}`,
          })),
        };
      },
    },
  ];
  async function scan(actor: Actor): Promise<ThreadDraft[]> {
    const a = await acks();
    return notices
      .filter(n => n.requiresReceipt && (n.audience === 'all' || actor.role === 'manager') && !a[actor.id]?.[n.ref])
      .map(n => ({
        topic: `communication:${n.ref}`,
        area: 'viktigt-nu',
        title: n.title,
        summary: n.body,
        reason: `Publicerat ${new Date(n.publishedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })} · läskvitto krävs`,
        items: [{ ref: n.ref, label: n.title, detail: 'kräver läskvitto', selectable: false, selected: true }],
        actions: [
          {
            id: 'ack',
            label: 'Jag har läst',
            capability: 'communication.acknowledge',
            kind: 'execute',
            role: 'primary',
            usesItems: true,
          },
        ],
      }));
  }
  return {
    id: CONNECTOR,
    kind: 'core',
    source: 'Kommunikation',
    areas: [
      {
        id: 'viktigt-nu',
        title: 'Viktigt nu',
        icon: 'bell',
        roles: ['manager', 'employee'],
        standing: ['communication.notices'],
        schedules: [{ label: 'Nya meddelanden som kräver läskvitto', when: 'Direkt när de publiceras' }],
      },
    ],
    capabilities,
    scan,
  };
}
