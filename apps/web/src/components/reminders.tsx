import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, BellIcon, Button, Divider, EmptyState, Heading, HStack, Icon, Link, List, ListItem, Popover, Spinner, Text, Timestamp, VStack } from '@clew/ui';
import { threadsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { activeReminders } from '../stream';

/**
 * The bell and its list (D39): an anchored Popover on a screen with a pointer, Astryx's BottomSheet on a touch phone
 * (`presentation="adaptive"`). The count sits inside the button, as plain figures like the rail's own counts.
 */
export function ReminderBell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // The same session-scoped cache as the start page; no notification endpoint or read/unread state.
  const threadsQ = useQuery(threadsQuery);
  const reminders = activeReminders(threadsQ.data?.threads ?? [], new Date().toISOString());
  useEffect(() => { setOpen(false); }, [location.key]);
  const name = threadsQ.isError ? 'Påminnelser – kunde inte uppdateras' : `Påminnelser: ${reminders.length}`;
  return <Popover isOpen={open} onOpenChange={setOpen} label="Påminnelser" closeButtonLabel="Stäng påminnelser" presentation="adaptive"
    placement="below" alignment="start" width={380} padding={0}
    content={<VStack>
      <HStack padding={3}><Heading level={4} accessibilityLevel={2}>Påminnelser</Heading></HStack>
      <Divider />
      {threadsQ.isPending && <HStack padding={3} gap={2}><Spinner /><Text role="status">Hämtar påminnelser …</Text></HStack>}
      {threadsQ.isError && <VStack padding={3}><Banner collapsible={false} status="error" title={errorMessage(threadsQ.error, 'Påminnelserna kunde inte uppdateras.')}
        endContent={<Button label="Försök igen" size="sm" variant="secondary" onClick={() => { void threadsQ.refetch(); }} />} /></VStack>}
      {threadsQ.data && (reminders.length === 0
        ? <EmptyState isCompact headingLevel={3} icon={<Icon icon={BellIcon} size="lg" />} title="Inga aktuella påminnelser"
          description="När ett kort kommer tillbaka vid tiden du valde visas det här." />
        : <List density="spacious" aria-label="Aktuella påminnelser">{reminders.map(thread => <ListItem key={thread.id}
          label={<Text weight="semibold" maxLines={2}>{thread.title}</Text>}
          description={<Text type="supporting">{thread.trigger.source} · <Timestamp value={thread.trigger.at} format="relative" hasTooltip={false} /></Text>}
          href={`/todo?card=${encodeURIComponent(thread.id)}`} />)}</List>)}
      <Divider />
      <HStack padding={3}><Link href="/todo" hasUnderline>Öppna Att göra</Link></HStack>
    </VStack>}>
    <Button label={reminders.length ? String(reminders.length) : name} aria-label={name} isIconOnly={reminders.length === 0}
      icon={<Icon icon={BellIcon} size="sm" />} variant="ghost" size="sm" tooltip="Påminnelser" />
  </Popover>;
}
