import { useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Heading,
  HStack,
  Icon,
  LayoutPanel,
  List,
  ListItem,
  Text,
  VStack,
  useAnimatedLayout,
  useMediaQuery,
} from '@clew/ui';
import { useHeldCapabilities } from '../../capabilities';
import { areasQuery } from '../../queries';
import { mobileQuery } from '../../media';
import { PageFrame } from './page-frame';
import { ADMIN_ROWS, type AdminSection } from './nav';

export type { AdminSection } from './nav';
/**
 * One section of the administration: the rail's data (`ADMIN_ROWS`), so the rail's one Administration row and this
 * panel answer from the same list and the same rule (D126). The order is the panel's, and `/admin` opens the first.
 */
export type AdminSectionRow = (typeof ADMIN_ROWS)[number];
/** The section a page belongs to, by its id. */
export const adminSection = (section: AdminSection) => ADMIN_ROWS.find(r => r.section === section)!;

/**
 * The sections the person may open, and whether that is known yet: a section of a module waits for `/api/areas`, so
 * until it has answered (or failed) the list may still grow. The section a page is on is drawn before then, so the panel
 * does not gain the row the reader is already on.
 */
export function useAdminSections(current?: AdminSection): {
  sections: readonly AdminSectionRow[];
  settled: boolean;
} {
  const held = useHeldCapabilities();
  const areas = useQuery(areasQuery);
  const systems = areas.data?.systems;
  const sections = ADMIN_ROWS.filter(
    r =>
      held.includes(r.capability) &&
      (!r.system || r.section === current || !!systems?.some(s => s.connector === r.system)),
  );
  return { sections, settled: systems !== undefined || areas.isError };
}

/**
 * The administration's own panel (D126, the `settings-sidebar` template): its heading and the sections as links, the
 * open one marked, a navigation landmark of its own beside the rail's. A section of a module that answers late glides in
 * rather than pushing the rows under it.
 */
function SectionsPanel({ current }: { current: AdminSection }) {
  const { sections } = useAdminSections(current);
  const area = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: area });
  return (
    <LayoutPanel width={240} padding={4} hasDivider role="navigation" label="Administration">
      <VStack gap={3} ref={area}>
        {/* Inset as the rows' labels are, so the heading starts on the line the page's title and the labels start on. */}
        <VStack paddingInline={2}>
          <Heading level={2}>Administration</Heading>
        </VStack>
        <List animatedLayout={animatedLayout}>
          {sections.map(r => (
            <ListItem
              key={r.section}
              itemKey={r.section}
              label={r.label}
              href={r.href}
              isSelected={r.section === current}
            />
          ))}
        </List>
      </VStack>
    </LayoutPanel>
  );
}

/**
 * The narrow administration (the `settings-sidebar` template under 768 px): the sections as a list of their own, the
 * page `/admin` is on a phone, each row leading to its section, whose head then has the way back here.
 */
export function AdminSectionsList() {
  const { sections } = useAdminSections();
  const area = useRef<HTMLDivElement>(null);
  const animatedLayout = useAnimatedLayout({ containerRef: area });
  return (
    <PageFrame ask={{ none: 'administration' }} title="Administration" label="Administration">
      <VStack ref={area}>
        <List density="spacious" aria-label="Administration" animatedLayout={animatedLayout}>
          {sections.map(r => (
            <ListItem
              key={r.section}
              itemKey={r.section}
              label={r.label}
              href={r.href}
              endContent={<Icon icon="chevronRight" size="sm" color="secondary" />}
            />
          ))}
        </List>
      </VStack>
    </PageFrame>
  );
}

/** A thing's page inside a section (D126 rule 1, board Arende): where it stands, its mark and state, its actions. */
export interface AdminThing {
  /** The way back; by default the thing's section. */
  back?: { label: string; href: string };
  /** Where the thing stands, after the way back on the trail's line. */
  place?: ReactNode;
  /** A mark that belongs to the title and stands before it: a connected system's swatch. */
  icon?: ReactNode;
  /** The thing's state beside its title. */
  status?: ReactNode;
  /** What the thing is, under the title's line: the sentence a sub-page opens with. */
  meta?: ReactNode;
  /** The thing's actions, directly under the title (the `work-item-detail` composition). */
  actions?: ReactNode;
}

/**
 * Every administration page in the one page frame (D126, board Admin, the `settings-sidebar` template; the product
 * owner 2026-11-14: Hem's container is every page's): the page's head above, its title on the line every page's title
 * stands on, and under it the administration's own panel of sections in the start slot beside the section's content,
 * both inside the same column. A section's head is its title, the facts line under it and its one primary action at
 * the end of the title's line; a thing's in a section is the way back to its section with where it stands, the title
 * with its mark and state, and its actions directly under the title (without a title, while the thing is read or when
 * it is gone, only the way back, and the content says why). Under 768 px the panel gives way to the list at `/admin`,
 * as the template drills from the menu into a section, and each head has its way back there. A register sits in the
 * column in a card, as Hem's lists do.
 */
export function AdminFrame({
  section,
  title,
  meta,
  action,
  thing,
  label,
  children,
}: {
  section: AdminSection;
  /** The page's level-1 heading; null while a thing is being read or is gone, when the content holds the heading. */
  title: string | null;
  /** A section's facts line under its title. */
  meta?: ReactNode;
  /** A section's own controls: its one primary action, and the ways to its sub-pages where it has them. */
  action?: ReactNode;
  thing?: AdminThing | undefined;
  /** What the content is named while it scrolls: the page's title. */
  label: string;
  children: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const own = adminSection(section);
  const back = thing
    ? (thing.back ?? { label: own.label, href: own.href })
    : mobile
      ? { label: 'Administration', href: '/admin' }
      : null;
  return (
    <PageFrame
      ask={{ none: 'administration' }}
      back={back}
      trail={
        typeof thing?.place === 'string' ? (
          <Text type="supporting" color="secondary">
            {thing.place}
          </Text>
        ) : (
          thing?.place
        )
      }
      icon={thing && title !== null ? thing.icon : undefined}
      title={thing ? title : (title ?? own.label)}
      status={thing?.status}
      meta={thing ? thing.meta : meta}
      actions={thing ? undefined : action}
      below={
        thing?.actions ? (
          <HStack gap={2} vAlign="center" wrap="wrap">
            {thing.actions}
          </HStack>
        ) : undefined
      }
      label={label}
      // A section's column may hold nothing that takes the focus (a table of plain cells, its list on a phone), so
      // wherever it scrolls under a pinned head it is a tab stop of its own (2.1.1). The section scrolls as one page
      // (D130 item 8 as amended 2026-11-21), so that is only when the frame is told to pin.
      scrollTabStop
      start={mobile ? undefined : <SectionsPanel current={section} />}
    >
      {children}
    </PageFrame>
  );
}
