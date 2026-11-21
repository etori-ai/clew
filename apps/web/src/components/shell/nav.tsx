import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, Capability, MenuEntry, Thread } from '@clew/contracts';
import {
  Button,
  CommandPalette,
  CommandPaletteInput,
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuItem,
  Icon,
  Text,
  VStack,
  createStaticSource,
  type SearchableItem,
} from '@clew/ui';
import type { SiteHeaderPage } from '@clew/site-header';
import { today } from '@clew/calendar/dates';
import { areasQuery, entityListQuery, threadsQuery } from '../../queries';
import { groupThreads } from '../../stream';
import { cardOverPage } from '../../panel-address';
import { viewPageHref } from '../../view-address';
import { pageLocation } from '../../page-location';
import { toolOf, unitPageHref } from '../../person-address';
import { toolsOf } from '../../tool-catalogue';
import { needsYouOf, todoHref } from '../../work-items';
import { useHeldCapabilities } from '../../capabilities';

/**
 * What a page hands the shell for the shared header (D130): Clew's own pages for the row under the band, the current
 * one, what stands at that row's end on a wide window, the search's button for the band, and what the search opens over
 * the page.
 */
export interface ShellNav {
  pages: readonly SiteHeaderPage[];
  current: string | null;
  end?: ReactNode;
  search?: ReactNode;
  overlay?: ReactNode;
}
const toolId = (capability: string) => 'tool:' + capability;
/** The id of Hem among Clew's pages: the shell lists it as "Start" where no header connector does (D130). */
export const START_PAGE_ID = 'start';

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
/** What the header marks as current among Clew's pages: the place, and within the start page the conversation. */
export interface NavCurrent {
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
const CONNECTOR_PLACES: Readonly<Record<string, NavCurrent['surface']>> = {
  calendar: 'calendar',
  competence: 'competence',
};
/** The place a read's page belongs to, by its connector (a capability's name begins with its connector's id), or null. */
export function placeOfRead(capability: string): NavCurrent | null {
  const surface = CONNECTOR_PLACES[capability.split('.')[0] ?? ''];
  return surface ? { surface } : null;
}
const EMPTY_THREADS: Thread[] = [];
const EMPTY_AREAS: Area[] = [];
const EMPTY_MENU: MenuEntry[] = [];
/** How many tools the menu shows; every tool is under "Alla verktyg", so the menu keeps its length however many there are. */
const TOOLS_SHOWN = 4;
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
 * Clew's own pages, for the row under the shared header's band (D130): there is no rail, as the startsidan prototype
 * has none, and the places a person goes to inside Clew stand under the band on every one of Clew's addresses. In the
 * row: Att göra with how much needs the person, Kalender while the calendar is the person's to see (D23), for a manager
 * Personal and Läget (D94, D117: the one unit, or the list of them), Samtal, the register of the person's
 * conversations, and Administration for a person who holds any of its sections (`ADMIN_ROWS`). At the row's end
 * "Verktyg", a menu with the views an administrator placed as tools (D40, each a page of its own, D42) and Clew's own
 * lists the person has (`toolsOf`), the first few, and "Alla verktyg", the page that lists every one. Hem is the
 * header's own Start and the logo. On a phone the header's "Meny" lists every page, the tools among them. Sök stands on
 * the band beside the reminders (`search`) and opens Astryx's `CommandPalette` over the page, which finds
 * conversations, work items, areas and tools. Every place is a link to a route, so the back button and a reload land in
 * the same place.
 */
export function useNav({
  current,
  admin,
  manager,
}: {
  current: NavCurrent;
  admin: boolean;
  /** The session's role is manager (D94): Personal and Läget are among the pages; the server checks the assignments again. */
  manager: boolean;
}): ShellNav {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY_THREADS;
  const areasData = useQuery(areasQuery).data;
  const areas = areasData?.areas ?? EMPTY_AREAS;
  // Every tool the person may open: the views an administrator placed (D40) and Clew's own lists the person has.
  const menu = useMemo(() => toolsOf(areasData?.menu ?? EMPTY_MENU, areas), [areasData?.menu, areas]);
  // A place whose system the person cannot see is not drawn (D23); until `/api/areas` answers, the row draws it.
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
  // The search finds conversations, open work items, the areas and the tools from what the page already has: the same
  // things the box's router finds without the model.
  const { source, byId } = useMemo(() => {
    const tools: SearchableItem<Found>[] = menu.map(e => ({
      id: 'verktyg:' + e.capability,
      label: e.label,
      auxiliaryData: { href: toolHref(e.capability), detail: e.source, group: 'Verktyg' },
    }));
    const items: SearchableItem<Found>[] = [
      // Every conversation is found, also one asked beside a page and never opened as a conversation (D141 rule 6 on
      // the branch, D138 item 10).
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
  // of Clew's own lists opened from the menu or from Alla verktyg), the one whose page the address is.
  const openCapability = current.surface === 'verktyg' ? (current.view ?? toolOf(pathname)) : null;
  const openTool = menu.find(e => e.capability === openCapability);
  const shownTools = menu.slice(0, TOOLS_SHOWN);
  // The search (D126's "Sök"): Astryx's command palette over the page, opened from the band. A pick opens what it
  // found: a work item where a work item opens from the page the person is on, anything else at its address.
  const [searching, setSearching] = useState(false);
  const pick = (id: string) => {
    const hit = byId.get(id);
    if (!hit) return;
    const { pathname, search } = pageLocation();
    navigate('card' in hit ? cardOverPage(pathname, search, hit.card) : hit.href);
  };
  const label = 'Sök i samtal och ärenden';
  const conversations =
    current.surface === 'conversations' || !!current.conversation || !!current.conversationId || !!current.newQuestion;
  const pages: SiteHeaderPage[] = [
    // Att göra (D112 item 3) with how much needs the person: the count Behöver dig has in the queue.
    {
      id: 'todo',
      label: 'Att göra',
      href: '/todo',
      ...(needsYou ? { count: needsYou, countLabel: 'behöver dig' } : {}),
    },
    // Kalender is drawn on its connector's signal, so a read of the calendar marks it (`CONNECTOR_PLACES`).
    ...(sees('calendar') ? [{ id: 'calendar', label: 'Kalender', href: '/calendar' }] : []),
    // A manager's people and the unit's state (D94, D126); the server checks the assignments on every read.
    ...(manager
      ? [
          { id: 'staff', label: 'Personal', href: '/staff' },
          { id: 'units', label: 'Läget', href: lageHref },
        ]
      : []),
    { id: 'conversations', label: 'Samtal', href: '/conversations' },
    ...(adminRows.length > 0 ? [{ id: 'admin', label: 'Administration', href: '/admin' }] : []),
    // The tools are a menu at the row's end on a wide window and rows of the phone's menu.
    ...menu.map(e => ({ id: toolId(e.capability), label: e.label, href: toolHref(e.capability), more: true })),
    ...(menu.length > 0 ? [{ id: 'tools', label: 'Alla verktyg', href: TOOLS_HREF, more: true }] : []),
  ];
  const currentId =
    current.surface === 'start'
      ? conversations
        ? 'conversations'
        : // Hem, and a page opened from it that stands on Hem's place: Start, where the row lists it (`START_PAGE`).
          START_PAGE_ID
      : current.surface === 'verktyg'
        ? openCapability
          ? toolId(openCapability)
          : null
        : current.surface === 'competence' || current.surface === 'boarding'
          ? 'staff'
          : current.surface;
  return {
    pages,
    current: currentId,
    end:
      menu.length > 0 ? (
        <DropdownMenu
          button={{
            // The open tool's own name, so the row still says where the person is.
            label: openTool?.label ?? (current.surface === 'tools' ? 'Alla verktyg' : 'Verktyg'),
            size: 'sm',
            variant: 'ghost',
          }}
        >
          {shownTools.map(e => (
            <DropdownMenuItem key={e.capability} label={e.label} href={toolHref(e.capability)} />
          ))}
          <DropdownMenuDivider />
          <DropdownMenuItem label="Alla verktyg" href={TOOLS_HREF} />
        </DropdownMenu>
      ) : undefined,
    search: (
      <Button
        label="Sök"
        variant="ghost"
        isIconOnly
        icon={<Icon icon="search" color="inherit" />}
        onClick={() => setSearching(true)}
      />
    ),
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
  };
}
