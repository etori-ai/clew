import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Area, Capability, MenuEntry, Thread } from '@clew/contracts';
import {
  AcademicCapIcon,
  Badge,
  CommandPalette,
  CommandPaletteInput,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentCheckIcon,
  HomeIcon,
  InboxIcon,
  PlusIcon,
  SideNavItem,
  SideNavSection,
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
import { areasQuery, boardingPlansQuery, threadsQuery } from '../queries';
import { boardingPlaceHref } from '../boarding-address';
import { groupThreads } from '../stream';
import { clewIcon } from '../icons';
import { cardOverPage } from '../panel-address';
import { viewPageHref } from '../view-address';
import { pageLocation } from '../page-location';
import { conversationState, needsYouOf, todoHref } from '../work-items';
import { SubRows, type ShellNav } from './shell';
import { useHeldCapabilities } from '../capabilities';

/** The administration's sections, rows under Administration (D45, administration keeps the rail). */
export type AdminSection =
  'anslutningar' | 'modeller' | 'anvandare' | 'organisation' | 'utseende' | 'kompetens' | 'introduktion';
/**
 * Each row under Administration with the capability its page is behind on the server (D85): a row is drawn only for a
 * person who holds it, so no row leads to a refusal. Kompetens and Introduktion och avslut also need their module switched
 * on and visible to the person (D108 item 13, D124 item 9), which `/api/areas` says by listing the system.
 */
const ADMIN_ROWS: ReadonlyArray<{
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
  surface: 'start' | 'todo' | 'calendar' | 'verktyg' | 'staff' | 'units' | 'competence' | 'boarding' | 'admin';
  conversationId?: string | null;
  /** The capability whose tool page is open (D42), so its row under Verktyg is marked. */
  view?: string | null;
  /** The administration's section that is open (D45), so its row under Administration is marked. */
  section?: AdminSection;
}
/**
 * The places in the rail that belong to one connector: the rail draws each of them on that connector's own signal
 * (`sees`, the system the person may see, D23), Kalender for the calendar and Kompetens for the competence module. A
 * view of one of its reads is a page of that place, so the rail marks the place on it, wherever it was opened from (the
 * review of 2026-11-13: the same list was marked Kompetens, Hem or nothing by its `from`). Personal and Dialogstöd
 * show many systems' rows and belong to none.
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
/** How many tools show at once; the rest sit under "Fler verktyg", so the foot of the menu keeps its height however many connectors offer a row. */
const TOOLS_SHOWN = 4;
/**
 * The address of a tool (D42): its own page, `/tools/:capability`, as the rail and Verktygslådan lead to it. Every other
 * read the person may open has the same page (D116, `view-address.ts`, which also names the way back to it).
 */
export const toolHref = (capability: string) => viewPageHref({ capability });
/**
 * A hit's address, or for a work item the item itself, which opens over the page the person is on when it is picked;
 * `group` is the heading the search lists it under (Astryx's `CommandPalette` groups by it).
 */
type Found = ({ href: string } | { card: string }) & { detail: string; group: string };

/**
 * The rail (D112 item 1, board Sidebar, the `shell-side-nav` template): Ny fråga and Sök as its first rows, each with
 * its icon, so the rail's own collapse draws them as icons named by their labels as it does every row; Sök opens
 * Astryx's `CommandPalette` over the page, which finds conversations, work items, areas and tools. Then the places,
 * Hem, Att göra with how much needs the person, Kalender, a manager's Personal (D94) and Dialogstöd (D116, amended:
 * the header's Start has no row of its own, so Clew's places stand here once), and Kompetens (D120 item 8); Verktyg, the views an
 * administrator placed as tools (D40, each a page of its own, D42); then Samtal, the person's conversations, newest
 * first, in one disclosure, each with a dot only where the data says something about it (the answer being written, a
 * draft that waits for the person). At the foot Administration with the sections the person may open (`ADMIN_ROWS`),
 * collapsed until one of them is open. Kalender is drawn while the calendar is the person's to see (D23), and Kompetens
 * for everyone while the competence module is switched on and visible to them (D108 item 13), the same signal as its row
 * under Administration: not before `/api/areas` has said so, since the module is off until an administrator switches it on,
 * except on a page of the place itself, where the reader already is. Introduktion och avslut (D124 item 12) follows
 * Kompetens and needs the same signal, and then whom it applies to, which the server answers in the list's own read
 * (`boardingPlaceHref`): the list for a manager, there with their own plan above it; their own plan's page for someone
 * with one and nothing to manage; no row for anyone else. It is drawn once that read has answered, so it never leads
 * somewhere and then moves.
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
  // A place whose system the person cannot see is not drawn (D23); until `/api/areas` answers, the rail draws it.
  const systems = areasData?.systems;
  const sees = (connector: string) => !systems || systems.some(s => s.connector === connector);
  const held = useHeldCapabilities();
  // Introduktion och avslut (D124 item 12): read only while the module is on for the person, and drawn from its answer.
  const boardingOn = !!systems && sees('boarding');
  const boardingPlace = boardingPlaceHref(useQuery({ ...boardingPlansQuery, enabled: boardingOn }).data);
  const adminRows = admin
    ? ADMIN_ROWS.filter(r => held.includes(r.capability) && (!r.system || (!!systems && sees(r.system))))
    : [];
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
          {/* Kalender and Kompetens are drawn on their connector's signal, so a read of theirs marks them (`CONNECTOR_PLACES`). */}
          {sees('calendar') && (
            <SideNavItem
              label="Kalender"
              icon="calendar"
              href="/calendar"
              isSelected={current.surface === 'calendar'}
            />
          )}
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
          {/* Kompetens (D120 item 8): the reader's own and, for a manager, the matrix; drawn while the module is on for them.
              On a page of the place it is drawn before `/api/areas` has answered, so the rail does not gain a row under
              the reader's eyes; the page says so itself if the module turns out to be off. */}
          {(!!systems || current.surface === 'competence') && sees('competence') && (
            <SideNavItem
              label="Kompetens"
              icon={AcademicCapIcon}
              href="/competence"
              isSelected={current.surface === 'competence'}
            />
          )}
          {/* Introduktion och avslut (D124 item 12): the list, or the reader's own plan; the server says which, or none. */}
          {boardingOn && boardingPlace && (
            <SideNavItem
              label="Introduktion och avslut"
              icon={ClipboardDocumentCheckIcon}
              href={boardingPlace}
              isSelected={current.surface === 'boarding'}
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
          <SideNavSection title="Samtal">
            {/* The conversation history (board Sidebar): rows of the section itself, so Astryx cuts a long title with an
                ellipsis on one line. Not a row that folds: the region Astryx folds lets its rows grow as wide as their
                text (D112, Astryx gaps). */}
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
          </SideNavSection>
        )}
      </>
    ),
    footer:
      adminRows.length > 0 ? (
        <SideNavItem
          label="Administration"
          icon="wrench"
          collapsible={{ defaultIsCollapsed: current.surface !== 'admin' }}
        >
          <SubRows>
            {adminRows.map(r => (
              <SideNavItem key={r.section} label={r.label} href={r.href} isSelected={current.section === r.section} />
            ))}
          </SubRows>
        </SideNavItem>
      ) : undefined,
  };
}
