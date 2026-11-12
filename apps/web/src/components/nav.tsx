import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MenuEntry, ViewRef } from '@clew/contracts';
import { DropdownMenu, DropdownMenuItem } from '@clew/ui';
import type { SiteHeaderPage } from '@clew/site-header';
import { areasQuery } from '../queries';

/** The administration's sections (D45): the tabs under the trail on every administration page. */
export type AdminSection = 'anslutningar' | 'modeller' | 'anvandare' | 'organisation' | 'utseende' | 'kompetens';
export const ADMIN_SECTIONS: ReadonlyArray<{ id: AdminSection; label: string; href: string }> = [
  { id: 'anslutningar', label: 'Anslutna system', href: '/admin/connectors' },
  { id: 'modeller', label: 'Modeller', href: '/admin/models' },
  { id: 'anvandare', label: 'Användare', href: '/admin/users' },
  { id: 'organisation', label: 'Organisation', href: '/admin/organisation' },
  { id: 'utseende', label: 'Utseende', href: '/admin/appearance' },
  { id: 'kompetens', label: 'Kompetens', href: '/admin/competence' },
];
/** What the header marks as current among Clew's own pages: the place, and for a tool the capability whose page is open (D42). */
export interface NavCurrent {
  surface: 'start' | 'activities' | 'conversations' | 'calendar' | 'verktyg' | 'staff' | 'admin';
  view?: string | null;
}
/** What a page hands the shell for the row under the header's band: Clew's own pages, the current one, and the menu with the rest. */
export interface ShellNav {
  pages: readonly SiteHeaderPage[];
  current: string | null;
  end?: ReactNode;
}
const EMPTY_MENU: MenuEntry[] = [];
/** How many tools stand in the row; the rest are under "Fler verktyg", so the row keeps one line however many connectors offer a tool. */
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
const toolId = (capability: string) => 'tool:' + capability;

/**
 * Clew's own pages, for the row under the header's band (D115 item 3): there is no rail, and the places a person goes
 * to inside Clew are the pages of the header's Start. Mina aktiviteter, Min AI, Kalender, Personal for a manager (D94), the views
 * connectors offer as tools (D40), each a page of its own (D42), with the ones beyond the first few under "Fler
 * verktyg", and Administration for an administrator. Start itself is the header's own place and the logo. Every entry
 * is a link to a route, so the back button and a reload land in the same place.
 */
export function useNav({
  current,
  admin,
  manager,
}: {
  current: NavCurrent;
  admin: boolean;
  /** The session's role is manager (D94): Personal is among the pages; the server checks the assignments again. */
  manager: boolean;
}): ShellNav {
  const menu = useQuery(areasQuery).data?.menu ?? EMPTY_MENU;
  const more = menu.slice(TOOLS_SHOWN);
  const pages: SiteHeaderPage[] = [
    { id: 'activities', label: 'Mina aktiviteter', href: '/activities' },
    // Min AI (D115 item 5): the conversations' own full-window place.
    { id: 'conversations', label: 'Min AI', href: '/conversations' },
    { id: 'calendar', label: 'Kalender', href: '/calendar' },
    ...(manager ? [{ id: 'staff', label: 'Personal', href: '/staff' }] : []),
    ...menu.map((e, i) => ({
      id: toolId(e.capability),
      label: e.label,
      href: toolHref(e.capability),
      ...(i >= TOOLS_SHOWN ? { more: true } : {}),
    })),
    ...(admin ? [{ id: 'admin', label: 'Administration', href: '/admin/connectors' }] : []),
  ];
  const id =
    current.surface === 'verktyg'
      ? current.view
        ? toolId(current.view)
        : null
      : current.surface === 'start'
        ? null
        : current.surface;
  return {
    pages,
    current: id,
    end: more.length ? (
      <DropdownMenu
        button={{
          // The open tool's own name when it is one of these, so the row still says where the person is.
          label: more.find(e => toolId(e.capability) === id)?.label ?? 'Fler verktyg',
          size: 'sm',
          variant: 'ghost',
        }}
      >
        {more.map(e => (
          <DropdownMenuItem key={e.capability} label={e.label} href={toolHref(e.capability)} />
        ))}
      </DropdownMenu>
    ) : undefined,
  };
}
