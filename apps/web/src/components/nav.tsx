import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, MenuIcon, Thread } from '@clew/contracts';
import { BookOpenIcon, ChartBarIcon, DocumentTextIcon, LinkIcon, PhoneIcon, UsersIcon, Badge, Button, SideNavItem, SideNavSection, StatusDot, Text, Typeahead, TypeaheadItem, VStack, createStaticSource, type SearchableItem } from '@clew/ui';
import { addDays, displayDate, timeLabel, today } from '@clew/calendar/dates';
import { areasQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import type { ShellNav } from './shell';

/** What the rail marks as current: the surface, and within the start page the group, the pile, the area or the conversation. */
export interface RailCurrent {
  surface: 'start' | 'oversikt' | 'kalender' | 'admin';
  group?: 'behover-dig' | 'foreslar' | 'kannedom' | null;
  pile?: 'pagar' | 'inte-nu' | 'klart' | null;
  area?: string | null;
  conversationId?: string | null;
  /** The capability whose view is open in the panel, so its row under Verktyg is marked. */
  view?: string | null;
}
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];
/**
 * The menu's icons (D40): a connector names one, Clew draws it. Astryx's semantic names have no phone, people, book,
 * document, chart or link, so those are Heroicons outline components handed over as SVG components, the documented way
 * for an icon outside the semantic list (`astryx docs icons custom-icons`), as `AtSymbolIcon` already is.
 */
const menuIcon = { phone: PhoneIcon, people: UsersIcon, book: BookOpenIcon, document: DocumentTextIcon, chart: ChartBarIcon, link: LinkIcon, search: 'search', clock: 'clock' } as const satisfies Record<MenuIcon, unknown>;
/** How many tools show at once; the rest sit under "Fler verktyg", so the foot of the menu keeps its height however many connectors offer a row. */
const TOOLS_SHOWN = 4;
/** The address of a tool: its view in the panel over the start page, the same address the chip under the box opens. */
export const menuHref = (e: Pick<MenuEntry, 'capability' | 'title'>) => `/vy/${e.capability}?titel=${encodeURIComponent(e.title)}`;
const tone = { ok: null, warn: 'warning', alert: 'error', none: null } as const;
type Found = { href: string; detail: string };

/**
 * The rail (D34, the canvas's H1, H3 and H4): one navigation ordered by time relative to the person, after the
 * `shell-side-nav` template. On top Ny fråga and the search; then Från mig, the push in its three groups; Pågår, what
 * moves without the person; Samtal, the person's own conversations by day; and at the foot what is always there:
 * Verktyg (Kalender and the views connectors offer as tools, D40), the areas as lenses, collapsed, and Administration. Every row is a link to a route, so the back button and
 * a reload land in the same place. Returned as the shell's three slots so the shell keeps the heading and the way out.
 */
export function useRail({ current, admin }: { current: RailCurrent; admin: boolean }): ShellNav {
  const navigate = useNavigate();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  const menu = areasData?.menu ?? EMPTY_MENU;
  const todayDate = today();
  const g = groupThreads(threads, new Date().toISOString(), todayDate);
  const onStart = current.surface === 'start' || current.surface === 'oversikt';
  const count = (n: number) => n ? <Text type="supporting" hasTabularNumbers>{n}</Text> : undefined;
  const dot = (a: Area) => {
    const figure = a.figure ? tone[a.figure.tone] : null;
    const urgency = a.urgency === 'now' || a.urgency === 'urgent' ? 'error' : a.urgency === 'soon' ? 'warning' : null;
    const variant = figure === 'error' || urgency === 'error' ? 'error' : figure ?? urgency;
    const label = figure && a.figure ? a.figure.label : urgency === 'error' ? 'Deadline i dag' : 'Snart';
    return variant ? <StatusDot variant={variant} label={label} tooltip={label} /> : null;
  };
  // Conversations by day, in Stockholm: today's with the time, then I går and Tidigare; eight at most, the rest under Alla samtal.
  const recent = g.questions.slice(0, 8);
  const yesterday = addDays(todayDate, -1);
  const days = [
    { title: 'I dag', list: recent.filter(t => displayDate(t.updatedAt) === todayDate) },
    { title: 'I går', list: recent.filter(t => displayDate(t.updatedAt) === yesterday) },
    { title: 'Tidigare', list: recent.filter(t => displayDate(t.updatedAt) < yesterday) },
  ].filter(d => d.list.length > 0);
  const needsYou = g.nu.length + g.senare.length;
  // The search finds conversations, open cards and the areas from what the page already has: the same things the box's router finds without the model.
  const source = useMemo(() => {
    const items: SearchableItem<Found>[] = [
      ...g.questions.map(t => ({ id: 'samtal:' + t.id, label: t.title, auxiliaryData: { href: `/samtal/${t.id}`, detail: 'Samtal' } })),
      ...[...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom, ...g.waiting, ...g.snoozed].map(t => ({ id: 'kort:' + t.id, label: t.title, auxiliaryData: { href: `/oversikt?kort=${encodeURIComponent(t.id)}`, detail: `Kort · ${t.trigger.source}` } })),
      ...areas.map(a => ({ id: 'omrade:' + a.id, label: a.title, auxiliaryData: { href: `/omrade/${a.id}`, detail: 'Område' } })),
      ...menu.map(e => ({ id: 'verktyg:' + e.capability, label: e.label, auxiliaryData: { href: menuHref(e), detail: `Verktyg · ${e.source}` } })),
    ];
    return createStaticSource(items);
  }, [threads, areas, menu]);
  const tool = (e: MenuEntry) => <SideNavItem key={e.capability} label={e.label} icon={menuIcon[e.icon]} href={menuHref(e)} isSelected={onStart && current.view === e.capability} />;
  const more = menu.slice(TOOLS_SHOWN);
  return {
    top: <VStack gap={2}>
      <Button variant="primary" label="Ny fråga" href="/" width="100%" />
      <Typeahead<SearchableItem<Found>> label="Sök i samtal och kort" isLabelHidden placeholder="Sök i samtal och kort" startIcon="search" size="sm" width="100%"
        searchSource={source} value={null} debounceMs={0} hasClear={false} emptySearchText="Inget samtal eller kort heter så"
        renderItem={item => <TypeaheadItem item={item} description={item.auxiliaryData?.detail} />}
        onChange={item => { const href = item?.auxiliaryData?.href; if (href) navigate(href); }} />
    </VStack>,
    sections: <>
      <SideNavSection title="Från mig">
        <SideNavItem label="Behöver dig" href="/oversikt" isSelected={onStart && current.group === 'behover-dig'}
          endContent={g.nu.length ? <Badge variant="error" label={String(needsYou)} /> : count(needsYou)} />
        <SideNavItem label="Jag föreslår" href="/oversikt#foreslar" isSelected={onStart && current.group === 'foreslar'} endContent={count(g.foreslar.length)} />
        <SideNavItem label="Till kännedom" href="/oversikt#kannedom" isSelected={onStart && current.group === 'kannedom'} endContent={count(g.kannedom.length)} />
      </SideNavSection>
      <SideNavSection title={`Pågår · ${g.waiting.length}`}>
        {g.waiting.slice(0, 4).map(t => <SideNavItem key={t.id} label={t.title} href="/pagar" isSelected={false}
          endContent={<StatusDot variant="warning" label={`Väntar på ${t.waitingOn}`} tooltip={`Väntar på ${t.waitingOn}`} />} />)}
        {g.waiting.length > 4 && <SideNavItem label={`Alla ${g.waiting.length} som pågår`} href="/pagar" isSelected={onStart && current.pile === 'pagar'} />}
        <SideNavItem label="Inte nu" href="/inte-nu" isSelected={onStart && current.pile === 'inte-nu'} endContent={count(g.snoozed.length)} />
      </SideNavSection>
      {days.length === 0 && <SideNavSection title="Samtal">
        <SideNavItem label="Alla samtal och klart i dag" href="/hanterat" isSelected={onStart && current.pile === 'klart'} endContent={count(g.handledToday.length)} />
      </SideNavSection>}
      {days.map((d, i) => <SideNavSection key={d.title} title={i === 0 ? `Samtal · ${d.title.toLowerCase()}` : d.title}>
        {d.list.map(t => <SideNavItem key={t.id} label={t.title} href={`/samtal/${t.id}`} isSelected={current.conversationId === t.id}
          endContent={d.title === 'I dag' ? <Text type="supporting" hasTabularNumbers>{timeLabel(t.updatedAt)}</Text> : undefined} />)}
        {i === days.length - 1 && <SideNavItem label="Alla samtal och klart i dag" href="/hanterat" isSelected={onStart && current.pile === 'klart'} endContent={count(g.handledToday.length)} />}
      </SideNavSection>)}
    </>,
    tools: <>
      <SideNavItem label="Kalender" icon="calendar" href="/kalender" isSelected={current.surface === 'kalender'} />
      {menu.slice(0, TOOLS_SHOWN).map(tool)}
      {more.length > 0 && <SideNavItem label="Fler verktyg" collapsible={{ defaultIsCollapsed: !more.some(e => e.capability === current.view) }}>{more.map(tool)}</SideNavItem>}
    </>,
    footer: <>
      <SideNavItem label="Områden" collapsible={{ defaultIsCollapsed: !current.area }}>
        {areas.map(a => <SideNavItem key={a.id} label={a.title} href={`/omrade/${a.id}`} isSelected={onStart && current.area === a.id}
          endContent={a.needsYou || dot(a) ? <>{dot(a)}{count(a.needsYou)}</> : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text> : undefined} />)}
      </SideNavItem>
      {admin && <SideNavItem label="Administration" icon="wrench" href="/admin/anslutningar" isSelected={current.surface === 'admin'} />}
    </>,
  };
}
