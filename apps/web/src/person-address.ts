import { sameSubject, type EntityPage, type PanelViewSpec, type Subject } from '@clew/contracts';
import { pageOnly } from './panel-address';
import { TALK_PARAM, sourcePageHref } from './talk-address';
import { DIALOGUE_PARAM } from './dialogue-address';

/**
 * Where a person or a unit is (D97, D43, D83 rule 4, D111 rule 3): `/people/<key>` is the person as a page, by Clew's key,
 * their id (D122: never their user name, which may be renamed or reused), with `section` the source whose fuller view is
 * drawn and `from` the page they were opened from, for the way back;
 * `/units/<id>` is the unit as a page, with `from` the same way. A person is a page only: nothing draws them beside a
 * list, and the address that once did (`?person=`) leads to their page (`fromPersonBeside`).
 */
/** The value Behöver dig takes in the address (`?section=`): never a capability's name, which always has a dot. */
export const NEEDS_YOU = 'needs-you';
/**
 * The tabs of a person's own page that are not a source's (D126 rule 7: a person's own competences and plan are tabs of
 * their own page): `?section=competence` is Mina kompetenser, `?section=plan` the person's own introduction or leaving.
 * Neither has a dot, so neither is ever a capability's name.
 */
export const OWN_COMPETENCE = 'competence';
export const OWN_PLAN = 'plan';
const addressOf = (pathname: string, query: URLSearchParams) => {
  const q = query.toString();
  return q ? `${pathname}?${q}` : pathname;
};
/** A path inside Clew, never another site: what `from` may hold. */
export const insideClew = (path: string | null): string | null =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
/**
 * The page a person or a unit was opened from, as `from` holds it: a path inside Clew with its own search, never the
 * `from` of that page, so a way back never holds another way back (`/people/anna?from=/staff` names `/people/anna`).
 * The trail and the rail name `from` by its path alone (`originOf`: Hem, Personal, Kalender or a tool, never a person
 * or a unit), and the trail leads back to it with its own search (a card still open beside it), so the nested one was
 * never read.
 */
export const wayBack = (path: string | null | undefined): string | null => {
  const inside = insideClew(path ?? null);
  const at = inside ? inside.indexOf('?') : -1;
  if (!inside || at < 0) return inside;
  const q = new URLSearchParams(inside.slice(at + 1));
  if (!q.has('from')) return inside;
  q.delete('from');
  return addressOf(inside.slice(0, at), q);
};
/** The person as a page, with a section chosen and the list it was opened from. */
export function personPageHref(key: string, options: { section?: string; from?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (options.section) q.set('section', options.section);
  const from = wayBack(options.from);
  if (from) q.set('from', from);
  return addressOf(`/people/${encodeURIComponent(key)}`, q);
}
/**
 * The person's page as a name in a list leads to it (the product owner, 2026-11-11: the name opens the page), with the
 * list as its way back: the list's own address, its lens kept and nothing of its panel.
 */
export const personPageFrom = (pathname: string, search: URLSearchParams | string, key: string): string =>
  personPageHref(key, { from: pageOnly(pathname, search) });
/**
 * Where an address that drew a person beside a list now leads (D111 answer 1): `?person=<key>` on the list, kept in
 * bookmarks and sent links, is the person's page with the list as its way back. The section drilled into on a phone
 * (`person-section`) is the page's `section`, and a card open over the person stays open beside the page. Null for any
 * other address.
 */
export function fromPersonBeside(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const key = q.get('person');
  if (!key) return null;
  const section = q.get('person-section') || undefined;
  const card = q.get('card');
  q.delete('person');
  q.delete('person-section');
  const page = personPageHref(key, { ...(section ? { section } : {}), from: pageOnly(pathname, q) });
  return card ? `${page}${page.includes('?') ? '&' : '?'}card=${encodeURIComponent(card)}` : page;
}
/**
 * Where an address that listed a person's cards beside Personal now leads (D111, amended 2026-11-11: the panel holds one
 * opened thing): `?cards=<key>`, with `cards-kind`, is the person's page at Behöver dig with the list as its way back,
 * and a card open over that list stays open beside the page. Null for any other address.
 */
export function fromCardsBeside(pathname: string, search: URLSearchParams | string): string | null {
  const q = new URLSearchParams(search);
  const key = q.get('cards');
  if (!key) return null;
  const card = q.get('card');
  q.delete('cards');
  q.delete('cards-kind');
  const page = personPageHref(key, { section: NEEDS_YOU, from: pageOnly(pathname, q) });
  return card ? `${page}&card=${encodeURIComponent(card)}` : page;
}
/** The unit as a page (D97, artboard E), with a tab chosen (`section`, as a person's) and the page it was opened from. */
export function unitPageHref(id: string, options: { section?: string; from?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (options.section) q.set('section', options.section);
  const from = wayBack(options.from);
  if (from) q.set('from', from);
  return addressOf(`/units/${encodeURIComponent(id)}`, q);
}
/** The person or unit whose page `pathname` is (`/people/<key>`, `/units/<id>`), or null on any other page. */
export function pageSubject(pathname: string): Subject | null {
  const match = /^\/(people|units)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return { entity: match[1] === 'units' ? 'unit' : 'person', key: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}
/**
 * The entity a record of a declared view names (D97 item 6), by Clew's key (D122): a unit by the id the record holds, a
 * person by their id, found from the source's key in the record, their user name, in `view.people`, which the server
 * fills for the reader. A user name nobody of the reader's organisation holds now has no id there: the record names
 * nobody, and links nowhere.
 */
export function recordSubject(view: PanelViewSpec, value: unknown): Subject | undefined {
  const subject = view.kind === 'table' || view.kind === 'list' || view.kind === 'detail' ? view.subject : undefined;
  if (!subject || typeof value !== 'string' || !value) return undefined;
  const key =
    subject.entity === 'unit'
      ? value
      : view.people && Object.hasOwn(view.people, value)
        ? view.people[value]
        : undefined;
  return key ? { entity: subject.entity, key } : undefined;
}
/**
 * Where a row that names an entity leads (D97 item 6): a person to their page, a unit to its page, each with the
 * address of the page the row was on as `from`, so the way back returns to it as it was (a work item still open in Att
 * göra's reading pane).
 * Null on the entity's own page: a row there that names the person or unit the page is about would lead to the page the
 * reader is already on, out of the card it stands in, so its name is plain text (the product owner, 2026-11-11).
 */
export function entityHref(subject: Subject, from?: string | null): string | null {
  const here = from ? pageSubject(from.split('?')[0]!) : null;
  if (here && sameSubject(here, subject)) return null;
  const options = { from: from ?? null };
  return subject.entity === 'unit' ? unitPageHref(subject.key, options) : personPageHref(subject.key, options);
}
/** The name of a page a person can be opened from, for the way back ("‹ Personal"); null for a page without one. */
export function originLabel(path: string | null): string | null {
  if (!path) return null;
  const pathname = path.split('?')[0]!;
  if (pathname === '/admin/users') return 'Användare';
  // A unit's page under Organisation, when the page that knows the unit's name has not given it (`person.tsx`).
  if (pathname === '/admin/organisation' || pathname.startsWith('/admin/organisation/')) return 'Organisation';
  if (pathname === '/staff') return 'Personal';
  if (pathname === '/') return 'Hem';
  if (pathname === '/todo') return 'Att göra';
  if (pathname === '/calendar') return 'Kalender';
  // D121: a person's holdings opened from a hit of the registrar's search.
  if (pathname === '/competence/search') return 'Kompetenssökning';
  // D124: a plan opened from the list (item 12), and a person opened from their plan's "Tillhör".
  if (pathname === '/boarding' || pathname.startsWith('/boarding/')) return 'Introduktion och avslut';
  return null;
}
/** The tool a page was opened from (`/tools/<capability>`), or null. */
export function toolOf(path: string | null): string | null {
  const tool = path ? /^\/tools\/([^/?]+)/.exec(path)?.[1] : undefined;
  if (!tool) return null;
  try {
    return decodeURIComponent(tool);
  } catch {
    return null;
  }
}
/** Where a page was opened from, as the way back names it: a page Clew names, or a tool's page by its row in the menu. */
export function originOf(
  from: string | null,
  menu: ReadonlyArray<{ capability: string; label: string }> = [],
): { label: string; href: string } | null {
  if (!from) return null;
  const tool = toolOf(from);
  const label = originLabel(from) ?? (tool ? menu.find(m => m.capability === tool)?.label : undefined);
  return label ? { label, href: from } : null;
}

/**
 * A source's way in that is a tab of the entity's own page since D126 (rule 3: nothing opens over a page): one person's
 * utvecklingssamtal (`?talk={id}`) is their page's tab for that source, one unit's follow-up dialogue (`?dialog={key}`)
 * the unit's. Null for any other way in, which keeps its own address (`sourcePageHref`).
 */
export function sourceTab(page: EntityPage | undefined): 'talk' | 'dialogue' | null {
  if (!page) return null;
  if (page.href.startsWith(`?${TALK_PARAM}=`)) return 'talk';
  if (page.href.startsWith(`?${DIALOGUE_PARAM}=`)) return 'dialogue';
  return null;
}
/**
 * Where a source's way in leads (D95, D126): a way in that is a tab of the entity's page leads to that page at the
 * source's tab, with `back` as its way back (on the entity's own page, to the tab itself, its way back kept); any other
 * is the source's own address as `sourcePageHref` fills it in.
 */
export function sourceWayHref(
  source: { capability: string; page?: EntityPage | undefined },
  entity: { kind?: 'person' | 'unit'; key: string; id?: string | undefined },
  here: { pathname: string; search: string },
  back?: string | null,
): string | null {
  if (!source.page) return null;
  const tab = sourceTab(source.page);
  if (!tab) return sourcePageHref(source.page, entity, here, back);
  const unit = tab === 'dialogue' || entity.kind === 'unit';
  const own = pageSubject(here.pathname);
  // On the entity's own page the tab keeps the page's way back.
  const from =
    own && own.key === entity.key && own.entity === (unit ? 'unit' : 'person')
      ? new URLSearchParams(here.search).get('from')
      : back;
  return unit
    ? unitPageHref(entity.key, { section: source.capability, from })
    : personPageHref(entity.id ?? entity.key, { section: source.capability, from });
}
/**
 * Where an address that laid a talk or a dialogue over a page leads since D126 (rule 3: old addresses redirect to the
 * page): `?talk=<personId>` to that person's page at the talk's tab, `?dialog=<unitId>` to the unit's page at the
 * dialogue's tab, each with the page it lay over as the way back (or, on the entity's own page, the way back it had).
 * `capability` names the source the tab belongs to, when the page knows it; without it the person's or unit's own page
 * finds the tab from the address (`talk`, `dialog`) itself. Null for any other address.
 */
export function overlayRedirect(
  pathname: string,
  search: URLSearchParams | string,
  capability?: { talk?: string | undefined; dialogue?: string | undefined },
): string | null {
  const q = new URLSearchParams(search);
  const talk = q.get(TALK_PARAM),
    dialogue = q.get(DIALOGUE_PARAM);
  if (!talk && !dialogue) return null;
  const subject = pageSubject(pathname);
  const back = subject ? q.get('from') : pageOnly(pathname, q);
  if (talk) {
    const page = personPageHref(talk, { ...(capability?.talk ? { section: capability.talk } : {}), from: back });
    return capability?.talk
      ? page
      : `${page}${page.includes('?') ? '&' : '?'}${TALK_PARAM}=${encodeURIComponent(talk)}`;
  }
  const page = unitPageHref(dialogue!, {
    ...(capability?.dialogue ? { section: capability.dialogue } : {}),
    from: back,
  });
  return capability?.dialogue
    ? page
    : `${page}${page.includes('?') ? '&' : '?'}${DIALOGUE_PARAM}=${encodeURIComponent(dialogue!)}`;
}
