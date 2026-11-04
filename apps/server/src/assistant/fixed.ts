import type { AuthenticatedContext } from '@clew/contracts';
import { dayLabel, timeRange, today, weekNumber, nextWeekStart } from '@clew/calendar/dates';
import { readFigures } from '../modules/figures/domain';
import { calendar } from '../composition';

const { ensureProposalThread, readToday, samtalStatus } = calendar;

export type FixedAnswer = { title: string; body: string; reason: string; source: string; forslagThreadId?: string };
/** The first-session intent router: a few questions answered from the calendar and the synthetic figures. Deterministic, no registry. */
export async function routeFixed(persona: AuthenticatedContext, question: string): Promise<FixedAnswer | undefined> {
  const q = question.toLowerCase();
  if (/i ?dag|idag|dagens|schema/.test(q)) {
    const view = await readToday(persona);
    const timed = view.events.filter(e => !e.allDay);
    const list = timed.length ? timed.map(e => `${timeRange(e.start, e.end)} ${e.title}`).join('; ') : 'inga inbokade möten';
    const gap = view.gaps.sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0];
    return { title: 'I dag', body: `${dayLabel(view.date)}: ${list}. ${gap ? `Längsta lucka ${timeRange(gap.start, gap.end)}.` : ''}`.trim(), reason: 'Du frågade om dagen', source: 'Kalendern' };
  }
  if (/utvecklingssamtal|\bsamtal\b|förslag/.test(q)) {
    const status = await samtalStatus(persona);
    const thread = persona.role === 'manager' ? await ensureProposalThread(persona, 'Din fråga') : undefined;
    const open = thread?.proposals.filter(p => p.status === 'proposed').length ?? 0;
    return { title: 'Utvecklingssamtal', body: `${status.held} hållna, ${status.booked} bokade, ${Math.max(0, 4 - status.held - status.booked)} saknar tid före ${status.deadline}.${open ? ` ${open} förslag väntar i kortet för vecka ${weekNumber(nextWeekStart(today()))} under Behöver dig.` : ''}`,
      reason: 'Du frågade om utvecklingssamtalen', source: 'Kalendern', ...(open && thread ? { forslagThreadId: thread.id } : {}) };
  }
  if (/frånvaro|\bsjuk|budget|hme|läget|siffr/.test(q)) {
    const figures = readFigures(persona, await samtalStatus(persona), new Date().toISOString());
    const pick = figures.filter(f => (/frånvaro|sjuk/.test(q) && f.id === 'korttidsfranvaro') || (/budget/.test(q) && f.id === 'budgetavvikelse') || (/hme/.test(q) && f.id === 'hme'));
    const chosen = pick.length ? pick : figures;
    return { title: chosen.length === 1 ? chosen[0]!.label : 'Läget', body: chosen.map(f => `${f.label}: ${f.value}, ${f.comparison}.`).join(' '), reason: 'Du frågade om läget', source: chosen.map(f => f.source).join(', ') };
  }
  if (/varför|vafför|why/.test(q)) {
    return { title: 'Varför ser du detta?', body: 'Varje kort på sidan kommer från en utlösare: en nattlig genomgång, en händelse i ett källsystem eller en fråga från dig. Källa och tid står på varje kort, och "Varför ser jag detta?" i kortets meny visar skälet. Du får högst tre avbrott per dag; resten samlas till lunch eller nästa morgon.', reason: 'Du frågade om sidan', source: 'Startsidan' };
  }
  return undefined;
}
