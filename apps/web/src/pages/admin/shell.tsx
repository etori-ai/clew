import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { BreadcrumbItem, Breadcrumbs, Button, EmptyState, Layout, LayoutContent, VStack } from '@clew/ui';
import { useRail, type AdminSection } from '../../components/nav';
import { Shell, mobileQuery } from '../../components/shell';
import { useMediaQuery } from '@clew/ui';

/**
 * The administration surface (D23, D24) on the shared shell (D31) with the same rail as every other page (D45): Anslutna
 * system and Modeller are rows under Administration. The page sits in a Layout whose contentWidth bounds and centres it,
 * so a table does not run to the edge of a wide screen and the page lines up with the start page's column. Each page
 * opens with the one page header (D74, `components/page-header.tsx`) under the trail. Only Astryx.
 */
export type Crumb = { label: string; href?: string };
export function AdminShell({
  user,
  crumbs,
  children,
  section = 'anslutningar',
}: {
  user: SessionUser;
  crumbs: Crumb[];
  children: ReactNode;
  section?: AdminSection;
}) {
  const mobile = useMediaQuery(mobileQuery);
  // Only an administrator reaches this shell: `main.tsx` draws NotAdmin for anyone else.
  const nav = useRail({ current: { surface: 'admin', section }, admin: true });
  return (
    <Shell user={user} nav={nav}>
      {/* Layout's contentWidth bounds the page and centres it in the content area, the same mechanism as the start page's
        column; the Layout owns its gutters through `padding`, 32 px as on every page (D74), and grows with the page so
        the shell keeps the scroll. The trail stands above the page header, where Astryx places Breadcrumbs. */}
      <Layout
        height="auto"
        contentWidth={1216}
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
              {children}
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
            description="Administration av anslutningar kräver behörigheten admin.connectors. Be systemförvaltaren om du behöver den."
            actions={<Button label="Till startsidan" href="/" />}
          />
        </LayoutContent>
      }
    />
  );
}
