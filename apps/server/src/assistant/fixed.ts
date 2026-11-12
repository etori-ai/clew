import type { AuthenticatedContext } from '@clew/contracts';
import { dayLabel, displayDate, timeRange, weekNumber, nextWeekStart } from '@clew/calendar/dates';
import { actorOf } from '@clew/connectors';
import type { AssistantDeps } from './ports';

export type FixedAnswer = { title: string; body: string; reason: string; source: string; forslagThreadId?: string };
/** The first-session intent router: a few questions answered from the calendar and the areas' figures (D54). Deterministic, no model. */
export async function routeFixed(
  deps: AssistantDeps,
  persona: AuthenticatedContext,
  question: string,
): Promise<FixedAnswer | undefined> {
  const q = question.toLowerCase();
  const now = deps.clock().toISOString();
  if (/i ?dag|idag|dagens|schema/.test(q) && deps.registry.visible(persona, 'calendar')) {
    const view = await deps.calendar.readToday(persona);
    const timed = view.events.filter(e => !e.allDay);
    const list = timed.length
      ? timed.map(e => `${timeRange(e.start, e.end)} ${e.title}`).join('; ')
      : 'inga inbokade möten';
    const gap = view.gaps.sort(
      (a, b) => Date.parse(b.end) - Date.parse(b.start) - (Date.parse(a.end) - Date.parse(a.start)),
    )[0];
    return {
      title: 'I dag',
      body: `${dayLabel(view.date)}: ${list}. ${gap ? `Längsta lucka ${timeRange(gap.start, gap.end)}.` : ''}`.trim(),
      reason: 'Du frågade om dagen',
      source: 'Kalendern',
    };
  }
  if (/utvecklingssamtal|\bsamtal\b|förslag/.test(q) && deps.registry.visible(persona, 'calendar')) {
    const status = await deps.calendar.samtalStatus(persona);
    const thread =
      persona.role === 'manager' ? await deps.calendar.ensureProposalThread(persona, 'Din fråga') : undefined;
    const open = thread?.proposals.filter(p => p.status === 'proposed').length ?? 0;
    // The team and the round come from the status (D96 item 3); with neither there is nothing to count.
    const missing = Math.max(0, status.members - status.held - status.booked);
    return {
      title: 'Utvecklingssamtal',
      body: status.members
        ? `${status.held} hållna, ${status.booked} bokade, ${missing} saknar tid före ${status.deadline}.${open ? ` ${open} förslag väntar i ärendet för vecka ${weekNumber(nextWeekStart(displayDate(now)))} under Behöver dig.` : ''}`
        : 'Det finns inga utvecklingssamtal att planera just nu.',
      reason: 'Du frågade om utvecklingssamtalen',
      source: 'Kalendern',
      ...(open && thread ? { forslagThreadId: thread.id } : {}),
    };
  }
  if (/frånvaro|\bsjuk|budget|ramen|tillbud|vikarie|läget|siffr|nyckeltal/.test(q)) {
    // The figures the person's connectors answer (D54), as Läget draws them; one whose words the question names, else all.
    const figures = (await deps.registry.areas(actorOf(persona)))
      .filter(a => a.figure?.value && !a.figure.unavailable)
      .map(a => ({ ...a.figure!, area: a.title, source: a.source }));
    const words = q.match(/[a-zåäö]{5,}/g) ?? [];
    const pick = figures.filter(f =>
      words.some(w => `${f.label} ${f.area}`.toLowerCase().includes(w.slice(0, Math.max(5, w.length - 3)))),
    );
    const chosen = pick.length ? pick : figures;
    if (!chosen.length) return undefined;
    return {
      title: chosen.length === 1 ? chosen[0]!.label : 'Läget',
      body: chosen.map(f => `${f.label}: ${f.value}${f.comparison ? `, ${f.comparison}` : ''}.`).join(' '),
      reason: 'Du frågade om läget',
      source: [...new Set(chosen.map(f => f.source))].join(', '),
    };
  }
  if (/varför|vafför|why/.test(q)) {
    return {
      title: 'Varför ser du detta?',
      body: 'Varje ärende kommer från en utlösare: en nattlig genomgång, en händelse i ett källsystem eller en fråga från dig. Källa och tid står på varje ärende, och "Varför ser jag detta?" i ärendet visar skälet. Du får högst tre avbrott per dag; resten samlas till lunch eller nästa morgon.',
      reason: 'Du frågade om sidan',
      source: 'Startsidan',
    };
  }
  return undefined;
}
