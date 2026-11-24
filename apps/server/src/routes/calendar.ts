import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthenticatedContext, WeekView } from '@clew/contracts';
import { failure, type Env } from '../context';

export interface CalendarRouteDeps {
  /** The week the person reads on Kalender (`weekOverview`): the use case owns the date's check and the scope. */
  weekOverview(persona: AuthenticatedContext, from?: string): Promise<WeekView>;
  /** The session guard of a test; inside the API its own guard stands in front. */
  guard?: MiddlewareHandler<Env>;
}
/**
 * Kalender's week (`GET /api/calendar?from=YYYY-MM-DD`): the person's events and live proposals for the week holding
 * `from`, this week when it is absent. A date that is not a day of the calendar (2026-02-30) is refused as one, with the
 * words the page shows, never read as another day. Mounted under `/api/calendar` behind the API's session guard.
 */
export function calendarRoutes(deps: CalendarRouteDeps) {
  const routes = new Hono<Env>();
  if (deps.guard) routes.use('*', deps.guard);
  routes.get('/', async c => c.json(await deps.weekOverview(c.get('session').context, c.req.query('from'))));
  routes.onError((error, c) => failure(c, error));
  return routes;
}
