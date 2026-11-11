import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
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
  Spinner,
  Text,
  Theme,
  Timestamp,
  VStack,
  useAppearance,
} from '@clew/ui';
import { createClewTheme } from '@clew/ui/theme';
import { useBranding } from '../branding';
import { threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { activeReminders } from '../stream';
import { cardOverPage } from '../panel-address';

/**
 * The bell and its list (D39): an anchored Popover on a screen with a pointer, Astryx's BottomSheet on a touch phone
 * (`presentation="adaptive"`). The count sits inside the button, as plain figures like the rail's own counts. A reminder
 * opens its card over the page the person is on (D110 rule 2): beside it where the page holds the panel, else the
 * shell's drawer over it.
 *
 * The bell stands in the header's band (D88), whose theme turns text white for the band's dark ground. From Astryx
 * 0.7.12 the popover's content is drawn inside the theme of its trigger, so the list would be white words on the
 * popover's own light ground: the content is wrapped in the page's theme again, a nested `Theme` as the band itself is.
 */
export function ReminderBell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // The same session-scoped cache as the start page; no notification endpoint or read/unread state.
  const threadsQ = useQuery(threadsQuery);
  const reminders = activeReminders(threadsQ.data?.threads ?? [], new Date().toISOString());
  useEffect(() => {
    setOpen(false);
  }, [location.key]);
  const name = threadsQ.isError ? 'Påminnelser – kunde inte uppdateras' : `Påminnelser: ${reminders.length}`;
  const pageTheme = createClewTheme(useBranding());
  const { mode } = useAppearance();
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      label="Påminnelser"
      closeButtonLabel="Stäng påminnelser"
      presentation="adaptive"
      placement="below"
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
                  description="När ett kort kommer tillbaka vid tiden du valde visas det här."
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
              <Link href="/" hasUnderline>
                Öppna Hem
              </Link>
            </HStack>
          </VStack>
        </Theme>
      }
    >
      <Button
        label={reminders.length ? String(reminders.length) : name}
        aria-label={name}
        isIconOnly={reminders.length === 0}
        icon={<Icon icon={BellIcon} size="sm" />}
        variant="ghost"
        size="sm"
        tooltip="Påminnelser"
      />
    </Popover>
  );
}
