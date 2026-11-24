import type { AuthenticatedContext } from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import type { RefreshDeps } from '../refresh-model';

/** How long one source's scan may take before the refresh counts it as not answering (D47). */
export const SOURCE_DEADLINE_MS = 10_000;

/** The calendar's part of a person's scan: the planner's card, and the reading back of the invitations they sent. */
export interface CalendarScan {
  /** Keep the planner's card in step with the round (`ensureProposalThread` of the calendar's talk planning). */
  ensureProposalThread(persona: AuthenticatedContext): Promise<unknown>;
  /** Read the person's sent invitations back by their events' ids (D133); at most once an hour per manager. */
  follow(persona: AuthenticatedContext): Promise<unknown>;
}
export interface ScanSourcesDeps {
  registry: Pick<Registry, 'listFor' | 'governance' | 'scanOne' | 'connector' | 'refreshGovernance'>;
  calendar: CalendarScan;
  /**
   * Where a failure no request waits for is said, in the scope of the part that failed (`calendar`): composition binds
   * it to `logPort(scope, 'error')`.
   */
  log: (scope: string, message: string, ...details: unknown[]) => void;
  /** The deadline of one source's scan; `SOURCE_DEADLINE_MS` unless a test shortens it. */
  deadlineMs?: number;
}

/**
 * Which sources a person's scan reads and how each is read, as the server runs the refresh (`composition/refresh.ts`,
 * D47), and as the unit suites run it (`tests/refresh-scan.ts`), so a test world scans the way the server does. The
 * sources are the connectors the person sees whose scan an administrator has switched on, with the administrator's
 * decisions read again first; the calendar, which declares no scan of its own, is among them while its scan is on. A
 * connector is scanned through the registry as the person, with the token of the session behind the request (D26);
 * the calendar is scanned in process: the planner's card is kept in step and the invitations the person sent are read
 * back. The reading back asks the calendar once per invitation, so it is started and not waited for: it never counts
 * against the deadline, never holds the planner up, and a failure is logged. What it finds reaches the talk's tab when
 * it has run and the card at the next scan. Every scan has a deadline, past which the source counts as not answering.
 */
export function scanSources(deps: ScanSourcesDeps): Pick<RefreshDeps, 'sources' | 'system' | 'scan'> {
  const { registry, calendar, log, deadlineMs = SOURCE_DEADLINE_MS } = deps;
  async function calendarScan(persona: AuthenticatedContext) {
    await calendar.ensureProposalThread(persona);
    void calendar.follow(persona).catch(error => log('calendar', 'invitations could not be read back', error));
    return { drafts: [] };
  }
  return {
    sources: async persona => {
      await registry.refreshGovernance();
      return registry
        .listFor(persona)
        .filter(c => (c.scan || c.id === 'calendar') && registry.governance(c.id).scanEnabled)
        .map(c => c.id);
    },
    system: id => registry.connector(id)?.source ?? id,
    scan: async (persona, id) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          id === 'calendar'
            ? calendarScan(persona)
            : registry.scanOne(persona, id, persona.delegate ? { delegate: persona.delegate } : {}),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Source deadline exceeded')), deadlineMs);
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
