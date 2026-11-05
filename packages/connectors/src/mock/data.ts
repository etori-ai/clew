/**
 * Synthetic people and records shared by the mock integrations. Names are fictional; the four calendar-bound
 * members match `@clew/calendar/accounts` so the planner and the HR mock agree on who works at the school.
 * Everything here is deterministic so a demo repeats itself.
 */
export interface Employee { ref: string; personId: string; name: string; email: string; unitId: string; role: string; }
export const UNIT = 'unit-skola';
export const employees: Employee[] = [
  { ref: 'hr:emp:1001', personId: 'anna', name: 'Anna Lindqvist', email: 'anna@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1002', personId: 'erik', name: 'Erik Sandström', email: 'erik@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1003', personId: 'maria', name: 'Maria Källström', email: 'maria@clew.test', unitId: UNIT, role: 'Specialpedagog' },
  { ref: 'hr:emp:1004', personId: 'johan', name: 'Johan Byström', email: 'johan@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1005', personId: 'hassan', name: 'Hassan Ali', email: 'hassan@clew.test', unitId: UNIT, role: 'Elevassistent' },
  { ref: 'hr:emp:1006', personId: 'lena', name: 'Lena Öhman', email: 'lena@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1007', personId: 'omar', name: 'Omar Haddad', email: 'omar@clew.test', unitId: UNIT, role: 'Fritidspedagog' },
  { ref: 'hr:emp:1008', personId: 'sara', name: 'Sara Nyström', email: 'sara@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1009', personId: 'per', name: 'Per Lindahl', email: 'per@clew.test', unitId: UNIT, role: 'Vaktmästare' },
  { ref: 'hr:emp:1010', personId: 'mona', name: 'Mona Berg', email: 'mona@clew.test', unitId: UNIT, role: 'Skoladministratör' },
  { ref: 'hr:emp:1011', personId: 'jonas', name: 'Jonas Kask', email: 'jonas@clew.test', unitId: UNIT, role: 'Lärare' },
  { ref: 'hr:emp:1012', personId: 'aisha', name: 'Aisha El Amin', email: 'aisha@clew.test', unitId: UNIT, role: 'Kurator' },
];
export const managerOf: Record<string, string> = { 'unit-skola': 'hillevi' };
/** Absence periods, inclusive dates. `kind` short = sjuk ≤ 14 days, vab, long = sjukskrivning. */
export interface Absence { employee: string; from: string; to: string; kind: 'short' | 'vab' | 'long'; }
export const absences: Absence[] = [
  { employee: 'hr:emp:1001', from: '2026-06-12', to: '2026-06-13', kind: 'short' },
  { employee: 'hr:emp:1001', from: '2026-08-18', to: '2026-08-18', kind: 'short' },
  { employee: 'hr:emp:1001', from: '2026-11-02', to: '2026-11-02', kind: 'short' },
  { employee: 'hr:emp:1004', from: '2026-10-05', to: '2026-10-06', kind: 'vab' },
  { employee: 'hr:emp:1006', from: '2026-10-26', to: '2026-12-18', kind: 'long' },
  { employee: 'hr:emp:1008', from: '2026-11-03', to: '2026-11-03', kind: 'short' },
  { employee: 'hr:emp:1011', from: '2026-11-03', to: '2026-11-04', kind: 'vab' },
  { employee: 'hr:emp:1002', from: '2026-09-14', to: '2026-09-15', kind: 'short' },
];
export interface LeaveRequest { ref: string; employee: string; from: string; to: string; days: number; type: 'semester' | 'tjänstledigt'; submittedAt: string; }
export const leaveRequests: LeaveRequest[] = [
  { ref: 'hr:leave:7781', employee: 'hr:emp:1004', from: '2026-12-22', to: '2026-12-23', days: 2, type: 'semester', submittedAt: '2026-11-02T16:40:00+01:00' },
  { ref: 'hr:leave:7790', employee: 'hr:emp:1005', from: '2026-12-22', to: '2026-12-26', days: 5, type: 'semester', submittedAt: '2026-11-03T06:35:00+01:00' },
];
export interface Delegation { ref: string; employee: string; title: string; expires: string; renewer: string; }
export const delegations: Delegation[] = [
  { ref: 'hr:deleg:301', employee: 'hr:emp:1005', title: 'Läkemedelsdelegering', expires: '2026-11-28', renewer: 'Maria Källström (ssk)' },
  { ref: 'hr:deleg:302', employee: 'hr:emp:1007', title: 'Brandskyddsansvarig', expires: '2026-12-15', renewer: 'Per Lindahl' },
];
export interface Shift { employee: string; date: string; start: string; end: string; ward: string; }
export const shifts: Shift[] = [
  { employee: 'hr:emp:1005', date: '2026-11-03', start: '07:00', end: '16:00', ward: 'Björken' },
  { employee: 'hr:emp:1005', date: '2026-11-04', start: '07:00', end: '16:00', ward: 'Björken' },
  { employee: 'hr:emp:1006', date: '2026-11-03', start: '07:00', end: '16:00', ward: 'Björken' },
  { employee: 'hr:emp:1007', date: '2026-11-03', start: '07:00', end: '16:00', ward: 'Björken' },
  { employee: 'hr:emp:1012', date: '2026-11-03', start: '12:00', end: '20:00', ward: 'Björken' },
];
export interface Invoice { ref: string; supplier: string; amount: number; due: string; order: string; costCentre: string; account: string; }
export const invoices: Invoice[] = [
  { ref: 'finance:inv:55120', supplier: 'Skolgrossisten', amount: 11200, due: '2026-11-05', order: '2026-0412', costCentre: 'KS-4410', account: 'Läromedel' },
  { ref: 'finance:inv:55121', supplier: 'Skolgrossisten', amount: 7200, due: '2026-11-05', order: '2026-0412', costCentre: 'KS-4410', account: 'Läromedel' },
  { ref: 'finance:inv:55140', supplier: 'Energibolaget', amount: 18650, due: '2026-11-12', order: '', costCentre: 'KS-4410', account: 'Lokaler' },
];
export const costCentreOf: Record<string, string> = { 'unit-skola': 'KS-4410' };
export interface Budget { costCentre: string; budget: number; outcome: number; forecast: number; driver: string; }
export const budgets: Budget[] = [{ costCentre: 'KS-4410', budget: 37_400_000, outcome: 31_900_000, forecast: 38_110_000, driver: 'vikarier −710 tkr' }];
export interface Deviation { ref: string; unitId: string; title: string; reportedBy: string; reportedAt: string; state: 'open' | 'waiting-safety-rep' | 'closed'; waitingOn?: string; dueBy?: string; }
export const deviations: Deviation[] = [
  { ref: 'incidents:dev:2026-1182', unitId: UNIT, title: 'Tillbud 2026-1182, halkolycka i duschen', reportedBy: 'hr:emp:1005', reportedAt: '2026-10-30T11:10:00+01:00', state: 'waiting-safety-rep', waitingOn: 'skyddsombudets yttrande', dueBy: '2026-11-06' },
];
export interface Notice { ref: string; title: string; body: string; publishedAt: string; requiresReceipt: boolean; audience: 'all' | 'managers'; }
export const notices: Notice[] = [
  { ref: 'komm:notice:2026-44-1', title: 'Ny rutin vid hot och våld', body: 'Från 1 december gäller en ny rutin vid hot och våld i skolan. Läs rutinen och bekräfta att du tagit del av den.', publishedAt: '2026-11-03T06:30:00+01:00', requiresReceipt: true, audience: 'all' },
  { ref: 'komm:notice:2026-44-2', title: 'Enkät om matsalen', body: 'Kostenheten vill veta hur matsalen fungerar. Tar tre minuter.', publishedAt: '2026-11-02T09:00:00+01:00', requiresReceipt: false, audience: 'all' },
];
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const money = (n: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n);
export const shortDate = (d: string) => new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00'));
