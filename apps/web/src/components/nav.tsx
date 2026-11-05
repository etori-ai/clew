import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, Thread, ViewRef } from '@clew/contracts';
import { Badge, Button, SideNavItem, SideNavSection, Squares2X2Icon, StatusDot, Text, Typeahead, TypeaheadItem, VStack, createStaticSource, type SearchableItem } from '@clew/ui';
import { addDays, displayDate, timeLabel, today } from '@clew/calendar/dates';
import { areasQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import type { ShellNav } from './shell';

/** The administration's two sections, rows under Administration (D45). */
export type AdminSection = 'anslutningar' | 'modeller';
/** What the rail marks as current: the surface, and within the start page the group, the pile, the area or the conversation. */
export interface RailCurrent {
  surface: 'start' | 'oversikt' | 'kalender' | 'verktyg' | 'admin';
  group?: 'behover-dig' | 'foreslar' | 'kannedom' | null;
  pile?: 'waiting' | 'snoozed' | 'handled' | null;
  area?: string | null;
  conversationId?: string | null;
  /** The capability whose tool page is open (D42), so its row under Verktyg is marked. */
  view?: string | null;
  /** The administration's section that is open (D45), so its row under Administration is marked. */
  section?: AdminSection;
}
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];
/** How many tools show at once; the rest sit under "Fler verktyg", so the foot of the menu keeps its height however many connectors offer a row. */
const TOOLS_SHOWN = 4;
const json = (value: Record<string, unknown> | undefined) => value && Object.keys(value).length ? encodeURIComponent(JSON.stringify(value)) : null;
/**
 * The address of a tool (D42): its own page, `/tools/:capability`. `input` is what the view's own controls ask for;
 * `open` is a row's own view shown in the panel over the page (`open`, with `open-title` and `open-input`), and `via` marks one
 * opened from another opened view, which then offers the way back.
 */
export const toolHref = (capability: string, input?: Record<string, unknown>, open?: Pick<ViewRef, 'capability' | 'title' | 'input'>, via = false) => {
  const query = [
    json(input) && `input=${json(input)}`,
    open && `open=${encodeURIComponent(open.capability)}&open-title=${encodeURIComponent(open.title)}`,
    open && json(open.input) && `open-input=${json(open.input)}`,
    open && via && 'via=1',
  ].filter(Boolean).join('&');
  return `/tools/${capability}${query ? `?${query}` : ''}`;
};
const tone = { ok: null, warn: 'warning', alert: 'error', none: null } as const;
type Found = { href: string; detail: string };

/**
 * The rail (D34, the canvas's H1, H3 and H4): one navigation ordered by time relative to the person, after the
 * `shell-side-nav` template. On top Ny fråga and the search; then Från mig, the push in its three groups; Pågår, what
 * moves without the person; Samtal, the person's own conversations by day; and at the foot what is always there:
 * Verktyg (Kalender and the views connectors offer as tools, D40, each a page of its own, D42), the areas as lenses, collapsed, and Administration with its two sections, collapsed until one of them is open (D45). Every row is a link to a route, so the back button and
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
      ...g.questions.map(t => ({ id: 'samtal:' + t.id, label: t.title, auxiliaryData: { href: `/conversations/${t.id}`, detail: 'Samtal' } })),
      ...[...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom, ...g.waiting, ...g.snoozed].map(t => ({ id: 'kort:' + t.id, label: t.title, auxiliaryData: { href: `/overview?card=${encodeURIComponent(t.id)}`, detail: `Kort · ${t.trigger.source}` } })),
      ...areas.map(a => ({ id: 'omrade:' + a.id, label: a.title, auxiliaryData: { href: `/areas/${a.id}`, detail: 'Område' } })),
      ...menu.map(e => ({ id: 'verktyg:' + e.capability, label: e.label, auxiliaryData: { href: toolHref(e.capability), detail: `Verktyg · ${e.source}` } })),
    ];
    return createStaticSource(items);
  }, [threads, areas, menu]);
  const tool = (e: MenuEntry) => <SideNavItem key={e.capability} label={e.label} icon={clewIcon[e.icon]} href={toolHref(e.capability)} isSelected={current.surface === 'verktyg' && current.view === e.capability} />;
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
        <SideNavItem label="Behöver dig" href="/overview" isSelected={onStart && current.group === 'behover-dig'}
          endContent={g.nu.length ? <Badge variant="error" label={String(needsYou)} /> : count(needsYou)} />
        <SideNavItem label="Jag föreslår" href="/overview#proposals" isSelected={onStart && current.group === 'foreslar'} endContent={count(g.foreslar.length)} />
        <SideNavItem label="Till kännedom" href="/overview#notices" isSelected={onStart && current.group === 'kannedom'} endContent={count(g.kannedom.length)} />
      </SideNavSection>
      <SideNavSection title={g.waiting.length ? `Pågår · ${g.waiting.length}` : 'Pågår'}>
        {g.waiting.slice(0, 4).map(t => <SideNavItem key={t.id} label={t.title} href="/waiting" isSelected={false}
          endContent={<StatusDot variant="warning" label={`Väntar på ${t.waitingOn}`} tooltip={`Väntar på ${t.waitingOn}`} />} />)}
        {g.waiting.length > 4 && <SideNavItem label={`Alla ${g.waiting.length} som pågår`} href="/waiting" isSelected={onStart && current.pile === 'waiting'} />}
        <SideNavItem label="Inte nu" href="/snoozed" isSelected={onStart && current.pile === 'snoozed'} endContent={count(g.snoozed.length)} />
      </SideNavSection>
      {days.length === 0 && <SideNavSection title="Samtal">
        <SideNavItem label="Redan hanterat" href="/handled" isSelected={onStart && current.pile === 'handled'} endContent={count(g.handledToday.length)} />
      </SideNavSection>}
      {days.map((d, i) => <SideNavSection key={d.title} title={i === 0 ? `Samtal · ${d.title.toLowerCase()}` : d.title}>
        {d.list.map(t => <SideNavItem key={t.id} label={t.title} href={`/conversations/${t.id}`} isSelected={current.conversationId === t.id}
          endContent={d.title === 'I dag' ? <Text type="supporting" hasTabularNumbers>{timeLabel(t.updatedAt)}</Text> : undefined} />)}
        {i === days.length - 1 && <SideNavItem label="Redan hanterat" href="/handled" isSelected={onStart && current.pile === 'handled'} endContent={count(g.handledToday.length)} />}
      </SideNavSection>)}
    </>,
    tools: <>
      <SideNavItem label="Kalender" icon="calendar" href="/calendar" isSelected={current.surface === 'kalender'} />
      {menu.slice(0, TOOLS_SHOWN).map(tool)}
      {more.length > 0 && <SideNavItem label="Fler verktyg" icon="moreHorizontal" collapsible={{ defaultIsCollapsed: !more.some(e => e.capability === current.view) }}>{more.map(tool)}</SideNavItem>}
    </>,
    footer: <>
      <SideNavItem label="Områden" icon={Squares2X2Icon} collapsible={{ defaultIsCollapsed: !current.area }}>
        {areas.map(a => <SideNavItem key={a.id} label={a.title} href={`/areas/${a.id}`} isSelected={onStart && current.area === a.id}
          endContent={a.needsYou || dot(a) ? <>{dot(a)}{count(a.needsYou)}</> : a.waiting ? <Text type="supporting">{a.waiting} pågår</Text> : undefined} />)}
      </SideNavItem>
      {admin && <SideNavItem label="Administration" icon="wrench" collapsible={{ defaultIsCollapsed: current.surface !== 'admin' }}>
        <SideNavItem label="Anslutna system" href="/admin/connectors" isSelected={current.section === 'anslutningar'} />
        <SideNavItem label="Modeller" href="/admin/models" isSelected={current.section === 'modeller'} />
      </SideNavItem>}
    </>,
  };
}
