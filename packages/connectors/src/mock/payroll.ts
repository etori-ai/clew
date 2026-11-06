import { Type } from '@sinclair/typebox';
import type { Actor, Capability, Connector } from '../index';
import type { StateStore } from '../memory-state';
import { FactEnvelopeSchema, FollowResponseSchema } from '../protocol';
import { ABSENCE_FACT, managerOf, reportedAbsences, shortDate, UNIT } from './data';

/**
 * Mock payroll system, a generic stand-in for any municipal payroll system; no vendor is named (D52). Clew cannot write
 * in it: payroll reads the HR system itself, once a night (D55 item 8, propagation stays in the systems), so Clew only
 * watches that a sick report shows up and says so when it does not. In the mock, a report registered in the HR mock
 * reaches payroll the day after it was made; nothing a person does in Clew moves it faster.
 */
const CONNECTOR = 'payroll';
const isManagerOf = (actor: Actor) => actor.role === 'manager' && managerOf[UNIT] === actor.id;
const todayIso = () => new Date().toISOString().slice(0, 10);
const Empty = Type.Object({}, { additionalProperties: false });
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const AbsenceQuery = Type.Object(
  { person: Type.String({ pattern: '^hr:emp:[0-9]+$' }), date: Type.String({ pattern: DATE }) },
  { additionalProperties: false },
);

export function payrollConnector(state: StateStore): Connector {
  /** What the nightly import has brought over: every report registered before today. */
  const imported = async (today = todayIso()) =>
    Object.values(await reportedAbsences(state)).filter(r => r.at.slice(0, 10) < today);
  const capabilities: Capability<any, any>[] = [
    {
      name: 'payroll.absences',
      kind: 'read',
      title: 'Frånvaro som nått lönesystemet',
      model: true,
      description: 'Sjukanmälningar som lönesystemet har läst in från personalsystemet, med dag och omfattning.',
      input: Empty,
      output: Type.Object({
        rows: Type.Array(
          Type.Object({
            ref: Type.String(),
            person: Type.String(),
            from: Type.String(),
            to: Type.String(),
            extent: Type.Integer(),
            importedAt: Type.String(),
          }),
        ),
      }),
      scope: isManagerOf,
      // The view (D38): what payroll holds, as a table; who is sick is the person's, so the model reads a summary.
      view: {
        kind: 'table',
        title: 'person',
        ref: 'ref',
        modelReads: 'summary',
        empty: 'Ingen sjukanmälan har nått lönesystemet.',
        fields: [
          { key: 'person', label: 'Medarbetare' },
          { key: 'from', label: 'Från', format: 'date' },
          { key: 'to', label: 'Till', format: 'date' },
          { key: 'extent', label: 'Omfattning, procent', format: 'number' },
          { key: 'importedAt', label: 'Inläst', format: 'date' },
        ],
      },
      run: async () => ({
        rows: (await imported()).map(r => ({
          ref: r.ref,
          person: r.person,
          from: r.from,
          to: r.to,
          extent: r.extent,
          importedAt: r.at.slice(0, 10),
        })),
      }),
    },
    {
      // The read a watch step repeats (D55 item 5): has the report for this person and day reached payroll?
      name: 'payroll.absenceStatus',
      kind: 'read',
      title: 'Har sjukanmälan nått lönesystemet?',
      model: false,
      description:
        'Om lönesystemet har läst in en sjukanmälan för en medarbetare och en dag: registered eller pending.',
      input: AbsenceQuery,
      output: Type.Object({
        status: Type.Union([Type.Literal('registered'), Type.Literal('pending')]),
        person: Type.String(),
        date: Type.String(),
        checkedAt: Type.String(),
      }),
      scope: isManagerOf,
      run: async (_actor, input: typeof AbsenceQuery.static) => {
        const hit = (await imported()).find(
          r => r.person === input.person && r.from <= input.date && r.to >= input.date,
        );
        return {
          status: hit ? ('registered' as const) : ('pending' as const),
          person: input.person,
          date: input.date,
          checkedAt: new Date().toISOString(),
        };
      },
    },
    {
      // The follower (D55): one watch step, a read of this connector repeated inside a window; payroll is never written by Clew.
      name: 'payroll.followAbsence',
      kind: 'propose',
      title: 'Bevaka i lönesystemet',
      model: false,
      description:
        'Vad lönesystemet gör när en medarbetare blir sjuk: ingenting självt, så Clew bevakar att sjukanmälan kommer fram.',
      input: FactEnvelopeSchema,
      output: FollowResponseSchema,
      scope: isManagerOf,
      follows: [ABSENCE_FACT],
      run: async (_actor, input: typeof FactEnvelopeSchema.static) => {
        const a = input.fact.attributes as { person?: string; from?: string };
        if (typeof a.person !== 'string' || typeof a.from !== 'string') return { steps: [] };
        return {
          steps: [
            {
              kind: 'watch' as const,
              operation: 'payroll.absenceStatus',
              input: { person: a.person, date: a.from },
              expect: { path: ['status'], equals: 'registered' },
              within: 'P1D',
              title: 'Bevakas i lönesystemet',
              detail: `Lönesystemet läser personalsystemet varje natt; sjukanmälan ${shortDate(a.from)} ska synas där.`,
            },
          ],
        };
      },
    },
  ];
  return {
    id: CONNECTOR,
    kind: 'passthrough',
    source: 'Lönesystemet',
    areas: [
      {
        id: 'lon',
        title: 'Lön',
        icon: 'document',
        roles: ['manager'],
        standing: ['payroll.absences'],
        schedules: [{ label: 'Inläsning från personalsystemet', when: 'Varje natt' }],
      },
    ],
    capabilities,
  };
}
