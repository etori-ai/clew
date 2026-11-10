import { Fragment, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, Thread, ViewRef } from '@clew/contracts';
import {
  Badge,
  Button,
  HomeIcon,
  HStack,
  SideNavItem,
  SideNavSection,
  Text,
  Typeahead,
  TypeaheadItem,
  VStack,
  createStaticSource,
  worstWord,
  type SearchableItem,
} from '@clew/ui';
import { addDays, displayDate, shortDayLabel, today } from '@clew/calendar/dates';
import { titled } from './conversation-context';
import { areasQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { SubRows, type ShellNav } from './shell';

/** The administration's sections, rows under Administration (D45, administration keeps the rail). */
export type AdminSection = 'anslutningar' | 'modeller' | 'anvandare' | 'utseende';
/** What the rail marks as current: the place, and within the start page the conversation. */
export interface RailCurrent {
  surface: 'start' | 'calendar' | 'verktyg' | 'staff' | 'admin';
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
const json = (value: Record<string, unknown> | undefined) =>
  value && Object.keys(value).length ? encodeURIComponent(JSON.stringify(value)) : null;
/**
 * The address of a tool (D42): its own page, `/tools/:capability`. `input` is what the view's own controls ask for;
 * `open` is a row's own view shown in the panel over the page (`open`, with `open-title` and `open-input`), and `via` marks one
 * opened from another opened view, which then offers the way back.
 */
export const toolHref = (
  capability: string,
  input?: Record<string, unknown>,
  open?: Pick<ViewRef, 'capability' | 'title' | 'input'>,
  via = false,
) => {
  const query = [
    json(input) && `input=${json(input)}`,
    open && `open=${encodeURIComponent(open.capability)}&open-title=${encodeURIComponent(open.title)}`,
    open && json(open.input) && `open-input=${json(open.input)}`,
    open && via && 'via=1',
  ]
    .filter(Boolean)
    .join('&');
  return `/tools/${capability}${query ? `?${query}` : ''}`;
};
type Found = { href: string; detail: string };

/**
 * The rail (D50, D53, after the `shell-side-nav` template): places first, then where the person has been. On top Nytt samtal and
 * the search; then Hem, the one page with everything the assistant has pushed, with how much of it needs the person;
 * Verktyg (Kalender and the views connectors offer as tools, D40, each a page of its own, D42); then Samtal, the
 * person's latest conversations, each saying when. A card's state (väntar, inte nu, klart) and the areas are not places: they are the
 * tabs and the filter on Hem. At the foot Administration with its two sections, collapsed until one of them is
 * open. Every row is a link to a route, so the back button and a reload land in the same place. Returned as the shell's slots so the shell keeps the heading and the way out.
 */
export function useRail({
  current,
  admin,
  manager,
}: {
  current: RailCurrent;
  admin: boolean;
  /** The session's role is manager (D94): the row Personal shows under Verktyg; the server checks the assignments again. */
  manager: boolean;
}): ShellNav {
  const navigate = useNavigate();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  const menu = areasData?.menu ?? EMPTY_MENU;
  const todayDate = today();
  const g = groupThreads(threads, new Date().toISOString(), todayDate);
  const count = (n: number) =>
    n ? (
      <Text type="supporting" hasTabularNumbers>
        {n}
      </Text>
    ) : undefined;
  // The latest conversations, in one list; each says when: today's with the time, then I går and the day. The rest are under Alla samtal.
  const yesterday = addDays(todayDate, -1);
  const recent = g.questions.slice(0, 5);
  const said = (t: Thread) => {
    const day = displayDate(t.updatedAt);
    return day === todayDate ? 'i dag' : day === yesterday ? 'i går' : shortDayLabel(day);
  };
  const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
  const needsYou = g.nu.length + g.senare.length + g.foreslar.length + g.kannedom.length;
  const word = useMemo(() => worstWord(areas.map(a => a.figure)), [areas]);
  // The search finds conversations, open cards, the areas and the tools from what the page already has: the same things the box's router finds without the model.
  const source = useMemo(() => {
    const items: SearchableItem<Found>[] = [
      ...g.questions.map(t => ({
        id: 'samtal:' + t.id,
        label: t.title,
        auxiliaryData: { href: `/conversations/${t.id}`, detail: 'Samtal' },
      })),
      ...[...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom, ...g.waiting, ...g.snoozed].map(t => ({
        id: 'kort:' + t.id,
        label: t.title,
        auxiliaryData: { href: `/?card=${encodeURIComponent(t.id)}`, detail: `Kort · ${t.trigger.source}` },
      })),
      ...areas.map(a => ({
        id: 'omrade:' + a.id,
        label: a.title,
        auxiliaryData: { href: `/?area=${encodeURIComponent(a.id)}`, detail: 'Område' },
      })),
      ...menu.map(e => ({
        id: 'verktyg:' + e.capability,
        label: e.label,
        auxiliaryData: { href: toolHref(e.capability), detail: `Verktyg · ${e.source}` },
      })),
    ];
    return createStaticSource(items);
  }, [threads, areas, menu]);
  const tool = (e: MenuEntry) => (
    <SideNavItem
      key={e.capability}
      label={e.label}
      icon={clewIcon[e.icon]}
      href={toolHref(e.capability)}
      isSelected={current.surface === 'verktyg' && current.view === e.capability}
    />
  );
  const more = menu.slice(TOOLS_SHOWN);
  const allConversations = <SideNavItem label="Alla samtal" href="/?tab=done" isSelected={false} />;
  return {
    top: (
      <VStack gap={2}>
        <Button variant="primary" label="Ny fråga" href="/" width="100%" />
        <Typeahead<SearchableItem<Found>>
          label="Sök i samtal och kort"
          isLabelHidden
          placeholder="Sök i samtal och kort"
          startIcon="search"
          size="sm"
          width="100%"
          searchSource={source}
          value={null}
          debounceMs={0}
          hasClear={false}
          emptySearchText="Inget samtal eller kort heter så"
          renderItem={item => <TypeaheadItem item={item} description={item.auxiliaryData?.detail} />}
          onChange={item => {
            const href = item?.auxiliaryData?.href;
            if (href) navigate(href);
          }}
        />
      </VStack>
    ),
    sections: (
      <>
        <SideNavSection title="Från mig" isHeaderHidden>
          <SideNavItem
            label="Hem"
            icon={HomeIcon}
            href="/"
            isSelected={current.surface === 'start' && !current.conversationId}
            /* The word (D54, artboard 3): the worst tone among the person's figures, "lugnt", "bevaka" or "behöver dig". Without a figure that has a tone, what needs the person today or how much. */
            endContent={
              word ? (
                <Badge variant={word.variant} label={word.word} />
              ) : g.nu.length ? (
                <Badge variant="error" label={`${g.nu.length} i dag`} />
              ) : needsYou ? (
                count(needsYou)
              ) : undefined
            }
          />
        </SideNavSection>
        <SideNavSection title="Verktyg">
          <SideNavItem label="Kalender" icon="calendar" href="/calendar" isSelected={current.surface === 'calendar'} />
          {/* Personal (D94): a manager's people, a destination of its own; the server checks the assignments on every read. */}
          {manager && (
            <SideNavItem
              label="Personal"
              icon={clewIcon.people}
              href="/staff"
              isSelected={current.surface === 'staff'}
            />
          )}
          {menu.slice(0, TOOLS_SHOWN).map(tool)}
          {more.length > 0 && (
            <SideNavItem
              label="Fler verktyg"
              icon="moreHorizontal"
              collapsible={{ defaultIsCollapsed: !more.some(e => e.capability === current.view) }}
            >
              <SubRows>{more.map(tool)}</SubRows>
            </SideNavItem>
          )}
        </SideNavSection>
        <SideNavSection title="Samtal">
          {/* The latest conversations under the day each was (artboard A: "I dag", "I går"), one line per conversation. */}
          {recent.map((t, i) => (
            <Fragment key={t.id}>
              {(i === 0 || said(recent[i - 1]!) !== said(t)) && (
                <HStack paddingInlineStart={2} paddingBlockStart={1}>
                  <Text type="supporting">{capital(said(t))}</Text>
                </HStack>
              )}
              <SideNavItem
                label={titled(t.title)}
                href={`/conversations/${t.id}`}
                isSelected={current.conversationId === t.id}
              />
            </Fragment>
          ))}
          {allConversations}
        </SideNavSection>
      </>
    ),
    footer: admin ? (
      <SideNavItem
        label="Administration"
        icon="wrench"
        collapsible={{ defaultIsCollapsed: current.surface !== 'admin' }}
      >
        <SubRows>
          <SideNavItem
            label="Anslutna system"
            href="/admin/connectors"
            isSelected={current.section === 'anslutningar'}
          />
          <SideNavItem label="Modeller" href="/admin/models" isSelected={current.section === 'modeller'} />
          <SideNavItem label="Användare" href="/admin/users" isSelected={current.section === 'anvandare'} />
          <SideNavItem label="Utseende" href="/admin/appearance" isSelected={current.section === 'utseende'} />
        </SubRows>
      </SideNavItem>
    ) : undefined,
  };
}
