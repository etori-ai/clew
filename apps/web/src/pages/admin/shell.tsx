import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { SessionUser } from '@clew/contracts';
import { Button, EmptyState, Layout, LayoutContent, useMediaQuery } from '@clew/ui';
import { useRail } from '../../components/nav';
import { Shell, mobileQuery } from '../../components/shell';
import { AsyncContent, ContentSkeleton } from '../../components/loading';
import { PageFrame } from '../../components/page-frame';
import { usePageTitle } from '../../page-title';
import {
  AdminFrame,
  AdminSectionsList,
  adminSection,
  useAdminSections,
  type AdminSection,
  type AdminThing,
} from '../../components/admin-frame';

export type { AdminSection } from '../../components/admin-frame';

/**
 * The administration surface (D23, D24) on the shared shell (D31): the rail keeps one row for it, and every page is
 * drawn in the administration's own frame (D126, board Admin, `components/admin-frame.tsx`): its sections in a panel
 * beside the page, the page's head above its content. A section page names its title, the facts line under it and its
 * one primary action (`meta`, `action`); a thing in a section (a connector, a model, a provider, a sub-page of
 * Kompetens or an import) passes `thing`, and gets the thing's head: the way back to its section, the title, the
 * actions under it. The panel and the way back replace the trail the pages had above their headers.
 */
export function AdminShell({
  user,
  section,
  title,
  meta,
  action,
  thing,
  pending = false,
  children,
}: {
  user: SessionUser;
  section: AdminSection;
  /** The page's level-1 heading; null while a thing is being read or is gone, when the content holds the heading. */
  title: string | null;
  meta?: ReactNode;
  action?: ReactNode;
  /** A thing's page in the section: where it stands, its mark and state, its actions; the way back is its section's. */
  thing?: AdminThing;
  pending?: boolean;
  children: ReactNode;
}) {
  // Only an administrator reaches this shell: `main.tsx` draws NotAdmin for anyone else.
  const nav = useRail({ current: { surface: 'admin' }, admin: true, manager: user.role === 'manager' });
  const own = adminSection(section);
  return (
    <Shell user={user} nav={nav}>
      <AdminFrame
        section={section}
        title={thing ? title : (title ?? own.label)}
        meta={meta}
        action={action}
        thing={thing}
        label={title ?? own.label}
      >
        <AsyncContent pending={pending} fallback={<ContentSkeleton heading={false} />} gap={5}>
          {children}
        </AsyncContent>
      </AdminFrame>
    </Shell>
  );
}

/**
 * `/admin`, where the rail's one row leads: on a wide screen the first section the person may open, in place of this
 * address, so Back does not return to a page that only moves on; on a phone the sections as a list of their own (the
 * `settings-sidebar` template's menu), each leading to its section. A person whose every capability belongs to a module
 * that is switched off is told so in the frame.
 */
export function AdminIndexPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery(mobileQuery);
  const { sections, settled } = useAdminSections();
  const nav = useRail({ current: { surface: 'admin' }, admin: true, manager: user.role === 'manager' });
  // The sections without a module stand first, so the first one is known before `/api/areas` has answered.
  const first = sections[0];
  usePageTitle(mobile || !first ? 'Administration' : null);
  if (!mobile && first) return <Navigate to={first.href} replace />;
  return (
    <Shell user={user} nav={nav}>
      {sections.length === 0 ? (
        <PageFrame ask={{ none: 'administration' }}>
          {settled ? (
            <EmptyState
              headingLevel={1}
              title="Inget att administrera ännu"
              description="Det du har behörighet till är inte påslaget. Det syns här när systemförvaltaren slår på det under Anslutna system."
              actions={<Button label="Till startsidan" href="/" />}
            />
          ) : (
            <ContentSkeleton label="Hämtar administrationen …" />
          )}
        </PageFrame>
      ) : (
        <AdminSectionsList />
      )}
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
