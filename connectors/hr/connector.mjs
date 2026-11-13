// The HR fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated records,
// state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, ABSENCE_FACT, CONNECTOR, KEYS_MAX, SICK_DAYS, sickOnDay } from './manifest.mjs';
import { addDays, dateIn, daysBetween, period, seed, shortDate, sickLeaveOf } from './fixture.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Invalid extends Error {}
class Denied extends Error {}
class Conflict extends Error {}
/** How long a booked talk can be undone, in minutes: what the write answers and its effect read says beforehand. */
const TALK_UNDO_MINUTES = 10;
/** The realism switches, process configuration only (never a route): what a real source does to a connector now and then. */
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'crash-after-commit'];

/** A talk's time as a manager reads it, in Swedish time: "torsdag 19 november kl. 13:15". */
const meetingTime = instant =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
/** When something came in, a long date with the time as the card's other dates are long, in Swedish time: "10 november kl. 16:40". */
const arrivalTime = instant =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clockTime = (clock, day) => `${day}T${clock().toISOString().slice(11, 19)}Z`;

/**
 * `state` is the source's own store (SQLite in the service, memory in tests); `clock` is the source's clock; `fault` one of
 * FAULTS; `unitMap` and `personMap` translate Clew's unit and person ids to the HR system's where they differ; `feedKey`
 * protects the fixture-internal feed payroll imports from (D55 item 8: never through Clew). `fresh` reseeds the records.
 */
export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  unitMap = {},
  personMap = {},
  feedKey = '',
  fresh = false,
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  if (!state.get('records')) state.set('records', seed(today()));
  const records = () => state.get('records');

  // Identity: the verified actor, translated to the HR system's own ids. The unit decides what a manager sees.
  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const personOf = actor => personMap[actor.id] ?? actor.id;
  const own = actor => records().employees.find(e => e.personId === personOf(actor));
  const managerOf = (actor, unitId) => actor.role === 'manager' && unitOf(actor) === unitId;
  const personKey = actor => unitOf(actor) + ':' + personOf(actor);
  const nameOf = ref => records().employees.find(e => e.ref === ref)?.name ?? 'Medarbetare';
  const staff = unitId => records().employees.filter(e => e.unitId === unitId);

  const decided = () => state.get('leave-decisions', {});
  const booked = () => state.get('talks', {});
  const renewed = () => state.get('delegations-renewed', {});
  const reported = () => state.get('reported-absences', {});

  /** Rehab rule 4.2 (synthetic): three or more short absences in 180 days triggers a talk within two weeks. */
  function rehabCandidates(unitId, day = today()) {
    const since = addDays(day, -180);
    return staff(unitId)
      .map(e => {
        const periods = records().absences.filter(a => a.employee === e.ref && a.kind === 'short' && a.from >= since);
        return {
          employee: e,
          periods,
          latest:
            periods
              .map(p => p.from)
              .sort()
              .at(-1) ?? null,
        };
      })
      .filter(c => c.periods.length >= 3);
  }
  const absentOn = (unitId, day) =>
    records().absences.filter(
      a => a.from <= day && a.to >= day && records().employees.find(e => e.ref === a.employee)?.unitId === unitId,
    );
  const absenceReceipt = row => ({
    headline: 'Sjukanmälan är registrerad i personalsystemet.',
    rows: [
      {
        ref: row.ref,
        label: 'Sjukanmälan',
        outcome: 'done',
        detail: `${shortDate(row.from)}${row.to !== row.from ? '–' + shortDate(row.to) : ''}, ${row.extent} %, registrerad i personalsystemet`,
      },
    ],
    undoCapability: 'hr.withdrawAbsence',
    undoMinutes: 10,
  });
  /**
   * Every absence of one employee the HR system knows of, as periods: the recorded ones, the sick reports registered
   * through Clew's jobs, and the leave requests not turned down (an undecided one says so). Inclusive dates.
   */
  function absencesOf(employee) {
    const done = decided();
    const leaveWord = type => (type === 'semester' ? 'Semester' : 'Ledig');
    return [
      ...records()
        .absences.filter(a => a.employee === employee.ref)
        .map(a => ({ from: a.from, to: a.to, kind: a.kind })),
      ...Object.values(reported())
        .filter(r => r.person === employee.ref)
        .map(r => ({ from: r.from, to: r.to, kind: daysBetween(r.from, r.to) >= SICK_DAYS ? 'long' : 'short' })),
      ...records()
        .leaveRequests.filter(r => r.employee === employee.ref && done[r.ref]?.decision !== 'reject')
        .map(r => ({ from: r.from, to: r.to, kind: 'leave', word: leaveWord(r.type), pending: !done[r.ref] })),
    ];
  }
  /** What an absence is called on its `day` of it: "Sjuk · dag 1", "Sjukskriven", "VAB", "Semester". */
  const absenceWord = (a, day) => {
    if (a.kind === 'vab') return 'VAB';
    if (a.kind === 'leave') return a.word;
    const n = daysBetween(a.from, day) + 1;
    return a.kind === 'short' && n <= SICK_DAYS ? sickOnDay(n) : 'Sjukskriven';
  };
  /**
   * One employee's row for `hr.person` (D97): presence today, today in a few more words (the shift, or the absence and
   * when it ends), and the next absence that is known, an undecided leave request saying so.
   */
  function presenceOf(employee, key, day = today()) {
    const all = absencesOf(employee);
    // A sick report or a vab outranks leave on the same day.
    const now = all
      .filter(a => a.from <= day && a.to >= day)
      .sort((a, b) => Number(a.kind === 'leave') - Number(b.kind === 'leave'))[0];
    const next = all.filter(a => a.from > day).sort((a, b) => a.from.localeCompare(b.from))[0];
    const shift = records().shifts.find(s => s.employee === employee.ref && s.date === day);
    const presence = now ? absenceWord(now, day) : 'I tjänst';
    const longWord = now && now.kind === 'long' ? `${presence} · dag ${daysBetween(now.from, day) + 1}` : presence;
    return {
      key,
      ref: employee.ref,
      presence,
      today: now
        ? `${longWord}${now.to > day ? `, till ${period(now.to)}` : ''}`
        : `På plats${shift ? ` ${shift.start}–${shift.end}` : ''}`,
      ...(next
        ? {
            upcoming: `${next.kind === 'leave' ? next.word : absenceWord(next, next.from).replace(/ · dag \d+$/, '')} ${period(next.from, next.to)}${next.pending ? ', väntar på beslut' : ''}`,
          }
        : {}),
    };
  }

  const conflictRows = (refs, label) => ({
    headline: 'Posten har ändrats i personalsystemet.',
    rows: refs.map(ref => ({
      ref,
      label,
      outcome: 'failed',
      detail: 'ändrad av någon annan, läs tillbaka och försök igen',
    })),
  });

  const reads = {
    'hr.whoIsOn': actor => {
      const date = today();
      const me = own(actor);
      const unitId = managerOf(actor, unitOf(actor)) ? unitOf(actor) : me?.unitId;
      if (!unitId) return { date, onDuty: [], absent: [] };
      const manager = managerOf(actor, unitId);
      const shiftsToday = records().shifts.filter(s => s.date === date);
      const onDuty = shiftsToday
        .map(s => ({ s, e: records().employees.find(e => e.ref === s.employee) }))
        .filter(({ e }) => e && e.unitId === unitId)
        .map(({ s, e }) => `${e.name} ${s.start}–${s.end}`);
      const absent = absentOn(unitId, date).map(a => ({
        name: manager ? nameOf(a.employee) : 'En kollega',
        kind: a.kind === 'vab' ? 'vab' : a.kind === 'long' ? 'sjukskriven' : 'sjuk',
      }));
      return { date, onDuty, absent };
    },
    'hr.absenceOverview': actor => {
      const since = addDays(today(), -180);
      const rows = staff(unitOf(actor))
        .map(e => {
          const mine = records().absences.filter(a => a.employee === e.ref && a.to >= since);
          const days = k => mine.filter(a => a.kind === k).reduce((n, a) => n + daysBetween(a.from, a.to) + 1, 0);
          return {
            ref: e.ref,
            name: e.name,
            short: days('short'),
            vab: days('vab'),
            long: days('long'),
            periods: mine.filter(a => a.kind === 'short').length,
          };
        })
        .sort((a, b) => b.periods - a.periods);
      return { rows };
    },
    'hr.absencePattern': (actor, input) => {
      const e = records().employees.find(e => e.ref === input.ref && e.unitId === unitOf(actor));
      if (!e) throw new Invalid('Medarbetaren finns inte i din enhet.');
      return {
        name: e.name,
        periods: records()
          .absences.filter(a => a.employee === e.ref)
          .map(a => ({ from: a.from, to: a.to, kind: a.kind })),
        rule: 'Rutin 4.2: samtal inom två veckor efter tredje korta frånvaron på sex månader.',
      };
    },
    'hr.leaveRequests': actor => {
      const done = decided();
      const unit = staff(unitOf(actor)).map(e => e.ref);
      const open = records().leaveRequests.filter(r => !done[r.ref] && unit.includes(r.employee));
      return {
        rows: open.map(r => ({
          ref: r.ref,
          name: nameOf(r.employee),
          from: r.from,
          to: r.to,
          days: r.days,
          type: r.type,
          clash: open.some(o => o.ref !== r.ref && o.from <= r.to && o.to >= r.from),
        })),
      };
    },
    'hr.myShift': actor => {
      const me = own(actor);
      const date = today();
      const mine = me && records().shifts.find(s => s.employee === me.ref && s.date === date);
      if (!mine) return { today: null };
      const colleagues = records()
        .shifts.filter(s => s.date === date && s.employee !== me.ref && s.ward === mine.ward)
        .map(s => `${nameOf(s.employee)} ${s.start}–${s.end}`);
      return { today: { start: mine.start, end: mine.end, ward: mine.ward, colleagues } };
    },
    'hr.myBalance': () => ({ vacationDaysLeft: 6, mustUseBy: today().slice(0, 4) + '-12-31' }),
    // A read about a person (D97): one row per key that is an employee of the manager's unit here, by user name without
    // regard to case, with the key as it was asked. Anyone else, an unknown key and a key asked twice are no row.
    'hr.person': (actor, input) => {
      const keys = input.keys;
      if (!Array.isArray(keys) || keys.length > KEYS_MAX || keys.some(k => typeof k !== 'string' || !k))
        throw new Invalid('Ogiltig förfrågan.');
      const unit = managerOf(actor, unitOf(actor)) ? staff(unitOf(actor)) : [];
      const answered = new Set();
      const rows = [];
      for (const key of keys) {
        const employee = unit.find(e => e.personId.toLowerCase() === key.toLowerCase());
        if (!employee || answered.has(employee.ref)) continue;
        answered.add(employee.ref);
        rows.push(presenceOf(employee, key));
      }
      return { rows };
    },
    'hr.lookup': (actor, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.person === personKey(actor) ? { found: true, result: op.result } : { found: false };
    },
    // What hr.bookTalk will do with the same input (D112), checked as the write checks it and written nowhere: the talk
    // registered on the employee with its time and place, and the ten minutes the write can be undone.
    'hr.bookTalkEffect': (actor, input) => {
      const unit = staff(unitOf(actor)).map(e => e.ref);
      if (!input.refs.length || input.refs.some(ref => !unit.includes(ref)))
        throw new Invalid('Medarbetaren finns inte i din enhet.');
      const n = input.refs.length;
      const details = [
        input.when ? meetingTime(input.when) : 'nästa lediga tid',
        input.place,
        input.message ? 'med ditt meddelande' : undefined,
      ].filter(Boolean);
      return {
        rows: [
          {
            label: n === 1 ? 'Omtankesamtalet registreras' : `${n} omtankesamtal registreras`,
            detail: `På medarbetaren, ${details.join(', ')}`,
          },
        ],
        undoMinutes: TALK_UNDO_MINUTES,
      };
    },
  };

  const proposals = {
    'hr.proposeAbsence': (_actor, input) => {
      const f = input.fact;
      if (f.kind !== ABSENCE_FACT) throw new Invalid('Personalsystemet följer bara ' + ABSENCE_FACT + '.');
      if (f.ref) return { steps: [] };
      const a = f.attributes;
      const extent = a.extent ?? 100;
      return {
        steps: [
          {
            kind: 'execute',
            operation: 'hr.reportAbsence',
            payload: { person: a.person, from: a.from, ...(a.to ? { to: a.to } : {}), extent },
            title: 'Sjukanmälan registreras',
            detail: `Från ${shortDate(a.from)}, ${extent} %`,
          },
        ],
      };
    },
    // An action about a person (D97): the employee by user name, as hr.person finds them, on the manager's own unit only;
    // anyone else is refused, as hr.absencePattern refuses. Nothing is written: the card's button is hr.reportAbsence
    // with this payload, run after the manager's decision. A day the employee is already away is refused.
    'hr.prepareAbsence': (actor, input) => {
      const key = input.person;
      const unit = managerOf(actor, unitOf(actor)) ? staff(unitOf(actor)) : [];
      const employee = typeof key === 'string' && unit.find(e => e.personId.toLowerCase() === key.toLowerCase());
      if (!employee) throw new Invalid('Medarbetaren finns inte i din enhet.');
      const from = input.from ?? today();
      if (absencesOf(employee).some(a => a.kind !== 'leave' && a.from <= from && a.to >= from))
        throw new Invalid(`${employee.name} är redan frånvarande ${period(from)}.`);
      return {
        topic: `hr:absence-draft:${employee.ref}:${from}`,
        area: 'employees',
        title: 'Sjukanmälan att registrera',
        summary: `Registreras i personalsystemet när du beslutar: sjukfrånvaro ${period(from)}, en dag, heltid.`,
        reason: 'Chefen valde Registrera frånvaro',
        items: [
          {
            ref: employee.ref,
            label: employee.name,
            detail: `Sjuk ${period(from)} · 100 %`,
            selectable: false,
            selected: true,
            subject: { entity: 'person', key },
          },
        ],
        actions: [
          {
            id: 'report',
            label: 'Registrera sjukanmälan',
            capability: 'hr.reportAbsence',
            kind: 'execute',
            role: 'primary',
            input: { person: employee.ref, from, to: from, extent: 100 },
          },
          {
            id: 'pattern',
            label: 'Se mönstret i personalsystemet',
            capability: 'hr.absencePattern',
            kind: 'read',
            role: 'secondary',
            target: 'panel',
            input: { ref: employee.ref },
          },
        ],
      };
    },
  };

  // Each write is one transaction in the source. The fault `conflict` is the source answering that the record moved.
  const writes = {
    'hr.bookTalk': (actor, input) => {
      if (fault === 'conflict') return conflictRows(input.refs, 'Omtankesamtal');
      const talks = booked();
      const unit = staff(unitOf(actor)).map(e => e.ref);
      const rows = input.refs.map(ref => {
        if (!unit.includes(ref)) return { ref, label: 'Omtankesamtal', outcome: 'failed', detail: 'inte i din enhet' };
        // The time, the place and the message the manager gave (D112) are kept with the talk.
        talks[ref] = {
          at: now(),
          when: input.when ?? 'nästa lediga tid',
          ...(input.place ? { place: input.place } : {}),
          ...(input.message ? { message: input.message } : {}),
        };
        return {
          ref,
          label: 'Omtankesamtal',
          outcome: 'done',
          detail: ['registrerat i personalsystemet', input.when ? meetingTime(input.when) : undefined, input.place]
            .filter(Boolean)
            .join(', '),
        };
      });
      state.set('talks', talks);
      const n = rows.filter(r => r.outcome === 'done').length;
      return {
        headline: `${n === 1 ? 'Samtalet är' : n + ' samtal är'} registrerat i personalsystemet.`,
        rows,
        undoCapability: 'hr.unbookTalk',
        undoMinutes: TALK_UNDO_MINUTES,
      };
    },
    'hr.unbookTalk': (_actor, input) => {
      const talks = booked();
      for (const ref of input.refs) delete talks[ref];
      state.set('talks', talks);
      return {
        headline: 'Bokningen är borttagen.',
        rows: input.refs.map(ref => ({
          ref,
          label: 'Omtankesamtal',
          outcome: 'done',
          detail: 'borttaget i personalsystemet',
        })),
      };
    },
    'hr.decideLeave': (actor, input) => {
      if (fault === 'conflict') return conflictRows(input.refs, 'Ansökan');
      const done = decided();
      const unit = staff(unitOf(actor)).map(e => e.ref);
      const rows = input.refs.map(ref => {
        const request = records().leaveRequests.find(r => r.ref === ref && unit.includes(r.employee));
        if (!request) return { ref, label: 'Ansökan', outcome: 'failed', detail: 'finns inte i personalsystemet' };
        done[ref] = { decision: input.decision, at: now(), comment: input.comment };
        return {
          ref,
          label: `Ansökan ${shortDate(request.from)}–${shortDate(request.to)}`,
          outcome: 'done',
          detail:
            input.decision === 'approve'
              ? 'godkänd i personalsystemet, medarbetaren meddelad'
              : 'avslagen i personalsystemet, medarbetaren meddelad',
        };
      });
      state.set('leave-decisions', done);
      return {
        headline: input.decision === 'approve' ? 'Ansökan är godkänd.' : 'Ansökan är avslagen.',
        rows,
        undoCapability: 'hr.undecideLeave',
        undoMinutes: 10,
      };
    },
    'hr.undecideLeave': (_actor, input) => {
      const done = decided();
      for (const ref of input.refs) delete done[ref];
      state.set('leave-decisions', done);
      return {
        headline: 'Beslutet är återtaget; ansökan väntar igen.',
        rows: input.refs.map(ref => ({
          ref,
          label: 'Ansökan',
          outcome: 'done',
          detail: 'väntar igen i personalsystemet',
        })),
      };
    },
    'hr.reportAbsence': (actor, input, operationId) => {
      if (fault === 'conflict') return conflictRows([input.person], 'Sjukanmälan');
      const all = reported();
      const key = operationId ?? `${input.person}:${input.from}`;
      if (all[key]) return absenceReceipt(all[key]);
      if (!staff(unitOf(actor)).some(e => e.ref === input.person))
        throw new Invalid('Medarbetaren finns inte i din enhet.');
      const row = {
        ref: `hr:absence:${input.person.split(':').pop()}:${input.from}`,
        person: input.person,
        from: input.from,
        to: input.to ?? input.from,
        extent: input.extent ?? 100,
        at: now(),
      };
      all[key] = row;
      state.set('reported-absences', all);
      return absenceReceipt(row);
    },
    'hr.withdrawAbsence': (_actor, input) => {
      const all = reported();
      for (const [key, row] of Object.entries(all)) if (input.refs.includes(row.ref)) delete all[key];
      state.set('reported-absences', all);
      return {
        headline: 'Sjukanmälan är borttagen.',
        rows: input.refs.map(ref => ({
          ref,
          label: 'Sjukanmälan',
          outcome: 'done',
          detail: 'borttagen i personalsystemet',
        })),
      };
    },
    'hr.renewDelegation': (actor, input) => {
      const me = own(actor);
      if (fault === 'conflict') return conflictRows(input.refs, 'Delegering');
      const done = renewed();
      const rows = input.refs.map(ref => {
        const d = me && records().delegations.find(x => x.ref === ref && x.employee === me.ref);
        if (!d) return { ref, label: 'Delegering', outcome: 'failed', detail: 'inte din delegering' };
        done[ref] = now();
        return {
          ref,
          label: d.title,
          outcome: 'done',
          detail: `förnyelse bokad med ${d.renewer}${input.when ? ' ' + input.when : ''}`,
        };
      });
      state.set('delegations-renewed', done);
      return { headline: 'Förnyelsen är bokad.', rows };
    },
  };

  /**
   * A write runs once per approved operation (D45): the same operation id answers with the first result, a different
   * input under the same id is refused, and `hr.lookup` finds the result afterwards. Without an id (a direct call) it just runs.
   */
  function execute(actor, name, input, operationId) {
    return state.transaction(() => {
      const digest = hash({ person: personKey(actor), name, input });
      if (operationId) {
        const existing = state.get('op:' + operationId);
        if (existing) {
          if (existing.person !== personKey(actor) || existing.digest !== digest)
            throw new Conflict('Beslutet gäller annat innehåll.');
          return existing.result;
        }
      }
      const result = writes[name](actor, input, operationId);
      if (operationId) state.set('op:' + operationId, { person: personKey(actor), name, digest, result, at: now() });
      return result;
    });
  }

  function scan(actor) {
    const drafts = [];
    const day = today();
    const unitId = unitOf(actor);
    if (managerOf(actor, unitId)) {
      const talks = booked();
      const done = decided();
      for (const c of rehabCandidates(unitId, day)) {
        if (talks[c.employee.ref]) continue;
        const dueBy = addDays(c.latest, 14);
        drafts.push({
          topic: `hr:rehab:${c.employee.ref}`,
          area: 'employees',
          title: 'Boka ett omtankesamtal med en medarbetare',
          summary:
            'Tredje korta sjukfrånvaron på sex månader. Kommunens rehabrutin 4.2 säger samtal inom två veckor. Namnet visas i personalsystemet, inte här.',
          reason: `Rutinens tvåveckorsgräns går ut ${shortDate(dueBy)}`,
          deadline: dueBy,
          // The row names the employee by key only (D97): the card shows on that person for the manager, and the text
          // keeps the name in the HR system.
          items: [
            {
              ref: c.employee.ref,
              label: 'Medarbetare',
              detail: `${c.periods.length} korta perioder sedan ${shortDate(c.periods[0].from)}`,
              selectable: false,
              selected: true,
              subject: { entity: 'person', key: c.employee.personId },
            },
          ],
          actions: [
            {
              id: 'book',
              label: 'Boka samtalet',
              capability: 'hr.bookTalk',
              kind: 'execute',
              role: 'primary',
              usesItems: true,
            },
            {
              id: 'pattern',
              label: 'Se mönstret i personalsystemet',
              capability: 'hr.absencePattern',
              kind: 'read',
              role: 'secondary',
              target: 'panel',
              input: { ref: c.employee.ref },
            },
          ],
        });
      }
      const unit = staff(unitId).map(e => e.ref);
      const open = records().leaveRequests.filter(r => !done[r.ref] && unit.includes(r.employee));
      for (const r of open) {
        const clash = open.some(o => o.ref !== r.ref && o.from <= r.to && o.to >= r.from);
        const asker = records().employees.find(e => e.ref === r.employee);
        drafts.push({
          topic: `hr:leave:${r.ref}`,
          area: 'employees',
          title: `Godkänn en ledighetsansökan, ${shortDate(r.from)} till ${shortDate(r.to)}`,
          summary: `${r.days} dagar ${r.type}. ${clash ? 'En kollega har sökt samma period.' : 'Ingen annan i arbetslaget är ledig då'} och saldot räcker.`,
          reason: `Ansökan kom ${arrivalTime(r.submittedAt)}`,
          deadline: null,
          // The card says what and when; the row names who by key only (D97), so the card shows on that person, and
          // "Se i personalsystemet" shows the source's record.
          items: [
            {
              ref: r.ref,
              label: 'Ansökan',
              detail: `${shortDate(r.from)}–${shortDate(r.to)} · ${r.days} dagar ${r.type}`,
              selectable: false,
              selected: true,
              ...(asker ? { subject: { entity: 'person', key: asker.personId } } : {}),
            },
          ],
          actions: [
            {
              id: 'approve',
              label: 'Godkänn',
              capability: 'hr.decideLeave',
              kind: 'execute',
              role: 'primary',
              usesItems: true,
              input: { decision: 'approve' },
            },
            {
              id: 'open',
              label: 'Se i personalsystemet',
              capability: 'hr.leaveRequests',
              kind: 'read',
              role: 'secondary',
              target: 'panel',
            },
            {
              id: 'reject',
              label: 'Avslå',
              capability: 'hr.decideLeave',
              kind: 'execute',
              role: 'secondary',
              usesItems: true,
              input: { decision: 'reject' },
              confirm: 'Avslå ansökan? Medarbetaren meddelas direkt.',
            },
          ],
        });
      }
    }
    const me = own(actor);
    if (me && actor.role === 'employee') {
      const renewedMap = renewed();
      for (const d of records().delegations.filter(
        d => d.employee === me.ref && !renewedMap[d.ref] && daysBetween(day, d.expires) <= 30,
      )) {
        drafts.push({
          topic: `hr:delegation:${d.ref}`,
          area: 'my-shift',
          title: `Din ${d.title.toLowerCase()} går ut ${shortDate(d.expires)}`,
          summary: `${d.renewer} förnyar den. Tar 20 minuter.`,
          reason: `Går ut om ${daysBetween(day, d.expires)} dagar`,
          deadline: d.expires,
          items: [
            {
              ref: d.ref,
              label: d.title,
              detail: `giltig till ${shortDate(d.expires)}`,
              selectable: false,
              selected: true,
            },
          ],
          actions: [
            {
              id: 'renew',
              label: 'Boka förnyelse',
              capability: 'hr.renewDelegation',
              kind: 'execute',
              role: 'primary',
              usesItems: true,
            },
          ],
        });
      }
      const mine = records().leaveRequests.find(r => r.employee === me.ref);
      if (mine && !decided()[mine.ref])
        drafts.push({
          topic: `hr:leave-waiting:${mine.ref}`,
          area: 'my-shift',
          title: `Semesteransökan ${shortDate(mine.from)}–${shortDate(mine.to)}`,
          summary: 'Ligger hos din chef.',
          reason: 'Du skickade den i morse',
          waitingOn: 'din chef',
          actions: [],
        });
    }
    // Complete local records have no pagination; persistent records use their source refs, a renewal its expiry period.
    return drafts.map(d => ({
      ...d,
      occurrences: d.items?.length
        ? d.items.map(i => ({
            key: i.ref,
            revision: hash([i.label, i.detail, d.summary, d.actions]),
            period: d.topic.includes(':delegation:') ? (d.deadline ?? 'once') : 'once',
          }))
        : [{ key: d.topic, revision: hash(d), period: 'once' }],
    }));
  }

  /** A share as a person reads it, one decimal and a comma: 4,2. */
  const decimal = n => n.toFixed(1).replace('.', ',');
  // The figures (D54): one number per area, formatted here; Clew says the tone in its own words.
  function figure(actor, area) {
    if (area === 'employees' && managerOf(actor, unitOf(actor))) {
      const s = sickLeaveOf[unitOf(actor)];
      if (!s || !staff(unitOf(actor)).length) return null;
      return {
        label: 'Sjukfrånvaro',
        value: `${decimal(s.percent)} %`,
        comparison: `mål ≤ ${decimal(s.target)} % · ${s.change >= 0 ? '+' : '−'}${decimal(Math.abs(s.change))} sedan ${s.since}`,
        tone: s.percent > s.target + 1 ? 'alert' : s.percent > s.target ? 'warn' : 'ok',
        opens: 'hr.absenceOverview',
      };
    }
    if (area === 'my-shift') {
      const me = own(actor);
      const s = me && records().shifts.find(x => x.employee === me.ref && x.date === today());
      // A sentence without a value: the shift is the whole message, so it has no tone.
      return s ? { label: `${s.start}–${s.end} på ${s.ward}.`, tone: 'none' } : { label: 'Ledig i dag.', tone: 'none' };
    }
    return null;
  }

  /** The feed payroll imports from, outside the Clew protocol: the sick reports, as one system reads another's records. */
  const feed = () => ({ rows: Object.values(reported()) });

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (url.pathname === '/fixture/absences') {
      if (!feedKey || request.headers.get('x-fixture-key') !== feedKey) return fail('denied', 'Okänd nyckel.', 401);
      return json(feed());
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Personalsystemet svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Personalsystemet godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') {
        const drafts = scan(actor);
        return json({
          drafts,
          observation: {
            scope: unitOf(actor) + ':' + actor.role,
            observedAt: now(),
            version: hash(drafts),
            completeness: 'complete',
            exhausted: true,
          },
        });
      }
      if (url.pathname === '/clew/figure') return json({ figure: figure(actor, body.area) });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      // Scope again on this side: never trust that the caller filtered. Clew did, but the transport key could leak.
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      let output;
      if (reads[name]) output = reads[name](actor, input);
      else if (proposals[name]) output = proposals[name](actor, input);
      else {
        output = execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
        // The write is committed; the answer is lost on the way back. Clew must read it back, never write again.
        if (fault === 'crash-after-commit') return fail('unavailable', 'Personalsystemet svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Denied) return fail('denied', error.message, 403);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error(error);
      return fail('unavailable', 'Personalsystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
