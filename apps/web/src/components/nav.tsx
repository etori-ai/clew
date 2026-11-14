import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, Capability, MenuEntry, Thread } from '@clew/contracts';
import {
  Badge,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  CommandPalette,
  CommandPaletteInput,
  Divider,
  HomeIcon,
  InboxIcon,
  PlusIcon,
  SideNavItem,
  SideNavSection,
  Squares2X2Icon,
  StatusDot,
  Text,
  UsersIcon,
  VStack,
  createStaticSource,
  type SearchableItem,
  VisuallyHidden,
} from '@clew/ui';
import { today } from '@clew/calendar/dates';
import { titled, useConversation } from './conversation-context';
import { areasQuery, entityListQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { cardOverPage } from '../panel-address';
import { viewPageHref } from '../view-address';
import { pageLocation } from '../page-location';
import { unitPageHref } from '../person-address';
import { conversationState, needsYouOf, todoHref } from '../work-items';
import type { ShellNav } from './shell';
import { useHeldCapabilities } from '../capabilities';

/** The administration's sections (D45). The rail has one row for all of them; the administration lists them itself. */
export type AdminSection =
  'anslutningar' | 'modeller' | 'anvandare' | 'organisation' | 'utseende' | 'kompetens' | 'introduktion';
/**
 * Each section of the administration with the capability its page is behind on the server (D85), so a section is
 * offered only to a person who holds it and none leads to a refusal. Kompetens and Introduktion och avslut also need
 * their module switched on and visible to the person (D108 item 13, D124 item 9), which `/api/areas` says by listing the
 * system. The rail's one Administration row is drawn when the person holds any of them (D126); the administration's own
 * panel lists the sections from here.
 */
export const ADMIN_ROWS: ReadonlyArray<{
  section: AdminSection;
  label: string;
  href: string;
  capability: Capability;
  system?: string;
}> = [
  { section: 'anslutningar', label: 'Anslutna system', href: '/admin/connectors', capability: 'admin.connectors' },
  { section: 'modeller', label: 'Modeller', href: '/admin/models', capability: 'admin.connectors' },
  { section: 'anvandare', label: 'Användare', href: '/admin/users', capability: 'admin.users' },
  { section: 'organisation', label: 'Organisation', href: '/admin/organisation', capability: 'admin.users' },
  { section: 'utseende', label: 'Utseende', href: '/admin/appearance', capability: 'admin.appearance' },
  {
    section: 'kompetens',
    label: 'Kompetens',
    href: '/admin/competence',
    capability: 'admin.competence',
    system: 'competence',
  },
  {
    section: 'introduktion',
    label: 'Introduktion och avslut',
    href: '/admin/boarding',
    capability: 'admin.boarding',
    system: 'boarding',
  },
];
/** What the rail marks as current: the place, and within the start page the conversation. */
export interface RailCurrent {
  surface:
    | 'start'
    | 'todo'
    | 'calendar'
    | 'verktyg'
    | 'staff'
    | 'units'
    | 'competence'
    | 'boarding'
    | 'conversations'
    | 'admin';
  conversationId?: string | null;
  /** The capability whose tool page is open (D42), so its row under Verktyg is marked. */
  view?: string | null;
  /** The administration's section that is open (D45), for the administration's own panel. */
  section?: AdminSection;
}
/**
 * The places in the rail that belong to one connector: a view of one of their reads is a page of that place, so the
 * rail marks the place on it, wherever it was opened from (the review of 2026-11-13). Kalender for the calendar; the
 * competence module's reads are a tab of Personal (D126), so its pages mark Personal.
 */
const CONNECTOR_PLACES: Readonly<Record<string, RailCurrent['surface']>> = {
  calendar: 'calendar',
  competence: 'competence',
};
/** The place a read's page belongs to, by its connector (a capability's name begins with its connector's id), or null. */
export function placeOfRead(capability: string): RailCurrent | null {
  const surface = CONNECTOR_PLACES[capability.split('.')[0] ?? ''];
  return surface ? { surface } : null;
}
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];
/** How many tools the rail shows; every tool is under "Alla verktyg", so the rail keeps its height however many there are. */
const TOOLS_SHOWN = 4;
/** How many conversations the rail shows, the newest; every conversation is on "Alla samtal" (D126). */
const CONVERSATIONS_SHOWN = 3;
/**
 * The address of a tool (D42): its own page, `/tools/:capability`, as the rail leads to it. Every other read the person
 * may open has the same page (D116, `view-address.ts`, which also names the way back to it).
 */
export const toolHref = (capability: string) => viewPageHref({ capability });
/**
 * A hit's address, or for a work item the item itself, which opens where a work item opens from the page the person is
 * on; `group` is the heading the search lists it under (Astryx's `CommandPalette` groups by it).
 */
type Found = ({ href: string } | { card: string }) & { detail: string; group: string };
/** What the palette searches: everything (Sök), or the tools alone (Alla verktyg). */
type Searching = 'all' | 'tools';

/**
 * The rail (D126 rule 7, board Shell, the `shell-side-nav` template): two verbs, the places in three short groups, the
 * account at the foot. Ny fråga and Sök first, each with its icon, so the rail's own collapse draws them as icons named
 * by their labels as it does every row; Sök opens Astryx's `CommandPalette` over the page, which finds conversations,
 * work items, areas and tools. Then "Mitt arbete": Hem, Att göra with how much needs the person, and Kalender while the
 * calendar is the person's to see (D23). "Min enhet" for a manager (D94): Personal, whose tabs are the unit's
 * competence, talks and introductions (D126; their pages mark it), and Läget, the unit the manager follows up, or the
 * list of them when there are several (D117). "Verktyg": the views an administrator placed as tools (D40, each a page of
 * its own, D42), the first four, and "Alla verktyg", the palette narrowed to the tools. "Samtal": the three newest
 * conversations, each with a dot only where the data says something about it (the answer being written, a draft that
 * waits for the person), and "Alla samtal", the register of them. At the foot one row, Administration, for a person who
 * holds any of its sections (`ADMIN_ROWS`); the administration lists its sections itself. Every place is a link to a
 * route, so the back button and a reload land in the same place. Returned as the shell's slots so the shell keeps the
 * heading, the person and the way out.
 */
export function useRail({
  current,
  admin,
  manager,
}: {
  current: RailCurrent;
  admin: boolean;
  /** The session's role is manager (D94): "Min enhet" shows among the places; the server checks the assignments again. */
  manager: boolean;
}): ShellNav {
  const navigate = useNavigate();
  const talk = useConversation();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  const menu = areasData?.menu ?? EMPTY_MENU;
  // A place whose system the person cannot see is not drawn (D23); until `/api/areas` answers, the rail draws it.
  const systems = areasData?.systems;
  const sees = (connector: string) => !systems || systems.some(s => s.connector === connector);
  const held = useHeldCapabilities();
  const adminRows = admin
    ? ADMIN_ROWS.filter(r => held.includes(r.capability) && (!r.system || (!!systems && sees(r.system))))
    : [];
  // Läget (D117): the one unit a manager follows up is its page; with several, the list of them. Until the list has
  // answered, and if it fails, the list's address, which holds one unit as well as many.
  const units = useQuery({ ...entityListQuery('unit'), enabled: manager }).data;
  const followed = units?.groups.flatMap(g => g.entities) ?? [];
  const lageHref = followed.length === 1 ? unitPageHref(followed[0]!.key) : '/units';
  const todayDate = today();
  const g = groupThreads(threads, new Date().toISOString(), todayDate);
  const needsYou = needsYouOf(g).length;
  /** The conversation whose answer is being written now: the one on screen while a turn is on its way. */
  const answering = talk.pending ? (talk.conversation?.id ?? null) : null;
  // The search finds conversations, open work items, the areas and the tools from what the page already has: the same
  // things the box's router finds without the model. "Alla verktyg" searches the tools alone.
  const { source, toolSource, byId } = useMemo(() => {
    const tools: SearchableItem<Found>[] = menu.map(e => ({
      id: 'verktyg:' + e.capability,
      label: e.label,
      auxiliaryData: { href: toolHref(e.capability), detail: e.source, group: 'Verktyg' },
    }));
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
      ...tools,
    ];
    return {
      source: createStaticSource(items),
      toolSource: createStaticSource(tools),
      byId: new Map(items.map(i => [i.id, i.auxiliaryData!])),
    };
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
  // The first tools, and the one open now when it is further down the list, so the page the person is on stays marked.
  const openTool = menu.slice(TOOLS_SHOWN).find(e => current.surface === 'verktyg' && e.capability === current.view);
  const tools = [...menu.slice(0, TOOLS_SHOWN), ...(openTool ? [openTool] : [])];
  // The newest conversations, and the one open now first in their place when it is older, as the board marks it.
  const latest = g.questions.slice(0, CONVERSATIONS_SHOWN);
  const openConversation = latest.some(t => t.id === current.conversationId)
    ? undefined
    : g.questions.find(t => t.id === current.conversationId);
  const conversations = openConversation ? [openConversation, ...latest.slice(0, CONVERSATIONS_SHOWN - 1)] : latest;
  // The search (board Shell's "Sök"): Astryx's command palette over the page, opened from its row in the rail. A pick
  // opens what it found: a work item where a work item opens from the page the person is on, anything else at its address.
  const [searching, setSearching] = useState<Searching | null>(null);
  const pick = (id: string) => {
    const hit = byId.get(id);
    if (!hit) return;
    const { pathname, search } = pageLocation();
    navigate('card' in hit ? cardOverPage(pathname, search, hit.card) : hit.href);
  };
  const toolsOnly = searching === 'tools';
  const label = toolsOnly ? 'Alla verktyg' : 'Sök i samtal och ärenden';
  return {
    overlay: (
      <CommandPalette<SearchableItem<Found>>
        isOpen={searching !== null}
        onOpenChange={open => {
          if (!open) setSearching(null);
        }}
        searchSource={toolsOnly ? toolSource : source}
        label={label}
        input={
          <CommandPaletteInput
            label={label}
            placeholder={toolsOnly ? 'Sök bland verktygen' : 'Sök i samtal och ärenden'}
          />
        }
        value=""
        onValueChange={pick}
        emptySearchText={toolsOnly ? 'Inget verktyg heter så' : 'Inget samtal eller ärende heter så'}
        emptyBootstrapText={toolsOnly ? 'Inga verktyg att välja bland' : 'Inget att söka bland än'}
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
        {/* The two verbs (board Shell, the template's "New chat" and "Search"): rows with icons, so a folded rail draws them as its other rows. */}
        <SideNavSection title="Börja" isHeaderHidden>
          <SideNavItem label="Ny fråga" icon={PlusIcon} href="/" />
          <SideNavItem label="Sök" icon="search" onClick={() => setSearching('all')} />
        </SideNavSection>
        <Divider />
        <SideNavSection title="Mitt arbete">
          <SideNavItem
            label="Hem"
            icon={HomeIcon}
            href="/"
            isSelected={current.surface === 'start' && !current.conversationId}
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
                  <Badge variant="error" label={String(needsYou)} />
                  {/* What the number counts, for a screen reader: the row reads "Att göra 2 behöver dig". */}
                  <VisuallyHidden>behöver dig</VisuallyHidden>
                </>
              ) : undefined
            }
          />
          {/* Kalender is drawn on its connector's signal, so a read of the calendar marks it (`CONNECTOR_PLACES`). */}
          {sees('calendar') && (
            <SideNavItem
              label="Kalender"
              icon="calendar"
              href="/calendar"
              isSelected={current.surface === 'calendar'}
            />
          )}
        </SideNavSection>
        {/* Min enhet (D94, D126): a manager's people and the unit's state; the server checks the assignments on every read. */}
        {manager && (
          <SideNavSection title="Min enhet">
            <SideNavItem
              label="Personal"
              icon={UsersIcon}
              href="/staff"
              isSelected={
                current.surface === 'staff' || current.surface === 'competence' || current.surface === 'boarding'
              }
            />
            <SideNavItem label="Läget" icon={ChartBarIcon} href={lageHref} isSelected={current.surface === 'units'} />
          </SideNavSection>
        )}
        {menu.length > 0 && (
          <SideNavSection title="Verktyg">
            {tools.map(tool)}
            {/* Every tool, searchable: the palette narrowed to them, since no page lists them yet. */}
            <SideNavItem label="Alla verktyg" icon={Squares2X2Icon} onClick={() => setSearching('tools')} />
          </SideNavSection>
        )}
        {g.questions.length > 0 && (
          <SideNavSection title="Samtal">
            {/* Rows of the section itself, so Astryx cuts a long title with an ellipsis on one line (D112, Astryx gaps). */}
            {conversations.map(t => {
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
            <SideNavItem
              label="Alla samtal"
              icon={ChatBubbleLeftRightIcon}
              href="/conversations"
              isSelected={current.surface === 'conversations'}
            />
          </SideNavSection>
        )}
      </>
    ),
    footer:
      adminRows.length > 0 ? (
        <SideNavItem
          label="Administration"
          icon={Cog6ToothIcon}
          href="/admin"
          isSelected={current.surface === 'admin'}
        />
      ) : undefined,
  };
}
