import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  AppShell,
  Button,
  Dialog,
  DialogHeader,
  RadioList,
  RadioListItem,
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  Text,
  UserCircleIcon,
  VStack,
  signOut,
  useAppearance,
  useToast,
  Divider,
  HStack,
  StackItem,
} from '@clew/ui';
import { branding } from '../branding';
import { threadsQuery } from '../queries';
import { api } from '../api';
import { ReminderBell } from './reminders';

const headerLogo = branding.logo;

/** AppShell moves the SideNav into a drawer below its `md` breakpoint (768 px); every phone decision in the app follows the same line. */
export const mobileQuery = '(max-width: 767px)';
/** 1.4.10: with 480 px or less in height nothing is pinned; the page scrolls as one. */
export const shortQuery = '(max-height: 480px)';

/**
 * The rows under a rail row that opens (D56). Astryx indents them only as far as the parent's label, so they read as its
 * equals; here they sit further in, with a line down from the parent's icon. The line is drawn only: the rows are already
 * a group. A vertical Divider takes its height from a parent of known height, which the StackItem gets by stretching.
 */
export const SubRows = ({ children }: { children: ReactNode }) => (
  <HStack gap={1} paddingInlineStart={4}>
    <StackItem aria-hidden>
      <Divider orientation="vertical" variant="strong" />
    </StackItem>
    <StackItem size="fill">{children}</StackItem>
  </HStack>
);

export type Surface = 'start' | 'kalender' | 'admin';
/** What a surface puts in the rail: a create button on top, its sections (the places, then the conversations, D50) and the rows that stay at the foot. */
export interface ShellNav {
  top?: ReactNode;
  sections: ReactNode;
  footer?: ReactNode;
}
type Props = {
  user: SessionUser;
  nav: ShellNav;
  banner?: ReactNode;
  height?: 'fill' | 'auto';
  children: ReactNode;
};
/** One shell for every surface (D31, D39); Astryx owns navigation, overlays and focus restoration. */
export function Shell({ user, nav, banner, height = 'fill', children }: Props) {
  const { mode, setMode, isPersistent } = useAppearance();
  const logoSrc = mode === 'dark' && headerLogo?.darkSrc ? headerLogo.darkSrc : headerLogo?.src;
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  // Every row in the phone drawer asks to close it. Settings opens over the drawer instead, so its row is still there for Escape to return focus to (2.4.3).
  const keepNavigation = useRef(false);
  const changeNavigation = (open: boolean) => {
    if (open || !keepNavigation.current) setNavigationOpen(open);
    keepNavigation.current = false;
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const toast = useToast();
  const location = useLocation(),
    navigate = useNavigate();
  const deliveryAttempts = useRef(new Set<string>());
  // The same session-scoped cache as the start page carries reminder cards and pending delivery claims.
  const threadsQ = useQuery(threadsQuery);
  const deliveryContext = useRef(threadsQ.data),
    deliveryMounted = useRef(false);
  deliveryContext.current = threadsQ.data;
  useEffect(() => {
    deliveryMounted.current = true;
    return () => {
      deliveryMounted.current = false;
    };
  }, []);
  useEffect(() => {
    for (const delivery of threadsQ.data?.deliveries ?? []) {
      if (deliveryAttempts.current.has(delivery.id)) continue;
      const thread = threadsQ.data?.threads.find(t => t.id === delivery.threadId);
      if (!thread) continue;
      deliveryAttempts.current.add(delivery.id);
      void api
        .claimDelivery(delivery.id)
        .then(({ claimed }) => {
          if (!claimed || !deliveryMounted.current || !deliveryContext.current?.threads.some(t => t.id === thread.id))
            return;
          const dismiss = toast({
            body: delivery.kind === 'reminder' ? 'Påminnelse: ' + thread.title : 'Nya uppgifter finns på Hem.',
            isAutoHide: false,
            uniqueID: delivery.id,
            endContent: (
              <Button
                size="sm"
                variant="ghost"
                label="Visa"
                onClick={() => {
                  navigate('/?card=' + encodeURIComponent(thread.id));
                  dismiss();
                }}
              />
            ),
          });
        })
        .catch(() => {
          deliveryAttempts.current.delete(delivery.id);
        });
    }
  }, [threadsQ.data, toast, navigate]);
  useEffect(() => {
    setNavigationOpen(false);
  }, [location.key]);
  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      toast({ type: 'error', body: error instanceof Error ? error.message : 'Kunde inte logga ut. Försök igen.' });
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <>
      <AppShell
        height={height}
        variant="elevated"
        contentPadding={0}
        mobileNav={{ breakpoint: 'md', isOpen: navigationOpen, onOpenChange: changeNavigation }}
        banner={banner}
        sideNav={
          <SideNav
            header={
              <SideNavHeading
                heading="Startsidan"
                headingHref="/"
                headerEndContent={<ReminderBell />}
                icon={
                  headerLogo && logoSrc !== failedLogo ? (
                    <img
                      src={logoSrc}
                      alt={headerLogo.alt}
                      width={20}
                      height={20}
                      style={{
                        width: 20,
                        height: 20,
                        objectFit: 'contain',
                        padding: 'var(--spacing-3)',
                        boxSizing: 'content-box',
                        backgroundColor: mode === 'dark' && !headerLogo.darkSrc ? 'var(--color-on-dark)' : undefined,
                      }}
                      onError={() => setFailedLogo(logoSrc ?? null)}
                    />
                  ) : undefined
                }
              />
            }
            topContent={nav.top}
            footer={
              <SideNavSection title="Alltid" isHeaderHidden>
                {nav.footer}
                {/* The last row of the rail, a disclosure like Administration above it. Not in `footerIcons`: Astryx draws those in the phone top bar too (D39). */}
                <SideNavItem label={user.name} icon={UserCircleIcon} collapsible={{ defaultIsCollapsed: true }}>
                  <SubRows>
                    <SideNavItem
                      label="Inställningar"
                      onClick={() => {
                        keepNavigation.current = true;
                        setSettingsOpen(true);
                      }}
                    />
                    <SideNavItem
                      label={signingOut ? 'Loggar ut …' : 'Logga ut'}
                      isDisabled={signingOut}
                      onClick={() => {
                        void logout();
                      }}
                    />
                  </SubRows>
                </SideNavItem>
              </SideNavSection>
            }
          >
            {nav.sections}
          </SideNav>
        }
      >
        {children}
      </AppShell>
      <Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogHeader title="Inställningar" onOpenChange={setSettingsOpen} />
        <VStack gap={4} padding={3}>
          <VStack gap={1}>
            <Text weight="semibold">{user.name}</Text>
            <Text type="supporting">{user.unitLabel}</Text>
          </VStack>
          <RadioList
            label="Utseende"
            value={mode}
            onChange={value => {
              if (value === 'system' || value === 'light' || value === 'dark') setMode(value);
            }}
            description={
              isPersistent
                ? 'Valet sparas i den här webbläsaren.'
                : 'Webbläsaren tillåter inte att valet sparas. Det gäller tills du laddar om sidan.'
            }
          >
            <RadioListItem value="system" label="Samma som datorn" />
            <RadioListItem value="light" label="Ljust" />
            <RadioListItem value="dark" label="Mörkt" />
          </RadioList>
          <Button label="Stäng" variant="secondary" onClick={() => setSettingsOpen(false)} />
        </VStack>
      </Dialog>
    </>
  );
}
