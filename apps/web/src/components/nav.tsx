import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, MenuEntry, Thread, ViewRef } from '@clew/contracts';
import {
  Badge,
  CommandPalette,
  CommandPaletteInput,
  ChatBubbleLeftRightIcon,
  HomeIcon,
  InboxIcon,
  PlusIcon,
  SideNavItem,
  SideNavSection,
  SparklesIcon,
  StatusDot,
  Text,
  VStack,
  createStaticSource,
  worstWord,
  type SearchableItem,
  VisuallyHidden,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { titled, useConversation } from './conversation-context';
import { areasQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { cardOverPage } from '../panel-address';
import { pageLocation } from '../page-location';
import { conversationState, needsYouOf, todoHref } from '../work-items';
import { SubRows, type ShellNav } from './shell';

/** The administration's sections, rows under Administration (D45, administration keeps the rail). */
export type AdminSection = 'anslutningar' | 'modeller' | 'anvandare' | 'organisation' | 'utseende' | 'kompetens';
/** What the rail marks as current: the place, and within the start page the conversation. */
export interface RailCurrent {
  surface: 'start' | 'todo' | 'calendar' | 'verktyg' | 'staff' | 'units' | 'admin';
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
/**
 * A hit's address, or for a work item the item itself, which opens over the page the person is on when it is picked;
 * `group` is the heading the search lists it under (Astryx's `CommandPalette` groups by it).
 */
type Found = ({ href: string } | { card: string }) & { detail: string; group: string };

/**
 * The rail (D112 item 1, board Sidebar, the `shell-side-nav` template): Ny fråga and Sök as its first rows, each with
 * its icon, so the rail's own collapse draws them as icons named by their labels as it does every row; Sök opens
 * Astryx's `CommandPalette` over the page, which finds conversations, work items, areas and tools. Then the places,
 * Hem, Att göra with how much needs the person, Kalender and a manager's Personal (D94) and Dialogstöd (D116, amended:
 * the header's Start has no row of its own, so Clew's places stand here once); Verktyg, the views an
 * administrator placed as tools (D40, each a page of its own, D42); then Samtal, the person's conversations, newest
 * first, in one disclosure, each with a dot only where the data says something about it (the answer being written, a
 * draft that waits for the person). At the foot Administration with its sections, collapsed until one of them is open.
 * Every row is a link to a route, so the back button and a reload land in the same place. Returned as the shell's
 * slots so the shell keeps the heading, the person and the way out.
 */
export function useRail({
  current,
  admin,
  manager,
}: {
  current: RailCurrent;
  admin: boolean;
  /** The session's role is manager (D94): the row Personal shows among the places; the server checks the assignments again. */
  manager: boolean;
}): ShellNav {
  const navigate = useNavigate();
  const talk = useConversation();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  const menu = areasData?.menu ?? EMPTY_MENU;
  const todayDate = today();
  const g = groupThreads(threads, new Date().toISOString(), todayDate);
  const needsYou = needsYouOf(g).length;
  /** The conversation whose answer is being written now: the one on screen while a turn is on its way. */
  const answering = talk.pending ? (talk.conversation?.id ?? null) : null;
  // The word (D54, artboard 3): the worst tone among the person's figures on Hem, "Lugnt", "Bevaka" or "Behöver dig", written as everywhere else.
  const word = useMemo(() => worstWord(areas.map(a => a.figure)), [areas]);
  // The search finds conversations, open work items, the areas and the tools from what the page already has: the same things the box's router finds without the model.
  const { source, byId } = useMemo(() => {
    const items: SearchableItem<Found>[] = [
      ...g.questions.map(t => ({
        id: 'samtal:' + t.id,
        label: t.title,
        auxiliaryData: { href: `/conversations/${t.id}`, detail: '', group: 'Samtal' },
      })),
      ...[...g.nu, ...g.senare, ...g.foreslar, ...g.kannedom, ...g.waiting, ...g.snoozed].map(t => ({
        id: 'kort:' + t.id,
        label: t.title,
        auxiliaryData: { card: t.id, detail: t.trigger.source, group: 'Ärenden' },
      })),
      ...areas.map(a => ({
        id: 'omrade:' + a.id,
        label: a.title,
        auxiliaryData: { href: todoHref({ area: a.id }), detail: 'Område i Att göra', group: 'Områden' },
      })),
      ...menu.map(e => ({
        id: 'verktyg:' + e.capability,
        label: e.label,
        auxiliaryData: { href: toolHref(e.capability), detail: e.source, group: 'Verktyg' },
      })),
    ];
    return { source: createStaticSource(items), byId: new Map(items.map(i => [i.id, i.auxiliaryData!])) };
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
  // The search (board Sidebar's "Sök"): Astryx's command palette over the page, opened from its row in the rail. A pick
  // opens what it found: a work item over the page the person is on (D111 rule 2), anything else at its address.
  const [searching, setSearching] = useState(false);
  const pick = (id: string) => {
    const hit = byId.get(id);
    if (!hit) return;
    const { pathname, search } = pageLocation();
    navigate('card' in hit ? cardOverPage(pathname, search, hit.card) : hit.href);
  };
  return {
    overlay: (
      <CommandPalette<SearchableItem<Found>>
        isOpen={searching}
        onOpenChange={setSearching}
        searchSource={source}
        label="Sök i samtal och ärenden"
        input={<CommandPaletteInput label="Sök i samtal och ärenden" placeholder="Sök i samtal och ärenden" />}
        value=""
        onValueChange={pick}
        emptySearchText="Inget samtal eller ärende heter så"
        emptyBootstrapText="Inget att söka bland än"
        renderItem={item => (
          <VStack gap={0}>
            <Text>{item.label}</Text>
            {item.auxiliaryData?.detail && <Text type="supporting">{item.auxiliaryData.detail}</Text>}
          </VStack>
        )}
      />
    ),
    sections: (
      <>
        {/* The first rows (board Sidebar, the template's "New chat" and "Search"): rows with icons, so a folded rail draws them as its other rows. */}
        <SideNavSection title="Meny" isHeaderHidden>
          <SideNavItem label="Ny fråga" icon={PlusIcon} href="/" />
          <SideNavItem label="Sök" icon="search" onClick={() => setSearching(true)} />
        </SideNavSection>
        <SideNavSection title="Platser" isHeaderHidden>
          <SideNavItem
            label="Hem"
            icon={HomeIcon}
            href="/"
            isSelected={current.surface === 'start' && !current.conversationId}
            endContent={word ? <Badge variant={word.variant} label={word.word} /> : undefined}
          />
          {/* Att göra (D112 item 3) with how much needs the person: the count Behöver dig has in the queue. */}
          <SideNavItem
            label="Att göra"
            icon={InboxIcon}
            href="/todo"
            isSelected={current.surface === 'todo'}
            endContent={
              needsYou ? (
                <>
                  <Badge variant="neutral" label={String(needsYou)} />
                  {/* What the number counts, for a screen reader: the row reads "Att göra 2 behöver dig". */}
                  <VisuallyHidden>behöver dig</VisuallyHidden>
                </>
              ) : undefined
            }
          />
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
          {/* Dialogstöd (D117, D118): the units a manager follows up and their dialogue; marked on every unit's page. */}
          {manager && (
            <SideNavItem
              label="Dialogstöd"
              icon={ChatBubbleLeftRightIcon}
              href="/units"
              isSelected={current.surface === 'units'}
            />
          )}
        </SideNavSection>
        {menu.length > 0 && (
          <SideNavSection title="Verktyg">
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
        )}
        {g.questions.length > 0 && (
          <SideNavSection title="Samtal" isHeaderHidden>
            {/* The conversation history as the template draws it: one disclosure, open until the person folds it. */}
            <SideNavItem label="Samtal" icon={SparklesIcon} collapsible={{ defaultIsCollapsed: false }}>
              <SubRows>
                {g.questions.map(t => {
                  const state = conversationState(t, threads, answering);
                  return (
                    <SideNavItem
                      key={t.id}
                      label={titled(t.title)}
                      href={`/conversations/${t.id}`}
                      isSelected={current.conversationId === t.id}
                      endContent={state ? <StatusDot variant={state.variant} label={state.label} /> : undefined}
                    />
                  );
                })}
              </SubRows>
            </SideNavItem>
          </SideNavSection>
        )}
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
          <SideNavItem
            label="Organisation"
            href="/admin/organisation"
            isSelected={current.section === 'organisation'}
          />
          <SideNavItem label="Utseende" href="/admin/appearance" isSelected={current.section === 'utseende'} />
          <SideNavItem label="Kompetens" href="/admin/competence" isSelected={current.section === 'kompetens'} />
        </SubRows>
      </SideNavItem>
    ) : undefined,
  };
}
