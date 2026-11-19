import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Banner,
  BellIcon,
  Button,
  Divider,
  EmptyState,
  Heading,
  HStack,
  Icon,
  Link,
  List,
  ListItem,
  Popover,
  SideNavItem,
  Spinner,
  Text,
  Theme,
  Timestamp,
  VStack,
  VisuallyHidden,
  useAppearance,
} from '@clew/ui';
import { createClewTheme } from '@clew/ui/theme';
import { useBranding } from '../../branding';
import { threadsQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { activeReminders } from '../../stream';
import { cardOverPage } from '../../panel-address';

/**
 * The phone's drawer closes when a row in it is chosen; a row that opens something over the drawer instead (the
 * reminders' list) calls this first, so the row is still there for Escape to give the focus back to (2.4.3). The shell
 * provides it around the rail.
 */
export const KeepNavigation = createContext<() => void>(() => undefined);

/** The active reminders and what is said about them: the session's cache, as the start page has it (no read state). */
function useReminders() {
  const threadsQ = useQuery(threadsQuery);
  const reminders = activeReminders(threadsQ.data?.threads ?? [], new Date().toISOString());
  const name = threadsQ.isError ? 'Påminnelser – kunde inte uppdateras' : `Påminnelser: ${reminders.length}`;
  return { threadsQ, reminders, name };
}

/**
 * The reminders' list (D39) in its popover: an anchored Popover on a screen with a pointer, Astryx's BottomSheet on a
 * touch phone (`presentation="adaptive"`). A reminder opens its work item where a work item opens from the page the
 * person is on (D126 rules 1 and 2): Att göra's reading pane in the queue, else its own page.
 *
 * In the header's band (D88), whose theme turns text white for the band's dark ground, the popover's content would be
 * drawn inside the theme of its trigger (Astryx 0.7.12): it is wrapped in the page's theme again, a nested `Theme` as
 * the band itself is.
 */
function RemindersPopover({
  trigger,
  placement,
}: {
  trigger: (count: number, name: string) => ReactNode;
  placement: 'below' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { threadsQ, reminders, name } = useReminders();
  useEffect(() => {
    setOpen(false);
  }, [location.key]);
  const pageTheme = createClewTheme(useBranding());
  const { mode } = useAppearance();
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      label="Påminnelser"
      closeButtonLabel="Stäng påminnelser"
      presentation="adaptive"
      placement={placement}
      alignment="start"
      width={380}
      padding={0}
      content={
        <Theme theme={pageTheme} mode={mode}>
          <VStack>
            <HStack padding={3}>
              <Heading level={3} accessibilityLevel={2}>
                Påminnelser
              </Heading>
            </HStack>
            <Divider />
            {threadsQ.isPending && (
              <HStack padding={3} gap={2}>
                <Spinner />
                <Text role="status">Hämtar påminnelser …</Text>
              </HStack>
            )}
            {threadsQ.isError && (
              <VStack padding={3}>
                <Banner
                  collapsible={false}
                  status="error"
                  title={errorMessage(threadsQ.error, 'Påminnelserna kunde inte uppdateras.')}
                  endContent={
                    <Button
                      label="Försök igen"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void threadsQ.refetch();
                      }}
                    />
                  }
                />
              </VStack>
            )}
            {threadsQ.data &&
              (reminders.length === 0 ? (
                <EmptyState
                  isCompact
                  headingLevel={3}
                  icon={<Icon icon={BellIcon} size="lg" />}
                  title="Inga aktuella påminnelser"
                  description="När ett ärende kommer tillbaka vid tiden du valde visas det här."
                />
              ) : (
                <List density="spacious" aria-label="Aktuella påminnelser">
                  {reminders.map(thread => (
                    <ListItem
                      key={thread.id}
                      label={
                        <Text weight="semibold" maxLines={2}>
                          {thread.title}
                        </Text>
                      }
                      description={
                        <Text type="supporting">
                          {thread.trigger.source} ·{' '}
                          <Timestamp value={thread.trigger.at} format="relative" hasTooltip={false} />
                        </Text>
                      }
                      href={cardOverPage(location.pathname, location.search, thread.id)}
                    />
                  ))}
                </List>
              ))}
            <Divider />
            <HStack padding={3}>
              <Link href="/todo" hasUnderline>
                Öppna Att göra
              </Link>
            </HStack>
          </VStack>
        </Theme>
      }
    >
      {trigger(reminders.length, name)}
    </Popover>
  );
}

/**
 * The bell on the shared header's band (D88): how many are due as a badge beside it (D130).
 */
export function ReminderBell() {
  return (
    <RemindersPopover
      placement="below"
      trigger={(count, name) => (
        <Button
          label={count ? String(count) : name}
          aria-label={name}
          isIconOnly={count === 0}
          icon={<Icon icon={BellIcon} size="sm" />}
          variant="ghost"
          size="sm"
          tooltip="Påminnelser"
          // The count as a badge beside the bell, as the reference marks what waits there (D130).
          {...(count ? { endContent: <Badge variant="error" label={String(count)} /> } : {})}
        >
          {count ? <VisuallyHidden>{name}</VisuallyHidden> : undefined}
        </Button>
      )}
    />
  );
}

/**
 * Påminnelser as a row of the rail under Mitt arbete (D126 rule 7, pending the product owner's confirmation: the bell
 * beside the rail's heading is not on the canvas, and the rail is where the board has room for it), with how many are
 * due as its badge, opening the same list beside the rail. Where the shared header's band stands, the bell is there
 * instead and the rail has no such row.
 */
export function ReminderRow() {
  const keep = useContext(KeepNavigation);
  return (
    <RemindersPopover
      placement="end"
      trigger={(count, name) => (
        <SideNavItem
          label="Påminnelser"
          icon={BellIcon}
          // The list opens over the phone's drawer, which stays under it so Escape gives the focus back to this row.
          onClick={keep}
          // Named by what it draws: the word and how many; a list that could not be read says so too (4.1.2).
          endContent={
            count ? (
              <Badge variant="neutral" label={String(count)} />
            ) : name.includes('kunde inte') ? (
              <VisuallyHidden>kunde inte uppdateras</VisuallyHidden>
            ) : undefined
          }
        />
      )}
    />
  );
}
