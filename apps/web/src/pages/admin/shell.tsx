import type { ReactNode } from 'react';
import type { SessionUser } from '@clew/contracts';
import { Avatar, BreadcrumbItem, Breadcrumbs, Button, EmptyState, HStack, Layout, LayoutContent, LayoutHeader, LayoutPanel, List, ListItem, Text, VStack, signOut, useMediaQuery } from '@clew/ui';

/**
 * The administration surface (D23): the same shell as the start and calendar pages, a list of admin sections in the
 * start panel (Anslutna system today, Modeller when D24 lands), and the content with its breadcrumb. Only Astryx.
 */
export type Crumb = { label: string; href?: string };
export function AdminShell({ user, crumbs, children }: { user: SessionUser; crumbs: Crumb[]; children: ReactNode }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const sections = <List density="compact" aria-label="Administration">
    <ListItem label="Anslutna system" isSelected href="/admin/anslutningar" />
    <ListItem label="Modeller" description={<Text type="supporting">Kommer senare (D24)</Text>} />
  </List>;
  return <Layout height="fill" padding={0}
    header={<LayoutHeader hasDivider role="banner" padding={mobile ? 3 : 4}>
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
        <HStack gap={2} vAlign="center">
          {!mobile && <Avatar name={user.name} size="md" />}
          <VStack gap={0}>
            <Text weight="semibold">Administration</Text>
            <Text type="supporting">{user.name}{mobile ? '' : ` · ${user.unitLabel}`}</Text>
          </VStack>
        </HStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="ghost" size="sm" label="Till startsidan" href="/" />
          <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
        </HStack>
      </HStack>
    </LayoutHeader>}
    start={mobile ? undefined : <LayoutPanel hasDivider width={260} padding={2} role="navigation" label="Administration">{sections}</LayoutPanel>}
    content={<LayoutContent padding={mobile ? 3 : 4} role="main">
      <VStack gap={4}>
        <Breadcrumbs label="Du är här" variant="supporting">
          <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
          <BreadcrumbItem href="/admin/anslutningar">Administration</BreadcrumbItem>
          {crumbs.map((c, i) => <BreadcrumbItem key={i} href={c.href} isCurrent={i === crumbs.length - 1}>{c.label}</BreadcrumbItem>)}
        </Breadcrumbs>
        {mobile && <HStack gap={1} wrap="wrap" as="nav" aria-label="Administration"><Button size="sm" variant="primary" label="Anslutna system" href="/admin/anslutningar" /><Button size="sm" variant="secondary" label="Modeller" isDisabled /></HStack>}
        {children}
      </VStack>
    </LayoutContent>} />;
}
/** A signed-in person without the grant capability who reaches /admin: no data, one way back. The server refuses every call anyway. */
export function NotAdmin() {
  return <Layout height="fill" padding={6} content={<LayoutContent role="main">
    <EmptyState headingLevel={1} title="Du saknar behörighet till administrationen" description="Administration av anslutningar kräver behörigheten admin.connectors. Be systemförvaltaren om du behöver den." actions={<Button label="Till startsidan" href="/" />} />
  </LayoutContent>} />;
}
