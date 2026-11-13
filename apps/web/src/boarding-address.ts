import type { BoardingEvent } from '@clew/contracts';
import { wayBack } from './person-address';

/**
 * Where introduction and leaving are (D124, D116, D43): `/boarding/<personId>` is one person's plans as a page, by the
 * person's Clew id, the way in that `boarding.person` declares (`/boarding/{id}`) on a person's page and Personal's lens.
 * `plan=<id>` chooses one of their plans when they have several (left out, the page shows the open one, else the latest),
 * `from` is the page it was opened from, the way back, and `start=introduction` or `start=leaving` is the start dialog
 * over the page, so a link and the suggestion's card can open it; closing the dialog drops it. Two reads open here too:
 * the page of `boarding.plan` (an item's card leads there, D116) is the plan's page, and the page of `boarding.person`
 * for one person (the suggestion's card) is that person's page. Administration › Introduktion och avslut is
 * `/admin/boarding`, with the import of layers at `/admin/boarding/import`. This file imports nothing of the pages, so
 * a unit test loads it on its own.
 */
export const BOARDING_PATH = '/boarding';
export const BOARDING_ADMIN_PATH = '/admin/boarding';
export const BOARDING_IMPORT_PATH = '/admin/boarding/import';
export const PLAN_PARAM = 'plan';
export const START_PARAM = 'start';
/** The reads whose page is this page (D116): one plan, and one person's standing. */
export const PLAN_READ = 'boarding.plan';
export const PERSON_READ = 'boarding.person';
/** Personal with the lens Introduktion och avslut (D97): where a read about more than one person leads. */
export const BOARDING_LENS_HREF = `/staff?show=${PERSON_READ}`;

const address = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** An id as an address names one: 1 to 80 characters, else none. */
const idIn = (value: string | null | undefined) => (value && value.length <= 80 ? value : null);

/** The person's page of introduction and leaving, with a plan chosen, the start dialog over it and the way back. */
export function boardingHref(
  personId: string,
  options: { plan?: string | null; start?: BoardingEvent | null; from?: string | null } = {},
): string {
  const q = new URLSearchParams();
  if (options.plan) q.set(PLAN_PARAM, options.plan);
  if (options.start) q.set(START_PARAM, options.start);
  const from = wayBack(options.from);
  if (from) q.set('from', from);
  return address(`${BOARDING_PATH}/${encodeURIComponent(personId)}`, q);
}
/** The person whose page `pathname` is (`/boarding/<personId>`), or null on any other page. */
export function boardingPersonOf(pathname: string): string | null {
  const match = /^\/boarding\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return idIn(decodeURIComponent(match[1]!));
  } catch {
    return null;
  }
}
/** The plan the address chooses, or null for the page's own choice. */
export const planOf = (search: URLSearchParams | string) => idIn(new URLSearchParams(search).get(PLAN_PARAM));
/** The plan chosen in the address, everything else kept: the start dialog closes with the choice, as it was. */
export function withPlan(pathname: string, search: URLSearchParams | string, plan: string): string {
  const q = new URLSearchParams(search);
  q.delete(START_PARAM);
  q.set(PLAN_PARAM, plan);
  return address(pathname, q);
}
/** The event whose start dialog the address opens over the page, or null for none. */
export function startOf(search: URLSearchParams | string): BoardingEvent | null {
  const value = new URLSearchParams(search).get(START_PARAM);
  return value === 'introduction' || value === 'leaving' ? value : null;
}
/** The page with the start dialog for this event over it; the rest of the address is kept. */
export function withStart(pathname: string, search: URLSearchParams | string, event: BoardingEvent): string {
  const q = new URLSearchParams(search);
  q.set(START_PARAM, event);
  return address(pathname, q);
}
/** The page with the start dialog closed: the address without `start`. */
export function withoutStart(pathname: string, search: URLSearchParams | string): string {
  const q = new URLSearchParams(search);
  q.delete(START_PARAM);
  return address(pathname, q);
}

/** A read's page input (`?input=…`, D116) as an object; an empty one for none or for what is no JSON object. */
function inputOf(search: URLSearchParams | string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new URLSearchParams(search).get('input') ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
/**
 * What the page of `boarding.plan` names (`/tools/boarding.plan?input={"plan":…}&from=…`, an item's card): the plan and
 * the way back. The plan's page is keyed on the person, so the page reads the plan to learn whose it is.
 */
export function planReadOf(search: URLSearchParams | string): { plan: string | null; from: string | null } {
  const plan = inputOf(search).plan;
  return {
    plan: typeof plan === 'string' ? idIn(plan) : null,
    from: wayBack(new URLSearchParams(search).get('from')),
  };
}
/**
 * What the page of `boarding.person` names (`/tools/boarding.person?input={"keys":[…]}&from=…`, the suggestion's card):
 * the one person's user name when it names exactly one, and the way back. More than one is a list: Personal's lens.
 */
export function personReadOf(search: URLSearchParams | string): { key: string | null; from: string | null } {
  const keys = inputOf(search).keys;
  const key = Array.isArray(keys) && keys.length === 1 && typeof keys[0] === 'string' ? keys[0] : null;
  return {
    key: key && key.length <= 256 ? key : null,
    from: wayBack(new URLSearchParams(search).get('from')),
  };
}
