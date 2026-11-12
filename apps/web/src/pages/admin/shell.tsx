import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import {
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  DropdownMenu,
  EmptyState,
  Layout,
  LayoutContent,
  Tab,
  TabList,
  VStack,
} from '@clew/ui';
import { ADMIN_SECTIONS, useNav, type AdminSection } from '../../components/nav';
import { Shell, mobileQuery } from '../../components/shell';
import { useMediaQuery } from '@clew/ui';
import { AsyncContent, ContentSkeleton } from '../../components/loading';
import { PageFooter } from '../../components/footer';

/**
 * The administration surface (D23, D24) on the shared shell (D31): Administration is one of Clew's pages in the header
 * (D115 item 3), and its sections (D45) are tabs under the trail, each a link to its own address. The page sits in a
 * Layout whose contentWidth bounds and centres it, as every page's does. Each page opens with the one page header
 * (D74, `components/page-header.tsx`) under the tabs. Only Astryx.
 */
export type Crumb = { label: string; href?: string };
export function AdminShell({
  user,
  crumbs,
  children,
  section = 'anslutningar',
  pending = false,
}: {
  user: SessionUser;
  crumbs: Crumb[];
  children: ReactNode;
  section?: AdminSection;
  pending?: boolean;
}) {
  const mobile = useMediaQuery(mobileQuery);
  // Only an administrator reaches this shell: `main.tsx` draws NotAdmin for anyone else.
  const nav = useNav({ current: { surface: 'admin' }, admin: true, manager: user.role === 'manager' });
  return (
    <Shell user={user} nav={nav}>
      {/* Layout's contentWidth bounds the page and centres it in the content area, the same mechanism as the start page's
        column; the Layout owns its gutters through `padding`, 32 px as on every page (D74), and grows with the page so
        the shell keeps the scroll. The trail stands above the page header, where Astryx places Breadcrumbs. */}
      <Layout
        height="auto"
        contentWidth={1280}
        padding={mobile ? 3 : 8}
        content={
          <LayoutContent isScrollable={false}>
            <VStack gap={5}>
              <Breadcrumbs label="Du är här" variant="supporting">
                <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
                <BreadcrumbItem href="/admin/connectors">Administration</BreadcrumbItem>
                {crumbs.map((c, i) => (
                  <BreadcrumbItem key={i} href={c.href} isCurrent={i === crumbs.length - 1}>
                    {c.label}
                  </BreadcrumbItem>
                ))}
              </Breadcrumbs>
              {/* Navigation between the sections, not panels switched in place: every entry is a link. Six tabs do not
                fit 320 px without scrolling sideways (1.4.10), so a phone gets the sections as a menu, as a connector's
                own page does; a wider window gets Astryx TabList's navigation pattern. */}
              {mobile ? (
                <DropdownMenu
                  presentation="adaptive"
                  button={{
                    label: `Sektion: ${ADMIN_SECTIONS.find(s => s.id === section)!.label}`,
                    size: 'sm',
                    variant: 'secondary',
                  }}
                  items={ADMIN_SECTIONS.map(s => ({ id: s.id, label: s.label, href: s.href }))}
                />
              ) : (
                <TabList value={section} onChange={() => {}} hasDivider>
                  {ADMIN_SECTIONS.map(s => (
                    <Tab key={s.id} value={s.id} label={s.label} href={s.href} />
                  ))}
                </TabList>
              )}
              <AsyncContent pending={pending} fallback={<ContentSkeleton />} gap={5}>
                {children}
              </AsyncContent>
              <PageFooter user={user} />
            </VStack>
          </LayoutContent>
        }
      />
    </Shell>
  );
}
/** A signed-in person without the grant capability who reaches /admin: no data, one way back. The server refuses every call anyway. */
export function NotAdmin() {
  return (
    <Layout
      height="fill"
      padding={6}
      content={
        <LayoutContent role="main">
          <EmptyState
            headingLevel={1}
            title="Du saknar behörighet till administrationen"
            description="Administrationen kräver en behörighet som systemförvaltaren delar ut. Be systemförvaltaren om du behöver den."
            actions={<Button label="Till startsidan" href="/" />}
          />
        </LayoutContent>
      }
    />
  );
}
