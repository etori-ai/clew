import { useEffect, useState, type ReactNode } from 'react';
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
  Flyout,
  Spinner,
  Text,
  Timestamp,
  VStack,
} from '@clew/ui';
import { threadsQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { activeReminders } from '../../stream';
import { cardOverPage } from '../../panel-address';

/** The active reminders and what is said about them: the session's cache, as the start page has it (no read state). */
function useReminders() {
  const threadsQ = useQuery(threadsQuery);
  const reminders = activeReminders(threadsQ.data?.threads ?? [], new Date().toISOString());
  const label = threadsQ.data ? `Påminnelser: ${reminders.length}` : 'Påminnelser';
  const name = threadsQ.isError ? `${label} – kunde inte uppdateras` : label;
  return { threadsQ, reminders, name };
}

/**
 * The reminders' list (D39) under the bell: a `Flyout`, so an anchored popover on a screen with a pointer and a low
 * sheet with a visible "Stäng" on a touch phone. A reminder opens its work item where a work item opens from the page
 * the person is on (D126 rules 1 and 2): Att göra's reading pane in the queue, else its own page. What opens from the
 * band is drawn as the page by the band's own theme (`createHeaderBandTheme`), so nothing here wraps itself in one.
 */
function RemindersPopover({
  trigger,
}: {
  trigger: (count: number, name: string, press: (() => void) | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { threadsQ, reminders, name } = useReminders();
  useEffect(() => {
    setOpen(false);
  }, [location.key]);
  return (
    <Flyout
      isOpen={open}
      onOpenChange={setOpen}
      label="Påminnelser"
      closeLabel="Stäng påminnelser"
      width={380}
      content={
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
      }
      trigger={press => trigger(reminders.length, name, press)}
    />
  );
}

/**
 * The bell on the shared header's band (D88): how many are due as a badge beside it (D130). The button is named by
 * what it is and how many are due ("Påminnelser: 2"); with a count the badge is its only visible text, and the name
 * holds that number (2.5.3), so the visible label is empty and Astryx's `Button` names it by `label`.
 */
export function ReminderBell() {
  return (
    <RemindersPopover
      trigger={(count, name, press) =>
        count ? (
          <Button
            label={name}
            onClick={press}
            icon={<Icon icon={BellIcon} size="sm" />}
            variant="ghost"
            tooltip="Påminnelser"
            endContent={<Badge variant="error" label={String(count)} />}
          >
            {''}
          </Button>
        ) : (
          <Button
            label={name}
            onClick={press}
            isIconOnly
            icon={<Icon icon={BellIcon} size="sm" />}
            variant="ghost"
            tooltip="Påminnelser"
          />
        )
      }
    />
  );
}
