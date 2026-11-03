import type { AuthenticatedContext, Thread } from '@clew/contracts';
import { database, schema } from '@clew/db';
import { addMessage, readThread, writeAudit } from '@clew/db/threads';
import { dayLabel, timeRange, today, weekNumber, nextWeekStart } from '@clew/calendar/dates';
import { readToday } from './calendar';
import { readFigures } from './figures';
import { ensureProposalThread, samtalStatus, TOPIC } from './planner';
import { InputError } from './context';

/**
 * The question box in v1: typeahead completions plus a deterministic intent router, so the first use case works
 * without a model endpoint. When AI_BASE_URL/AI_API_KEY/AI_MODEL are configured the same questions can be routed
 * through the AI SDK; that path is not wired in this session (see HANDOVER).
 */
export const completions = [
  'Vad har jag i dag?',
  'Hur ligger vi till med utvecklingssamtalen?',
  'Visa förslagen för nästa vecka',
  'Hur ser korttidsfrånvaron ut?',
  'Hur ligger budgeten?',
  'Vad säger HME?',
  'Varför ser jag detta?',
];
type Answer = { title: string; body: string; reason: string; source: string; openProposals?: boolean };
async function answer(persona: AuthenticatedContext, question: string): Promise<Answer> {
  const q = question.toLowerCase();
  const now = new Date().toISOString();
  if (/i ?dag|idag|dagens|schema/.test(q)) {
    const view = await readToday(persona);
    const timed = view.events.filter(e => !e.allDay);
    const list = timed.length ? timed.map(e => `${timeRange(e.start, e.end)} ${e.title}`).join('; ') : 'inga inbokade möten';
    const gap = view.gaps.sort((a, b) => (Date.parse(b.end) - Date.parse(b.start)) - (Date.parse(a.end) - Date.parse(a.start)))[0];
    return { title: 'I dag', body: `${dayLabel(view.date)}: ${list}. ${gap ? `Längsta lucka ${timeRange(gap.start, gap.end)}.` : ''}`.trim(), reason: 'Du frågade om dagen', source: 'Kalendern' };
  }
  if (/utvecklingssamtal|samtal|förslag/.test(q)) {
    const status = await samtalStatus(persona);
    const thread = persona.role === 'manager' ? await ensureProposalThread(persona, 'Din fråga') : undefined;
    const open = thread?.proposals.filter(p => p.status === 'proposed').length ?? 0;
    return { title: 'Utvecklingssamtal', body: `${status.held} hållna, ${status.booked} bokade, ${Math.max(0, 4 - status.held - status.booked)} saknar tid före ${status.deadline}.${open ? ` ${open} förslag väntar i tråden för vecka ${weekNumber(nextWeekStart(today()))}.` : ''}`,
      reason: 'Du frågade om utvecklingssamtalen', source: 'Kalendern', openProposals: open > 0 };
  }
  if (/frånvaro|sjuk|budget|hme|läget|siffr/.test(q)) {
    const figures = readFigures(persona, await samtalStatus(persona));
    const pick = figures.filter(f => (/frånvaro|sjuk/.test(q) && f.id === 'korttidsfranvaro') || (/budget/.test(q) && f.id === 'budgetavvikelse') || (/hme/.test(q) && f.id === 'hme'));
    const chosen = pick.length ? pick : figures;
    return { title: chosen.length === 1 ? chosen[0]!.label : 'Läget', body: chosen.map(f => `${f.label}: ${f.value}, ${f.comparison}.`).join(' '), reason: 'Du frågade om läget', source: chosen.map(f => f.source).join(', ') };
  }
  if (/varför|vafför|why/.test(q)) {
    return { title: 'Varför ser du detta?', body: 'Varje tråd på sidan kommer från en utlösare: en nattlig genomgång, en händelse i ett källsystem eller en fråga från dig. Källa och tid står under varje tråd. Du får högst tre avbrott per dag; resten samlas till lunch eller nästa morgon.', reason: 'Du frågade om sidan', source: 'Startsidan' };
  }
  return { title: question, body: 'Det där kan jag inte svara på ännu. Fråga om dagen, utvecklingssamtalen, korttidsfrånvaron, budgeten eller HME.', reason: 'Du ställde en fråga', source: 'Startsidan', openProposals: false };
}
/** A question becomes a thread under the box: the answer is the thread's first assistant message, with memory. */
export async function ask(persona: AuthenticatedContext, question: string): Promise<Thread> {
  const result = await answer(persona, question);
  const id = crypto.randomUUID(), now = new Date();
  await database().transaction(async tx => {
    await tx.insert(schema.threads).values({ id, personId: persona.id, kind: 'question', topic: 'question', title: result.title, state: 'open', week: null, module: 'startsidan', area: 'fragor', summary: result.body,
      trigger: { reason: result.reason, source: result.source, at: now.toISOString() } });
    await addMessage(tx, id, 'user', question);
    await addMessage(tx, id, 'assistant', result.body);
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.asked', subject: 'thread:' + id, details: { source: result.source } });
  });
  return (await readThread(persona.id, id))!.thread;
}
/** A reply in place keeps the thread's memory. The router answers in the same thread. */
export async function reply(persona: AuthenticatedContext, threadId: string, body: string): Promise<Thread> {
  const current = await readThread(persona.id, threadId);
  if (!current) throw new InputError('Tråden finns inte.');
  const result = current.row.topic === TOPIC && /nästa vecka|vecka \d+/.test(body.toLowerCase()) ? null : await answer(persona, body);
  await database().transaction(async tx => {
    await addMessage(tx, threadId, 'user', body);
    await addMessage(tx, threadId, 'assistant', result ? result.body : 'Välj veckan med knappen "Vecka … i stället" ovanför, så ritar jag om förslagen.');
    await writeAudit(tx, { actor: persona.principal.id, action: 'thread.replied', subject: 'thread:' + threadId });
  });
  return (await readThread(persona.id, threadId))!.thread;
}
