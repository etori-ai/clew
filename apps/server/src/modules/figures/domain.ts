import type { AuthenticatedContext, Figure } from '@clew/contracts';
import { unitMembers } from '@clew/calendar/accounts';

/**
 * "Läget": four figures, always the same shape. Synthetic data behind a read interface in v1.
 * The utvecklingssamtal figure is computed from the calendar so it stays consistent with the thread.
 */
export function readFigures(
  persona: AuthenticatedContext,
  samtal: { held: number; booked: number; deadline: string },
  now: string,
): Figure[] {
  const members = unitMembers(persona.unitId).length;
  const remaining = Math.max(0, members - samtal.held - samtal.booked);
  return [
    {
      id: 'korttidsfranvaro',
      label: 'Korttidsfrånvaro',
      value: '4,1 %',
      comparison: '3,2 % samma vecka i fjol',
      tone: 'warn',
      source: 'Personalsystemet (syntetiskt)',
      observedAt: now,
    },
    {
      id: 'budgetavvikelse',
      label: 'Budgetavvikelse',
      value: '−1,8 %',
      comparison: 'prognos −0,9 % i september',
      tone: 'alert',
      source: 'Ekonomisystemet (syntetiskt)',
      observedAt: now,
    },
    {
      id: 'hme',
      label: 'HME',
      value: '79',
      comparison: '76 i fjol, kommunen 77',
      tone: 'ok',
      source: 'Medarbetarenkät 2026 (syntetiskt)',
      observedAt: now,
    },
    {
      id: 'utvecklingssamtal',
      label: 'Utvecklingssamtal',
      value: `${remaining} av ${members} kvar`,
      comparison: samtal.booked ? `${samtal.booked} bokade, senast ${samtal.deadline}` : `senast ${samtal.deadline}`,
      tone: remaining === 0 ? 'ok' : samtal.booked >= remaining ? 'warn' : 'alert',
      source: 'Kalendern',
      observedAt: now,
      progress: { value: samtal.held + samtal.booked, max: members },
    },
  ];
}
