import { Type } from '@sinclair/typebox';
import type { Actor, Capability, Connector, ExecuteResult } from '../index';
import type { StateStore } from '../memory-state';
import { FactEnvelopeSchema, FollowResponseSchema } from '../protocol';
import { ABSENCE_FACT, managerOf, shifts, shortDate, UNIT } from './data';

/**
 * Mock time-reporting system, a generic stand-in for any municipal time and scheduling system; no vendor is named (D52).
 * Pass-through: the shifts live here (the fixture it shares with the HR mock), Clew keeps refs and audit. It follows the
 * HR system's sick report (D55) with one write of its own: the day is marked as absence.
 */
const CONNECTOR = 'timesheet';
const isManagerOf = (actor: Actor) => actor.role === 'manager' && managerOf[UNIT] === actor.id;
const todayIso = () => new Date().toISOString().slice(0, 10);
const Empty = Type.Object({}, { additionalProperties: false });
const Refs = Type.Object({ refs: Type.Array(Type.String()) }, { additionalProperties: false });
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const MarkInput = Type.Object(
  { person: Type.String({ pattern: '^hr:emp:[0-9]+$' }), date: Type.String({ pattern: DATE }) },
  { additionalProperties: false },
);
interface MarkedAbsence {
  ref: string;
  person: string;
  date: string;
  shift: string | null;
  at: string;
}
const shiftOf = (person: string, date: string) => {
  const s = shifts.find(s => s.employee === person && s.date === date);
  return s ? `${s.start}–${s.end} på ${s.ward}` : null;
};
const receipt = (row: MarkedAbsence): ExecuteResult => ({
  headline: 'Passet är markerat som frånvaro i tidrapporteringen.',
  rows: [
    {
      ref: row.ref,
      label: 'Frånvaro',
      outcome: 'done',
      detail: `${shortDate(row.date)}${row.shift ? ', ' + row.shift : ''}, markerad i tidrapporteringen`,
    },
  ],
  undoCapability: 'timesheet.unmarkAbsence',
  undoMinutes: 10,
});

export function timesheetConnector(state: StateStore): Connector {
  const marked = () => state.get<Record<string, MarkedAbsence>>(CONNECTOR, 'absences', {});
  const capabilities: Capability<any, any>[] = [
    {
      name: 'timesheet.today',
      kind: 'read',
      title: 'Dagens pass',
      model: true,
      description: 'Dagens schemarader för enheten och vilka som är markerade som frånvaro.',
      input: Empty,
      output: Type.Object({
        date: Type.String(),
        rows: Type.Array(
          Type.Object({
            ref: Type.String(),
            person: Type.String(),
            start: Type.String(),
            end: Type.String(),
            ward: Type.String(),
            absent: Type.Boolean(),
          }),
        ),
      }),
      scope: isManagerOf,
      // The view (D38): the day's shifts as a table; who works and who is away is the person's, so the model reads a summary.
      view: {
        kind: 'table',
        title: 'person',
        ref: 'ref',
        modelReads: 'summary',
        empty: 'Inga schemarader i dag.',
        fields: [
          { key: 'person', label: 'Medarbetare' },
          { key: 'start', label: 'Börjar' },
          { key: 'end', label: 'Slutar' },
          { key: 'ward', label: 'Avdelning' },
          { key: 'absent', label: 'Frånvaro' },
        ],
      },
      run: async () => {
        const date = todayIso(),
          away = Object.values(await marked());
        return {
          date,
          rows: shifts
            .filter(s => s.date === date)
            .map(s => ({
              ref: `timesheet:shift:${s.employee.split(':').pop()}:${s.date}`,
              person: s.employee,
              start: s.start,
              end: s.end,
              ward: s.ward,
              absent: away.some(a => a.person === s.employee && a.date === s.date),
            })),
        };
      },
    },
    {
      // The follower (D55): one execute step of this connector, computed from the fact alone.
      name: 'timesheet.followAbsence',
      kind: 'propose',
      title: 'Markera frånvaro',
      model: false,
      description: 'Vad tidrapporteringen gör när en medarbetare blir sjuk: markerar dagen som frånvaro.',
      input: FactEnvelopeSchema,
      output: FollowResponseSchema,
      scope: isManagerOf,
      follows: [ABSENCE_FACT],
      run: async (_actor, input: typeof FactEnvelopeSchema.static) => {
        const a = input.fact.attributes as { person?: string; from?: string };
        if (typeof a.person !== 'string' || typeof a.from !== 'string') return { steps: [] };
        const shift = shiftOf(a.person, a.from);
        return {
          steps: [
            {
              kind: 'execute' as const,
              operation: 'timesheet.markAbsence',
              payload: { person: a.person, date: a.from },
              title: 'Passet markeras frånvaro',
              detail: shift ? `${shortDate(a.from)}, ${shift}` : `${shortDate(a.from)}, ingen schemarad den dagen`,
            },
          ],
        };
      },
    },
    {
      name: 'timesheet.markAbsence',
      kind: 'execute',
      title: 'Markera frånvaro',
      model: false,
      description: 'Markerar en dag som frånvaro i tidrapporteringen.',
      input: MarkInput,
      output: Type.Any(),
      scope: isManagerOf,
      execution: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'timesheet.absenceLookup' },
      run: async (_actor, input: typeof MarkInput.static, clew): Promise<ExecuteResult> => {
        const rows = await marked();
        const key = clew.operationId ?? `${input.person}:${input.date}`;
        const existing = rows[key];
        if (existing) return receipt(existing);
        const row: MarkedAbsence = {
          ref: `timesheet:absence:${input.person.split(':').pop()}:${input.date}`,
          person: input.person,
          date: input.date,
          shift: shiftOf(input.person, input.date),
          at: new Date().toISOString(),
        };
        rows[key] = row;
        await state.set(CONNECTOR, 'absences', rows);
        return receipt(row);
      },
    },
    {
      name: 'timesheet.absenceLookup',
      kind: 'read',
      title: 'Läs tillbaka en markering',
      model: false,
      description: 'Om en markering med ett givet operations-id finns i tidrapporteringen.',
      input: Type.Object({ operationId: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ found: Type.Boolean(), result: Type.Optional(Type.Any()) }),
      scope: isManagerOf,
      run: async (_actor, input: { operationId: string }) => {
        const row = (await marked())[input.operationId];
        return row ? { found: true, result: receipt(row) } : { found: false };
      },
    },
    {
      name: 'timesheet.unmarkAbsence',
      kind: 'execute',
      title: 'Ta bort markeringen',
      model: false,
      description: 'Tar bort en frånvaromarkering inom ångerfönstret.',
      input: Refs,
      output: Type.Any(),
      scope: isManagerOf,
      run: async (_actor, input: { refs: string[] }): Promise<ExecuteResult> => {
        const rows = await marked();
        for (const [key, row] of Object.entries(rows)) if (input.refs.includes(row.ref)) delete rows[key];
        await state.set(CONNECTOR, 'absences', rows);
        return {
          headline: 'Markeringen är borttagen.',
          rows: input.refs.map(ref => ({
            ref,
            label: 'Frånvaro',
            outcome: 'done' as const,
            detail: 'borttagen i tidrapporteringen',
          })),
        };
      },
    },
  ];
  return {
    id: CONNECTOR,
    kind: 'passthrough',
    source: 'Tidrapporteringen',
    areas: [
      {
        id: 'bemanning',
        title: 'Bemanning',
        icon: 'clock',
        roles: ['manager'],
        standing: ['timesheet.today'],
        schedules: [{ label: 'Pass som saknar bemanning', when: 'Varje vardag 06:00' }],
      },
    ],
    capabilities,
  };
}
