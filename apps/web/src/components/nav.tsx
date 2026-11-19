import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import { areasQuery, entityListQuery, headerQuery, threadsQuery } from '../queries';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { cardOverPage } from '../panel-address';
import { viewPageHref } from '../view-address';
import { pageLocation } from '../page-location';
import { toolOf, unitPageHref } from '../person-address';
import { toolsOf } from '../tool-catalogue';
import { conversationState, needsYouOf, todoHref } from '../work-items';
import type { ShellNav } from './shell';
import { useHeldCapabilities } from '../capabilities';
import { ReminderRow } from './reminders';

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
    /** Alla verktyg, the catalogue of every tool (D126 rule 7). */
    | 'tools'
    | 'staff'
    | 'units'
    | 'competence'
    | 'boarding'
    | 'conversations'
    | 'admin';
  conversationId?: string | null;
  /**
   * A conversation takes the start page's column, a new one (`/conversations/new`) included: Hem is not the place, and
   * a conversation the rail does not list marks "Alla samtal" (board Samtal's rail).
   */
  conversation?: boolean;
  /** Ny fråga's own page is open (`/conversations/new` naming nothing, D126 item 14): the rail marks "Ny fråga". */
  newQuestion?: boolean;
  /**
   * The capability whose tool page is open (D42), so its row under Verktyg is marked; null on a tool's page that does not
   * know it is a tool, where the rail marks the tool whose page the address is.
   */
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
 * The address of a tool (D42): its own page, `/tools/:capability`, as the rail leads to it, and with `from` the page it
 * was opened from as its way back (Alla verktyg). Every other read the person may open has the same page (D116,
 * `view-address.ts`, which also names the way back to it).
 */
export const toolHref = (capability: string, from?: string) => viewPageHref({ capability }, from);
/** Alla verktyg's address (D126 rule 7): every tool the person may open, where the rail's first few end. */
export const TOOLS_HREF = '/tools';
/**
 * A hit's address, or for a work item the item itself, which opens where a work item opens from the page the person is
 * on; `group` is the heading the search lists it under (Astryx's `CommandPalette` groups by it).
 */
type Found = ({ href: string } | { card: string }) & { detail: string; group: string };

/**
 * The rail (D126 item 10, board RailOrder variant b, the `shell-side-nav` template): the work first. Sök alone at the
 * top, the rail's one utility, which opens Astryx's `CommandPalette` over the page and finds conversations, work items,
 * areas and tools. Then "Mitt arbete": Hem, Att göra with how much needs the person, and Kalender while the calendar is
 * the person's to see (D23), and Påminnelser with how many are due (`ReminderRow`). "Min enhet" for a manager (D94):
 * Personal, whose tabs are the unit's competence, talks and introductions (D126; their pages mark it), and Läget, the
 * unit the manager follows up, or the list of them when there are several (D117). "Verktyg": the views an administrator
 * placed as tools (D40, each a page of its own, D42) and Clew's own lists the person has (`toolsOf`), the first four,
 * and "Alla verktyg", the page that lists every one of them (`/tools`). "Fråga assistenten": asking is one way of doing the
 * work, so it follows it, with "Ny fråga" heading the conversations it starts, then the three newest, each with a dot
 * only where the data says something about it (the answer being written, a draft that waits for the person), and "Alla
 * samtal", the register of them. Every row that has an icon keeps it, so the rail's own collapse draws it as an icon
 * named by its label. At the foot one row, Administration, for a person who holds any of its sections (`ADMIN_ROWS`);
 * the administration lists its sections itself. Every place is a link to a route, so the back button and a reload land
 * in the same place. Returned as the shell's slots so the shell keeps the heading, the person and the way out.
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
  const { pathname } = useLocation();
  const talk = useConversation();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  // Every tool the person may open: the views an administrator placed (D40) and Clew's own lists the person has.
  const menu = useMemo(() => toolsOf(areasData?.menu ?? EMPTY_MENU, areas), [areasData?.menu, areas]);
  // A place whose system the person cannot see is not drawn (D23); until `/api/areas` answers, the rail draws it.
  const systems = areasData?.systems;
  const sees = (connector: string) => !systems || systems.some(s => s.connector === connector);
  const held = useHeldCapabilities();
  // The reminders are a row here while no shared header's band stands above the rail with its bell (D88).
  const banded = !!useQuery(headerQuery).data?.source;
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
  // things the box's router finds without the model.
  const { source, byId } = useMemo(() => {
    const tools: SearchableItem<Found>[] = menu.map(e => ({
      id: 'verktyg:' + e.capability,
      label: e.label,
      auxiliaryData: { href: toolHref(e.capability), detail: e.source, group: 'Verktyg' },
    }));
    const items: SearchableItem<Found>[] = [
      // Every conversation is found, also one asked beside a page and not yet opened, which only the rail's latest
      // leave out (D130 rule 6).
      ...g.allQuestions.map(t => ({
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
      byId: new Map(items.map(i => [i.id, i.auxiliaryData!])),
    };
  }, [threads, areas, menu]);
  // The tool whose page is open: the one the page names, else, on a tool's page that does not know it is a tool (one
  // of Clew's own lists opened from the rail or from Alla verktyg), the one whose page the address is.
  const openCapability = current.surface === 'verktyg' ? (current.view ?? toolOf(pathname)) : null;
  const tool = (e: MenuEntry) => (
    <SideNavItem
      key={e.capability}
      label={e.label}
      icon={clewIcon[e.icon]}
      href={toolHref(e.capability)}
      isSelected={e.capability === openCapability}
    />
  );
  // The first tools, and the one open now when it is further down the list, so the page the person is on stays marked.
  const openTool = menu.slice(TOOLS_SHOWN).find(e => e.capability === openCapability);
  const tools = [...menu.slice(0, TOOLS_SHOWN), ...(openTool ? [openTool] : [])];
  // The newest conversations, and the one open now first in their place when it is older, as the board marks it. One
  // asked beside a page stands among them once it has been opened as a conversation (D130 rule 6); the one on screen is
  // marked at once, before its page has said so.
  const latest = g.questions.slice(0, CONVERSATIONS_SHOWN);
  const openConversation = latest.some(t => t.id === current.conversationId)
    ? undefined
    : g.allQuestions.find(t => t.id === current.conversationId);
  const conversations = openConversation ? [openConversation, ...latest.slice(0, CONVERSATIONS_SHOWN - 1)] : latest;
  // The search (board Shell's "Sök"): Astryx's command palette over the page, opened from its row in the rail. A pick
  // opens what it found: a work item where a work item opens from the page the person is on, anything else at its address.
  const [searching, setSearching] = useState(false);
  const pick = (id: string) => {
    const hit = byId.get(id);
    if (!hit) return;
    const { pathname, search } = pageLocation();
    navigate('card' in hit ? cardOverPage(pathname, search, hit.card) : hit.href);
  };
  const label = 'Sök i samtal och ärenden';
  return {
    overlay: (
      <CommandPalette<SearchableItem<Found>>
        isOpen={searching}
        onOpenChange={open => {
          if (!open) setSearching(false);
        }}
        searchSource={source}
        label={label}
        input={<CommandPaletteInput label={label} placeholder={label} />}
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
        {/* The rail's one utility (board RailOrder b, the template's "Search"): a row with its icon, so a folded rail draws it as its other rows. */}
        <SideNavSection title="Börja" isHeaderHidden>
          <SideNavItem label="Sök" icon="search" onClick={() => setSearching(true)} />
        </SideNavSection>
        <Divider />
        <SideNavSection title="Mitt arbete">
          <SideNavItem
            label="Hem"
            icon={HomeIcon}
            href="/"
            isSelected={current.surface === 'start' && !current.conversationId && !current.conversation}
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
          {/* The reminders (D39), where the bell beside the rail's heading was (D126, pending the product owner). */}
          {!banded && <ReminderRow />}
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
            {/* Every tool on a page of its own (D126 rule 7, the `library` template), marked while it is open. */}
            <SideNavItem
              label="Alla verktyg"
              icon={Squares2X2Icon}
              href={TOOLS_HREF}
              isSelected={current.surface === 'tools'}
            />
          </SideNavSection>
        )}
        {/* Fråga assistenten (D126 item 10): asking is one way of doing the work, so it follows it, Ny fråga first. */}
        <SideNavSection title="Fråga assistenten">
          {/* Ny fråga is a page of its own (D126 item 14): a new conversation with nothing in it, wherever it is pressed. */}
          <SideNavItem
            label="Ny fråga"
            icon={PlusIcon}
            href="/conversations/new"
            isSelected={!!current.newQuestion}
            onClick={() => {
              const { pathname, search } = pageLocation();
              talk.newConversation({ from: pathname + search, stay: true });
            }}
          />
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
          {/* The register of every conversation, once there is one to list, also one only asked beside a page. */}
          {g.allQuestions.length > 0 && (
            <SideNavItem
              label="Alla samtal"
              icon={ChatBubbleLeftRightIcon}
              href="/conversations"
              isSelected={
                current.surface === 'conversations' ||
                (!!current.conversation &&
                  !current.newQuestion &&
                  !conversations.some(t => t.id === current.conversationId))
              }
            />
          )}
        </SideNavSection>
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
