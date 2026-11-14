import { useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Heading,
  HStack,
  Icon,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  Link,
  List,
  ListItem,
  StackItem,
  Text,
  VStack,
  useAnimatedLayout,
  useMediaQuery,
} from '@clew/ui';
import { useHeldCapabilities } from '../capabilities';
import { areasQuery } from '../queries';
import { mobileQuery, shortQuery } from '../media';
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
        <Heading level={2}>Administration</Heading>
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
    <Layout
      height="auto"
      content={
        <LayoutContent padding={4} isScrollable={false}>
          <VStack gap={4} ref={area}>
            <Heading level={1}>Administration</Heading>
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
        </LayoutContent>
      }
    />
  );
}

/**
 * Every administration page in one frame (D126, board Admin, the `settings-sidebar` template): the administration's own
 * panel in the start slot beside a page of its own, whose head is the section's (`AdminSectionHeader`) or a thing's in it
 * (`AdminThingHeader`) and whose content is the register or the form. Under 768 px the panel gives way to the list at
 * `/admin`, as the template drills from the menu into a section, and each head has its way back. The head stays while
 * the content scrolls; on a short screen nothing is pinned and the page scrolls as one (1.4.10). `flush` lets a register
 * meet the edges as the board draws it; a form keeps the content's gutters.
 */
export function AdminFrame({
  section,
  header,
  label,
  flush = false,
  children,
}: {
  section: AdminSection;
  header: ReactNode;
  /** What the content is named while it scrolls: the page's title. */
  label: string;
  flush?: boolean;
  children: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const page = (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={header}
      content={
        <LayoutContent padding={flush ? 0 : mobile ? 4 : 6} isScrollable={!short} label={label}>
          {children}
        </LayoutContent>
      }
    />
  );
  if (mobile) return page;
  return (
    <Layout
      height={short ? 'auto' : 'fill'}
      start={<SectionsPanel current={section} />}
      content={
        <LayoutContent padding={0} isScrollable={false}>
          {page}
        </LayoutContent>
      }
    />
  );
}

/**
 * A section's head (board Admin): its title, the facts line under it and its one primary action at the end of the
 * title's line. On a phone the way back to the sections stands before the title, as the template's back button does.
 */
export function AdminSectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  /** The line under the title: what the section holds, in supporting text. */
  meta?: ReactNode;
  /** The section's own controls: its one primary action, and the ways to its sub-pages where it has them. */
  action?: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  return (
    <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <HStack gap={2} vAlign="center">
            {mobile && (
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon="chevronLeft" size="sm" />}
                label="Tillbaka till Administration"
                href="/admin"
              />
            )}
            <VStack gap={0.5}>
              <Heading level={1}>{title}</Heading>
              {typeof meta === 'string' ? (
                <Text type="supporting" color="secondary">
                  {meta}
                </Text>
              ) : (
                meta
              )}
            </VStack>
          </HStack>
        </StackItem>
        {action}
      </HStack>
    </LayoutHeader>
  );
}

/**
 * A thing's head inside a section (D126 rule 1, board Arende, the `work-item-detail` composition): the way back to the
 * section with where the thing stands beside it, the title with its mark and state, and the actions directly under the
 * title. Without a title (the thing is still being read, or is gone) only the way back is drawn, and the content says why.
 */
export function AdminThingHeader({
  back,
  place,
  title,
  icon,
  status,
  meta,
  actions,
}: {
  back: { label: string; href: string };
  /** Where the thing stands, after the way back on the trail's line. */
  place?: ReactNode;
  title: string | null;
  /** A mark that belongs to the title and stands before it: a connected system's swatch. */
  icon?: ReactNode;
  /** The thing's state beside its title. */
  status?: ReactNode;
  /** What the thing is, under the title's line: the sentence a sub-page opens with. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const mobile = useMediaQuery(mobileQuery);
  return (
    <LayoutHeader padding={mobile ? 4 : 6} hasDivider>
      <VStack gap={4}>
        <VStack gap={2}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Link href={back.href} type="supporting" color="secondary">
              <HStack as="span" gap={1} vAlign="center">
                <Icon icon="chevronLeft" size="sm" />
                {back.label}
              </HStack>
            </Link>
            {typeof place === 'string' ? (
              <Text type="supporting" color="secondary">
                {place}
              </Text>
            ) : (
              place
            )}
          </HStack>
          {title !== null && (
            <HStack gap={3} vAlign="center" wrap="wrap">
              {icon}
              <Heading level={1}>{title}</Heading>
              {status}
            </HStack>
          )}
          {meta}
        </VStack>
        {actions && (
          <HStack gap={2} vAlign="center" wrap="wrap">
            {actions}
          </HStack>
        )}
      </VStack>
    </LayoutHeader>
  );
}
