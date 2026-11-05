import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { BreadcrumbItem, Breadcrumbs, Button, EmptyState, HStack, Heading, Layout, LayoutContent, SideNav, SideNavItem, SideNavSection, Text, VStack } from '@clew/ui';
import { Shell, mobileQuery } from '../../components/shell';
import { useMediaQuery } from '@clew/ui';

/**
 * The administration surface (D23, D24) on the shared shell (D31): the SideNav holds the admin sections (Anslutna
 * system and Modeller; the drawer on a phone), and the page sits in a Layout whose contentWidth bounds and centres it, so
 * a table does not run to the edge of a wide screen and the page lines up with the start page's column. Only Astryx.
 */
export type Crumb = { label: string; href?: string };
export type AdminSection = 'anslutningar' | 'modeller';
export function AdminShell({ user, crumbs, children, section = 'anslutningar' }: { user: SessionUser; crumbs: Crumb[]; children: ReactNode; section?: AdminSection }) {
  const mobile = useMediaQuery(mobileQuery);
  return <Shell user={user} admin current="admin"
    sideNav={<SideNav>
      <SideNavSection title="Anslutningar">
        <SideNavItem label="Anslutna system" isSelected={section === 'anslutningar'} href="/admin/anslutningar" />
        <SideNavItem label="Modeller" isSelected={section === 'modeller'} href="/admin/modeller" />
      </SideNavSection>
      <SideNavSection title="Om administrationen" isHeaderHidden>
        <Text type="supporting" as="p">Du styr vilka system Startsidan är ansluten till, vilka modeller som svarar i frågerutan och vem som ser dem. Vad var och en får göra i ett system avgör systemet självt.</Text>
      </SideNavSection>
    </SideNav>}>
    {/* Layout's contentWidth bounds the page and centres it in the content area, the same mechanism as the start page's
        column; the Layout owns its gutters through `padding`, and grows with the page so the shell keeps the scroll. */}
    <Layout height="auto" contentWidth={1216} padding={mobile ? 3 : 6} content={<LayoutContent isScrollable={false}>
      <VStack gap={5}>
        <Breadcrumbs label="Du är här" variant="supporting">
          <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
          <BreadcrumbItem href="/admin/anslutningar">Administration</BreadcrumbItem>
          {crumbs.map((c, i) => <BreadcrumbItem key={i} href={c.href} isCurrent={i === crumbs.length - 1}>{c.label}</BreadcrumbItem>)}
        </Breadcrumbs>
        {children}
      </VStack>
    </LayoutContent>} />
  </Shell>;
}
/** A signed-in person without the grant capability who reaches /admin: no data, one way back. The server refuses every call anyway. */
export function NotAdmin() {
  return <Layout height="fill" padding={6} content={<LayoutContent role="main">
    <EmptyState headingLevel={1} title="Du saknar behörighet till administrationen" description="Administration av anslutningar kräver behörigheten admin.connectors. Be systemförvaltaren om du behöver den." actions={<Button label="Till startsidan" href="/" />} />
  </LayoutContent>} />;
}
/** The page's lead: the h1, one sentence that says what the page is for, and the primary action beside them. */
export function PageLead({ title, lead, children, actions }: { title: ReactNode; lead?: string; children?: ReactNode; actions?: ReactNode }) {
  return <HStack justify="between" vAlign="start" gap={3} wrap="wrap">
    <VStack gap={1}>
      {typeof title === 'string' ? <Heading level={1}>{title}</Heading> : title}
      {lead && <Text as="p" color="secondary">{lead}</Text>}
      {children}
    </VStack>
    {actions}
  </HStack>;
}
