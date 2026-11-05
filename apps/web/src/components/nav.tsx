import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, Thread, ViewRef } from '@clew/contracts';
import { Badge, Button, InboxIcon, SideNavItem, SideNavSection, Text, Typeahead, TypeaheadItem, VStack, createStaticSource, type SearchableItem } from '@clew/ui';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { titled } from './conversation-context';
import { areasQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import type { ShellNav } from './shell';

/** The administration's two sections, rows under Administration (D45, administration keeps the rail). */
export type AdminSection = 'anslutningar' | 'modeller';
/** What the rail marks as current: the place, and within the start page the conversation. */
export interface RailCurrent {
  surface: 'start' | 'todo' | 'kalender' | 'verktyg' | 'admin';
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
type Found = { href: string; detail: string };

/**
 * The rail (D50, after the `shell-side-nav` template): places first, then where the person has been. On top Nytt samtal and
 * the search; then Att göra, the one page for everything the assistant has pushed, with how much of it needs the person;
 * Verktyg (Kalender and the views connectors offer as tools, D40, each a page of its own, D42); then Samtal, the
 * person's latest conversations, each saying when. A card's state (pågår, inte nu, klart) and the areas are not places: they are the
 * tabs and the filter on Att göra. At the foot Administration with its two sections, collapsed until one of them is
 * open. Every row is a link to a route, so the back button and a reload land in the same place. Returned as the shell's slots so the shell keeps the heading and the way out.
 */
export function useRail({ current, admin }: { current: RailCurrent; admin: boolean }): ShellNav {
  const navigate = useNavigate();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  const menu = areasData?.menu ?? EMPTY_MENU;
  const todayDate = today();
  const g = groupThreads(threads, new Date().toISOString(), todayDate);
  const count = (n: number) => n ? <Text type="supporting" hasTabularNumbers>{n}</Text> : undefined;
  // The latest conversations, in one list; each says when: today's with the time, then I går and the day. The rest are under Alla samtal.
  const yesterday = addDays(todayDate, -1);
  const recent = g.questions.slice(0, 5);
  const said = (t: Thread) => { const day = displayDate(t.updatedAt); return day === todayDate ? timeLabel(t.updatedAt) : day === yesterday ? 'i går' : shortDayLabel(day); };
  const needsYou = g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length;
  // The search finds conversations, open cards, the areas and the tools from what the page already has: the same things the box's router finds without the model.
  const source = useMemo(() => {
    const items: SearchableItem<Found>[] = [
      ...g.questions.map(t => ({ id: 'samtal:' + t.id, label: t.title, auxiliaryData: { href: `/conversations/${t.id}`, detail: 'Samtal' } })),
      ...[...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom, ...g.waiting, ...g.snoozed].map(t => ({ id: 'kort:' + t.id, label: t.title, auxiliaryData: { href: `/todo?card=${encodeURIComponent(t.id)}`, detail: `Kort · ${t.trigger.source}` } })),
      ...areas.map(a => ({ id: 'omrade:' + a.id, label: a.title, auxiliaryData: { href: `/todo?area=${encodeURIComponent(a.id)}`, detail: 'Område' } })),
      ...menu.map(e => ({ id: 'verktyg:' + e.capability, label: e.label, auxiliaryData: { href: toolHref(e.capability), detail: `Verktyg · ${e.source}` } })),
    ];
    return createStaticSource(items);
  }, [threads, areas, menu]);
  const tool = (e: MenuEntry) => <SideNavItem key={e.capability} label={e.label} icon={clewIcon[e.icon]} href={toolHref(e.capability)} isSelected={current.surface === 'verktyg' && current.view === e.capability} />;
  const more = menu.slice(TOOLS_SHOWN);
  const allConversations = <SideNavItem label="Alla samtal" href="/todo?tab=done" isSelected={false} />;
  return {
    top: <VStack gap={2}>
      <Button variant="secondary" label="Nytt samtal" href="/" width="100%" />
      <Typeahead<SearchableItem<Found>> label="Sök i samtal och kort" isLabelHidden placeholder="Sök i samtal och kort" startIcon="search" size="sm" width="100%"
        searchSource={source} value={null} debounceMs={0} hasClear={false} emptySearchText="Inget samtal eller kort heter så"
        renderItem={item => <TypeaheadItem item={item} description={item.auxiliaryData?.detail} />}
        onChange={item => { const href = item?.auxiliaryData?.href; if (href) navigate(href); }} />
    </VStack>,
    sections: <>
      <SideNavSection title="Från mig" isHeaderHidden>
        <SideNavItem label="Att göra" icon={InboxIcon} href="/todo" isSelected={current.surface === 'todo'}
          endContent={g.nu.length ? <Badge variant="error" label={String(needsYou)} /> : count(needsYou)} />
      </SideNavSection>
      <SideNavSection title="Verktyg">
        <SideNavItem label="Kalender" icon="calendar" href="/calendar" isSelected={current.surface === 'kalender'} />
        {menu.slice(0, TOOLS_SHOWN).map(tool)}
        {more.length > 0 && <SideNavItem label="Fler verktyg" icon="moreHorizontal" collapsible={{ defaultIsCollapsed: !more.some(e => e.capability === current.view) }}>{more.map(tool)}</SideNavItem>}
      </SideNavSection>
      <SideNavSection title="Samtal">
        {recent.map(t => <SideNavItem key={t.id} label={titled(t.title)} href={`/conversations/${t.id}`} isSelected={current.conversationId === t.id}
          endContent={<Text type="supporting" hasTabularNumbers>{said(t)}</Text>} />)}
        {allConversations}
      </SideNavSection>
    </>,
    footer: admin ? <SideNavItem label="Administration" icon="wrench" collapsible={{ defaultIsCollapsed: current.surface !== 'admin' }}>
      <SideNavItem label="Anslutna system" href="/admin/connectors" isSelected={current.section === 'anslutningar'} />
      <SideNavItem label="Modeller" href="/admin/models" isSelected={current.section === 'modeller'} />
    </SideNavItem> : undefined,
  };
}
