import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { AppShell, Badge, BreadcrumbItem, Breadcrumbs, Button, EmptyState, HStack, Heading, Icon, Layout, LayoutContent, Section, SideNav, SideNavItem, SideNavSection, Text, TopNav, TopNavHeading, VStack, signOut, useMediaQuery } from '@clew/ui';

/**
 * The administration surface (D23): Astryx's AppShell with a TopNav for identity and the way out, a SideNav for the
 * admin sections (Anslutna system today, Modeller when D24 lands; the drawer on a phone), and the page inside a
 * Layout with a bounded content width so a table does not run to the edge of a wide screen. Only Astryx.
 */
export type Crumb = { label: string; href?: string };
export function AdminShell({ user, crumbs, children }: { user: SessionUser; crumbs: Crumb[]; children: ReactNode }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  return <AppShell height="fill" variant="section" contentPadding={0}
    topNav={<TopNav label="Administration" heading={<TopNavHeading heading="Administration" superheading="Startsidan" superheadingHref="/" subheading={mobile ? user.name : `${user.name} · ${user.unitLabel}`} />}
      endContent={<HStack gap={1} vAlign="center">
        <Button variant="ghost" size="sm" label="Till startsidan" href="/" icon={<Icon icon="chevronLeft" size="sm" />} isIconOnly={mobile} />
        <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
      </HStack>} />}
    sideNav={<SideNav>
      <SideNavSection title="Anslutningar">
        <SideNavItem label="Anslutna system" icon="wrench" isSelected href="/admin/anslutningar" />
        <SideNavItem label="Modeller" isDisabled endContent={<Badge variant="neutral" label="Kommer" />} />
      </SideNavSection>
      <SideNavSection title="Om administrationen" isHeaderHidden>
        <Text type="supporting" as="p">Du styr vilka system Startsidan är ansluten till och vem som ser dem. Vad var och en får göra i ett system avgör systemet självt.</Text>
      </SideNavSection>
    </SideNav>}>
    {/* The page's gutters live on this Section: a Layout, or a Section with padding 0, is full-bleed and would cancel the shell's padding. */}
    <Section variant="transparent" padding={mobile ? 3 : 6} maxWidth={1216}>
      <VStack gap={5}>
        <Breadcrumbs label="Du är här" variant="supporting">
          <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
          <BreadcrumbItem href="/admin/anslutningar">Administration</BreadcrumbItem>
          {crumbs.map((c, i) => <BreadcrumbItem key={i} href={c.href} isCurrent={i === crumbs.length - 1}>{c.label}</BreadcrumbItem>)}
        </Breadcrumbs>
        {children}
      </VStack>
    </Section>
  </AppShell>;
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
